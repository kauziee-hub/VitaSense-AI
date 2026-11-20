"""Environmental health risks where the user is, from real weather and air data.

Input: the user's stored daily environment rows (Open-Meteo weather + air quality, collected
from their location) plus the region (state / country) and elevation of that location.
Output: one assessment per risk family with a level, the numbers behind it, what it can
cause, what to watch for, how to protect yourself and when to see which doctor.

Two kinds of output, labelled so the app never overstates them:
- "measured": pollution, heat, cold, UV — straight from today's measurements and forecasts.
- "estimate": infection risks (mosquito-borne, water-borne, respiratory) — how favourable the
  weather and season are, weighted by how common the disease is in the region. These are not
  outbreak reports; WHO outbreak notices are handled separately (collect/outbreaks.py).
VitaSense never names medicines here: advice is prevention, symptoms and which doctor/test.
"""

from __future__ import annotations

from datetime import date
from typing import Any, Literal

Level = Literal["low", "moderate", "high"]

# WHO 2021 air-quality guideline, 24-hour mean, µg/m³ (O3 is an 8-hour value; daily mean of
# hourly values is used as a conservative stand-in). CO is reported by Open-Meteo in µg/m³.
WHO_24H = {"pm2_5": 15.0, "pm10": 45.0, "nitrogen_dioxide": 25.0, "sulphur_dioxide": 40.0, "ozone": 100.0, "carbon_monoxide": 4000.0}
POLLUTANT_NAMES = {
    "pm2_5": "Fine particles (PM2.5)",
    "pm10": "Coarse particles (PM10)",
    "nitrogen_dioxide": "Nitrogen dioxide (traffic)",
    "sulphur_dioxide": "Sulphur dioxide (industry)",
    "ozone": "Ozone (smog)",
    "carbon_monoxide": "Carbon monoxide",
}

# India: approximate endemicity by state (National Center for Vector Borne Diseases Control
# reporting). Coarse on purpose: it only weights a weather-driven estimate.
INDIA_MALARIA = {
    "high": {"odisha", "chhattisgarh", "jharkhand", "meghalaya", "mizoram", "tripura", "arunachal pradesh", "andaman and nicobar islands"},
    "moderate": {
        "madhya pradesh", "maharashtra", "west bengal", "assam", "gujarat", "rajasthan", "uttar pradesh",
        "telangana", "andhra pradesh", "manipur", "nagaland", "bihar", "dadra and nagar haveli and daman and diu",
    },
}
INDIA_JE = {
    "assam", "uttar pradesh", "bihar", "west bengal", "tamil nadu", "karnataka", "andhra pradesh", "telangana",
    "kerala", "haryana", "manipur", "jharkhand", "odisha", "tripura", "goa",
}
# Countries with ongoing malaria transmission (ISO 3166-1 alpha-2, lower case; WHO World Malaria Report).
MALARIA_COUNTRIES = {
    "in", "pk", "af", "bd", "mm", "id", "pg", "kh", "la", "vn", "th", "my", "ph", "np", "bt", "lk", "sb", "vu", "tl", "kp", "kr",
    "ye", "sa", "ir", "br", "co", "ve", "pe", "bo", "ec", "gy", "sr", "gf", "pa", "hn", "ni", "gt", "mx", "ht", "do", "cr", "bz",
    "ng", "cd", "ug", "mz", "tz", "ao", "bf", "ml", "ne", "cm", "gh", "ci", "mw", "zm", "td", "sd", "ss", "et", "ke", "mg", "gn",
    "bj", "tg", "sl", "lr", "cf", "cg", "ga", "gq", "bi", "rw", "zw", "so", "er", "dj", "gm", "gw", "sn", "mr", "na", "bw", "za",
}
# Lower-middle-income settings where unsafe drinking water drives most water-borne illness.
WATER_RISK_COUNTRIES = {
    "in", "pk", "bd", "np", "af", "mm", "kh", "la", "id", "ph", "vn", "lk", "ye", "ng", "cd", "et", "ke", "ug", "tz", "mz", "mg",
    "ht", "bo", "gt", "hn", "ni", "pe", "so", "ss", "sd", "td", "ne", "ml", "bf", "cm", "gh", "ci", "zm", "mw", "zw",
}

