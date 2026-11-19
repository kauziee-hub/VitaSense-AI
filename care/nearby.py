"""Find doctors and hospitals near the user for a given specialty.

Google Places (New) when GOOGLE_MAPS_API_KEY is set; otherwise OpenStreetMap's
Nominatim search, which needs no key (its policy allows about one request per
second: fine for a prototype; production should set the Google key). Either way
the response carries a Google Maps search link so the user can see every option
Google knows about.
"""

from __future__ import annotations

import asyncio
import logging
import math
import os
import re
import time
from typing import Any
from urllib.parse import quote

import httpx

logger = logging.getLogger(__name__)

NOMINATIM_URL = "https://nominatim.openstreetmap.org/search"
NOMINATIM_QUERIES = ("hospital", "clinic", "doctors")
PLACES_URL = "https://places.googleapis.com/v1/places:searchText"
USER_AGENT = "VitaSense/1.0 (health assistant prototype)"
CACHE_SECONDS = 600
DEFAULT_RADIUS_M = 5000

# label shown to the user -> (words that name it in chat answers, OpenStreetMap speciality values)
SPECIALTIES: dict[str, tuple[tuple[str, ...], tuple[str, ...]]] = {
    "General physician": (("general physician", "family doctor", "general practitioner", "internal medicine", "physician", "gp"), ("general", "internal")),
    "Cardiologist": (("cardiologist", "cardiology", "heart specialist"), ("cardiology",)),
    "Gastroenterologist": (("gastroenterologist", "gastroenterology", "gastro"), ("gastroenterology",)),
    "Pulmonologist": (("pulmonologist", "chest specialist", "respiratory specialist", "pulmonology"), ("pulmonology", "pneumology")),
    "ENT specialist": (("ent", "otolaryngologist", "ear nose throat", "ear, nose"), ("otolaryngology", "ent")),
    "Dermatologist": (("dermatologist", "skin specialist", "dermatology"), ("dermatology",)),
    "Neurologist": (("neurologist", "neurology"), ("neurology",)),
    "Orthopedist": (("orthopedic", "orthopaedic", "orthopedist", "bone specialist"), ("orthopaedics", "orthopedics")),
    "Endocrinologist": (("endocrinologist", "diabetologist", "thyroid specialist"), ("endocrinology", "diabetology")),
    "Gynecologist": (("gynecologist", "gynaecologist", "obstetrician", "ob-gyn"), ("gynaecology", "obstetrics")),
    "Psychiatrist": (("psychiatrist", "psychiatry"), ("psychiatry",)),
    "Psychologist": (("psychologist", "therapist", "counsellor", "counselor"), ("psychology", "psychotherapy")),
    "Ophthalmologist": (("ophthalmologist", "eye specialist", "eye doctor"), ("ophthalmology",)),
    "Urologist": (("urologist",), ("urology",)),
    "Nephrologist": (("nephrologist", "kidney specialist"), ("nephrology",)),
    "Pediatrician": (("pediatrician", "paediatrician", "child specialist"), ("paediatrics", "pediatrics")),
    "Dentist": (("dentist", "dental"), ("dentist", "dentistry")),
    "Allergist": (("allergist", "allergy specialist", "immunologist"), ("allergology", "immunology")),
}


# Words in a place's name that mark it as a single-specialty centre.
NAME_SPECIALTY_CLUES: tuple[tuple[str, str], ...] = (
    (r"\beye\b|\bvision\b|netralaya|ophthalm", "Ophthalmologist"),
    (r"\bdental\b|\bdentist|\bdentis|\bsmile\b|\btooth|\bteeth\b|orthodont", "Dentist"),
    (r"fertility|\bivf\b|maternity|\bwomen'?s\b|gyn", "Gynecologist"),
    (r"\bchild|\bchildren'?s\b|\bkids?\b|paediatric|pediatric", "Pediatrician"),
    (r"\bheart\b|cardi", "Cardiologist"),
    (r"\bskin\b|derma|cosmetic|\bhair\b", "Dermatologist"),
    (r"\bent\b|ear,? nose", "ENT specialist"),
    (r"ortho(?!dont)|\bbone\b|\bjoint|\bspine\b", "Orthopedist"),
    (r"\bkidney|nephro|\buro", "Urologist"),
    (r"\bgastro|\bdigestive|\bliver\b", "Gastroenterologist"),
    (r"\bneuro|\bbrain\b", "Neurologist"),
    (r"psychiatr|\bmental\b|\bmind\b|de-?addiction", "Psychiatrist"),
    (r"diabet|endocrin|thyroid", "Endocrinologist"),
    (r"\bchest\b|pulmon|\blung", "Pulmonologist"),
)


