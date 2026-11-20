"""Everything that can affect someone's health, and how VitaSense knows each one.

One catalogue drives the app's "Health factors" screen, the doctor report and the chat
context. Each factor lists the sources that can feed it, in order of preference, and a
reader that pulls its latest value from what was actually collected. Status per factor:

  live        an automatic source delivered a recent value
  recorded    a value from a record, the profile, a check-in or chat
  waiting     an automatic source is connected but has not delivered this yet
  connect     an automatic source exists for it but is not switched on
  on_phone    tracked automatically by the Android app, not from this platform (e.g. the website)
  manual      only the person can tell us (check-in / profile / chat) and they haven't yet
  not_tracked VitaSense deliberately doesn't collect it (said openly, with why)
"""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import date, timedelta
from typing import Any, Callable

# ---------- sources ----------

AUTO_SOURCES = {"health_connect", "band", "phone_usage", "notifications", "location", "gmail", "calendar"}

SOURCES: dict[str, dict[str, Any]] = {
    "health_connect": {
        "label": "Health Connect",
        "detail": "Watches, bands, rings, smart scales, BP monitors, glucometers and apps that sync to Health Connect "
        "(Samsung Health, Fitbit, Mi Fitness, Zepp, Garmin, boAt, Noise, Google Fit…)",
        "platforms": ["android"],
        "keys": ["health_connect", "apple_health"],
    },
    "band": {
        "label": "Fitness band (Bluetooth)",
        "detail": "Live heart rate straight from a band, watch or chest strap that broadcasts heart rate",
        "platforms": ["android"],
        "keys": ["band"],
    },
    "phone_usage": {
        "label": "Phone usage",
        "detail": "Screen time, phone use after midnight and an estimated sleep window from when the phone goes quiet",
        "platforms": ["android"],
        "keys": ["screen_time", "phone_usage"],
    },
    "notifications": {
        "label": "Delivery app alerts",
        "detail": "Order alerts from Swiggy, Zomato, Blinkit, Zepto, Instamart, BigBasket, Amazon and pharmacy apps",
        "platforms": ["android"],
        "keys": ["notifications"],
    },
    "location": {
        "label": "Location",
        "detail": "Weather, seven air pollutants, pollen, UV, rainfall → water, mosquito and infection risk, plus WHO outbreak notices",
        "platforms": ["android", "ios", "web"],
        "keys": ["location"],
    },
    "gmail": {
        "label": "Gmail",
        "detail": "Food, grocery and pharmacy order receipts and lab report PDFs",
        "platforms": ["android", "ios", "web"],
        "keys": ["gmail"],
    },
    "calendar": {
        "label": "Calendar",
        "detail": "Workload, late or early events, travel and exam days (titles never leave the phone)",
        "platforms": ["android", "ios"],
        "keys": ["calendar"],
    },
    "records": {
        "label": "Records",
        "detail": "Lab reports, prescriptions and discharge summaries you upload or that arrive by email",
        "platforms": ["android", "ios", "web"],
        "keys": [],
    },
    "check_in": {"label": "Check-in", "detail": "Three taps a day for what no sensor can see", "platforms": ["android", "ios", "web"], "keys": []},
    "profile": {"label": "Profile", "detail": "Set once and update when life changes", "platforms": ["android", "ios", "web"], "keys": []},
    "chat": {"label": "Ask VitaSense", "detail": "Symptoms and events you mention", "platforms": ["android", "ios", "web"], "keys": []},
}

CATEGORIES = [
    ("body", "Body signals"),
    ("activity", "Movement"),
    ("food", "Food & drink"),
    ("substances", "Substances & medicines"),
    ("environment", "Air, water & climate"),
    ("infections", "Infections around you"),
    ("routine", "Routine & mind"),
    ("medical", "Medical background"),
    ("life", "Life & biology"),
]

Value = tuple[str, str | None, str]  # display value, date, source id
Reader = Callable[["Ctx"], Value | None]