HEAVY_RAIN_MM = 64.5  # India Meteorological Department "heavy rain" for one day


def _num(row: dict[str, Any], key: str) -> float | None:
    value = row.get(key)
    return float(value) if isinstance(value, (int, float)) else None


def _ramp(value: float | None, low: float, high: float) -> float:
    """0 at or below `low`, 1 at or above `high`, linear between."""
    if value is None:
        return 0.0
    if high == low:
        return 1.0 if value >= high else 0.0
    return max(0.0, min(1.0, (value - low) / (high - low)))


def _band(value: float | None, low: float, high: float, peak_low: float, peak_high: float) -> float:
    """Suitability window: 0 outside [low, high], 1 inside [peak_low, peak_high]."""
    if value is None:
        return 0.0
    if value <= low or value >= high:
        return 0.0
    if value < peak_low:
        return (value - low) / (peak_low - low)
    if value > peak_high:
        return (high - value) / (high - peak_high)
    return 1.0


def _level(score: float, moderate: float = 30, high: float = 55) -> Level:
    return "high" if score >= high else "moderate" if score >= moderate else "low"


def _mean(rows: list[dict[str, Any]], key: str) -> float | None:
    values = [v for v in (_num(r, key) for r in rows) if v is not None]
    return sum(values) / len(values) if values else None


def _risk(
    risk_id: str,
    category: str,
    title: str,
    score: float,
    *,
    level: Level | None = None,
    why: list[str],
    causes: list[str],
    watch_for: list[str],
    protect: list[str],
    see_doctor: str,
    kind: Literal["measured", "estimate"],
    source: str,
) -> dict[str, Any]:
    score = round(max(0.0, min(100.0, score)))
    return {
        "id": risk_id,
        "category": category,
        "title": title,
        "level": level or _level(score),
        "score": score,
        "why": [w for w in why if w],
        "causes": causes,
        "watch_for": watch_for,
        "protect": protect,
        "see_doctor": see_doctor,
        "kind": kind,
        "source": source,
    }


def season_india(month: int, kind: str) -> float:
    """How much of the year's transmission/infection season this month carries (India)."""
    if kind == "vector":  # dengue, chikungunya, malaria, JE: monsoon and post-monsoon
        return {6: 0.7, 7: 1.0, 8: 1.0, 9: 1.0, 10: 1.0, 11: 0.85, 12: 0.55}.get(month, 0.35)
    if kind == "water":  # typhoid, cholera, hepatitis A/E: pre-monsoon heat and monsoon
        return {4: 0.8, 5: 0.9, 6: 1.0, 7: 1.0, 8: 1.0, 9: 0.9, 10: 0.7}.get(month, 0.55)
    if kind == "respiratory":  # influenza peaks in monsoon and winter
        return {7: 1.0, 8: 1.0, 9: 0.85, 12: 0.85, 1: 1.0, 2: 0.85}.get(month, 0.5)
    return 1.0


def assess(
    rows_by_date: dict[str, dict[str, Any]],
    *,
    today: date | None = None,
) -> dict[str, Any]:
    """All environment risks for the latest collected day. Empty when nothing is collected."""
    if not rows_by_date:
        return {"date": None, "place": None, "risks": []}
    days = sorted(rows_by_date)
    latest_day = days[-1]
    row = rows_by_date[latest_day]
    week = [rows_by_date[d] for d in days[-7:]]
    fortnight = [rows_by_date[d] for d in days[-14:]]
    month = (today or date.fromisoformat(latest_day)).month if latest_day else date.today().month
    country = str(row.get("country_code") or "").lower()
    state = str(row.get("state") or "").lower()
    india = country == "in"
    zone = str(row.get("climate_zone") or "")
    elevation = _num(row, "elevation_m")

    risks: list[dict[str, Any]] = []
    risks.append(_air(row))
    risks.append(_heat(row))
    risks.append(_cold(row))
    risks.append(_uv(row))
    risks.append(_allergy(row, week))
    risks.extend(_vectors(row, fortnight, month=month, india=india, country=country, state=state, zone=zone, elevation=elevation))
    risks.append(_water(row, week, fortnight, month=month, india=india, country=country))
    risks.append(_respiratory(row, week, month=month, india=india))
    risks.append(_food_spoilage(row))
    risks.append(_daylight(week))
    risks = [r for r in risks if r is not None]
    order = {"high": 0, "moderate": 1, "low": 2}
    risks.sort(key=lambda r: (order[r["level"]], -r["score"]))
    return {
        "date": latest_day,
        "place": row.get("location"),
        "risks": risks,
    }


