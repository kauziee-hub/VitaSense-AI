from __future__ import annotations

import hashlib
from dataclasses import dataclass
from datetime import date
from typing import Any, Literal

Severity = Literal["low", "medium", "high"]
Layer = Literal["disease", "symptoms", "hazards", "food", "predictive"]


@dataclass(frozen=True)
class LocalityRequestContext:
    user_id: int
    city: str
    locality: str
    radius_km: float
    user_profile: dict[str, Any]
    daily_data: dict[str, Any]
    chatbot_history: list[dict[str, Any]]
    ai_health_insights: list[dict[str, Any]]
    today: date


def _rows(data: dict[str, Any], table_name: str) -> list[dict[str, Any]]:
    value = data.get(table_name)
    if isinstance(value, list):
        return [row for row in value if isinstance(row, dict)]
    return []


def _number(value: Any) -> float | None:
    if value in (None, ""):
        return None
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


def _bounded(value: float, low: int = 0, high: int = 100) -> int:
    return max(low, min(high, round(value)))


def _seed(*parts: Any) -> int:
    digest = hashlib.sha256("|".join(str(part) for part in parts).encode("utf-8")).hexdigest()
    return int(digest[:8], 16)


def _variant(seed: int, start: int, span: int) -> int:
    return start + (seed % max(1, span))


def _choice(seed: int, values: list[str]) -> str:
    return values[seed % len(values)]


def _text_blob(*values: Any) -> str:
    parts: list[str] = []
    for value in values:
        if value is None:
            continue
        if isinstance(value, list):
            parts.extend(str(item) for item in value if item not in (None, ""))
        elif isinstance(value, dict):
            parts.extend(str(item) for item in value.values() if item not in (None, ""))
        else:
            parts.append(str(value))
    return " ".join(parts).lower()


def _has_any(text: str, keywords: tuple[str, ...]) -> bool:
    return any(keyword in text for keyword in keywords)


def _latest(rows: list[dict[str, Any]]) -> dict[str, Any]:
    return rows[0] if rows else {}


def _count(rows: list[dict[str, Any]], predicate) -> int:
    return sum(1 for row in rows if predicate(row))


def _sleep_hours(row: dict[str, Any]) -> float | None:
    return _number(row.get("sleep_duration_hours")) or _number(row.get("sleep_hours"))


def _hydration_ml(row: dict[str, Any]) -> float | None:
    direct = _number(row.get("water_ml"))
    if direct is not None:
        return direct
    liters = _number(row.get("water_intake_liters"))
    if liters is not None:
        return liters * 1000 if liters <= 20 else liters
    return None


def _outside_food(row: dict[str, Any]) -> bool:
    blob = _text_blob(row)
    return any(row.get(key) is True for key in ("ate_from_outside", "processed_food_consumed", "unusual_food_exposure")) or _has_any(
        blob,
        ("outside", "street", "stall", "vendor", "restaurant", "takeout", "junk", "fried", "juice", "pani puri"),
    )


def _severity(probability: int) -> Severity:
    if probability >= 70:
        return "high"
    if probability >= 42:
        return "medium"
    return "low"


def _trend(current: int, baseline: int) -> str:
    if current > baseline + 10:
        return "rising"
    if current < baseline - 10:
        return "falling"
    return "stable"