def specialty_from_name(name: str) -> str | None:
    lowered = name.lower()
    for pattern, label in NAME_SPECIALTY_CLUES:
        if re.search(pattern, lowered):
            return label
    return None


def speciality_matches(speciality: str, label: str) -> bool:
    """OpenStreetMap speciality lists look like "gynaecology;paediatrics". Whole words only:
    "ent" must not match "dentist" or "treatment"."""
    wanted = SPECIALTIES[label][1]
    tokens = [token.strip().replace(" ", "_") for token in re.split(r"[;,]", speciality.lower()) if token.strip()]
    if label == "General physician":
        # "general_gynecology" or "general_surgery" is not a GP.
        return any(token in {"general", "general_practice", "general_medicine", "internal", "internal_medicine", "family_medicine"} for token in tokens)
    return any(token == w or token.startswith(w + "_") or (len(w) > 4 and token.startswith(w)) for token in tokens for w in wanted)


def classify_place(name: str, kind: str, speciality: str, label: str) -> str:
    """specialty: right specialist; hospital: general hospital; general: clinic; other: a different specialty."""
    if speciality and speciality_matches(speciality, label):
        return "specialty"
    clue = specialty_from_name(name)
    if clue == label:
        return "specialty"
    multi_specialty = kind == "hospital" and len(re.split(r"[;,]", speciality)) >= 3
    if clue is None and multi_specialty:
        return "hospital"
    if clue is not None or speciality:
        # An eye hospital or a dental clinic is not where a gastro patient should go.
        return "other"
    return "hospital" if kind == "hospital" else "general"


def normalise_specialty(text: str | None) -> str:
    if not text:
        return "General physician"
    lowered = text.lower()
    for label, (words, _) in SPECIALTIES.items():
        if lowered == label.lower() or any(word == lowered for word in words):
            return label
    for label, (words, _) in SPECIALTIES.items():
        if any(len(word) > 3 and word in lowered for word in words):
            return label
    return "General physician"


def distance_km(lat1: float, lng1: float, lat2: float, lng2: float) -> float:
    r = 6371.0
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dp, dl = math.radians(lat2 - lat1), math.radians(lng2 - lng1)
    a = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return round(2 * r * math.asin(math.sqrt(a)), 2)


def maps_search_url(specialty: str, lat: float, lng: float) -> str:
    return f"https://www.google.com/maps/search/{quote(specialty.lower())}/@{lat:.5f},{lng:.5f},14z"


def directions_url(lat: float, lng: float) -> str:
    return f"https://www.google.com/maps/dir/?api=1&destination={lat:.6f},{lng:.6f}"


_cache: dict[tuple[Any, ...], tuple[float, dict[str, Any]]] = {}


async def find_nearby(
    lat: float,
    lng: float,
    specialty: str | None,
    *,
    radius_m: int = DEFAULT_RADIUS_M,
    http: httpx.AsyncClient | None = None,
) -> dict[str, Any]:
    label = normalise_specialty(specialty)
    key = (round(lat, 3), round(lng, 3), label, radius_m)
    cached = _cache.get(key)
    if cached and time.monotonic() - cached[0] < CACHE_SECONDS:
        return cached[1]

    owns_client = http is None
    client = http or httpx.AsyncClient(timeout=20.0, headers={"User-Agent": USER_AGENT})
    try:
        results: list[dict[str, Any]] = []
        source = "openstreetmap"
        google_key = os.environ.get("GOOGLE_MAPS_API_KEY")
        if google_key:
            try:
                results = await _google_places(client, google_key, lat, lng, label, radius_m)
                source = "google"
            except Exception:
                logger.warning("Google Places search failed; falling back to OpenStreetMap")
        if source != "google":
            results = await _nominatim(client, lat, lng, label, radius_m)
    finally:
        if owns_client:
            await client.aclose()

    payload = {
        "specialty": label,
        "source": source,
        "radius_km": round(radius_m / 1000, 1),
        "maps_search_url": maps_search_url(label, lat, lng),
        "results": results,
    }
    _cache[key] = (time.monotonic(), payload)
    return payload


