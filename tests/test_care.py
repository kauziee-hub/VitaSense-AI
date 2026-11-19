import httpx
import pytest

from care import nearby
from care.doctor_report import build_doctor_report
from care.nearby import find_nearby, normalise_specialty

FORECAST = {
    "metrics": {
        "sleep": {"label": "Sleep", "value": 5.8, "baseline": 6.4, "unit": "h", "trend": "below_baseline"},
        "hydration": {"label": "Hydration", "value": 1500, "baseline": 1800, "unit": "ml", "trend": "below_baseline"},
    },
    "reasoning_timeline": [{"title": "Outside food 5 times this week", "evidence": "Meal notes"}],
    "live_risk_intelligence": {"local_alerts": [{"title": "Dengue cases rising", "detail": "3 km away"}]},
}
PROFILE = {"user_medical_identity": {"allergy_conditions": ["dust sensitivity"], "major_medical_history": ["no major history reported"]}}
RECORDS = {
    "conditions": ["Hypertension"],
    "allergies": ["Penicillin"],
    "procedures": [],
    "latest_labs": [{"name": "LDL", "value": 162, "unit": "mg/dL", "ref_low": 0, "ref_high": 100, "flag": "high", "date": "2026-10-01"}],
    "medications": [
        {"name": "Amlodipine", "strength": "5 mg", "times": ["08:00"], "as_needed": False, "active": True, "start_date": "2026-01-01", "end_date": None}
    ],
}


def test_specialty_names_from_chat_answers_normalise():
    assert normalise_specialty("a Gastroenterologist") == "Gastroenterologist"
    assert normalise_specialty("ENT") == "ENT specialist"
    assert normalise_specialty("General Physician or Internal Medicine specialist") == "General physician"
    assert normalise_specialty(None) == "General physician"
    assert normalise_specialty("something odd") == "General physician"


class FakeAI:
    def __init__(self, result=None, error=False):
        self.result = result
        self.error = error
        self.prompts = []

    async def generate_json(self, **kwargs):
        self.prompts.append(kwargs["prompt"])
        if self.error:
            raise RuntimeError("down")
        return self.result


@pytest.mark.asyncio
async def test_doctor_report_combines_facts_with_ai_narrative():
    ai = FakeAI(
        {
            "reason_for_visit": "Burning chest discomfort after meals for 3 days.",
            "symptom_timeline": [{"when": "3 days ago", "detail": "Started after a late spicy dinner"}],
            "relevant_context": ["Ate outside 5 times this week"],
            "questions_for_doctor": ["Could this be reflux?"],
        }
    )
    report = await build_doctor_report(
        ai_client=ai,
        user_name="Kausik",
        specialty="gastroenterologist",
        concern="burning in chest after food",
        conversation=[{"role": "user", "content": "chest burns after dinner"}],
        forecast=FORECAST,
        profile=PROFILE,
        records=RECORDS,
    )

    assert report["specialty"] == "Gastroenterologist"
    assert report["ai_written"] is True
    assert report["reason_for_visit"].startswith("Burning chest")
    assert report["history"]["allergies"] == ["Penicillin", "dust sensitivity"]
    assert report["history"]["past_history"] == []  # "no major history" is not history
    assert report["medications"][0]["name"] == "Amlodipine"
    assert report["labs"][0]["range"] == "0-100"
    assert report["lifestyle_30d"][0] == {"label": "Sleep", "latest": "5.8 h", "average_30d": "6.4 h", "trend": "below_baseline"}
    # The AI was given the real facts to work from.
    assert "Penicillin" in ai.prompts[0] and "Dengue" in ai.prompts[0]


@pytest.mark.asyncio
async def test_doctor_report_still_works_without_ai():
    report = await build_doctor_report(
        ai_client=FakeAI(error=True),
        user_name="Kausik",
        specialty=None,
        concern="",
        conversation=[{"role": "user", "content": "headache for two days"}],
        forecast=FORECAST,
        profile=PROFILE,
        records=RECORDS,
    )
    assert report["ai_written"] is False
    assert "headache for two days" in report["reason_for_visit"]
    assert report["questions_for_doctor"]
    assert report["specialty"] == "General physician"


