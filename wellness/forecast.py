from __future__ import annotations

from dataclasses import dataclass
from datetime import date
from typing import Any, Literal

Severity = Literal["low", "medium", "high"]
Trend = Literal["below_baseline", "near_baseline", "above_baseline", "unknown"]


@dataclass(frozen=True)
class MetricSignal:
    label: str
    value: float | None
    baseline: float | None
    unit: str
    trend: Trend


@dataclass(frozen=True)
class SignalContext:
    fitness_rows: list[dict[str, Any]]
    memory_rows: list[dict[str, Any]]
    environment_rows: list[dict[str, Any]]
    device_rows: list[dict[str, Any]]
    calendar_rows: list[dict[str, Any]]
    chatbot_rows: list[dict[str, Any]]
    insight_rows: list[dict[str, Any]]
    user_profile: dict[str, Any]
    metrics: dict[str, MetricSignal]


def _rows(data: dict[str, Any], table_name: str) -> list[dict[str, Any]]:
    value = data.get(table_name)
    if isinstance(value, list):
        return [row for row in value if isinstance(row, dict)]
    return []


def _profile_table(profile: dict[str, Any], table_name: str) -> dict[str, Any]:
    value = profile.get(table_name)
    return value if isinstance(value, dict) else {}


def _number(value: Any) -> float | None:
    if value in (None, ""):
        return None
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


def _average(values: list[float]) -> float | None:
    if not values:
        return None
    return sum(values) / len(values)


def _percent_change(value: float | None, baseline: float | None) -> float | None:
    if value is None or baseline in (None, 0):
        return None
    return ((value - baseline) / baseline) * 100


def _first_number(row: dict[str, Any], keys: tuple[str, ...]) -> float | None:
    for key in keys:
        value = _number(row.get(key))
        if value is not None:
            return value
    return None


def _hydration_ml(row: dict[str, Any]) -> float | None:
    direct = _number(row.get("water_ml"))
    if direct is not None:
        return direct
    liters = _number(row.get("water_intake_liters"))
    if liters is not None:
        return liters * 1000 if liters <= 20 else liters
    return None


def _metric(
    rows: list[dict[str, Any]],
    keys: str | tuple[str, ...],
    label: str,
    unit: str,
    *,
    extractor=None,
) -> MetricSignal:
    metric_keys = (keys,) if isinstance(keys, str) else keys
    get_value = extractor or (lambda row: _first_number(row, metric_keys))
    latest = get_value(rows[0]) if rows else None
    baseline_values = [value for value in (get_value(row) for row in rows[1:]) if value is not None]
    baseline = _average(baseline_values)
    trend = _trend(latest, baseline)
    return MetricSignal(label=label, value=latest, baseline=baseline, unit=unit, trend=trend)


def _trend(value: float | None, baseline: float | None, tolerance: float = 0.08) -> Trend:
    if value is None or baseline is None or baseline == 0:
        return "unknown"
    lower = baseline * (1 - tolerance)
    upper = baseline * (1 + tolerance)
    if value < lower:
        return "below_baseline"
    if value > upper:
        return "above_baseline"
    return "near_baseline"


def _severity_from_score(score: int) -> Severity:
    if score < 45:
        return "high"
    if score < 68:
        return "medium"
    return "low"


def _score_label(score: int) -> str:
    if score >= 75:
        return "steady"
    if score >= 55:
        return "watchful"
    return "delicate"


def _bounded_score(score: float) -> int:
    return max(0, min(100, round(score)))


def _bounded_probability(score: float) -> int:
    return _bounded_score(score)


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


def _count_rows(rows: list[dict[str, Any]], predicate) -> int:
    return sum(1 for row in rows if predicate(row))


def _latest(rows: list[dict[str, Any]]) -> dict[str, Any]:
    return rows[0] if rows else {}


def _streak(rows: list[dict[str, Any]], predicate) -> int:
    count = 0
    for row in rows:
        if predicate(row):
            count += 1
        else:
            break
    return count


def _sleep_hours(row: dict[str, Any]) -> float | None:
    return _first_number(row, ("sleep_duration_hours", "sleep_hours"))


def _hrv_value(row: dict[str, Any]) -> float | None:
    return _first_number(row, ("hrv_score", "hrv_ms"))


def _workload_high(row: dict[str, Any]) -> bool:
    return str(row.get("workload_intensity") or row.get("meetings_workload") or "").lower() in {"high", "extreme"}


def _outside_food(row: dict[str, Any]) -> bool:
    blob = _text_blob(
        row.get("food_flags"),
        row.get("breakfast"),
        row.get("lunch"),
        row.get("dinner"),
        row.get("snacks"),
        row.get("breakfast_log"),
        row.get("lunch_log"),
        row.get("dinner_log"),
        row.get("snacks_beverages_log"),
        row.get("unusual_exposure_notes"),
    )
    explicit = any(row.get(key) is True for key in ("ate_from_outside", "processed_food_consumed", "unusual_food_exposure"))
    return explicit or _has_any(blob, ("outside", "takeout", "restaurant", "fast food", "junk", "fried", "chips", "pizza"))


def _stress_emotion(row: dict[str, Any]) -> bool:
    blob = _text_blob(row)
    return _has_any(
        blob,
        ("stress", "stressed", "anxious", "sad", "very sad", "exhausted", "lonely", "isolated", "irritable", "burnout"),
    )