# ---------- measured ----------


def _air(row: dict[str, Any]) -> dict[str, Any] | None:
    ratios: list[tuple[float, str, float]] = []
    for key, limit in WHO_24H.items():
        value = _num(row, key)
        if value is not None:
            ratios.append((value / limit, key, value))
    aqi = _num(row, "aqi")
    if not ratios and aqi is None:
        return None
    ratios.sort(reverse=True)
    worst = ratios[0][0] if ratios else 0
    score = max(_ramp(worst, 1.0, 4.0) * 100, _ramp(aqi, 50, 200) * 100)
    why = [
        f"{POLLUTANT_NAMES[key]} {value:.0f} µg/m³, {ratio:.1f}× the WHO daily limit"
        for ratio, key, value in ratios
        if ratio >= 1
    ][:3]
    if aqi is not None:
        why.insert(0, f"US AQI {aqi:.0f} at the worst hour today")
    return _risk(
        "air_pollution",
        "air",
        "Air pollution",
        score,
        why=why or ["Pollutants within WHO daily limits"],
        causes=["Throat irritation and cough", "Asthma and COPD flare-ups", "Headache and tiredness", "Strain on heart and blood pressure"],
        watch_for=["Wheezing or breathlessness", "Cough lasting over two weeks", "Chest tightness on exertion"],
        protect=["Exercise indoors or early morning when traffic is low", "Wear a well-fitting N95 outdoors on bad days", "Keep windows shut at peak traffic hours"],
        see_doctor="General physician or pulmonologist if breathlessness or cough persists; urgent care for breathing difficulty.",
        kind="measured",
        source="Open-Meteo air quality (CAMS)",
    )


def heat_index_c(temp_c: float, humidity: float | None) -> float:
    """US NWS heat index (Rothfusz regression) in °C; below 27°C or without humidity, the temperature itself."""
    if humidity is None or temp_c < 27:
        return temp_c
    t = temp_c * 9 / 5 + 32
    rh = humidity
    hi = (
        -42.379 + 2.04901523 * t + 10.14333127 * rh - 0.22475541 * t * rh - 0.00683783 * t * t
        - 0.05481717 * rh * rh + 0.00122874 * t * t * rh + 0.00085282 * t * rh * rh - 0.00000199 * t * t * rh * rh
    )
    return (hi - 32) * 5 / 9


def _heat(row: dict[str, Any]) -> dict[str, Any] | None:
    humidity = _num(row, "humidity_percent")
    feels = _num(row, "feels_like_max_c")
    if feels is None:
        temp = _num(row, "temperature_c")
        if temp is None:
            return None
        feels = heat_index_c(temp, humidity)
    score = _ramp(feels, 32, 44) * 100
    return _risk(
        "heat",
        "climate",
        "Heat stress",
        score,
        why=[f"Feels like {feels:.0f}°C at the hottest hour", f"Humidity {humidity:.0f}%" if humidity is not None else ""],
        causes=["Dehydration", "Heat exhaustion and heat stroke", "Headache, dizziness, nausea", "Kidney strain, worse with diabetes or blood-pressure conditions"],
        watch_for=["Confusion, fainting or very high body temperature (emergency)", "Dark urine or very little urine", "Muscle cramps"],
        protect=["Drink water before you feel thirsty", "Avoid outdoor work 12:00–16:00", "Light, loose cotton clothing"],
        see_doctor="Emergency care for confusion, fainting or no sweating with high temperature; general physician for repeated dizziness.",
        kind="measured",
        source="Open-Meteo weather",
    )


