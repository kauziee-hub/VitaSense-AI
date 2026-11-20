from datetime import date, datetime, timedelta, timezone

import httpx
import pytest
from fastapi.testclient import TestClient

import main
from collect import environment
from collect.device import DevicePayload, map_device_payload, workload_from_busy_hours
from collect.email_orders import EmailMessage, html_to_text, order_rows, sender_category
from collect.environment import fetch_environment, heat_level, mosquito_conditions
from collect.store import CollectedStore, overlay_daily_rows
from collect.summary import collected_prompt_lines

TODAY = date.today()
YESTERDAY = TODAY - timedelta(days=1)


@pytest.fixture()
def store(tmp_path):
    return CollectedStore(tmp_path / "collected.db")


# ---------- store + overlay ----------


def test_collected_fields_win_and_lists_accumulate(store):
    day = YESTERDAY.isoformat()
    store.write_fields(user_id=5, source="gmail", rows={"daily_user_memory_logs": {day: {"food_flags": ["ordered food"], "dinner": "Swiggy: pizza"}}})
    store.write_fields(user_id=5, source="gmail", rows={"daily_user_memory_logs": {day: {"food_flags": ["late-night food", "ordered food"]}}})

    collected = store.read_days(5, (TODAY - timedelta(days=30)).isoformat())
    assert collected["daily_user_memory_logs"][day]["food_flags"] == ["ordered food", "late-night food"]

    loaded = {"daily_user_memory_logs": [{"log_date": day, "dinner": "dal", "mood_today": "Happy"}]}
    merged = overlay_daily_rows(loaded, collected, user_id=5)
    row = merged["daily_user_memory_logs"][0]
    assert row["dinner"] == "Swiggy: pizza"  # collected beats stored
    assert row["mood_today"] == "Happy"  # stored fields survive


def test_overlay_adds_days_that_only_exist_locally_newest_first(store):
    store.write_fields(
        user_id=7,
        source="location",
        rows={"daily_environment_data": {TODAY.isoformat(): {"aqi": 152}, YESTERDAY.isoformat(): {"aqi": 130}}},
    )
    merged = overlay_daily_rows({}, store.read_days(7, "2000-01-01"), user_id=7)
    assert [r["aqi"] for r in merged["daily_environment_data"]] == [152, 130]
    assert merged["daily_environment_data"][0]["user_id"] == 7


def test_disconnecting_deletes_that_sources_data_only(store):
    day = TODAY.isoformat()
    store.write_fields(user_id=3, source="location", rows={"daily_environment_data": {day: {"aqi": 90}}})
    store.write_fields(user_id=3, source="health_connect", rows={"daily_fitness_data": {day: {"steps": 4000}}})
    store.mark_sync(3, "location", {"days": 1})

    store.delete_source(3, "location")

    collected = store.read_days(3, "2000-01-01")
    assert "daily_environment_data" not in collected
    assert collected["daily_fitness_data"][day]["steps"] == 4000
    assert "location" not in store.connections(3)


def test_local_users_start_far_above_hosted_ids(store):
    first = store.create_user("Asha", "asha-1")
    second = store.create_user("Ravi", "ravi-1")
    assert first["id"] == 100_000 and second["id"] == 100_001
    assert [u["name"] for u in store.list_users()] == ["Asha", "Ravi"]


# ---------- phone data ----------


def test_health_connect_day_maps_onto_fitness_fields():
    payload = DevicePayload(
        source="health_connect",
        health=[
            {
                "date": YESTERDAY,
                "sleep_minutes": 342,
                "sleep_start": "01:10",
                "sleep_end": "6:52",
                "steps": 4120,
                "distance_m": 2900,
                "hrv_ms": 31.4,
                "resting_heart_rate": 64,
                "workout_types": ["Walking"],
            }
        ],
    )
    fitness = map_device_payload(payload)["daily_fitness_data"][YESTERDAY.isoformat()]
    assert fitness["sleep_hours"] == 5.7
    assert fitness["sleep_start_time"] == "01:10:00" and fitness["sleep_end_time"] == "06:52:00"
    assert fitness["steps"] == 4120 and fitness["distance_km"] == 2.9
    assert fitness["hrv_ms"] == 31.4 and fitness["resting_heart_rate"] == 64
    assert "water_ml" not in fitness  # not measured, not invented


