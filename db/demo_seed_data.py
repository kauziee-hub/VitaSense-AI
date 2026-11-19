from __future__ import annotations

from copy import deepcopy
from datetime import date, timedelta
from typing import Any

def demo_today() -> date:
    """Demo history ends today, so real data collected on a demo profile shows up in the same window."""
    return date.today()


DEMO_USER_IDS = {1, 2, 3}


def _non_empty(value: Any) -> bool:
    return value not in (None, "", [])


def merge_demo_row(default_row: dict[str, Any], row: dict[str, Any] | None) -> dict[str, Any]:
    merged = deepcopy(default_row)
    for key, value in (row or {}).items():
        if _non_empty(value):
            merged[key] = value
    return merged


def merge_demo_context(user_id: int, context: dict[str, Any]) -> dict[str, Any]:
    if user_id not in DEMO_USER_IDS:
        return context

    defaults = demo_profile_context(user_id)
    merged = {"user_id": user_id}
    for table_name, default_row in defaults.items():
        existing = context.get(table_name)
        merged[table_name] = merge_demo_row(default_row, existing if isinstance(existing, dict) else {})
    return {**context, **merged}


def demo_profile_context(user_id: int) -> dict[str, dict[str, Any]]:
    profiles = {
        1: {
            "life": {
                "life_phase": "Early Career",
                "social_environment": "Friends/Roommates",
                "life_structure_type": "Unpredictable",
                "lifestyle_identity": "Highly Busy",
                "preferred_environment": "Indoor Controlled Environment",
                "perceived_health_triggers": ["low sleep", "hackathon workload", "high screen time", "outside food", "pollution"],
            },
            "medical": {
                "chronic_conditions": [],
                "recurring_health_patterns": ["fatigue after 2 low-sleep nights", "throat irritation during AQI spikes", "headache after late caffeine"],
                "allergy_conditions": ["dust sensitivity"],
                "major_medical_history": ["no major history reported"],
                "personal_health_note": "Highly ambitious builder profile with frequent hackathon pushes, late-night debugging, caffeine reliance, and irregular meal timing during release weeks.",
            },
            "food": {
                "eating_behavior": "Convenience-Based",
                "unhealthy_eating_triggers": ["deadline pressure", "late coding sessions", "team hackathons", "caffeine cravings"],
                "body_awareness_level": "Aware",
                "emotional_health_impact": True,
            },
            "emotional": {
                "emotional_tracking_enabled": True,
                "emotional_pressure_sources": ["ambition pressure", "hackathon deadlines", "performance expectations", "sleep debt"],
                "stress_response_pattern": "Focus",
                "recovery_preference": "Sleep",
                "loneliness_level": "Low",
                "depression_signals": ["irritability after sleep debt", "motivation dips after intense pushes"],
                "anxiety_triggers": ["demo deadlines", "production bugs", "competitive pressure"],
                "burnout_risk": "High",
                "emotional_support_system": "Close developer friends and project teammates.",
                "coping_mechanisms": ["music", "short walks", "late-night planning reset", "talking to teammates"],
                "emotional_stability_score": 64,
                "social_interaction_frequency": "Few times a week",
                "self_isolation_pattern": "Withdraws into long coding blocks when deadlines approach.",
                "emotional_notes": "Emotionally resilient but prone to overextension when ambition and sleep debt stack together.",
            },
            "personal_summary": "Ambitious high-output builder with hackathon-heavy cycles, high cognitive load, low sleep windows, irregular meals, and AQI-linked throat sensitivity.",
            "ai_summary": "User demonstrates prolonged screen exposure, inconsistent sleep recovery, high cognitive workload, and deadline-driven nutrition drift associated with burnout susceptibility and reduced immune resilience.",
            "patterns": [
                "Two consecutive low-sleep nights usually precede lower energy and HRV suppression.",
                "Hackathon workload correlates with caffeine spikes, late meals, and delayed hydration.",
                "High AQI plus low sleep increases throat irritation probability.",
                "Long screen exposure after midnight predicts poorer next-day cognitive clarity.",
            ],
            "risks": ["burnout susceptibility", "sleep debt accumulation", "throat irritation during AQI spikes", "caffeine-related headache", "digestive discomfort after late outside food"],
            "assessment": "High ambition and technical intensity create strong output capacity, but recovery debt rises quickly without protected sleep and hydration windows.",
        },
        2: {
            "life": {
                "life_phase": "Early Career",
                "social_environment": "Friends/Roommates",
                "life_structure_type": "Moderately Structured",
                "lifestyle_identity": "Physically Active",
                "preferred_environment": "Nature/Outdoors",
                "perceived_health_triggers": ["missed workouts", "travel", "heavy meetings", "poor hydration", "heat exposure"],
            },
            "medical": {
                "chronic_conditions": [],
                "recurring_health_patterns": ["mild muscle soreness after intense gym days", "energy dip after travel", "occasional acidity after spicy food"],
                "allergy_conditions": ["mild pollen sensitivity"],
                "major_medical_history": ["no major history reported"],
                "personal_health_note": "Generally balanced and socially active with consistent gym habits, better sleep discipline, and moderate stress from work peaks.",
            },
            "food": {
                "eating_behavior": "Balanced",
                "unhealthy_eating_triggers": ["social dinners", "post-workout cravings", "weekend outings"],
                "body_awareness_level": "Very Aware",
                "emotional_health_impact": False,
            },
            "emotional": {
                "emotional_tracking_enabled": True,
                "emotional_pressure_sources": ["work planning", "travel disruption", "social commitments"],
                "stress_response_pattern": "Exercise",
                "recovery_preference": "Exercise",
                "loneliness_level": "Very Low",
                "depression_signals": ["rare low motivation after travel fatigue"],
                "anxiety_triggers": ["missed workout streaks", "compressed work deadlines"],
                "burnout_risk": "Low",
                "emotional_support_system": "Strong friend circle, gym routine, and family check-ins.",
                "coping_mechanisms": ["gym", "walking outdoors", "sports", "talking to friends"],
                "emotional_stability_score": 82,
                "social_interaction_frequency": "Daily",
                "self_isolation_pattern": "Rare; usually stays socially connected even during busy weeks.",
                "emotional_notes": "Stable emotional baseline with strong recovery through movement and social contact.",
            },
            "personal_summary": "Balanced active user with gym consistency, strong social support, moderate workload stress, and recovery patterns that improve after movement and regular sleep.",
            "ai_summary": "User shows protective lifestyle anchors: consistent exercise, social regulation, and relatively stable sleep. Risk rises mainly when travel disrupts hydration, workout rhythm, and meal timing.",
            "patterns": [
                "Gym consistency aligns with better next-day mood and recovery scores.",
                "Travel days reduce hydration and raise muscle soreness/fatigue markers.",
                "Social eating occasionally increases acidity risk but does not strongly affect emotional stability.",
                "Morning activity windows correlate with better cognitive clarity.",
            ],
            "risks": ["travel-related fatigue", "heat dehydration", "muscle soreness after intense workouts", "spicy-food acidity", "missed workout mood dip"],
            "assessment": "A resilient and active profile with strong recovery behaviors; the main strategy is preserving routine during travel and work compression.",
        },
        3: {
            "life": {
                "life_phase": "Student Life",
                "social_environment": "Hostel Community",
                "life_structure_type": "Unpredictable",
                "lifestyle_identity": "Mentally Exhausted",
                "preferred_environment": "Warm Climate",
                "perceived_health_triggers": ["academic workload", "low sleep", "outside food", "stress", "pollution"],
            },
            "medical": {
                "chronic_conditions": [],
                "recurring_health_patterns": ["recurring fatigue", "throat irritation during AQI spikes", "mild acidity tendencies", "headache after long study sessions"],
                "allergy_conditions": ["dust sensitivity"],
                "major_medical_history": ["no major history reported"],
                "personal_health_note": "College student in hostel setting with fluctuating motivation, deadline anxiety, stress eating, and inconsistent sleep around exams.",
            },
            "food": {
                "eating_behavior": "Stress-Based Eating",
                "unhealthy_eating_triggers": ["exam stress", "hostel food fatigue", "late-night study", "emotional pressure"],
                "body_awareness_level": "Moderate",
                "emotional_health_impact": True,
            },
            "emotional": {
                "emotional_tracking_enabled": True,
                "emotional_pressure_sources": ["academic workload", "uncertainty", "comparison pressure", "family expectations"],
                "stress_response_pattern": "Mood",
                "recovery_preference": "Entertainment",
                "loneliness_level": "Moderate",
                "depression_signals": ["low motivation", "emotional fatigue", "withdrawal after exam pressure"],
                "anxiety_triggers": ["deadlines", "exams", "unfinished assignments", "performance comparison"],
                "burnout_risk": "Medium",
                "emotional_support_system": "Hostel friends, music, and occasional family calls.",
                "coping_mechanisms": ["music", "short walks", "talking to friends", "watching shows"],
                "emotional_stability_score": 58,
                "social_interaction_frequency": "Few times a week",
                "self_isolation_pattern": "Tends to isolate during assignment backlogs and after poor sleep.",
                "emotional_notes": "Emotionally sensitive to academic pressure; stress often appears physically as fatigue, acidity, and headaches.",
            },
            "personal_summary": "Hostel-based college student with academic pressure, inconsistent routine, stress eating, fluctuating motivation, and AQI-linked throat sensitivity.",
            "ai_summary": "User demonstrates academic stress accumulation, irregular meals, emotional fatigue, and sleep inconsistency that may lower cognitive performance and increase acidity or throat irritation risk.",
            "patterns": [
                "Assignment backlog correlates with late-night study, stress eating, and next-day fatigue.",
                "Low sleep plus hostel outside food increases acidity and digestive discomfort probability.",
                "AQI spikes align with throat irritation language in daily logs.",
                "Isolation periods correlate with lower emotional stability and reduced productivity.",
            ],
            "risks": ["academic burnout", "stress eating", "mild acidity", "throat irritation during pollution", "low motivation after poor sleep"],
            "assessment": "Emotionally aware but stress-reactive student profile; strongest protective levers are routine stabilization, earlier sleep before exams, and lighter meals during pressure weeks.",
        },
    }

    profile = profiles.get(user_id, profiles[1])
    return {
        "user_life_context": {"user_id": user_id, **profile["life"]},
        "user_medical_identity": {"user_id": user_id, **profile["medical"]},
        "user_food_body_relationship": {"user_id": user_id, **profile["food"]},
        "user_emotional_wellness": {"user_id": user_id, **profile["emotional"]},
        "user_personal_context": {"user_id": user_id, "personal_context_summary": profile["personal_summary"]},
        "ai_user_health_profile": {
            "user_id": user_id,
            "ai_health_summary": profile["ai_summary"],
            "ai_behavioral_patterns": profile["patterns"],
            "ai_risk_factors": profile["risks"],
            "ai_lifestyle_assessment": profile["assessment"],
            "ai_last_updated": "2026-05-15T08:30:00+05:30",
        },
    }