def build_locality_health_intelligence(
    *,
    user_id: int,
    city: str = "Bengaluru",
    locality: str = "Koramangala",
    radius_km: float = 3.0,
    user_profile: dict[str, Any] | None = None,
    daily_data: dict[str, Any] | None = None,
    chatbot_history: list[dict[str, Any]] | None = None,
    ai_health_insights: list[dict[str, Any]] | None = None,
    today: date | None = None,
) -> dict[str, Any]:
    context = LocalityRequestContext(
        user_id=user_id,
        city=(city or "Bengaluru").strip()[:80],
        locality=(locality or "Koramangala").strip()[:120],
        radius_km=max(0.5, min(float(radius_km or 3.0), 25.0)),
        user_profile=user_profile or {},
        daily_data=daily_data or {},
        chatbot_history=[row for row in (chatbot_history or []) if isinstance(row, dict)],
        ai_health_insights=[row for row in (ai_health_insights or []) if isinstance(row, dict)],
        today=today or date.today(),
    )

    signal_model = _signal_model(context)
    clusters = _community_symptom_clusters(context, signal_model)
    signals = _locality_signals(context, signal_model, clusters)
    cards = _risk_cards(context, signals, clusters, signal_model)
    predictive = _personalized_predictions(context, cards, signal_model)

    return {
        "user_id": user_id,
        "generated_on": context.today.isoformat(),
        "city": context.city,
        "locality": context.locality,
        "radius_km": context.radius_km,
        "scan_status": {
            "overall_level": _severity(signal_model["overall_probability"]).title(),
            "overall_probability": signal_model["overall_probability"],
            "confidence": signal_model["confidence"],
            "refreshed_minutes_ago": signal_model["refreshed_minutes_ago"],
            "summary": _scan_summary(context, signal_model),
        },
        "layers": _layers(signals),
        "hotspots": signals,
        "community_symptom_clusters": clusters,
        "risk_cards": cards,
        "predictive_lifestyle_risks": predictive,
        "source_architecture": _source_architecture(),
        "mock_intelligence_feeds": _mock_feeds(context, signal_model),
        "correlation_explanation": _correlation_explanation(context, signal_model, cards),
    }


def _signal_model(context: LocalityRequestContext) -> dict[str, Any]:
    fitness = _rows(context.daily_data, "daily_fitness_data")
    memory = _rows(context.daily_data, "daily_user_memory_logs")
    environment = _rows(context.daily_data, "daily_environment_data")
    device = _rows(context.daily_data, "daily_device_behavior_data")
    calendar = _rows(context.daily_data, "daily_calendar_data")

    seed = _seed(context.city.lower(), context.locality.lower(), context.today.isoformat())
    season_boost = 10 if context.today.month in {6, 7, 8, 9, 10} else 4
    latest_env = _latest(environment)
    aqi = _number(latest_env.get("aqi")) or _variant(seed, 88, 92)
    temperature = _number(latest_env.get("temperature_c")) or _variant(seed >> 2, 26, 12)
    humidity = _number(latest_env.get("humidity_percent")) or _variant(seed >> 3, 48, 35)
    heat = max(0, temperature - 31) * 3
    pollution = max(0, aqi - 95) * 0.25
    humidity_mosquito = max(0, humidity - 58) * 0.35

    symptom_blob = _text_blob(*memory, *(row.get("message_content") for row in context.chatbot_history))
    fever_mentions = _has_any(symptom_blob, ("fever", "chills", "temperature", "body ache"))
    throat_mentions = _has_any(symptom_blob, ("cough", "throat", "breath", "allergy", "wheeze"))
    digestive_mentions = _has_any(symptom_blob, ("stomach", "digest", "nausea", "vomit", "loose motion", "diarrhea"))
    stress_mentions = _has_any(symptom_blob, ("stress", "burnout", "anxious", "exhausted", "fatigue"))

    low_sleep_days = _count(fitness[:7], lambda row: (_sleep_hours(row) or 8) < 6.5)
    low_hydration_days = _count(fitness[:7], lambda row: (_hydration_ml(row) or 2400) < 1700)
    outside_food_days = _count(memory[:7], _outside_food)
    high_screen_days = _count(device[:7], lambda row: row.get("late_night_usage") is True or (_number(row.get("screen_time_hours")) or 0) >= 7.5)
    workload_days = _count(memory[:7], lambda row: str(row.get("workload_intensity") or "").lower() in {"high", "extreme"})
    workload_days += _count(calendar[:7], lambda row: str(row.get("meetings_workload") or "").lower() in {"high", "extreme"} or row.get("exam_event") is True)

    disease = _bounded(35 + season_boost + _variant(seed >> 4, 0, 22) + (12 if fever_mentions else 0) + humidity_mosquito)
    respiratory = _bounded(28 + pollution + (16 if throat_mentions else 0) + low_hydration_days * 3)
    food = _bounded(24 + outside_food_days * 9 + (18 if digestive_mentions else 0) + _variant(seed >> 5, 0, 18))
    hazards = _bounded(30 + humidity_mosquito + heat + _variant(seed >> 6, 0, 22))
    personal = _bounded(26 + low_sleep_days * 8 + low_hydration_days * 5 + high_screen_days * 4 + workload_days * 3 + (12 if stress_mentions else 0))
    overall = _bounded((disease * 0.24) + (respiratory * 0.2) + (food * 0.2) + (hazards * 0.18) + (personal * 0.18))

    return {
        "seed": seed,
        "aqi": round(aqi),
        "temperature_c": round(temperature, 1),
        "humidity_percent": round(humidity),
        "disease_probability": disease,
        "respiratory_probability": respiratory,
        "food_probability": food,
        "hazard_probability": hazards,
        "personal_probability": personal,
        "overall_probability": overall,
        "trend": _trend(overall, _variant(seed >> 7, 38, 28)),
        "confidence": "high" if len(fitness) >= 7 or len(memory) >= 5 else "medium",
        "refreshed_minutes_ago": _variant(seed >> 8, 6, 22),
        "low_sleep_days": low_sleep_days,
        "low_hydration_days": low_hydration_days,
        "outside_food_days": outside_food_days,
        "high_screen_days": high_screen_days,
        "workload_days": workload_days,
        "symptom_flags": {
            "fever": fever_mentions,
            "respiratory": throat_mentions,
            "digestive": digestive_mentions,
            "stress": stress_mentions,
        },
    }