def _symptom_text(rows: list[dict[str, Any]], chatbot_rows: list[dict[str, Any]]) -> str:
    memory_blob = _text_blob(*rows)
    chat_blob = _text_blob(*(row.get("message_content") for row in chatbot_rows))
    return f"{memory_blob} {chat_blob}"


def build_wellness_forecast(
    *,
    user_id: int,
    user_profile: dict[str, Any],
    daily_data: dict[str, Any],
    chatbot_history: list[dict[str, Any]] | None = None,
    ai_health_insights: list[dict[str, Any]] | None = None,
    today: date | None = None,
) -> dict[str, Any]:
    today = today or date.today()

    fitness_rows = _rows(daily_data, "daily_fitness_data")
    memory_rows = _rows(daily_data, "daily_user_memory_logs")
    environment_rows = _rows(daily_data, "daily_environment_data")
    device_rows = _rows(daily_data, "daily_device_behavior_data")
    calendar_rows = _rows(daily_data, "daily_calendar_data")
    chatbot_rows = [row for row in (chatbot_history or []) if isinstance(row, dict)]
    insight_rows = [row for row in (ai_health_insights or []) if isinstance(row, dict)]

    metrics = {
        "sleep": _metric(fitness_rows, ("sleep_duration_hours", "sleep_hours"), "Sleep", "h"),
        "hydration": _metric(fitness_rows, ("water_ml", "water_intake_liters"), "Hydration", "ml", extractor=_hydration_ml),
        "steps": _metric(fitness_rows, "steps", "Activity", "steps"),
        "hrv": _metric(fitness_rows, ("hrv_score", "hrv_ms"), "Recovery", "ms"),
        "screen_time": _metric(device_rows, "screen_time_hours", "Screen time", "h"),
        "aqi": _metric(environment_rows, "aqi", "Air quality", "AQI"),
    }
    context = SignalContext(
        fitness_rows=fitness_rows,
        memory_rows=memory_rows,
        environment_rows=environment_rows,
        device_rows=device_rows,
        calendar_rows=calendar_rows,
        chatbot_rows=chatbot_rows,
        insight_rows=insight_rows,
        user_profile=user_profile,
        metrics=metrics,
    )

    engine_scores = _engine_scores(context)
    energy_score = _energy_score(metrics, _latest(memory_rows), _latest(calendar_rows), _latest(device_rows))
    recovery_score = engine_scores["recovery"]
    readiness = _bounded_score((energy_score * 0.35) + (recovery_score * 0.35) + (engine_scores["cognitive"] * 0.15) + (engine_scores["emotional"] * 0.15))
    status = _score_label(readiness)

    patterns = _behavior_patterns(metrics, _latest(memory_rows), _latest(calendar_rows), _latest(device_rows))
    actions = _suggested_actions(metrics, _latest(memory_rows), _latest(environment_rows), _latest(calendar_rows))
    environmental_alerts = _environmental_alerts(user_profile, _latest(environment_rows))
    advanced_patterns = _behavioral_detections(context)
    future_forecast = _future_forecast(context, engine_scores)
    body_systems = _body_systems(context, engine_scores)
    reasoning_timeline = _reasoning_timeline(context)
    strategist = _health_strategist(context, engine_scores, future_forecast)
    live_risk = _live_risk_intelligence(context, environmental_alerts)
    hero = _hero_prediction(status, readiness, context, future_forecast)
    narrative = _narrative(status, metrics, patterns, actions, environmental_alerts, hero["statement"])

    return {
        "user_id": user_id,
        "date": today.isoformat(),
        "analysis_window_days": 30,
        "headline": hero["statement"],
        "summary": narrative,
        "readiness_score": readiness,
        "energy": {
            "score": energy_score,
            "state": _score_label(energy_score),
            "trend": _energy_trend(metrics),
        },
        "recovery": {
            "score": recovery_score,
            "state": _score_label(recovery_score),
            "trend": metrics["hrv"].trend,
        },
        "hero_prediction": hero,
        "reasoning_timeline": reasoning_timeline,
        "future_forecast": future_forecast,
        "body_systems": body_systems,
        "behavioral_detections": advanced_patterns,
        "health_strategist": strategist,
        "live_risk_intelligence": live_risk,
        "engine_scores": engine_scores,
        "patterns": patterns,
        "suggested_actions": actions,
        "environmental_alerts": environmental_alerts,
        "metrics": {
            key: {
                "label": signal.label,
                "value": signal.value,
                "baseline": signal.baseline,
                "unit": signal.unit,
                "trend": signal.trend,
                "change_percent": _percent_change(signal.value, signal.baseline),
            }
            for key, signal in metrics.items()
        },
        "source_tables": _source_tables(daily_data, user_profile, chatbot_rows, insight_rows),
    }