def _cold(row: dict[str, Any]) -> dict[str, Any] | None:
    low = _num(row, "temperature_min_c")
    if low is None:
        return None
    score = _ramp(-low, -14, -2) * 100  # 14°C → 0, 2°C → 100
    return _risk(
        "cold",
        "climate",
        "Cold exposure",
        score,
        why=[f"Night low {low:.0f}°C"],
        causes=["Colds and flu spread more indoors", "Asthma triggered by cold air", "Higher blood pressure and heart strain", "Joint stiffness"],
        watch_for=["Chest pain on exertion in the cold (emergency)", "Numb, pale fingers or toes"],
        protect=["Layer up at night and early morning", "Ventilate rooms if using heaters or stoves", "Warm up before morning exercise"],
        see_doctor="General physician for persistent cough or joint pain; emergency for chest pain.",
        kind="measured",
        source="Open-Meteo weather",
    )


def _uv(row: dict[str, Any]) -> dict[str, Any] | None:
    uv = _num(row, "uv_index")
    if uv is None:
        return None
    score = _ramp(uv, 3, 11) * 100
    return _risk(
        "uv",
        "climate",
        "Sun (UV) exposure",
        score,
        level="high" if uv >= 8 else "moderate" if uv >= 6 else "low",
        why=[f"UV index {uv:.0f} at midday"],
        causes=["Sunburn", "Eye strain and cataract risk over years", "Skin ageing and skin cancer risk over years"],
        watch_for=["Blistering sunburn", "A mole that changes shape or colour"],
        protect=["Shade between 11:00 and 15:00", "Sunglasses and a cap", "Sunscreen on exposed skin"],
        see_doctor="Dermatologist for a changing mole or severe sunburn.",
        kind="measured",
        source="Open-Meteo weather",
    )


def _allergy(row: dict[str, Any], week: list[dict[str, Any]]) -> dict[str, Any] | None:
    pollen = _num(row, "pollen_max")
    dust = _num(row, "dust")
    pm10 = _num(row, "pm10")
    damp_days = sum(1 for r in week if (_num(r, "humidity_percent") or 0) >= 75)
    if pollen is None and dust is None and pm10 is None and not week:
        return None
    score = max(
        _ramp(pollen, 10, 80) * 100,
        _ramp(dust, 20, 100) * 100,
        _ramp(pm10, 45, 150) * 80,
        _ramp(damp_days, 2, 6) * 60,
    )
    why = []
    if pollen is not None:
        why.append(f"Pollen {pollen:.0f} grains/m³")
    if dust is not None and dust >= 20:
        why.append(f"Airborne dust {dust:.0f} µg/m³")
    if pm10 is not None and pm10 >= 45:
        why.append(f"Coarse dust (PM10) {pm10:.0f} µg/m³")
    if damp_days >= 2:
        why.append(f"{damp_days} very humid days this week (mould spores)")
    return _risk(
        "allergens",
        "air",
        "Allergens (pollen, dust, mould)",
        score,
        why=why or ["Low allergen signals today"],
        causes=["Sneezing, blocked or runny nose", "Itchy, watery eyes", "Asthma flare-ups", "Skin rashes and eczema flares"],
        watch_for=["Wheezing at night", "Symptoms that return every season"],
        protect=["Keep windows closed on dusty or windy days", "Dry damp rooms; check for mould behind furniture", "Wash bedding weekly in hot water"],
        see_doctor="ENT or allergist for recurring symptoms; pulmonologist if breathing is affected.",
        kind="measured",
        source="Open-Meteo air quality (pollen where available) and weather",
    )


# ---------- estimates ----------