def _community_symptom_clusters(context: LocalityRequestContext, model: dict[str, Any]) -> list[dict[str, Any]]:
    seed = model["seed"]
    clusters = [
        {
            "id": "cluster-fever",
            "symptom": "fever and body ache",
            "reports_48h": _bounded(8 + model["disease_probability"] * 0.22 + _variant(seed, 0, 11), 3, 45),
            "weekly_change_percent": _bounded(12 + model["disease_probability"] * 0.45 + _variant(seed >> 1, 0, 16), 0, 86),
            "radius_km": round(min(context.radius_km, 2.8), 1),
            "zone": _choice(seed, ["north-east blocks", "market corridor", "school-adjacent sector"]),
            "severity": _severity(model["disease_probability"]),
        },
        {
            "id": "cluster-throat",
            "symptom": "cough and throat irritation",
            "reports_48h": _bounded(7 + model["respiratory_probability"] * 0.2 + _variant(seed >> 2, 0, 12), 2, 42),
            "weekly_change_percent": _bounded(8 + model["respiratory_probability"] * 0.48 + _variant(seed >> 3, 0, 18), 0, 92),
            "radius_km": round(min(context.radius_km, 3.4), 1),
            "zone": _choice(seed >> 4, ["high-AQI corridor", "main road belt", "construction edge"]),
            "severity": _severity(model["respiratory_probability"]),
        },
        {
            "id": "cluster-digestive",
            "symptom": "stomach pain and nausea",
            "reports_48h": _bounded(5 + model["food_probability"] * 0.18 + _variant(seed >> 5, 0, 9), 1, 36),
            "weekly_change_percent": _bounded(6 + model["food_probability"] * 0.42 + _variant(seed >> 6, 0, 16), 0, 84),
            "radius_km": round(min(context.radius_km, 1.9), 1),
            "zone": _choice(seed >> 7, ["street-food cluster", "juice-stall lane", "canteen belt"]),
            "severity": _severity(model["food_probability"]),
        },
        {
            "id": "cluster-headache",
            "symptom": "headache and fatigue",
            "reports_48h": _bounded(4 + model["personal_probability"] * 0.16 + _variant(seed >> 8, 0, 12), 1, 34),
            "weekly_change_percent": _bounded(5 + model["personal_probability"] * 0.34 + _variant(seed >> 9, 0, 14), 0, 72),
            "radius_km": round(min(context.radius_km, 2.5), 1),
            "zone": _choice(seed >> 10, ["office corridor", "traffic-heavy stretch", "heat pocket"]),
            "severity": _severity(model["personal_probability"]),
        },
    ]
    return clusters