def _engine_scores(context: SignalContext) -> dict[str, int]:
    recovery = 84.0
    immunity = 82.0
    emotional = 80.0
    cognitive = 82.0
    lifestyle = 80.0
    environment = 84.0

    sleep_debt = _sleep_debt(context.fitness_rows[:7])
    low_sleep_streak = _streak(context.fitness_rows, lambda row: (_sleep_hours(row) or 9) < 6.5)
    hrv_drop = _percent_change(context.metrics["hrv"].value, context.metrics["hrv"].baseline)
    hydration_low_days = _count_rows(context.fitness_rows[:7], lambda row: (_hydration_ml(row) or 2500) < 1700)
    high_workload_days = _count_rows(context.memory_rows[:7], _workload_high) + _count_rows(context.calendar_rows[:7], _workload_high)
    outside_food_days = _count_rows(context.memory_rows[:7], _outside_food)
    high_aqi_days = _count_rows(context.environment_rows[:7], lambda row: (_number(row.get("aqi")) or 0) >= 120)
    screen_late_days = _count_rows(context.device_rows[:7], lambda row: row.get("late_night_usage") is True or (_number(row.get("screen_time_hours")) or 0) >= 7.5)
    emotional_days = _count_rows(context.memory_rows[:7], _stress_emotion)
    travel_days = _count_rows(context.calendar_rows[:7], lambda row: row.get("travel_event") is True)

    recovery -= min(28, sleep_debt * 3.2) + low_sleep_streak * 5 + hydration_low_days * 2.5
    if hrv_drop is not None and hrv_drop < -10:
        recovery -= min(24, abs(hrv_drop) * 0.8)
    recovery -= min(14, high_workload_days * 2)

    immunity -= outside_food_days * 4 + high_aqi_days * 3.5 + hydration_low_days * 2 + low_sleep_streak * 5
    if _has_any(_symptom_text(context.memory_rows, context.chatbot_rows), ("fever", "throat", "cough", "cold", "stomach", "digestive", "nausea")):
        immunity -= 10

    emotional -= emotional_days * 5 + high_workload_days * 2.5 + screen_late_days * 2
    if _profile_table(context.user_profile, "user_life_context").get("social_environment") == "Mostly Alone":
        emotional -= 6
    if _has_any(_symptom_text(context.memory_rows, context.chatbot_rows), ("lonely", "isolated", "depressed", "empty", "crying")):
        emotional -= 12

    cognitive -= low_sleep_streak * 7 + high_workload_days * 3.5 + screen_late_days * 4 + travel_days * 3
    if any(row.get("exam_event") is True for row in context.calendar_rows[:7]):
        cognitive -= 7

    lifestyle -= outside_food_days * 4 + screen_late_days * 4 + hydration_low_days * 2.5
    lifestyle -= _count_rows(context.calendar_rows[:7], lambda row: row.get("sleep_schedule_disruption") is True) * 4

    environment -= high_aqi_days * 5
    environment -= _count_rows(context.environment_rows[:7], lambda row: row.get("heatwave_alert") is True or (_number(row.get("temperature_c")) or 0) >= 33) * 4
    environment -= _count_rows(context.environment_rows[:7], lambda row: str(row.get("pollen_level", "")).lower() in {"high", "very high"}) * 3

    return {
        "recovery": _bounded_score(recovery),
        "immunity": _bounded_score(immunity),
        "emotional": _bounded_score(emotional),
        "cognitive": _bounded_score(cognitive),
        "lifestyle": _bounded_score(lifestyle),
        "environment": _bounded_score(environment),
    }


def _sleep_debt(rows: list[dict[str, Any]], target: float = 7.5) -> float:
    return sum(max(0.0, target - sleep) for sleep in (_sleep_hours(row) for row in rows) if sleep is not None)


def _energy_score(
    metrics: dict[str, MetricSignal],
    memory: dict[str, Any],
    calendar: dict[str, Any],
    device: dict[str, Any],
) -> int:
    score = 76.0
    sleep = metrics["sleep"].value
    hydration = metrics["hydration"].value
    steps = metrics["steps"].value
    screen_time = metrics["screen_time"].value

    if sleep is not None:
        if sleep < 6:
            score -= 18
        elif sleep < 7:
            score -= 8
        elif sleep >= 8:
            score += 5
    if hydration is not None and hydration < 1500:
        score -= 9
    if steps is not None and steps < 3500:
        score -= 6
    if screen_time is not None and screen_time > 7:
        score -= 7
    if device.get("late_night_usage") is True:
        score -= 6
    if memory.get("energy_level") in {"Very Low", "Low"}:
        score -= 10
    if memory.get("mood_today") in {"Stressed", "Anxious", "Exhausted"}:
        score -= 7
    if memory.get("workload_intensity") in {"High", "Extreme"}:
        score -= 8
    if calendar.get("sleep_schedule_disruption") is True:
        score -= 7

    return _bounded_score(score)


def _energy_trend(metrics: dict[str, MetricSignal]) -> Trend:
    if metrics["sleep"].trend == "below_baseline" or metrics["hydration"].trend == "below_baseline":
        return "below_baseline"
    if metrics["sleep"].trend == "above_baseline" and metrics["hrv"].trend != "below_baseline":
        return "above_baseline"
    if metrics["sleep"].trend == "unknown" and metrics["hydration"].trend == "unknown":
        return "unknown"
    return "near_baseline"