def test_calendar_day_becomes_workload_and_schedule_flags():
    payload = DevicePayload(
        source="calendar",
        calendar=[{"date": YESTERDAY, "event_count": 9, "busy_minutes": 480, "late_events": 1, "travel": True}],
    )
    rows = map_device_payload(payload)
    calendar = rows["daily_calendar_data"][YESTERDAY.isoformat()]
    assert calendar["meetings_workload"] == "Extreme"
    assert calendar["sleep_schedule_disruption"] is True
    assert calendar["travel_event"] is True
    assert rows["daily_user_memory_logs"][YESTERDAY.isoformat()]["workload_intensity"] == "Extreme"
    assert workload_from_busy_hours(2) == "Low"


def test_future_dates_are_rejected():
    with pytest.raises(ValueError):
        DevicePayload(source="health_connect", health=[{"date": TODAY + timedelta(days=2), "steps": 10}])


# ---------- emails ----------


def _message(id_, sender, hour, minute=0, day=YESTERDAY):
    sent = datetime(day.year, day.month, day.day, hour, minute, tzinfo=timezone(timedelta(hours=5, minutes=30)))
    return EmailMessage(id=id_, sender=sender, subject="Your order", sent_at=sent, text="...")


def test_only_merchant_senders_are_recognised():
    assert sender_category("Swiggy <noreply@swiggy.in>") == "food"
    assert sender_category("PharmEasy <care@pharmeasy.in>") == "pharmacy"
    assert sender_category("Mom <mom@gmail.com>") is None


def test_orders_map_to_meals_flags_and_events():
    parsed = [
        {
            "kind": "food_order",
            "merchant": "Swiggy",
            "items": ["2x Chicken biryani", "Coca-Cola"],
            "food_quality": "junk",
            "fried_or_fast_food": True,
            "sugary": True,
            "email": _message("m1", "noreply@swiggy.in", 23, 40),
        },
        {
            "kind": "pharmacy_order",
            "merchant": "PharmEasy",
            "medicines": [{"name": "Pantoprazole 40", "use": "acidity_digestion"}, {"name": "Azithromycin 500", "use": "antibiotic"}],
            "email": _message("m2", "care@pharmeasy.in", 10),
        },
        {"kind": "not_relevant", "email": _message("m3", "noreply@zomato.com", 9)},
    ]
    rows, items = order_rows(parsed, utc_offset_minutes=330)
    memory = rows["daily_user_memory_logs"][YESTERDAY.isoformat()]
    assert memory["dinner"] == "Swiggy: 2x Chicken biryani, Coca-Cola (ordered 23:40)"
    assert memory["ate_from_outside"] is True and memory["processed_food_consumed"] is True
    assert set(memory["food_flags"]) >= {"fried/fast food", "late-night food", "sugary food/drinks", "antibiotic bought"}
    assert any("Pantoprazole 40 (acidity digestion)" in e for e in memory["daily_events"])
    assert [i["kind"] for i in items] == ["food_order", "pharmacy_order"]


def test_late_order_after_midnight_stays_on_its_calendar_day():
    parsed = [{"kind": "food_order", "merchant": "Zomato", "items": ["Maggi"], "email": _message("m4", "x@zomato.com", 1, 15, day=TODAY)}]
    rows, items = order_rows(parsed, utc_offset_minutes=330)
    assert TODAY.isoformat() in rows["daily_user_memory_logs"]
    assert items[0]["details"]["late_night"] is True


def test_html_mail_becomes_readable_text():
    text = html_to_text("<html><style>p{}</style><p>Order&nbsp;<b>#123</b></p><table><tr><td>Biryani</td></tr></table></html>")
    assert "Order #123" in text and "Biryani" in text and "p{}" not in text