def _hotspot(
    *,
    id: str,
    layer: Layer,
    title: str,
    detail: str,
    probability: int,
    confidence: str,
    radius_km: float,
    x: int,
    y: int,
    symptoms: list[str],
    source: str,
    why: str,
    action: str,
) -> dict[str, Any]:
    return {
        "id": id,
        "layer": layer,
        "title": title,
        "detail": detail,
        "severity": _severity(probability),
        "confidence": confidence,
        "affected_radius_km": radius_km,
        "risk_probability": probability,
        "x": x,
        "y": y,
        "probable_symptoms": symptoms,
        "source": source,
        "why_this_is_happening": why,
        "future_probability": min(96, probability + 8),
        "suggested_precautions": [action],
        "trend": "rising" if probability >= 58 else "watching",
    }


def _locality_signals(context: LocalityRequestContext, model: dict[str, Any], clusters: list[dict[str, Any]]) -> list[dict[str, Any]]:
    seed = model["seed"]
    fever_cluster = clusters[0]
    throat_cluster = clusters[1]
    digestive_cluster = clusters[2]
    return [
        _hotspot(
            id="viral-fever-activity",
            layer="disease",
            title="Viral fever activity",
            detail=f"High viral fever activity detected within {fever_cluster['radius_km']}km of {context.locality}.",
            probability=model["disease_probability"],
            confidence=model["confidence"],
            radius_km=fever_cluster["radius_km"],
            x=_variant(seed, 55, 22),
            y=_variant(seed >> 1, 22, 20),
            symptoms=["fever", "fatigue", "body ache", "headache"],
            source="mock hospital trend API + anonymous symptom clusters",
            why=f"{fever_cluster['reports_48h']} fever-related reports in 48h with {fever_cluster['weekly_change_percent']}% weekly rise.",
            action="Avoid crowded indoor spaces and monitor temperature if fatigue or chills appear.",
        ),
        _hotspot(
            id="dengue-mosquito-watch",
            layer="disease",
            title="Dengue and mosquito-borne watch",
            detail="Mosquito breeding conditions are elevated after stagnant-water and humidity signals.",
            probability=_bounded(model["hazard_probability"] * 0.72 + model["disease_probability"] * 0.28),
            confidence="medium",
            radius_km=round(min(context.radius_km, 2.2), 1),
            x=_variant(seed >> 2, 18, 28),
            y=_variant(seed >> 3, 55, 22),
            symptoms=["fever", "body ache", "rash", "headache"],
            source="mock municipality drainage API + weather API",
            why=f"Humidity is {model['humidity_percent']}% and drainage-risk model is {model['hazard_probability']}%.",
            action="Use mosquito protection and avoid stagnant-water zones for the next 72h.",
        ),
        _hotspot(
            id="throat-cough-cluster",
            layer="symptoms",
            title="Respiratory symptom cluster",
            detail=f"{throat_cluster['reports_48h']} nearby users reported cough or throat irritation in the past 48h.",
            probability=model["respiratory_probability"],
            confidence=model["confidence"],
            radius_km=throat_cluster["radius_km"],
            x=_variant(seed >> 4, 42, 24),
            y=_variant(seed >> 5, 35, 18),
            symptoms=["cough", "throat irritation", "allergy", "fatigue"],
            source="anonymous community symptom aggregation",
            why=f"AQI is {model['aqi']} and throat reports are {throat_cluster['weekly_change_percent']}% above local baseline.",
            action="Reduce outdoor exertion near traffic corridors and hydrate earlier in the day.",
        ),
        _hotspot(
            id="drainage-overflow",
            layer="hazards",
            title="Drainage overflow hazard",
            detail="Drainage overflow risk is elevated near low-lying blocks, increasing mosquito and contamination probability.",
            probability=model["hazard_probability"],
            confidence="medium",
            radius_km=round(min(context.radius_km, 1.4), 1),
            x=_variant(seed >> 6, 25, 25),
            y=_variant(seed >> 7, 64, 18),
            symptoms=["fever", "skin irritation", "stomach infection"],
            source="mock municipality hazard API",
            why="Humidity, locality type, and synthetic drainage complaints are aligned.",
            action="Avoid walking through waterlogged lanes and keep windows screened near evening.",
        ),
        _hotspot(
            id="aqi-construction-corridor",
            layer="hazards",
            title="AQI and dust corridor",
            detail="Dust and pollution exposure are elevated near a traffic and construction corridor.",
            probability=model["respiratory_probability"],
            confidence="high" if model["aqi"] >= 140 else "medium",
            radius_km=round(min(context.radius_km, 2.7), 1),
            x=_variant(seed >> 8, 62, 20),
            y=_variant(seed >> 9, 48, 18),
            symptoms=["cough", "headache", "fatigue", "eye irritation"],
            source="mock pollution API + construction complaint feed",
            why=f"AQI is {model['aqi']} with respiratory reports rising in {throat_cluster['zone']}.",
            action="Prefer indoor workouts and use mask protection near main roads today.",
        ),
        _hotspot(
            id="foodborne-illness-zone",
            layer="food",
            title="Street-food illness cluster",
            detail=f"Digestive complaints detected near a {digestive_cluster['zone']}.",
            probability=model["food_probability"],
            confidence="medium",
            radius_km=digestive_cluster["radius_km"],
            x=_variant(seed >> 10, 48, 22),
            y=_variant(seed >> 11, 68, 14),
            symptoms=["stomach pain", "nausea", "loose motion", "fatigue"],
            source="mock food inspection API + anonymous symptom clusters",
            why=f"{digestive_cluster['reports_48h']} digestive reports in 48h and {model['outside_food_days']} personal outside-food signal(s).",
            action="Avoid raw juices, cut fruit, and high-risk street food in this zone today.",
        ),
        _hotspot(
            id="unsafe-water-advisory",
            layer="food",
            title="Unsafe water advisory",
            detail="Water contamination probability is elevated around vendor and drainage complaint overlap.",
            probability=_bounded(model["food_probability"] * 0.72 + model["hazard_probability"] * 0.28),
            confidence="medium",
            radius_km=round(min(context.radius_km, 2.6), 1),
            x=_variant(seed >> 12, 18, 20),
            y=_variant(seed >> 13, 30, 20),
            symptoms=["stomach pain", "vomiting", "skin irritation"],
            source="mock municipality water-quality API",
            why="Food-stall complaints overlap with water and drainage hazard reports.",
            action="Use sealed water and avoid ice in local beverages today.",
        ),
        _hotspot(
            id="personal-risk-fusion",
            layer="predictive",
            title="Personal-locality risk fusion",
            detail="Your recovery signals are being fused with outbreak, food, AQI, and hazard layers.",
            probability=model["personal_probability"],
            confidence=model["confidence"],
            radius_km=round(context.radius_km, 1),
            x=50,
            y=50,
            symptoms=["fatigue", "fever susceptibility", "respiratory sensitivity", "digestive issues"],
            source="VitaSense AI correlation engine",
            why=f"{model['low_sleep_days']} low-sleep days, {model['low_hydration_days']} low-hydration days, and {model['workload_days']} workload signals are active.",
            action="Keep tonight low-load and avoid exposure stacking: crowding, high AQI, and outside food on the same day.",
        ),
    ]