def _hero_prediction(
    status: str,
    readiness: int,
    context: SignalContext,
    future_forecast: list[dict[str, Any]],
) -> dict[str, Any]:
    top_future = max(future_forecast, key=lambda item: item.get("probability", 0), default={})
    sleep_debt = _sleep_debt(context.fitness_rows[:7])
    outside_food_days = _count_rows(context.memory_rows[:7], _outside_food)
    high_aqi_days = _count_rows(context.environment_rows[:7], lambda row: (_number(row.get("aqi")) or 0) >= 120)
    low_sleep_streak = _streak(context.fitness_rows, lambda row: (_sleep_hours(row) or 9) < 6.5)
    hrv_drop = _percent_change(context.metrics["hrv"].value, context.metrics["hrv"].baseline)

    if outside_food_days >= 2 and high_aqi_days >= 2 and low_sleep_streak:
        statement = (
            "Your outside-food exposure, elevated AQI pattern, and reduced sleep are increasing throat and digestive sensitivity over the next 48 hours."
        )
    elif sleep_debt >= 5 or (hrv_drop is not None and hrv_drop <= -15):
        statement = "Your system is showing signs of silent recovery debt accumulation."
    elif context.metrics["screen_time"].value and context.metrics["screen_time"].value >= 7.5 and _workload_high(_latest(context.memory_rows)):
        statement = "Your body may struggle with sustained focus and energy after 4 PM today."
    elif status == "steady":
        statement = "Your signals look resilient, with the strongest window likely before late-day cognitive load builds."
    else:
        statement = f"Your resilience is {status} today, with {top_future.get('title', 'energy variability')} as the main watch point."

    return {
        "statement": statement,
        "confidence": "high" if len(context.fitness_rows) >= 14 and len(context.memory_rows) >= 7 else "medium",
        "horizon": top_future.get("horizon", "24-72h"),
        "readiness_score": readiness,
        "primary_risks": [item["title"] for item in future_forecast[:3]],
    }


def _reasoning_timeline(context: SignalContext) -> list[dict[str, Any]]:
    items: list[dict[str, Any]] = []
    low_sleep_5 = _count_rows(context.fitness_rows[:5], lambda row: (_sleep_hours(row) or 9) < 6.5)
    if low_sleep_5:
        items.append({
            "title": f"{low_sleep_5} low-sleep cycle{'s' if low_sleep_5 != 1 else ''} detected in the past 5 days",
            "detail": "Reduced sleep increases sleep pressure and lowers stress tolerance against your monthly baseline.",
            "evidence": _evidence_metric(context.metrics["sleep"]),
            "severity": "high" if low_sleep_5 >= 3 else "medium",
            "source_table": "daily_fitness_data",
            "days_observed": low_sleep_5,
        })

    outside_food_7 = _count_rows(context.memory_rows[:7], _outside_food)
    if outside_food_7:
        items.append({
            "title": f"Outside or processed food appeared {outside_food_7} time{'s' if outside_food_7 != 1 else ''} this week",
            "detail": "Food exposure is being weighted against digestive resilience, hydration, and symptom history.",
            "evidence": "Meal notes and food exposure flags",
            "severity": "medium" if outside_food_7 >= 2 else "low",
            "source_table": "daily_user_memory_logs",
            "days_observed": outside_food_7,
        })

    hrv_change = _percent_change(context.metrics["hrv"].value, context.metrics["hrv"].baseline)
    if hrv_change is not None and hrv_change < -8:
        items.append({
            "title": f"HRV is {abs(hrv_change):.0f}% below your monthly baseline",
            "detail": "This can indicate nervous-system load when it appears with workload, poor sleep, or dehydration.",
            "evidence": _evidence_metric(context.metrics["hrv"]),
            "severity": "high" if hrv_change < -18 else "medium",
            "source_table": "daily_fitness_data",
            "days_observed": len(context.fitness_rows),
        })

    aqi_days = _count_rows(context.environment_rows[:7], lambda row: (_number(row.get("aqi")) or 0) >= 120)
    if aqi_days:
        items.append({
            "title": f"AQI exposure has been elevated for {aqi_days} recent day{'s' if aqi_days != 1 else ''}",
            "detail": "Air quality is being correlated with throat, allergy, headache, and fatigue signals.",
            "evidence": _evidence_metric(context.metrics["aqi"]),
            "severity": "high" if aqi_days >= 5 else "medium",
            "source_table": "daily_environment_data",
            "days_observed": aqi_days,
        })

    workload_days = _count_rows(context.memory_rows[:7], _workload_high) + _count_rows(context.calendar_rows[:7], _workload_high)
    if workload_days:
        items.append({
            "title": f"Workload intensity remained heavy across {workload_days} signal{'s' if workload_days != 1 else ''}",
            "detail": "Calendar pressure and self-reported workload are raising cognitive and emotional recovery load.",
            "evidence": "Workload intensity and calendar demand",
            "severity": "high" if workload_days >= 5 else "medium",
            "source_table": "daily_calendar_data",
            "days_observed": workload_days,
        })

    hydration_low = _count_rows(context.fitness_rows[:7], lambda row: (_hydration_ml(row) or 2500) < 1700)
    if hydration_low:
        items.append({
            "title": "Hydration has remained below your recovery threshold",
            "detail": "Low hydration is being connected to headache, fatigue, digestion, and HRV recovery risk.",
            "evidence": _evidence_metric(context.metrics["hydration"]),
            "severity": "medium",
            "source_table": "daily_fitness_data",
            "days_observed": hydration_low,
        })

    if not items:
        items.append({
            "title": "No strong negative longitudinal cluster is visible yet",
            "detail": "VitaSense is still learning from the available 30-day history and profile context.",
            "evidence": "Limited recent deviations",
            "severity": "low",
            "source_table": "daily_fitness_data",
            "days_observed": len(context.fitness_rows),
        })
    return items[:6]