def test_prompt_lines_show_timestamped_orders_and_measured_weather(store):
    store.mark_sync(1, "gmail", {})
    store.add_item(
        user_id=1,
        source="gmail",
        item_id="m1",
        happened_at=f"{YESTERDAY.isoformat()}T23:40",
        kind="food_order",
        summary="Swiggy: Chicken biryani, Coca-Cola",
        details={"flags": ["fried/fast food", "late-night food"]},
    )
    store.write_fields(
        user_id=1,
        source="location",
        rows={"daily_environment_data": {TODAY.isoformat(): {"aqi": 152, "aqi_scale": "US AQI", "location": "Koramangala, Bengaluru", "mosquito_breeding_conditions": "low"}}},
    )
    text = "\n".join(collected_prompt_lines(store, 1, today=TODAY))
    assert "23:40: Swiggy: Chicken biryani, Coca-Cola [fried/fast food, late-night food]" in text
    assert "AQI 152 (Unhealthy, US AQI)" in text and "Koramangala" in text


# ---------- environment ----------


def test_heat_and_mosquito_levels():
    assert heat_level(41, 30) == "heatwave"
    assert heat_level(35, 75) == "heat_stress"
    assert heat_level(30, 90) == "none"
    assert mosquito_conditions(80, 28, 80) == "high"
    assert mosquito_conditions(20, 28, 50) == "moderate"
    assert mosquito_conditions(0, 22, 40) == "low"


@pytest.mark.asyncio
async def test_environment_builds_daily_rows_with_worst_hour_aqi():
    environment._place_cache.clear()
    days = [(TODAY - timedelta(days=i)).isoformat() for i in (2, 1, 0)] + [(TODAY + timedelta(days=1)).isoformat()]

    def handler(request: httpx.Request) -> httpx.Response:
        if "air-quality" in request.url.host:
            return httpx.Response(
                200,
                json={"hourly": {"time": [f"{TODAY.isoformat()}T08:00", f"{TODAY.isoformat()}T17:00"], "us_aqi": [80, 161], "pm2_5": [30, 70]}},
            )
        if "nominatim" in request.url.host:
            return httpx.Response(200, json={"address": {"suburb": "Koramangala", "city": "Bengaluru"}})
        return httpx.Response(
            200,
            json={
                "daily": {
                    "time": days,
                    "temperature_2m_max": [33, 34, 35, 36],
                    "temperature_2m_mean": [27, 28, 28, 29],
                    "relative_humidity_2m_mean": [78, 80, 82, 80],
                    "precipitation_sum": [30, 25, 10, 0],
                    "uv_index_max": [7, 8, 9, 9],
                }
            },
        )

    async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
        result = await fetch_environment(12.93, 77.62, http=client, today=TODAY)

    assert sorted(result["rows"]) == days[:3]  # the forecast day is not stored as history
    today_row = result["today"]
    assert today_row["aqi"] == 161 and today_row["pm2_5"] == 50
    assert today_row["location"] == "Koramangala, Bengaluru"
    assert today_row["rain_14d_mm"] == 65 and today_row["mosquito_breeding_conditions"] == "high"
    assert {"air_pollution", "heat", "aedes"} <= {a["type"] for a in result["alerts"]}
    assert {r["id"] for r in result["risks"]} >= {"air_pollution", "heat", "water", "aedes", "anopheles", "respiratory"}


# ---------- endpoints ----------


class FakeAI:
    async def verify_models(self):
        return []

    async def health_check(self):
        return True

    async def close(self):
        return None

    async def generate_json(self, **kwargs):
        return {
            "emails": [
                {"index": 0, "kind": "food_order", "merchant": "Swiggy", "items": ["Pizza"], "food_quality": "junk", "fried_or_fast_food": True},
            ]
        }