@dataclass
class Ctx:
    today: date
    days: dict[str, dict[str, dict[str, Any]]]  # collected: {table: {date: {field: value}}}
    field_sources: dict[str, dict[str, str]]
    connected: set[str]
    risks: dict[str, dict[str, Any]]
    outbreaks: list[dict[str, Any]]
    records: dict[str, Any]
    profile: dict[str, dict[str, Any]]
    memory: list[dict[str, Any]]  # check-in rows, newest first
    items: list[dict[str, Any]]  # collected items (orders), newest first
    sex: str | None = None
    has_chat_symptoms: list[str] = field(default_factory=list)
    demo: bool = False  # built-in demo profile: values come from sample data


def _source_of(ctx: Ctx, fld: str, default: str) -> str:
    raw = (ctx.field_sources.get(fld) or {}).get("source")
    if raw is None:
        if ctx.demo:
            return "demo"
        raw = default
    for source_id, meta in SOURCES.items():
        if raw in meta["keys"] or raw == source_id:
            return source_id
    return default


def _latest(ctx: Ctx, table: str, fld: str, within: int = 3) -> tuple[Any, str] | None:
    cutoff = (ctx.today - timedelta(days=within)).isoformat()
    for day in sorted(ctx.days.get(table, {}), reverse=True):
        if day < cutoff:
            break
        value = ctx.days[table][day].get(fld)
        if value not in (None, "", []):
            return value, day
    return None


def _auto(table: str, fld: str, fmt: Callable[[Any], str], default_source: str, within: int = 3) -> Reader:
    def read(ctx: Ctx) -> Value | None:
        found = _latest(ctx, table, fld, within)
        if not found:
            return None
        value, day = found
        return fmt(value), day, _source_of(ctx, fld, default_source)

    return read


def _memory(fld: str, fmt: Callable[[Any], str | None], within: int = 7) -> Reader:
    def read(ctx: Ctx) -> Value | None:
        cutoff = (ctx.today - timedelta(days=within)).isoformat()
        for row in ctx.memory:
            day = str(row.get("log_date") or "")
            if day and day < cutoff:
                break
            value = row.get(fld)
            if value not in (None, "", []):
                text = fmt(value)
                if text:
                    return text, day or None, "check_in"
        return None

    return read


def _first(*readers: Reader) -> Reader:
    def read(ctx: Ctx) -> Value | None:
        for reader in readers:
            value = reader(ctx)
            if value:
                return value
        return None

    return read


def _risk(risk_id: str) -> Reader:
    def read(ctx: Ctx) -> Value | None:
        risk = ctx.risks.get(risk_id)
        if not risk:
            return None
        detail = risk["why"][0] if risk["why"] else ""
        return f"{risk['level'].capitalize()} · {detail}", None, "location"

    return read


def _profile(table: str, fld: str) -> Reader:
    def read(ctx: Ctx) -> Value | None:
        value = (ctx.profile.get(table) or {}).get(fld)
        if isinstance(value, list):
            value = ", ".join(str(v) for v in value if v and not str(v).lower().startswith("no "))
        if value in (None, "", []):
            return None
        return str(value), None, "profile"

    return read


def _records_list(key: str) -> Reader:
    def read(ctx: Ctx) -> Value | None:
        values = ctx.records.get(key) or []
        if not values:
            return None
        return ", ".join(values[:4]), ctx.records.get("last_record_date"), "records"

    return read


def _orders(kinds: set[str], label: str, *, predicate: Callable[[dict[str, Any]], bool] | None = None, within: int = 7) -> Reader:
    def read(ctx: Ctx) -> Value | None:
        cutoff = (ctx.today - timedelta(days=within)).isoformat()
        hits = [
            item
            for item in ctx.items
            if item.get("kind") in kinds
            and str(item.get("happened_at") or "")[:10] >= cutoff
            and (predicate is None or predicate(item))
        ]
        if not hits:
            return None
        source = "notifications" if hits[0].get("source") == "notifications" else "gmail"
        noun = label if len(hits) != 1 else label.replace("orders", "order")
        return f"{len(hits)} {noun} in {within} days", str(hits[0].get("happened_at") or "")[:10] or None, source

    return read