def _evidence_metric(signal: MetricSignal) -> str:
    if signal.value is None:
        return "Latest value unavailable"
    if signal.baseline is None:
        return f"Latest {signal.label.lower()} {signal.value:g}{signal.unit}"
    return f"Latest {signal.value:g}{signal.unit}, baseline {signal.baseline:g}{signal.unit}"


def _future_forecast(context: SignalContext, engine_scores: dict[str, int]) -> list[dict[str, Any]]:
    symptom_blob = _symptom_text(context.memory_rows, context.chatbot_rows)
    sleep_debt = _sleep_debt(context.fitness_rows[:7])
    low_sleep_streak = _streak(context.fitness_rows, lambda row: (_sleep_hours(row) or 9) < 6.5)
    outside_food = _count_rows(context.memory_rows[:7], _outside_food)
    high_aqi = _count_rows(context.environment_rows[:7], lambda row: (_number(row.get("aqi")) or 0) >= 120)
    screen_late = _count_rows(context.device_rows[:7], lambda row: row.get("late_night_usage") is True or (_number(row.get("screen_time_hours")) or 0) >= 7.5)
    high_workload = _count_rows(context.memory_rows[:7], _workload_high) + _count_rows(context.calendar_rows[:7], _workload_high)
    emotional_days = _count_rows(context.memory_rows[:7], _stress_emotion)
    hrv_drop = _percent_change(context.metrics["hrv"].value, context.metrics["hrv"].baseline) or 0
    hydration_low = _count_rows(context.fitness_rows[:7], lambda row: (_hydration_ml(row) or 2500) < 1700)

    forecasts = [
        {
            "horizon": "24h",
            "title": "Energy crash probability",
            "probability": _bounded_probability(24 + sleep_debt * 6 + low_sleep_streak * 8 + hydration_low * 4 + high_workload * 2),
            "severity": "medium",
            "signals": ["sleep debt", "hydration inconsistency", "workload compression"],
            "best_window": "10 AM to 1 PM" if low_sleep_streak else "late morning",
            "recovery_window": "after 7 PM",
        },
        {
            "horizon": "48h",
            "title": "Throat irritation or cold sensitivity",
            "probability": _bounded_probability(18 + high_aqi * 7 + max(0, -hrv_drop) * 0.7 + low_sleep_streak * 6 + (12 if "throat" in symptom_blob else 0)),
            "severity": "medium",
            "signals": ["AQI trend", "HRV load", "sleep reduction"],
            "best_window": "indoors during peak AQI",
            "recovery_window": "tonight's wind-down",
        },
        {
            "horizon": "48h",
            "title": "Digestive discomfort",
            "probability": _bounded_probability(16 + outside_food * 9 + hydration_low * 4 + (12 if _has_any(symptom_blob, ("stomach", "digestive", "nausea", "loose motion")) else 0)),
            "severity": "medium",
            "signals": ["outside-food frequency", "hydration pattern", "meal notes"],
            "best_window": "lighter meals today",
            "recovery_window": "next 24 hours",
        },
        {
            "horizon": "72h",
            "title": "Emotional crash or irritability",
            "probability": _bounded_probability(18 + emotional_days * 8 + high_workload * 3 + screen_late * 4 + (100 - engine_scores["emotional"]) * 0.45),
            "severity": "high" if engine_scores["emotional"] < 50 else "medium",
            "signals": ["stress accumulation", "screen load", "social and mood signals"],
            "best_window": "before high-demand conversations",
            "recovery_window": "one protected offline block",
        },
        {
            "horizon": "72h",
            "title": "Reduced cognitive performance",
            "probability": _bounded_probability(20 + low_sleep_streak * 9 + high_workload * 4 + screen_late * 4 + (100 - engine_scores["cognitive"]) * 0.4),
            "severity": "high" if engine_scores["cognitive"] < 50 else "medium",
            "signals": ["sleep pressure", "decision fatigue", "late-night screen exposure"],
            "best_window": "first deep-work block",
            "recovery_window": "90 minutes earlier sleep target",
        },
        {
            "horizon": "72h",
            "title": "Recovery collapse if sleep drops below 6h again",
            "probability": _bounded_probability(22 + sleep_debt * 5 + max(0, -hrv_drop) * 0.8 + high_workload * 3),
            "severity": "high" if engine_scores["recovery"] < 52 else "medium",
            "signals": ["sleep debt", "HRV decline", "workload intensity"],
            "best_window": "low-load evening",
            "recovery_window": "tonight",
        },
    ]

    for forecast in forecasts:
        probability = int(forecast["probability"])
        forecast["severity"] = "high" if probability >= 70 else "medium" if probability >= 42 else "low"
    return sorted(forecasts, key=lambda item: item["probability"], reverse=True)