def test_device_and_email_endpoints_feed_the_daily_loader(monkeypatch, tmp_path):
    import collect.store as store_module

    local = CollectedStore(tmp_path / "api.db")
    monkeypatch.setattr(store_module, "_store", local)
    monkeypatch.setattr(main, "_build_ai_client", lambda: (FakeAI(), "gemini"))

    with TestClient(main.app) as client:
        device = client.post(
            "/api/v1/user/100000/collect/device",
            json={"source": "health_connect", "health": [{"date": YESTERDAY.isoformat(), "sleep_minutes": 300, "steps": 2000}]},
        )
        emails = client.post(
            "/api/v1/user/100000/collect/emails",
            json={
                "utc_offset_minutes": 330,
                "emails": [
                    {"id": "a1", "sender": "Swiggy <noreply@swiggy.in>", "subject": "Order delivered", "sent_at": f"{YESTERDAY.isoformat()}T17:40:00+00:00", "text": "Pizza"},
                    {"id": "a2", "sender": "Friend <friend@gmail.com>", "subject": "hi", "sent_at": f"{YESTERDAY.isoformat()}T10:00:00+00:00", "text": "personal"},
                ],
            },
        )
        status = client.get("/api/v1/user/100000/collect/status")
        removed = client.delete("/api/v1/user/100000/collect/gmail")

    assert device.status_code == 200 and device.json()["days"] == 1
    assert emails.status_code == 200
    assert emails.json()["emails_read"] == 1  # the personal mail was dropped unread
    assert emails.json()["items"][0]["summary"] == "Swiggy: Pizza"
    body = status.json()
    assert set(body["connections"]) == {"health_connect", "gmail"}
    assert body["latest_health"]["sleep_hours"] == 5.0
    assert body["recent_items"][0]["kind"] == "food_order"
    assert removed.json() == {"disconnected": "gmail", "data_deleted": True}
    assert local.recent_items(100000) == []


def test_users_and_check_ins_work_while_the_database_is_down(monkeypatch, tmp_path):
    import collect.store as store_module

    local = CollectedStore(tmp_path / "users.db")
    monkeypatch.setattr(store_module, "_store", local)
    monkeypatch.setattr(main, "_build_ai_client", lambda: (None, None))

    def broken():
        raise RuntimeError("database offline")

    monkeypatch.setattr(main, "get_supabase", broken)

    with TestClient(main.app) as client:
        created = client.post("/api/v1/users", json={"name": "Asha"})
        listed = client.get("/api/v1/users")
        check_in = client.put(
            f"/api/v1/user/{created.json()['id']}/daily-log",
            json={"log_date": YESTERDAY.isoformat(), "manual": {"mood_today": "Stressed", "energy_level": "Low"}},
        )

    assert created.status_code == 200 and created.json()["id"] >= 100_000
    assert "Asha" in [u["name"] for u in listed.json()["users"]]
    assert "Kausik" in [u["name"] for u in listed.json()["users"]]
    assert check_in.status_code == 200
    saved = local.read_days(created.json()["id"], "2000-01-01")["daily_user_memory_logs"][YESTERDAY.isoformat()]
    assert saved["mood_today"] == "Stressed"


@pytest.mark.asyncio
async def test_gmail_fetch_searches_merchants_only_and_reads_parts():
    import base64

    from collect.email_orders import fetch_gmail_messages

    def b64(text):
        return base64.urlsafe_b64encode(text.encode()).decode().rstrip("=")

    seen = {}

    def handler(request: httpx.Request) -> httpx.Response:
        assert request.headers["Authorization"] == "Bearer token-123"
        if request.url.path.endswith("/messages"):
            seen["q"] = request.url.params["q"]
            return httpx.Response(200, json={"messages": [{"id": "old"}, {"id": "new"}]})
        assert request.url.path.endswith("/messages/new"), "already-seen mail must not be fetched"
        return httpx.Response(
            200,
            json={
                "payload": {
                    "headers": [
                        {"name": "From", "value": "Thyrocare <reports@thyrocare.com>"},
                        {"name": "Subject", "value": "Your report"},
                        {"name": "Date", "value": "Tue, 18 Nov 2025 09:15:00 +0530"},
                    ],
                    "parts": [
                        {"mimeType": "text/html", "body": {"data": b64("<p>Your <b>Lipid</b> report is ready</p>")}},
                        {"mimeType": "application/pdf", "filename": "report.pdf", "body": {"attachmentId": "att-1"}},
                    ],
                }
            },
        )

    async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
        messages = await fetch_gmail_messages(client, "token-123", days=30, skip_ids={"old"})

    assert "swiggy.in" in seen["q"] and "newer_than:30d" in seen["q"] and "gmail.com" not in seen["q"]
    assert len(messages) == 1
    assert messages[0].text == "Your Lipid report is ready"
    assert messages[0].pdf_attachments == [("report.pdf", "att-1")]
    assert messages[0].category == "lab"