def _vectors(
    row: dict[str, Any],
    fortnight: list[dict[str, Any]],
    *,
    month: int,
    india: bool,
    country: str,
    state: str,
    zone: str,
    elevation: float | None,
) -> list[dict[str, Any]]:
    temp = _mean(fortnight, "temperature_mean_c") or _num(row, "temperature_mean_c")
    humidity = _mean(fortnight, "humidity_percent")
    rain = _num(row, "rain_14d_mm")
    if temp is None:
        return []
    tropical = zone != "temperate"  # unknown counts as tropical: safer to warn
    high_altitude = elevation is not None and elevation >= 1800
    season = season_india(month, "vector") if india else 1.0
    wet = 0.5 * _ramp(humidity, 45, 75) + 0.5 * _ramp(rain, 5, 60)
    weather_why = [
        f"Average {temp:.0f}°C over two weeks",
        f"Humidity around {humidity:.0f}%" if humidity is not None else "",
        f"{rain:.0f} mm of rain in 14 days" if rain is not None else "",
    ]
    if india:
        weather_why.append("Monsoon and post-monsoon are peak months" if season >= 0.85 else "Outside the main monsoon season")

    # Aedes (dengue, chikungunya, Zika): day-biting, breeds in clean stored water, so even dry
    # weeks keep a floor in tropical cities.
    aedes_climate = _band(temp, 16, 36, 25, 31) * max(wet, 0.35)
    aedes_region = 0.08 if (not tropical or high_altitude) else 1.0
    aedes = _risk(
        "aedes",
        "vector",
        "Dengue, chikungunya, Zika (Aedes mosquitoes)",
        100 * aedes_climate * season * aedes_region,
        why=weather_why + (["High altitude or temperate area: Aedes is uncommon"] if aedes_region < 1 else ["Aedes breeds in water stored in pots, coolers and tyres"]),
        causes=["Dengue fever", "Chikungunya", "Zika"],
        watch_for=[
            "Sudden high fever with severe body or joint pain",
            "Pain behind the eyes, rash",
            "Bleeding gums, vomiting, belly pain or drowsiness after the fever drops (urgent)",
        ],
        protect=["Empty standing water every week (coolers, pots, tyres)", "Repellent and full sleeves at dawn and dusk", "Window screens; Aedes bites in daytime"],
        see_doctor="General physician on day 1–2 of fever for a dengue NS1/IgM test and platelet count; emergency for bleeding or severe belly pain.",
        kind="estimate",
        source="Open-Meteo weather + regional patterns",
    )

    # Anopheles (malaria): night-biting, needs rain-fed pools; strongly regional.
    if country and country not in MALARIA_COUNTRIES:
        malaria_region = 0.05
    elif india:
        malaria_region = 1.0 if state in INDIA_MALARIA["high"] else 0.6 if state in INDIA_MALARIA["moderate"] else 0.3
    else:
        malaria_region = 0.8 if country else 0.4
    if high_altitude:
        malaria_region *= 0.3
    malaria_climate = _band(temp, 16, 34, 22, 30) * wet
    anopheles = _risk(
        "anopheles",
        "vector",
        "Malaria (Anopheles mosquitoes)",
        100 * malaria_climate * season * malaria_region,
        why=weather_why
        + [
            (
                f"{state.title()} has high malaria transmission"
                if india and state in INDIA_MALARIA["high"]
                else f"{state.title()} reports some malaria" if india and state in INDIA_MALARIA["moderate"] else "Malaria is uncommon in this region"
            )
            if india
            else ("Malaria is present in this country" if malaria_region >= 0.5 else "Malaria is rare here")
        ],
        causes=["Malaria (P. vivax, P. falciparum)"],
        watch_for=["Fever with chills and sweating, often in cycles", "Headache, vomiting", "Confusion, yellow eyes or dark urine (urgent)"],
        protect=["Sleep under an insecticide-treated net", "Repellent from dusk to dawn", "Drain puddles and blocked drains nearby"],
        see_doctor="General physician the same day for any fever with chills: a malaria rapid test or blood smear decides it; emergency if confused or very weak.",
        kind="estimate",
        source="Open-Meteo weather + WHO / NCVBDC regional patterns",
    )

    # Culex (Japanese encephalitis, filariasis, West Nile): breeds in dirty water, rice fields.
    je_region = (1.0 if state in INDIA_JE else 0.35) if india else (0.4 if tropical else 0.1)
    culex_climate = _band(temp, 15, 36, 22, 32) * wet
    culex = _risk(
        "culex",
        "vector",
        "Japanese encephalitis, filariasis (Culex mosquitoes)",
        100 * culex_climate * season * je_region * 0.85,
        why=weather_why + (["Japanese encephalitis is reported in this state"] if india and state in INDIA_JE else []),
        causes=["Japanese encephalitis", "Lymphatic filariasis", "West Nile fever"],
        watch_for=["Fever with severe headache, neck stiffness or confusion (emergency)", "Gradual swelling of a leg or arm"],
        protect=["Repellent and nets at night", "Avoid stagnant drains and paddy-field edges at dusk", "Ask about the JE vaccine if you live in or travel to affected districts"],
        see_doctor="Emergency for fever with confusion, seizures or neck stiffness; general physician for limb swelling.",
        kind="estimate",
        source="Open-Meteo weather + regional patterns",
    )
    return [aedes, anopheles, culex]