def _body_systems(context: SignalContext, engine_scores: dict[str, int]) -> list[dict[str, Any]]:
    systems = [
        ("nervous_system", "Nervous system", engine_scores["recovery"], context.metrics["hrv"].trend, "HRV, sleep pressure, workload, and screen load are combined to estimate autonomic strain."),
        ("recovery", "Recovery", engine_scores["recovery"], context.metrics["sleep"].trend, "Sleep debt, HRV direction, hydration, and travel disruptions are shaping recovery reserve."),
        ("hydration", "Hydration", _bounded_score(100 - _count_rows(context.fitness_rows[:7], lambda row: (_hydration_ml(row) or 2500) < 1700) * 12), context.metrics["hydration"].trend, "Hydration consistency is compared with your 30-day pattern and fatigue symptoms."),
        ("emotional_resilience", "Emotional resilience", engine_scores["emotional"], "below_baseline" if engine_scores["emotional"] < 60 else "near_baseline", "Mood, loneliness language, workload pressure, and recovery preference are used to infer emotional reserve."),
        ("immune_stress", "Immune stress", engine_scores["immunity"], "below_baseline" if engine_scores["immunity"] < 65 else "near_baseline", "Sleep, food exposure, AQI, hydration, and symptom text are combined for immune stress."),
        ("cognitive_clarity", "Cognitive clarity", engine_scores["cognitive"], "below_baseline" if engine_scores["cognitive"] < 65 else "near_baseline", "Focus quality is inferred from sleep, workload, screen timing, exams, and travel."),
        ("sleep_pressure", "Sleep pressure", _bounded_score(100 - _sleep_debt(context.fitness_rows[:7]) * 9), context.metrics["sleep"].trend, "Recent sleep quantity is compared with the personal monthly baseline."),
        ("environmental_stress", "Environmental stress", engine_scores["environment"], context.metrics["aqi"].trend, "AQI, pollen, heat, UV, and outdoor exposure are weighted against your medical profile."),
    ]
    return [
        {
            "key": key,
            "label": label,
            "score": score,
            "trend": trend,
            "explanation": explanation,
            "monthly_comparison": _monthly_comparison(score, trend),
        }
        for key, label, score, trend, explanation in systems
    ]


def _monthly_comparison(score: int, trend: Trend) -> str:
    if trend == "below_baseline":
        return f"{100 - score}% more strain than your usual month pattern"
    if trend == "above_baseline":
        return "better than your recent monthly baseline"
    if trend == "near_baseline":
        return "near your monthly baseline"
    return "baseline still forming"


def _behavioral_detections(context: SignalContext) -> list[dict[str, Any]]:
    detections: list[dict[str, Any]] = []
    symptom_blob = _symptom_text(context.memory_rows, context.chatbot_rows)
    low_sleep_next_low_energy = _count_rows(
        list(zip(context.fitness_rows, context.memory_rows)),
        lambda pair: (_sleep_hours(pair[0]) or 9) < 6.5 and pair[1].get("energy_level") in {"Very Low", "Low"},
    )
    if low_sleep_next_low_energy or _streak(context.fitness_rows, lambda row: (_sleep_hours(row) or 9) < 6.5) >= 2:
        detections.append({
            "title": "Low-sleep sensitivity detected",
            "detail": "Your body appears to react strongly after consecutive low-sleep nights, especially through lower energy and recovery scores.",
            "confidence": "high" if low_sleep_next_low_energy >= 2 else "medium",
            "evidence": f"{low_sleep_next_low_energy or 2} linked low-sleep signal(s)",
        })

    if _count_rows(context.environment_rows[:30], lambda row: (_number(row.get("aqi")) or 0) >= 120) and ("throat" in symptom_blob or "cough" in symptom_blob):
        detections.append({
            "title": "AQI-throat correlation",
            "detail": "High AQI days are aligning with respiratory or throat language in your history.",
            "confidence": "medium",
            "evidence": "AQI rows plus symptom/chatbot text",
        })

    if _count_rows(context.memory_rows[:30], _outside_food) >= 2 and _count_rows(context.fitness_rows[:30], lambda row: (_hydration_ml(row) or 2500) < 1700) >= 2:
        detections.append({
            "title": "Food and hydration recovery drag",
            "detail": "Outside-food or processed-food days combined with low hydration often reduce next-day recovery resilience.",
            "confidence": "medium",
            "evidence": "Food exposure flags plus hydration rows",
        })

    if _has_any(symptom_blob, ("lonely", "isolated", "depressed")) or _profile_table(context.user_profile, "user_life_context").get("social_environment") == "Mostly Alone":
        detections.append({
            "title": "Isolation-emotional stability link",
            "detail": "Social isolation context is being treated as a vulnerability amplifier when stress or poor sleep appears.",
            "confidence": "medium",
            "evidence": "Social environment, emotional events, and chatbot history",
        })

    if _count_rows(context.device_rows[:30], lambda row: row.get("late_night_usage") is True or (_number(row.get("screen_time_hours")) or 0) > 7.5) >= 2:
        detections.append({
            "title": "Late-screen circadian disruption",
            "detail": "Extended screen exposure late in the day is predicting poorer sleep quality and lower cognitive clarity.",
            "confidence": "high",
            "evidence": "Device behavior rows and sleep trend",
        })

    return detections[:5] or [{
        "title": "Pattern learning active",
        "detail": "More daily logs will let VitaSense identify stronger behavioral correlations from your own history.",
        "confidence": "low",
        "evidence": "Available 30-day data is still sparse",
    }]