def _late_order(item: dict[str, Any]) -> bool:
    stamp = str(item.get("happened_at") or "")
    try:
        hour = int(stamp[11:13])
    except ValueError:
        return False
    return hour >= 22 or hour < 4


def _hours(value: Any) -> str:
    return f"{float(value):.1f} h"


def _bpm(value: Any) -> str:
    return f"{round(float(value))} bpm"


def _num(unit: str, digits: int = 0) -> Callable[[Any], str]:
    return lambda value: f"{float(value):.{digits}f}{unit}"


def _yes(label: str) -> Callable[[Any], str | None]:
    return lambda value: label if value is True else None


@dataclass
class Factor:
    id: str
    category: str
    label: str
    affects: str
    sources: list[str]
    read: Reader | None = None
    only_sex: str | None = None
    not_tracked_reason: str | None = None


F = Factor
FACTORS: list[Factor] = [
    # ---- body signals ----
    F("sleep_duration", "body", "Sleep amount", "Energy, immunity, mood, blood sugar", ["health_connect", "phone_usage", "check_in"],
      _first(_auto("daily_fitness_data", "sleep_hours", _hours, "health_connect"),
             _auto("daily_device_behavior_data", "phone_sleep_hours", lambda v: f"≈{float(v):.1f} h (screen-off estimate)", "phone_usage"))),
    F("sleep_timing", "body", "Bedtime & regularity", "Body clock, mood, appetite", ["health_connect", "phone_usage"],
      _first(_auto("daily_fitness_data", "sleep_start_time", lambda v: f"Asleep around {str(v)[:5]}", "health_connect"),
             _auto("daily_device_behavior_data", "phone_sleep_start", lambda v: f"Phone quiet from {str(v)[:5]}", "phone_usage"))),
    F("resting_hr", "body", "Resting heart rate", "Fitness, fever, stress, thyroid", ["health_connect", "band"],
      _auto("daily_fitness_data", "resting_heart_rate", _bpm, "health_connect")),
    F("heart_rate", "body", "Heart rate", "Exertion, palpitations, infection", ["band", "health_connect"],
      _auto("daily_fitness_data", "heart_rate_avg", lambda v: f"{_bpm(v)} average", "health_connect")),
    F("hrv", "body", "Heart rate variability", "Recovery, stress, oncoming illness", ["health_connect"],
      _auto("daily_fitness_data", "hrv_ms", _num(" ms"), "health_connect")),
    F("spo2", "body", "Blood oxygen", "Lungs, sleep apnoea, infection", ["health_connect"],
      _auto("daily_fitness_data", "spo2_percent", _num("%"), "health_connect")),
    F("respiratory_rate", "body", "Breathing rate", "Infection, lung and heart strain", ["health_connect"],
      _auto("daily_fitness_data", "respiratory_rate", _num(" /min", 1), "health_connect")),
    F("body_temperature", "body", "Body temperature", "Fever, infection, cycle", ["health_connect", "check_in"],
      _auto("daily_fitness_data", "body_temperature", _num("°C", 1), "health_connect")),
    F("blood_pressure", "body", "Blood pressure", "Heart, kidneys, stroke risk", ["health_connect", "records"],
      _auto("daily_fitness_data", "blood_pressure", str, "health_connect", within=30)),
    F("blood_glucose", "body", "Blood sugar", "Diabetes, energy dips", ["health_connect", "records"],
      _auto("daily_fitness_data", "blood_glucose_mg_dl", _num(" mg/dL"), "health_connect", within=30)),
    F("weight", "body", "Weight", "Heart, joints, blood sugar", ["health_connect", "profile"],
      _auto("daily_fitness_data", "weight_kg", _num(" kg", 1), "health_connect", within=30)),
    F("body_fat", "body", "Body fat", "Metabolic health", ["health_connect"],
      _auto("daily_fitness_data", "body_fat_percent", _num("%", 1), "health_connect", within=30)),
    F("cardio_fitness", "body", "Cardio fitness (VO₂ max)", "Heart health, longevity", ["health_connect"],
      _auto("daily_fitness_data", "vo2_max", _num(" ml/kg/min", 1), "health_connect", within=60)),
    F("menstrual_cycle", "body", "Menstrual cycle", "Energy, mood, iron, pain", ["health_connect", "check_in"],
      _auto("daily_fitness_data", "period_day", lambda v: "Period logged", "health_connect", within=35), only_sex="female"),
    # ---- movement ----
    F("steps", "activity", "Steps", "Heart, weight, mood, sleep", ["health_connect"],
      _auto("daily_fitness_data", "steps", lambda v: f"{int(v):,} steps", "health_connect")),
    F("exercise", "activity", "Exercise & workouts", "Fitness, stress, sleep", ["health_connect"],
      _auto("daily_fitness_data", "exercise_minutes", _num(" min"), "health_connect")),
    F("active_energy", "activity", "Active calories", "Energy balance, weight", ["health_connect"],
      _auto("daily_fitness_data", "calories_burned", _num(" kcal"), "health_connect")),
    F("floors", "activity", "Floors climbed", "Leg strength, heart", ["health_connect"],
      _auto("daily_fitness_data", "floors_climbed", _num(" floors"), "health_connect")),
    # ---- food & drink ----
    F("outside_food", "food", "Eating out & delivery", "Stomach infections, weight, blood pressure (salt)", ["notifications", "gmail", "check_in"],
      _first(_orders({"food_order"}, "food orders"), _memory("ate_from_outside", _yes("Ate outside recently")))),
    F("junk_food", "food", "Junk & processed food", "Weight, cholesterol, acidity, energy crashes", ["notifications", "gmail", "check_in"],
      _first(_orders({"food_order"}, "fast-food orders", predicate=lambda i: bool((i.get("details") or {}).get("junk"))),
             _memory("processed_food_consumed", _yes("Junk or processed food recently")))),
    F("late_meals", "food", "Late-night eating", "Acidity, sleep, weight", ["notifications", "gmail", "check_in"],
      _first(_orders({"food_order"}, "orders after 10 pm", predicate=_late_order),
             _memory("daily_events", lambda v: "Ate after 10 pm recently" if "late_meal" in v else None))),
    F("sugar", "food", "Sugary food & drinks", "Blood sugar, weight, teeth, energy crashes", ["check_in", "notifications", "gmail"],
      _memory("daily_events", lambda v: "Sweets or sugary drinks recently" if "sweets" in v else None)),
    F("groceries", "food", "What you buy to cook", "Overall diet quality", ["gmail", "notifications"],
      _orders({"grocery_order"}, "grocery orders", within=14)),
    F("nutrition", "food", "Calories & nutrients eaten", "Weight, deficiencies", ["health_connect"],
      _auto("daily_fitness_data", "nutrition_kcal", _num(" kcal eaten"), "health_connect")),
    F("hydration", "food", "Water intake", "Kidneys, headaches, energy", ["health_connect", "check_in"],
      _auto("daily_fitness_data", "water_ml", lambda v: f"{float(v) / 1000:.1f} L", "health_connect")),
    F("caffeine", "food", "Caffeine", "Sleep, anxiety, acidity, palpitations", ["check_in"], _memory("daily_events", lambda v: "Logged" if "caffeine" in v else None)),
    F("food_safety", "food", "Food poisoning risk", "Vomiting, loose motions", ["location", "notifications", "gmail"], _risk("food_spoilage")),
    # ---- substances & medicines ----
    F("smoking", "substances", "Smoking & vaping", "Lungs, heart, cancer, healing", ["check_in", "profile"],
      _memory("daily_events", lambda v: "Smoked recently" if "smoked" in v else None, within=14)),
    F("alcohol", "substances", "Alcohol", "Liver, sleep, mood, blood pressure", ["check_in", "notifications", "gmail"],
      _memory("daily_events", lambda v: "Alcohol recently" if "alcohol" in v else None, within=14)),
    F("medicines", "substances", "Prescribed medicines", "Side effects, interactions, recovery", ["records", "check_in"],
      lambda ctx: (f"{len(ctx.records.get('medications') or [])} on record", None, "records") if ctx.records.get("medications") else None),
    F("self_medication", "substances", "Medicines bought without a visit", "Masked symptoms, overuse", ["gmail", "notifications"],
      _orders({"pharmacy_order"}, "pharmacy orders", within=30)),
    # ---- air, water & climate ----
    F("air_pollution", "environment", "Air pollution (PM2.5, PM10, NO₂, O₃, SO₂, CO)", "Lungs, heart, throat, headaches", ["location"], _risk("air_pollution")),
    F("allergens", "environment", "Pollen, dust & mould", "Allergies, asthma, skin", ["location"], _risk("allergens")),
    F("heat", "environment", "Heat & humidity", "Dehydration, heat stroke, kidneys", ["location"], _risk("heat")),
    F("cold", "environment", "Cold", "Infections, asthma, blood pressure", ["location"], _risk("cold")),
    F("uv", "environment", "Sun & UV", "Skin, eyes", ["location"], _risk("uv")),
    F("water", "environment", "Water contamination & flooding", "Typhoid, cholera, hepatitis, diarrhoea", ["location"], _risk("water")),
    F("daylight", "environment", "Daylight & sunshine", "Mood, sleep rhythm, vitamin D", ["location"], _risk("daylight")),
    F("indoor_air", "environment", "Indoor air at home", "Asthma, headaches (cooking smoke, incense, damp)", ["profile"], _profile("user_life_context", "home_environment")),
    F("noise", "environment", "Noise", "Sleep, stress, hearing", [],
      not_tracked_reason="Would need the microphone. VitaSense never listens; mention noise in check-in or chat."),
    # ---- infections around you ----
    F("aedes", "infections", "Dengue, chikungunya, Zika", "Fever, joint pain, low platelets", ["location"], _risk("aedes")),
    F("anopheles", "infections", "Malaria", "Fever with chills", ["location"], _risk("anopheles")),
    F("culex", "infections", "Japanese encephalitis, filariasis", "Brain fever, limb swelling", ["location"], _risk("culex")),
    F("respiratory_viruses", "infections", "Flu & respiratory viruses", "Cough, fever, breathlessness", ["location"], _risk("respiratory")),
    F("outbreaks", "infections", "Official outbreak notices", "Whatever is spreading in your country", ["location"],
      lambda ctx: ((f"{len(ctx.outbreaks)} WHO notice{'s' if len(ctx.outbreaks) != 1 else ''}: {ctx.outbreaks[0]['title']}" if ctx.outbreaks else "No WHO notices for your country in 6 months"), ctx.outbreaks[0]["date"] if ctx.outbreaks else None, "location") if ctx.risks else None),
    F("crowds", "infections", "Crowds & close contact", "Colds, flu, conjunctivitis", ["check_in", "calendar"],
      _memory("crowded_place_exposure", _yes("Crowded places recently"))),
    F("travel", "infections", "Travel", "Traveller's diarrhoea, new infections, jet lag", ["calendar", "check_in"],
      _first(_auto("daily_calendar_data", "travel_event", lambda v: "Travel on your calendar" if v else "", "calendar", within=14),
             _memory("travel_today", _yes("Travelled recently"), within=14))),
    # ---- routine & mind ----
    F("screen_time", "routine", "Screen time", "Eyes, sleep, neck, mood", ["phone_usage"],
      _auto("daily_device_behavior_data", "screen_time_hours", _hours, "phone_usage")),
    F("night_phone", "routine", "Phone use after midnight", "Sleep, next-day energy", ["phone_usage"],
      _auto("daily_device_behavior_data", "late_night_minutes", lambda v: f"{round(float(v))} min after midnight", "phone_usage")),
    F("unlocks", "routine", "Phone pick-ups", "Focus, anxiety, sleep", ["phone_usage"],
      _auto("daily_device_behavior_data", "unlocks", lambda v: f"{int(v)} unlocks", "phone_usage")),
    F("workload", "routine", "Workload & meetings", "Stress, sleep, blood pressure", ["calendar", "check_in"],
      _first(_auto("daily_calendar_data", "meetings_workload", str, "calendar"), _memory("workload_intensity", str))),
    F("late_work", "routine", "Late or very early commitments", "Sleep debt", ["calendar"],
      _auto("daily_calendar_data", "late_events", lambda v: f"{int(v)} late events" if int(v) else "", "calendar")),
    F("stress", "routine", "Stress", "Sleep, stomach, heart, immunity", ["check_in", "chat", "health_connect"],
      _memory("mood_today", lambda v: "Stressed" if v in ("Stressed", "Anxious") else None)),
    F("mood", "routine", "Mood", "Energy, appetite, sleep", ["check_in", "chat"], _memory("mood_today", str)),
    F("social", "routine", "Social contact & loneliness", "Mood, sleep, heart health", ["check_in", "profile"],
      _profile("user_emotional_wellness", "loneliness_level")),
    F("exams", "routine", "Exams & deadlines", "Stress, sleep, appetite", ["calendar"],
      _auto("daily_calendar_data", "exam_event", lambda v: "Exam on your calendar" if v else "", "calendar", within=14)),
    # ---- medical background ----
    F("conditions", "medical", "Long-term conditions", "How every symptom is read", ["records", "profile"],
      _first(_records_list("conditions"), _profile("user_medical_identity", "chronic_conditions"))),
    F("allergies", "medical", "Allergies", "Reactions, what to avoid", ["records", "profile"],
      _first(_records_list("allergies"), _profile("user_medical_identity", "allergy_conditions"))),
    F("past_illness", "medical", "Past illnesses & surgery", "Recurrences, risks", ["records", "profile"],
      _first(_records_list("procedures"), _profile("user_medical_identity", "major_medical_history"))),
    F("labs", "medical", "Lab results", "Sugar, cholesterol, thyroid, vitamin D, B12, haemoglobin, kidney, liver", ["records", "gmail"],
      lambda ctx: (f"{len(ctx.records.get('latest_labs') or [])} results, {len(ctx.records.get('flagged_labs') or [])} out of range", ctx.records.get("last_record_date"), "records") if ctx.records.get("latest_labs") else None),
    F("vaccinations", "medical", "Vaccinations", "Protection against flu, hepatitis, typhoid, tetanus", ["records", "profile"], None),
    F("family_history", "medical", "Family history", "Inherited risk (diabetes, heart, cancer)", ["profile"], _profile("user_medical_identity", "family_history")),
    F("symptoms", "medical", "Recent symptoms", "What's going on now", ["chat", "check_in"],
      lambda ctx: (", ".join(ctx.has_chat_symptoms[:4]), None, "chat") if ctx.has_chat_symptoms else _memory("chatbot_symptoms_reported", lambda v: ", ".join(v[:4]) if isinstance(v, list) else str(v))(ctx)),
    # ---- life & biology ----
    F("sex", "life", "Sex", "Which conditions and causes apply", ["profile"],
      lambda ctx: (ctx.sex.capitalize(), None, "profile") if ctx.sex else None),
    F("age", "life", "Age", "Risk of most conditions", ["profile"], _profile("user_personal_context", "age")),
    F("pregnancy", "life", "Pregnancy", "Safe causes, urgent signs, which doctor", ["profile", "check_in"], None, only_sex="female"),
    F("occupation", "life", "Life stage & work", "Shift work, dust, chemicals, long sitting", ["profile"], _profile("user_life_context", "life_phase")),
    F("living", "life", "Living situation", "Shared infections, support, stress", ["profile"], _profile("user_life_context", "social_environment")),
    F("animals", "life", "Pets & animal contact", "Allergies, bites, animal-borne infections", ["profile"], None),
    F("genetics", "life", "Genetic risk", "Inherited conditions (from a DNA test you upload)", ["records"], None),
]