def _water(
    row: dict[str, Any],
    week: list[dict[str, Any]],
    fortnight: list[dict[str, Any]],
    *,
    month: int,
    india: bool,
    country: str,
) -> dict[str, Any] | None:
    temp = _num(row, "temperature_mean_c") or _mean(week, "temperature_mean_c")
    rain_week = sum(_num(r, "rain_mm") or 0 for r in week) if week else None
    heavy_days = sum(1 for r in fortnight if (_num(r, "rain_mm") or 0) >= HEAVY_RAIN_MM)
    if temp is None and rain_week is None:
        return None
    baseline = 0.85 if country in WATER_RISK_COUNTRIES else 0.15 if country else 0.5
    season = season_india(month, "water") if india else 1.0
    rain_factor = 0.45 + 0.55 * max(_ramp(rain_week, 10, 120), 1.0 if heavy_days else 0.0)
    heat_factor = 0.65 + 0.35 * _ramp(temp, 20, 30)
    score = 100 * baseline * season * rain_factor * heat_factor
    why = [
        f"{rain_week:.0f} mm of rain this week" if rain_week is not None else "",
        f"{heavy_days} day(s) of heavy rain in two weeks: flooding and sewage overflow can reach drinking water" if heavy_days else "",
        f"Warm days ({temp:.0f}°C average) help bacteria grow in water and food" if temp is not None and temp >= 25 else "",
        "Unsafe drinking water is common in this region" if baseline >= 0.85 else "",
    ]
    causes = ["Typhoid", "Cholera and acute diarrhoea", "Hepatitis A and E (jaundice)", "Amoebic and giardia infections"]
    if heavy_days:
        causes.append("Leptospirosis (after wading through flood water)")
    return _risk(
        "water",
        "water",
        "Water contamination",
        score,
        why=why,
        causes=causes,
        watch_for=[
            "Loose motions more than 3 times a day, or with blood (urgent)",
            "Fever lasting more than 3 days",
            "Yellow eyes or skin, dark urine",
            "Signs of dehydration: dizziness, very little urine",
        ],
        protect=[
            "Drink boiled, filtered (RO/UV) or sealed bottled water",
            "Skip street ice, cut fruit and raw salads outside",
            "Wash hands before eating; avoid wading in flood water",
        ],
        see_doctor="General physician for fever over 3 days (blood culture / typhoid test) or jaundice (liver function test); urgent care for bloody stools or dehydration.",
        kind="estimate",
        source="Open-Meteo rainfall and temperature + regional patterns",
    )