def _health_strategist(
    context: SignalContext,
    engine_scores: dict[str, int],
    future_forecast: list[dict[str, Any]],
) -> list[dict[str, Any]]:
    strategies: list[dict[str, Any]] = []
    top_titles = {item["title"] for item in future_forecast[:3]}

    if "Throat irritation or cold sensitivity" in top_titles:
        strategies.append({
            "title": "Protect throat sensitivity for 48h",
            "detail": "Avoid cold beverages and high-AQI outdoor exertion because respiratory sensitivity is elevated by your AQI, sleep, and symptom pattern.",
            "priority": "high",
            "horizon": "48h",
        })
    if engine_scores["recovery"] < 65:
        strategies.append({
            "title": "Reduce cognitive load tonight",
            "detail": "Your recovery system is overloaded. Move demanding decisions earlier and keep tonight's recovery window protected.",
            "priority": "high" if engine_scores["recovery"] < 50 else "medium",
            "horizon": "24h",
        })
    if _count_rows(context.memory_rows[:7], _outside_food) >= 2:
        strategies.append({
            "title": "Stabilize digestive resilience",
            "detail": "Choose simple, familiar meals and earlier hydration today because recent food exposure is raising digestive variability.",
            "priority": "medium",
            "horizon": "48h",
        })
    if engine_scores["emotional"] < 65:
        strategies.append({
            "title": "Lower social and emotional friction",
            "detail": "Your emotional baseline suggests increased irritability risk tonight. Keep one decompression block before high-stakes conversations.",
            "priority": "medium",
            "horizon": "24h",
        })
    if context.metrics["hrv"].trend == "below_baseline" or context.metrics["sleep"].trend == "below_baseline":
        strategies.append({
            "title": "Advance sleep by 90 minutes",
            "detail": "An earlier sleep target tonight may restore HRV direction and reduce tomorrow's recovery collapse probability.",
            "priority": "high",
            "horizon": "tonight",
        })

    return strategies[:5] or [{
        "title": "Maintain stable rhythm",
        "detail": "Keep sleep, hydration, meal timing, and screen boundaries steady while VitaSense continues learning your baseline.",
        "priority": "low",
        "horizon": "24h",
    }]


def _live_risk_intelligence(context: SignalContext, environmental_alerts: list[dict[str, str]]) -> dict[str, Any]:
    env = _latest(context.environment_rows)
    local_alerts = list(environmental_alerts)
    if env.get("heatwave_alert") is True:
        local_alerts.append({
            "type": "heatwave",
            "severity": "medium",
            "title": "Heatwave load",
            "detail": "Heatwave flag is active in your environmental data; hydration and exertion limits matter more today.",
        })
    return {
        "local_alerts": local_alerts[:6],
        "service_placeholders": [
            {
                "name": "Local health intelligence API",
                "status": "planned",
                "purpose": "Nearby viral illness, clinic visit, and symptom spike monitoring",
            },
            {
                "name": "Disease outbreak API",
                "status": "planned",
                "purpose": "Dengue, flu, food poisoning, and respiratory outbreak correlation",
            },
            {
                "name": "Environmental risk API",
                "status": "planned",
                "purpose": "AQI, pollen, heatwave, humidity, and UV risk enrichment",
            },
        ],
        "current_environment": {
            "aqi": _number(env.get("aqi")),
            "temperature_c": _number(env.get("temperature_c")),
            "pollen_level": env.get("pollen_level"),
            "heatwave_alert": env.get("heatwave_alert") is True,
        },
    }


def _behavior_patterns(
    metrics: dict[str, MetricSignal],
    memory: dict[str, Any],
    calendar: dict[str, Any],
    device: dict[str, Any],
) -> list[dict[str, str]]:
    patterns: list[dict[str, str]] = []

    if metrics["sleep"].value is not None and metrics["sleep"].value < 6.5:
        patterns.append({
            "title": "Sleep pressure",
            "detail": "Sleep is running light today, which may lower morning energy and stress tolerance.",
        })
    if metrics["hydration"].trend == "below_baseline" or (
        metrics["hydration"].value is not None and metrics["hydration"].value < 1500
    ):
        patterns.append({
            "title": "Hydration drift",
            "detail": "Water intake appears below a supportive range, so fatigue or headache risk may be higher.",
        })
    if memory.get("workload_intensity") in {"High", "Extreme"} or calendar.get("meetings_workload") in {"High", "Extreme"}:
        patterns.append({
            "title": "Workload compression",
            "detail": "Today looks cognitively demanding, so recovery breaks may matter more than usual.",
        })
    if device.get("late_night_usage") is True or (
        metrics["screen_time"].value is not None and metrics["screen_time"].value > 7
    ):
        patterns.append({
            "title": "Screen load",
            "detail": "Recent screen behavior may be adding strain to sleep quality and mental energy.",
        })
    if not patterns:
        patterns.append({
            "title": "Stable baseline",
            "detail": "No strong negative pattern stands out from the available recent data.",
        })

    return patterns[:4]