def build_factors(ctx: Ctx, *, platform: str | None = None) -> dict[str, Any]:
    connected = ctx.connected
    out_categories = []
    counts = {"live": 0, "recorded": 0, "waiting": 0, "connect": 0, "on_phone": 0, "manual": 0, "not_tracked": 0}
    for cat_id, cat_label in CATEGORIES:
        factors = []
        for factor in FACTORS:
            if factor.category != cat_id:
                continue
            if factor.only_sex and ctx.sex and ctx.sex != factor.only_sex:
                continue
            value = factor.read(ctx) if factor.read else None
            if value and not value[0]:
                value = None
            auto = [s for s in factor.sources if s in AUTO_SOURCES and (platform is None or platform in SOURCES[s]["platforms"])]
            connected_auto = [s for s in auto if s in connected]
            if factor.not_tracked_reason:
                status = "not_tracked"
            elif value:
                status = "live" if value[2] in AUTO_SOURCES or value[2] == "demo" else "recorded"
            elif connected_auto:
                status = "waiting"
            elif auto:
                status = "connect"
            elif any(s in AUTO_SOURCES for s in factor.sources):
                status = "on_phone"
            else:
                status = "manual"
            counts[status] += 1
            factors.append(
                {
                    "id": factor.id,
                    "label": factor.label,
                    "affects": factor.affects,
                    "status": status,
                    "value": value[0] if value else None,
                    "updated": value[1] if value else None,
                    "source": value[2] if value else None,
                    "sources": [{"id": s, "label": SOURCES[s]["label"], "connected": s in connected, "automatic": s in AUTO_SOURCES} for s in factor.sources],
                    "connect_with": next((s for s in auto if s not in connected), None) if status == "connect" else None,
                    "note": factor.not_tracked_reason,
                }
            )
        out_categories.append({"id": cat_id, "label": cat_label, "factors": factors})
    total = sum(counts.values())
    automatic = sum(1 for f in FACTORS if any(s in AUTO_SOURCES for s in f.sources))
    return {
        "categories": out_categories,
        "counts": {**counts, "total": total, "automatic_capable": automatic},
        "sources": [
            {"id": sid, **{k: v for k, v in meta.items() if k != "keys"}, "connected": sid in connected, "automatic": sid in AUTO_SOURCES}
            for sid, meta in SOURCES.items()
        ],
    }


def connected_sources(server_connections: dict[str, Any], client_declared: list[str] | None) -> set[str]:
    """Source ids that are on: what the server has received data from, plus what the phone says it has switched on."""
    on: set[str] = set()
    for source_id, meta in SOURCES.items():
        if any(key in server_connections for key in meta["keys"]):
            on.add(source_id)
    for raw in client_declared or []:
        if raw in SOURCES:
            on.add(raw)
    return on


def days_by_date(merged: dict[str, list[dict[str, Any]]]) -> dict[str, dict[str, dict[str, Any]]]:
    """{table: [rows newest first]} (the forecast's merged view) -> {table: {date: row}}."""
    out: dict[str, dict[str, dict[str, Any]]] = {}
    for table, rows in merged.items():
        for row in rows or []:
            day = str(row.get("log_date") or "")[:10]
            if day:
                out.setdefault(table, {})[day] = row
    return out