NOMINATIM_REPLIES = {
    "hospital": [
        {
            "osm_type": "way",
            "osm_id": 2,
            "lat": "12.94",
            "lon": "77.62",
            "category": "amenity",
            "type": "hospital",
            "name": "City Hospital",
            "address": {"road": "80 Feet Road", "suburb": "Koramangala", "city": "Bengaluru"},
            "extratags": {"phone": "+91 80 1234"},
        },
    ],
    "clinic": [
        {"osm_type": "node", "osm_id": 1, "lat": "12.935", "lon": "77.625", "category": "amenity", "type": "clinic", "name": "Sunrise Clinic"},
        # Unnamed place stored with its type as the name: skipped.
        {"osm_type": "node", "osm_id": 4, "lat": "12.93", "lon": "77.62", "category": "amenity", "type": "clinic", "name": "clinic"},
        # Not a healthcare place: skipped.
        {"osm_type": "node", "osm_id": 5, "lat": "12.93", "lon": "77.62", "category": "shop", "type": "chemist", "name": "Wellness Pharmacy"},
    ],
    "doctors": [
        {
            "osm_type": "node",
            "osm_id": 3,
            "lat": "12.95",
            "lon": "77.63",
            "category": "amenity",
            "type": "doctors",
            "name": "Heart Care Centre",
            "extratags": {"healthcare:speciality": "cardiology"},
        },
        # Same place returned by two queries: listed once.
        {"osm_type": "node", "osm_id": 1, "lat": "12.935", "lon": "77.625", "category": "amenity", "type": "clinic", "name": "Sunrise Clinic"},
    ],
}


async def _no_sleep(_seconds):
    return None


@pytest.mark.asyncio
async def test_nearby_ranks_matching_specialists_then_hospitals(monkeypatch):
    nearby._cache.clear()
    monkeypatch.setattr(nearby.asyncio, "sleep", _no_sleep)
    queries = []

    def handler(request: httpx.Request) -> httpx.Response:
        query = request.url.params["q"]
        queries.append(query)
        assert request.url.params["bounded"] == "1"
        return httpx.Response(200, json=NOMINATIM_REPLIES[query])

    async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
        result = await find_nearby(12.9352, 77.6245, "cardiologist", http=client)

    assert queries == ["hospital", "clinic", "doctors"]
    assert result["source"] == "openstreetmap"
    assert [r["name"] for r in result["results"]] == ["Heart Care Centre", "City Hospital", "Sunrise Clinic"]
    assert result["results"][1]["address"] == "80 Feet Road, Koramangala, Bengaluru"
    assert result["results"][1]["phone"] == "+91 80 1234"
    assert result["maps_search_url"].startswith("https://www.google.com/maps/search/cardiologist/@12.93520,77.62450")
    assert result["results"][0]["directions_url"].startswith("https://www.google.com/maps/dir/?api=1&destination=")


@pytest.mark.asyncio
async def test_nearby_uses_google_places_when_a_key_is_set(monkeypatch):
    nearby._cache.clear()
    monkeypatch.setenv("GOOGLE_MAPS_API_KEY", "test-key")

    def handler(request: httpx.Request) -> httpx.Response:
        assert request.headers["X-Goog-Api-Key"] == "test-key"
        return httpx.Response(
            200,
            json={
                "places": [
                    {
                        "id": "abc",
                        "displayName": {"text": "Dr Rao Gastro Clinic"},
                        "location": {"latitude": 12.94, "longitude": 77.62},
                        "rating": 4.6,
                        "userRatingCount": 210,
                        "googleMapsUri": "https://maps.google.com/?cid=1",
                    }
                ]
            },
        )

    async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
        result = await find_nearby(12.9352, 77.6245, "Gastroenterologist", http=client)

    assert result["source"] == "google"
    assert result["results"][0]["rating"] == 4.6
    assert result["results"][0]["maps_url"] == "https://maps.google.com/?cid=1"


def test_place_ranking_uses_whole_words_and_name_clues():
    from care.nearby import classify_place

    # "ent" is inside "dentist" and "treatment": neither is an ENT clinic.
    assert classify_place("Toothsi", "clinic", "dentist", "ENT specialist") == "other"
    assert classify_place("Stone Hospital", "hospital", "lithotripsy treatment", "ENT specialist") == "other"
    assert classify_place("Smruthi ENT Clinic", "clinic", "otolaryngology", "ENT specialist") == "specialty"
    # An eye hospital is not where a stomach complaint goes; a general hospital is.
    assert classify_place("Vasan Eye Care Hospital", "hospital", "", "Gastroenterologist") == "other"
    assert classify_place("Acura Speciality Hospital", "hospital", "", "Gastroenterologist") == "hospital"
    assert classify_place("City Hospital", "hospital", "general;surgery;cardiology", "Gastroenterologist") == "hospital"
    assert classify_place("Narayana Heart Centre", "hospital", "", "Cardiologist") == "specialty"


def test_general_physician_needs_an_exact_general_speciality():
    from care.nearby import speciality_matches

    assert speciality_matches("general", "General physician")
    assert speciality_matches("internal_medicine;cardiology", "General physician")
    assert not speciality_matches("general gynecology, obstetrics", "General physician")
    assert not speciality_matches("general_surgery", "General physician")
