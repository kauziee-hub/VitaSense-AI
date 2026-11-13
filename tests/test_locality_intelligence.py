from datetime import date

from locality.intelligence import build_locality_health_intelligence


def test_locality_intelligence_generates_layered_hotspots_from_user_context():
    intelligence = build_locality_health_intelligence(
        user_id=7,
        city="Bengaluru",
        locality="Indiranagar",
        radius_km=4,
        user_profile={
            "user_medical_identity": {
                "recurring_health_patterns": ["throat irritation during poor AQI"],
                "allergy_conditions": ["pollen"],
            }
        },
        daily_data={
            "daily_fitness_data": [
                {"sleep_hours": 5.8, "water_ml": 1200},
                {"sleep_hours": 6.0, "water_ml": 1500},
            ],
            "daily_environment_data": [{"aqi": 168, "temperature_c": 34, "humidity_percent": 72}],
            "daily_user_memory_logs": [
                {
                    "breakfast": "toast",
                    "lunch": "outside pani puri",
                    "chatbot_symptoms": ["throat irritation", "stomach pain"],
                    "workload_intensity": "High",
                }
            ],
            "daily_device_behavior_data": [{"screen_time_hours": 8.2, "late_night_usage": True}],
        },
        chatbot_history=[
            {"message_content": "I have throat irritation and fatigue"},
            {"message_content": "Stomach feels upset after outside food"},
        ],
        today=date(2026, 5, 15),
    )

    assert intelligence["locality"] == "Indiranagar"
    assert {layer["id"] for layer in intelligence["layers"]} == {"disease", "symptoms", "hazards", "food", "predictive"}
    assert any(hotspot["layer"] == "food" for hotspot in intelligence["hotspots"])
    assert any(card["future_probability"] >= card["affected_radius_km"] for card in intelligence["risk_cards"])
    assert "community symptom clusters" in intelligence["correlation_explanation"]


def test_locality_intelligence_is_deterministic_for_same_locality_and_date():
    first = build_locality_health_intelligence(user_id=1, city="Pune", locality="Kothrud", today=date(2026, 5, 15))
    second = build_locality_health_intelligence(user_id=1, city="Pune", locality="Kothrud", today=date(2026, 5, 15))

    assert first["scan_status"] == second["scan_status"]
    assert first["hotspots"] == second["hotspots"]