def _profile_type(user_id: int) -> str:
    return {1: "kausik", 2: "rithik", 3: "abhishek"}.get(user_id, "kausik")


def _mood(profile: str, index: int) -> str:
    if profile == "rithik":
        return ["Happy", "Neutral", "Happy", "Very Happy", "Neutral", "Happy", "Neutral"][index % 7]
    if profile == "abhishek":
        return ["Stressed", "Anxious", "Neutral", "Exhausted", "Sad", "Stressed", "Neutral"][index % 7]
    return ["Stressed", "Exhausted", "Anxious", "Neutral", "Stressed", "Happy", "Exhausted"][index % 7]


def demo_daily_payloads(user_id: int, log_date: date) -> dict[str, dict[str, Any]]:
    profile = _profile_type(user_id)
    day = log_date.day
    index = day - 1
    weekend = log_date.weekday() >= 5

    if profile == "kausik":
        hackathon = 9 <= day <= 12 or day in {4, 5}
        sleep = 4.6 if hackathon else 5.8 + (day % 3) * 0.4
        steps = 3200 + (day % 5) * 420
        water = 1250 + (day % 4) * 180
        hrv = 32 + (day % 5) * 2 - (6 if hackathon else 0)
        screen = 9.2 if hackathon else 7.4 + (day % 3) * 0.6
        workload = "Extreme" if hackathon else "High"
        breakfast, lunch, dinner, snacks = (
            "black coffee and toast",
            "canteen biryani",
            "late pizza with team",
            "2 coffees, energy drink, chips",
        ) if hackathon else (
            "idli and coffee",
            "rice bowl with dal",
            "paneer wrap",
            "coffee, peanuts",
        )
        mood = "Exhausted" if hackathon else _mood(profile, index)
        symptoms = ["headache", "eye strain"] if hackathon else ["mild fatigue"] if day % 4 == 0 else []
        note = "Hackathon sprint with long debugging blocks and delayed dinner." if hackathon else "Productive coding day with moderate recovery debt."
        workout = "Mobility" if hackathon else "Walking"
        recovery = "Not Improved" if hackathon else "Recovering"
    elif profile == "rithik":
        heavy_gym = day % 4 in {1, 2}
        travel = day in {7, 18, 26}
        sleep = 7.4 + (day % 4) * 0.2 - (0.8 if travel else 0)
        steps = 7800 + (day % 6) * 620
        water = 2300 + (day % 5) * 170
        hrv = 48 + (day % 6) * 2 - (4 if heavy_gym else 0)
        screen = 4.8 + (day % 4) * 0.45
        workload = "Moderate" if not travel else "High"
        breakfast, lunch, dinner, snacks = (
            "eggs, banana, oats",
            "chicken rice bowl",
            "dal, roti, vegetables",
            "protein shake, fruit",
        )
        mood = "Happy" if heavy_gym else _mood(profile, index)
        symptoms = ["muscle soreness"] if heavy_gym else ["travel fatigue"] if travel else []
        note = "Gym rhythm preserved; recovery feels stable." if heavy_gym else "Balanced workday with social contact."
        workout = "Strength Training" if heavy_gym else "Walking"
        recovery = "Recovered" if not travel else "Recovering"
    else:
        exam = 10 <= day <= 16 or day in {22, 23}
        sleep = 5.2 if exam else 6.3 + (day % 3) * 0.25
        steps = 3900 + (day % 5) * 300
        water = 1450 + (day % 4) * 160
        hrv = 35 + (day % 5) - (5 if exam else 0)
        screen = 7.2 if exam else 5.9 + (day % 4) * 0.4
        workload = "Extreme" if exam else "High" if day % 3 == 0 else "Moderate"
        breakfast, lunch, dinner, snacks = (
            "skipped breakfast, tea",
            "hostel rice and curry",
            "outside noodles",
            "chips, cold coffee",
        ) if exam else (
            "poha and tea",
            "hostel thali",
            "rice, dal, curd",
            "biscuits, lemon water",
        )
        mood = "Anxious" if exam else _mood(profile, index)
        symptoms = ["acidity", "headache", "fatigue"] if exam else ["mild throat irritation"] if day % 5 == 0 else []
        note = "Assignment pressure and late study increased emotional fatigue." if exam else "Mixed motivation with manageable routine."
        workout = "Walking"
        recovery = "Not Improved" if exam else "Recovering"

    aqi = 118 + (day % 6) * 12 + (12 if profile == "abhishek" and day % 5 == 0 else 0)
    temp = 31 + (day % 5)
    outside_food = profile in {"kausik", "abhishek"} and (day % 3 == 0 or (profile == "kausik" and 9 <= day <= 12))
    processed = outside_food or (profile == "abhishek" and day % 4 == 0)
    crowded = weekend or (profile == "abhishek" and 10 <= day <= 16)
    travel = profile == "rithik" and day in {7, 18, 26}

    created_at = f"{log_date.isoformat()}T21:30:00+05:30"
    return {
        "daily_fitness_data": {
            "user_id": user_id,
            "log_date": log_date.isoformat(),
            "steps": steps,
            "distance_km": round(steps * 0.00072, 2),
            "walking_distance_km": round(steps * 0.00072, 2),
            "calories_burned": round(220 + steps * 0.045),
            "exercise_minutes": 18 if profile != "rithik" else 52 if workout == "Strength Training" else 32,
            "exercise_duration_minutes": 18 if profile != "rithik" else 52 if workout == "Strength Training" else 32,
            "workout_type": workout,
            "heart_rate_avg": 78 if profile != "rithik" else 69,
            "resting_heart_rate": 62 if profile != "rithik" else 56,
            "hrv_ms": hrv,
            "hrv_score": hrv,
            "spo2_percent": 98,
            "spo2_level": 98,
            "sleep_hours": round(sleep, 1),
            "sleep_duration_hours": round(sleep, 1),
            "sleep_quality_score": max(38, min(92, round(sleep * 11 + hrv * 0.35))),
            "sleep_start_time": "00:50:00" if profile != "rithik" else "22:55:00",
            "sleep_end_time": "06:35:00" if profile != "rithik" else "06:45:00",
            "sleep_interruptions": 2 if sleep < 6 else 1,
            "water_ml": water,
            "water_intake_liters": round(water / 1000, 2),
            "body_temperature": 36.6 + (0.2 if symptoms else 0),
            "weight_kg": 68.2 if profile == "kausik" else 72.4 if profile == "rithik" else 64.8,
            "body_weight_kg": 68.2 if profile == "kausik" else 72.4 if profile == "rithik" else 64.8,
            "overall_health_feeling": "Average" if sleep < 6 else "Good",
            "created_at": created_at,
        },
        "daily_environment_data": {
            "user_id": user_id,
            "log_date": log_date.isoformat(),
            "location": "Bengaluru, Koramangala",
            "temperature_c": temp,
            "humidity_percent": 58 + (day % 6) * 3,
            "aqi": aqi,
            "uv_index": 5 + (day % 4),
            "pollen_level": "High" if day % 5 == 0 else "Moderate",
            "outdoor_hours": 1.8 if profile == "rithik" else 0.8 if profile == "kausik" else 1.1,
            "heatwave_alert": temp >= 34,
            "created_at": created_at,
        },
        "daily_device_behavior_data": {
            "user_id": user_id,
            "log_date": log_date.isoformat(),
            "screen_time_hours": round(screen, 1),
            "late_night_usage": profile != "rithik" and (sleep < 6 or day % 4 == 0),
            "continuous_usage_minutes": 95 if profile == "kausik" else 54 if profile == "rithik" else 82,
            "average_daily_usage_hours": round(screen + 0.3, 1),
            "created_at": created_at,
        },
        "daily_calendar_data": {
            "user_id": user_id,
            "log_date": log_date.isoformat(),
            "travel_event": travel,
            "trip_duration_days": 1 if travel else None,
            "meetings_workload": workload,
            "exam_event": profile == "abhishek" and (10 <= day <= 16 or day in {22, 23}),
            "sleep_schedule_disruption": sleep < 6,
            "created_at": created_at,
        },
        "daily_user_memory_logs": {
            "user_id": user_id,
            "log_date": log_date.isoformat(),
            "breakfast": breakfast,
            "lunch": lunch,
            "dinner": dinner,
            "snacks": snacks,
            "breakfast_log": breakfast,
            "lunch_log": lunch,
            "dinner_log": dinner,
            "snacks_beverages_log": snacks,
            "ate_from_outside": outside_food,
            "processed_food_consumed": processed,
            "unusual_food_exposure": outside_food,
            "unusual_exposure_notes": "Outside food exposure noted; monitor digestion." if outside_food else "No unusual food exposure.",
            "food_flags": ["outside food", "processed food"] if outside_food else ["home/hostel meal"],
            "mood_today": mood if mood in {"Very Sad", "Sad", "Neutral", "Happy", "Very Happy", "Anxious", "Stressed", "Exhausted"} else "Neutral",
            "energy_level": "Low" if sleep < 5.8 else "Moderate" if profile != "rithik" else "Good",
            "overall_mental_feeling": "Anxious" if mood == "Anxious" else "Stressed" if mood == "Stressed" else "Neutral",
            "emotional_physical_impact": profile != "rithik" and sleep < 6,
            "physical_discomfort_notes": ", ".join(symptoms) if symptoms else "No major discomfort.",
            "unusual_body_observation": note,
            "symptom_today": symptoms,
            "chatbot_symptoms": symptoms[:2],
            "chatbot_symptoms_reported": symptoms[:2],
            "chatbot_symptom_severity": "Moderate" if symptoms else "Mild",
            "chatbot_risk_level": "Medium" if symptoms or sleep < 6 else "Low",
            "chatbot_possible_causes": ["sleep debt", "workload", "AQI exposure"] if symptoms else ["normal variation"],
            "chatbot_recommended_actions": ["hydrate early", "protect sleep window", "avoid high-AQI outdoor exertion"],
            "chatbot_followup_questions": ["How long has this symptom been present?"] if symptoms else [],
            "chatbot_session_summary": f"{profile.title()} May 2026 demo log: {note}",
            "doctor_visit": False,
            "doctor_consulted_today": False,
            "medical_visit_reason": "",
            "personal_daily_note": note,
            "recovery_status": recovery,
            "linked_medical_reports": [],
            "workload_intensity": workload,
            "daily_events": ["hackathon sprint"] if profile == "kausik" and 9 <= day <= 12 else ["gym session"] if profile == "rithik" else ["assignment backlog"] if profile == "abhishek" and 10 <= day <= 16 else ["regular day"],
            "events": ["hackathon sprint"] if profile == "kausik" and 9 <= day <= 12 else ["gym session"] if profile == "rithik" else ["assignment backlog"] if profile == "abhishek" and 10 <= day <= 16 else ["regular day"],
            "crowded_place_exposure": crowded,
            "travel_today": travel,
            "emotional_event_notes": "Felt pressure but stayed functional." if profile != "rithik" else "Mood improved after activity and friends.",
            "created_at": created_at,
        },
    }