def _layers(signals: list[dict[str, Any]]) -> list[dict[str, Any]]:
    labels: dict[Layer, str] = {
        "disease": "Disease",
        "symptoms": "Symptoms",
        "hazards": "Hazards",
        "food": "Food Safety",
        "predictive": "Predictive",
    }
    layers = []
    for layer, label in labels.items():
        layer_signals = [signal for signal in signals if signal["layer"] == layer]
        probability = round(sum(signal["risk_probability"] for signal in layer_signals) / max(1, len(layer_signals)))
        layers.append({
            "id": layer,
            "label": label,
            "signal_count": len(layer_signals),
            "severity": _severity(probability),
            "probability": probability,
        })
    return layers


def _risk_cards(
    context: LocalityRequestContext,
    signals: list[dict[str, Any]],
    clusters: list[dict[str, Any]],
    model: dict[str, Any],
) -> list[dict[str, Any]]:
    selected = sorted(signals, key=lambda signal: signal["risk_probability"], reverse=True)[:6]
    return [
        {
            "title": signal["title"],
            "risk_level": signal["severity"],
            "confidence": signal["confidence"],
            "affected_radius_km": signal["affected_radius_km"],
            "probable_symptoms": signal["probable_symptoms"],
            "why_this_is_happening": signal["why_this_is_happening"],
            "future_probability": signal["future_probability"],
            "suggested_precautions": signal["suggested_precautions"],
            "source": signal["source"],
        }
        for signal in selected
    ]