async def _google_places(
    client: httpx.AsyncClient, api_key: str, lat: float, lng: float, label: str, radius_m: int
) -> list[dict[str, Any]]:
    response = await client.post(
        PLACES_URL,
        headers={
            "X-Goog-Api-Key": api_key,
            "X-Goog-FieldMask": (
                "places.id,places.displayName,places.formattedAddress,places.location,places.rating,"
                "places.userRatingCount,places.nationalPhoneNumber,places.googleMapsUri,"
                "places.currentOpeningHours.openNow,places.primaryTypeDisplayName"
            ),
        },
        json={
            "textQuery": label.lower(),
            "maxResultCount": 15,
            "locationBias": {"circle": {"center": {"latitude": lat, "longitude": lng}, "radius": float(radius_m)}},
        },
    )
    response.raise_for_status()
    results = []
    for place in response.json().get("places", []):
        location = place.get("location") or {}
        plat, plng = location.get("latitude"), location.get("longitude")
        if plat is None or plng is None:
            continue
        results.append(
            {
                "id": place.get("id"),
                "name": (place.get("displayName") or {}).get("text") or "Unnamed",
                "kind": (place.get("primaryTypeDisplayName") or {}).get("text") or label,
                "match": "specialty",
                "address": place.get("formattedAddress"),
                "phone": place.get("nationalPhoneNumber"),
                "rating": place.get("rating"),
                "rating_count": place.get("userRatingCount"),
                "open_now": (place.get("currentOpeningHours") or {}).get("openNow"),
                "lat": plat,
                "lng": plng,
                "distance_km": distance_km(lat, lng, plat, plng),
                "maps_url": place.get("googleMapsUri") or directions_url(plat, plng),
                "directions_url": directions_url(plat, plng),
            }
        )
    results.sort(key=lambda r: r["distance_km"])
    return results


def _address(item: dict[str, Any]) -> str | None:
    address = item.get("address") or {}
    parts = [
        " ".join(p for p in (address.get("house_number"), address.get("road")) if p),
        address.get("quarter") or address.get("neighbourhood") or address.get("suburb"),
        address.get("city") or address.get("town") or address.get("village"),
    ]
    text = ", ".join(p for p in parts if p)
    return text or None


KIND_LABELS = {"hospital": "Hospital", "clinic": "Clinic", "doctors": "Doctor's clinic"}
GENERIC_NAMES = {"clinic", "hospital", "doctors", "doctor", "pharmacy"}


async def _nominatim(client: httpx.AsyncClient, lat: float, lng: float, label: str, radius_m: int) -> list[dict[str, Any]]:
    d_lat = radius_m / 111_000
    d_lng = radius_m / (111_000 * max(math.cos(math.radians(lat)), 0.1))
    viewbox = f"{lng - d_lng:.5f},{lat + d_lat:.5f},{lng + d_lng:.5f},{lat - d_lat:.5f}"
    seen: set[str] = set()
    results: list[dict[str, Any]] = []
    for index, query in enumerate(NOMINATIM_QUERIES):
        if index:
            await asyncio.sleep(1.05)  # Nominatim usage policy: at most one request per second.
        response = await client.get(
            NOMINATIM_URL,
            params={
                "q": query,
                "format": "jsonv2",
                "viewbox": viewbox,
                "bounded": 1,
                "limit": 40,
                "addressdetails": 1,
                "extratags": 1,
            },
        )
        response.raise_for_status()
        for item in response.json():
            name = (item.get("name") or "").strip()
            if item.get("category") not in {"amenity", "healthcare"} or not name or name.lower() in seen:
                continue
            # Unnamed places are sometimes stored with their type as the name ("clinic").
            if name.lower() in GENERIC_NAMES:
                continue
            seen.add(name.lower())
            plat, plng = float(item["lat"]), float(item["lon"])
            tags = item.get("extratags") or {}
            speciality = (tags.get("healthcare:speciality") or "").lower()
            amenity = item.get("type") or ""
            match = classify_place(name, amenity, speciality, label)
            address = _address(item)
            results.append(
                {
                    "id": f"osm-{item.get('osm_type')}-{item.get('osm_id')}",
                    "name": name,
                    "kind": KIND_LABELS.get(amenity, "Clinic"),
                    "speciality": speciality.replace(";", ", ").replace("_", " ") or None,
                    "match": match,
                    "address": address,
                    "phone": tags.get("phone") or tags.get("contact:phone"),
                    "website": tags.get("website") or tags.get("contact:website"),
                    "opening_hours": tags.get("opening_hours"),
                    "emergency": tags.get("emergency") == "yes",
                    "rating": None,
                    "rating_count": None,
                    "open_now": None,
                    "lat": plat,
                    "lng": plng,
                    "distance_km": distance_km(lat, lng, plat, plng),
                    "maps_url": f"https://www.google.com/maps/search/?api=1&query={quote(name + ' ' + (address or ''))}",
                    "directions_url": directions_url(plat, plng),
                }
            )
    # A General physician search should not bury every clinic below hospitals.
    rank = {"specialty": 0, "hospital": 1, "general": 1 if label == "General physician" else 2, "other": 3}
    results = [r for r in results if r["distance_km"] <= radius_m / 1000 * 1.5]
    results.sort(key=lambda r: (rank[r["match"]], r["distance_km"]))
    return results[:25]