def demo_daily_history(user_id: int, days: int = 30) -> dict[str, list[dict[str, Any]]]:
    anchor = demo_today()
    dates = [anchor - timedelta(days=offset) for offset in range(days)]
    history = {
        "daily_fitness_data": [],
        "daily_environment_data": [],
        "daily_device_behavior_data": [],
        "daily_calendar_data": [],
        "daily_user_memory_logs": [],
    }
    for log_date in dates:
        payloads = demo_daily_payloads(user_id, log_date)
        for table_name, row in payloads.items():
            history[table_name].append(row)
    return history


def demo_chat_history(user_id: int, limit: int = 20) -> list[dict[str, Any]]:
    profile = _profile_type(user_id)
    if profile == "kausik":
        messages = [
            ("user", "I slept 4.5 hours after the hackathon and my throat feels scratchy."),
            ("assistant", "Your low sleep, elevated AQI, and caffeine-heavy day may be increasing throat sensitivity and recovery debt over the next 24-48 hours."),
            ("user", "Energy is crashing after 4 PM and I still need to work."),
            ("assistant", "This pattern looks like cognitive fatigue from sleep debt plus long screen exposure. A lighter evening block and earlier sleep would protect tomorrow's HRV."),
        ]
    elif profile == "rithik":
        messages = [
            ("user", "Legs are sore after gym but otherwise mood is good."),
            ("assistant", "That fits your activity pattern: muscle soreness after strength days with otherwise stable recovery. Hydration and protein timing are the main levers today."),
            ("user", "Travel tomorrow may disrupt my routine."),
            ("assistant", "Travel is your main recovery risk. Keeping hydration high and preserving even a shorter workout should reduce fatigue probability."),
        ]
    else:
        messages = [
            ("user", "I feel anxious about assignments and had acidity after outside noodles."),
            ("assistant", "Your academic workload, stress eating, and shorter sleep may be amplifying acidity and emotional fatigue over the next 24-48 hours."),
            ("user", "I also had a headache after studying late."),
            ("assistant", "That could relate to late screen exposure, hydration drift, and exam pressure. A protected sleep window may improve tomorrow's focus."),
        ]
    rows = []
    for index, (role, content) in enumerate(messages[-limit:]):
        rows.append({
            "id": index + 1,
            "user_id": user_id,
            "session_id": f"may-2026-demo-{user_id}",
            "message_role": role,
            "message_content": content,
            "related_symptoms": ["fatigue", "headache"] if profile != "rithik" else ["muscle soreness"],
            "ai_risk_level": "Medium" if profile != "rithik" else "Low",
            "created_at": f"2026-05-{12 + index:02d}T20:15:00+05:30",
        })
    return rows[:limit]