def _respiratory(row: dict[str, Any], week: list[dict[str, Any]], *, month: int, india: bool) -> dict[str, Any] | None:
    temps = [t for t in (_num(r, "temperature_mean_c") for r in week) if t is not None]
    if not temps:
        return None
    swing = max(abs(a - b) for a, b in zip(temps, temps[1:])) if len(temps) > 1 else 0
    low = _num(row, "temperature_min_c")
    humidity = _num(row, "humidity_percent")
    season = season_india(month, "respiratory") if india else (1.0 if month in (11, 12, 1, 2, 3) else 0.5)
    score = 100 * (0.5 * season + 0.2 * _ramp(swing, 3, 8) + 0.15 * _ramp(-(low or 20), -16, -6) + 0.15 * _ramp(-(humidity or 60), -60, -30))
    why = [
        "Flu season" if season >= 0.85 else "Between the main flu seasons",
        f"Temperature swung {swing:.0f}°C between days" if swing >= 3 else "",
        f"Dry air ({humidity:.0f}% humidity) dries the airways" if humidity is not None and humidity < 40 else "",
    ]
    return _risk(
        "respiratory",
        "infection",
        "Colds, flu and respiratory viruses",
        score,
        why=why,
        causes=["Common cold", "Influenza", "COVID-19 and other respiratory viruses", "Sinusitis"],
        watch_for=["Breathlessness or chest pain (urgent)", "Fever over 3 days", "Symptoms getting worse after a week"],
        protect=["Wash hands; avoid touching your face", "Mask in crowded indoor places when cases rise", "Annual flu vaccine, especially with asthma, diabetes or heart disease"],
        see_doctor="General physician for fever over 3 days or a cough with breathlessness; pulmonologist if it keeps coming back.",
        kind="estimate",
        source="Season + Open-Meteo weather",
    )


def _food_spoilage(row: dict[str, Any]) -> dict[str, Any] | None:
    temp = _num(row, "temperature_c")
    humidity = _num(row, "humidity_percent")
    if temp is None:
        return None
    score = 100 * _ramp(temp, 26, 38) * (0.6 + 0.4 * _ramp(humidity, 40, 80))
    return _risk(
        "food_spoilage",
        "food",
        "Food spoiling faster",
        score,
        why=[f"Daytime high {temp:.0f}°C", f"Humidity {humidity:.0f}%" if humidity is not None else ""],
        causes=["Food poisoning (vomiting, loose motions, cramps)", "Stomach infections from outside food"],
        watch_for=["Vomiting or loose motions within hours of a meal", "Several people sick after the same food"],
        protect=["Refrigerate leftovers within 2 hours", "Prefer freshly cooked, hot food when eating out", "Avoid buffets and cut fruit left out"],
        see_doctor="General physician if vomiting or loose motions last over a day, or for blood in stool (urgent).",
        kind="estimate",
        source="Open-Meteo weather",
    )


def _daylight(week: list[dict[str, Any]]) -> dict[str, Any] | None:
    sunshine = _mean(week, "sunshine_hours")
    if sunshine is None:
        return None
    score = _ramp(-sunshine, -6, -1) * 70
    return _risk(
        "daylight",
        "climate",
        "Low sunlight",
        score,
        why=[f"About {sunshine:.1f} h of sunshine a day this week"],
        causes=["Low mood and low energy", "Disturbed sleep-wake rhythm", "Vitamin D deficiency over months"],
        watch_for=["Low mood most days for two weeks or more", "Bone or muscle aches with tiredness"],
        protect=["20–30 minutes outdoors in morning light", "Keep a regular wake-up time"],
        see_doctor="General physician for a vitamin D test if tired and achy; psychologist or psychiatrist for persistent low mood.",
        kind="estimate",
        source="Open-Meteo weather",
    )


def top_alerts(assessment: dict[str, Any], limit: int = 4) -> list[dict[str, str]]:
    """Compact alerts (moderate and high only) for the forecast and dashboards."""
    alerts = []
    for risk in assessment.get("risks", []):
        if risk["level"] == "low":
            continue
        alerts.append(
            {
                "type": risk["id"],
                "severity": "high" if risk["level"] == "high" else "medium",
                "title": risk["title"],
                "detail": "; ".join(risk["why"][:2]),
            }
        )
    return alerts[:limit]