def _personalized_predictions(
    context: LocalityRequestContext,
    risk_cards: list[dict[str, Any]],
    model: dict[str, Any],
) -> list[dict[str, Any]]:
    profile_blob = _text_blob(context.user_profile)
    respiratory_sensitivity = "throat" in profile_blob or "asthma" in profile_blob or "allerg" in profile_blob
    return [
        {
            "title": "Viral exposure susceptibility",
            "probability": _bounded(model["disease_probability"] + model["low_sleep_days"] * 5),
            "horizon": "72h",
            "reason": "Local fever activity is being combined with your sleep debt and recovery strain.",
            "personalized_message": "Your recent sleep debt combined with elevated viral activity nearby may increase fever susceptibility.",
        },
        {
            "title": "Digestive issue probability",
            "probability": _bounded(model["food_probability"] + model["outside_food_days"] * 6),
            "horizon": "48h",
            "reason": "Food-safety signals overlap with outside-food exposure and community stomach complaints.",
            "personalized_message": "Outside-food exposure plus a community stomach-infection spike raises digestive risk.",
        },
        {
            "title": "Respiratory irritation sensitivity",
            "probability": _bounded(model["respiratory_probability"] + (14 if respiratory_sensitivity else 0)),
            "horizon": "24h",
            "reason": "AQI, cough clusters, hydration, and your respiratory history are aligned.",
            "personalized_message": "AQI plus low hydration and throat-irritation history suggests elevated respiratory sensitivity.",
        },
        {
            "title": "Burnout and fatigue probability",
            "probability": _bounded(model["personal_probability"] + model["workload_days"] * 3),
            "horizon": "24h",
            "reason": "Workload, screen load, sleep, and local stress signals are compounding.",
            "personalized_message": "Your workload and screen pattern may lower cognitive performance if locality stressors stack today.",
        },
    ]


def _scan_summary(context: LocalityRequestContext, model: dict[str, Any]) -> str:
    return (
        f"{context.locality} is showing {model['trend']} health pressure: "
        f"AQI {model['aqi']}, disease probability {model['disease_probability']}%, "
        f"food-safety probability {model['food_probability']}%, and personal-locality fusion {model['personal_probability']}%."
    )


def _correlation_explanation(context: LocalityRequestContext, model: dict[str, Any], cards: list[dict[str, Any]]) -> str:
    top = cards[0] if cards else {"title": "locality health pressure"}
    return (
        f"VitaSense correlated {context.locality} community symptom clusters, environmental hazards, food-safety signals, "
        f"and the user's recent sleep, hydration, workload, food exposure, and symptom history. "
        f"The strongest current signal is {top['title']} because {top.get('why_this_is_happening', 'multiple risk layers are aligned')}."
    )


def _mock_feeds(context: LocalityRequestContext, model: dict[str, Any]) -> list[dict[str, Any]]:
    return [
        {"name": "Municipality hazard feed", "status": "mock-live", "signals": _variant(model["seed"], 4, 8)},
        {"name": "Local public health feed", "status": "mock-live", "signals": _variant(model["seed"] >> 1, 5, 12)},
        {"name": "Food inspection feed", "status": "mock-live", "signals": _variant(model["seed"] >> 2, 2, 7)},
        {"name": "Pollution and weather feed", "status": "mock-live", "signals": _variant(model["seed"] >> 3, 8, 14)},
        {"name": "Anonymous VitaSense symptom clusters", "status": "privacy-preserving", "signals": _variant(model["seed"] >> 4, 11, 24)},
    ]


def _source_architecture() -> list[dict[str, str]]:
    return [
        {"service": "Disease intelligence service", "source": "local news, hospital/public health APIs, community symptoms", "status": "mock-ready"},
        {"service": "Outbreak correlation engine", "source": "symptom clusters, environment, food exposure, personal recovery", "status": "active"},
        {"service": "Locality risk aggregation engine", "source": "municipality, pollution, weather, food inspection, VitaSense logs", "status": "active"},
        {"service": "Environmental hazard detector", "source": "drainage, garbage, construction, smoke, heat, water contamination", "status": "mock-ready"},
        {"service": "Food safety intelligence service", "source": "food complaints, vendor clusters, digestive symptoms, inspection feeds", "status": "mock-ready"},
    ]