def _suggested_actions(
    metrics: dict[str, MetricSignal],
    memory: dict[str, Any],
    environment: dict[str, Any],
    calendar: dict[str, Any],
) -> list[dict[str, str]]:
    actions: list[dict[str, str]] = []

    if metrics["hydration"].value is None or metrics["hydration"].value < 1800:
        actions.append({
            "title": "Front-load hydration",
            "detail": "Add water earlier in the day rather than waiting until evening.",
        })
    if metrics["sleep"].value is not None and metrics["sleep"].value < 6.5:
        actions.append({
            "title": "Keep the afternoon lighter",
            "detail": "A lighter afternoon workload may help protect energy if your schedule allows it.",
        })
    if environment.get("aqi") and _number(environment.get("aqi")) and _number(environment.get("aqi")) >= 120:
        actions.append({
            "title": "Reduce outdoor exposure",
            "detail": "Poor air quality may make indoor or low-exertion plans more supportive today.",
        })
    if memory.get("mood_today") in {"Stressed", "Anxious"} or calendar.get("meetings_workload") in {"High", "Extreme"}:
        actions.append({
            "title": "Create one decompression window",
            "detail": "A short quiet reset between high-focus blocks may reduce stress carryover.",
        })
    if not actions:
        actions.append({
            "title": "Maintain your rhythm",
            "detail": "Keep meals, movement, and wind-down timing steady today.",
        })

    return actions[:3]


def _environmental_alerts(
    user_profile: dict[str, Any],
    environment: dict[str, Any],
) -> list[dict[str, str]]:
    medical = _profile_table(user_profile, "user_medical_identity")
    life = _profile_table(user_profile, "user_life_context")
    allergies = " ".join(str(item).lower() for item in medical.get("allergy_conditions", []) or [])
    recurring = " ".join(str(item).lower() for item in medical.get("recurring_health_patterns", []) or [])
    triggers = " ".join(str(item).lower() for item in life.get("perceived_health_triggers", []) or [])

    alerts: list[dict[str, str]] = []
    aqi = _number(environment.get("aqi"))
    uv_index = _number(environment.get("uv_index"))
    pollen = str(environment.get("pollen_level", "")).lower()
    temperature = _number(environment.get("temperature_c"))
    outdoor_hours = _number(environment.get("outdoor_hours"))

    if aqi is not None and aqi >= 120:
        severity: Severity = "high" if aqi >= 180 else "medium"
        detail = "Air quality is elevated today."
        if "throat" in recurring or "asthma" in allergies or "breathing" in triggers:
            detail = "Air quality is elevated and may be more relevant because of your respiratory or throat history."
        alerts.append({
            "type": "air_quality",
            "severity": severity,
            "title": "AQI sensitivity watch",
            "detail": detail,
        })

    if pollen in {"high", "very high"} or (pollen and "allerg" in allergies):
        alerts.append({
            "type": "pollen",
            "severity": "medium",
            "title": "Allergy load",
            "detail": "Pollen may be more noticeable today based on your allergy context.",
        })

    if temperature is not None and temperature >= 33 and outdoor_hours is not None and outdoor_hours >= 1:
        alerts.append({
            "type": "heat",
            "severity": "medium",
            "title": "Heat exposure",
            "detail": "Heat plus outdoor time may increase fatigue and hydration needs today.",
        })

    if uv_index is not None and uv_index >= 7:
        alerts.append({
            "type": "uv",
            "severity": "low",
            "title": "UV intensity",
            "detail": "UV is high enough that shade and skin protection may be helpful outdoors.",
        })

    return alerts[:4]


def _narrative(
    status: str,
    metrics: dict[str, MetricSignal],
    patterns: list[dict[str, str]],
    actions: list[dict[str, str]],
    environmental_alerts: list[dict[str, str]],
    hero_statement: str,
) -> str:
    opening = {
        "steady": "Your longitudinal signals look relatively steady today.",
        "watchful": "Your longitudinal signals suggest today may need a more deliberate rhythm.",
        "delicate": "Your body appears to need a more protective pace today.",
    }[status]

    context = []
    if metrics["sleep"].value is not None:
        context.append(f"sleep at {metrics['sleep'].value:g}h")
    if metrics["hydration"].value is not None:
        context.append(f"hydration around {metrics['hydration'].value:g}ml")
    if metrics["hrv"].trend != "unknown":
        context.append(f"HRV {metrics['hrv'].trend.replace('_', ' ')}")
    if environmental_alerts:
        context.append(environmental_alerts[0]["title"].lower())

    context_sentence = ""
    if context:
        context_sentence = " The strongest causal cluster is " + ", ".join(context[:4]) + "."

    action_sentence = ""
    if actions:
        action_sentence = f" Strategic move: {actions[0]['detail']}"

    return f"Good morning. {hero_statement} {opening}{context_sentence}{action_sentence}"


def _source_tables(
    daily_data: dict[str, Any],
    user_profile: dict[str, Any],
    chatbot_rows: list[dict[str, Any]],
    insight_rows: list[dict[str, Any]],
) -> list[str]:
    sources = [
        table
        for table, rows in daily_data.items()
        if isinstance(rows, list) and rows
    ]
    sources.extend(
        table
        for table, row in user_profile.items()
        if isinstance(row, dict) and row
    )
    if chatbot_rows:
        sources.append("chatbot_conversation_history")
    if insight_rows:
        sources.append("ai_health_insights")
    return sorted(set(sources))