@pytest.mark.asyncio
async def test_expired_gmail_token_is_reported():
    from collect.email_orders import fetch_gmail_messages

    async with httpx.AsyncClient(transport=httpx.MockTransport(lambda r: httpx.Response(401))) as client:
        with pytest.raises(PermissionError):
            await fetch_gmail_messages(client, "expired-token", days=30, skip_ids=set())


def test_app_alerts_are_read_only_from_known_delivery_apps(monkeypatch, tmp_path):
    import collect.store as store_module

    local = CollectedStore(tmp_path / "alerts.db")
    monkeypatch.setattr(store_module, "_store", local)
    monkeypatch.setattr(main, "_build_ai_client", lambda: (FakeAI(), "gemini"))
    posted = f"{YESTERDAY.isoformat()}T17:40:00+00:00"

    with TestClient(main.app) as client:
        response = client.post(
            "/api/v1/user/100000/collect/notifications",
            json={
                "alerts": [
                    {"id": "n1", "package": "in.swiggy.android", "title": "Order delivered", "text": "Your pizza is here", "posted_at": posted},
                    {"id": "n2", "package": "com.whatsapp", "title": "Mum", "text": "call me", "posted_at": posted},
                ]
            },
        )
        status = client.get("/api/v1/user/100000/collect/status")

    assert response.status_code == 200
    assert response.json()["alerts_read"] == 1  # WhatsApp was dropped unread
    assert response.json()["items"][0]["kind"] == "food_order"
    assert "notifications" in status.json()["connections"]
    assert local.recent_items(100000)[0]["source"] == "notifications"


def test_device_payload_carries_new_health_connect_measurements():
    from collect.device import DevicePayload, map_device_payload

    rows = map_device_payload(
        DevicePayload(
            source="health_connect",
            health=[{"date": YESTERDAY.isoformat(), "systolic_mmhg": 128.4, "diastolic_mmhg": 84, "blood_glucose_mg_dl": 104, "vo2_max": 41.26, "period_day": True}],
        )
    )
    day = rows["daily_fitness_data"][YESTERDAY.isoformat()]
    assert day["blood_pressure"] == "128/84 mmHg"
    assert day["blood_glucose_mg_dl"] == 104 and day["vo2_max"] == 41.3 and day["period_day"] is True


def test_status_scores_stored_environment_days_and_new_sources_can_be_removed(monkeypatch, tmp_path):
    """Regression: /collect/status returned 500 once any environment row existed, and the
    notifications and band sources could not be switched off server-side."""
    import collect.store as store_module

    local = CollectedStore(tmp_path / "status.db")
    monkeypatch.setattr(store_module, "_store", local)
    monkeypatch.setattr(main, "_build_ai_client", lambda: (FakeAI(), "gemini"))
    today = date.today()
    rows = {
        (today - timedelta(days=i)).isoformat(): {"aqi": 160, "pm2_5": 70, "temperature_mean_c": 24, "rain_mm": 0, "country_code": "in"}
        for i in range(5)
    }
    local.write_fields(user_id=100000, source="location", rows={"daily_environment_data": rows})
    local.write_fields(user_id=100000, source="band", rows={"daily_fitness_data": {today.isoformat(): {"avg_heart_rate": 72}}})

    with TestClient(main.app) as client:
        status = client.get("/api/v1/user/100000/collect/status")
        band_off = client.delete("/api/v1/user/100000/collect/band")
        alerts_off = client.delete("/api/v1/user/100000/collect/notifications")

    assert status.status_code == 200
    assert [a["type"] for a in status.json()["environment"]["alerts"]][:1] == ["air_pollution"]
    assert band_off.status_code == 200 and alerts_off.status_code == 200
    assert "avg_heart_rate" not in str(local.read_days(100000, (today - timedelta(days=1)).isoformat()))
    assert "band" not in local.connections(100000)


def test_environment_alerts_accepts_a_single_stored_row():
    from collect.environment import environment_alerts

    assert environment_alerts({"aqi": 170, "pm2_5": 80})[0]["type"] == "air_pollution"
    assert environment_alerts({}) == []
