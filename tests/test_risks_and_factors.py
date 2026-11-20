from datetime import date, datetime, timedelta, timezone

from collect.factors import FACTORS, Ctx, build_factors, connected_sources, days_by_date
from collect.outbreaks import notices_for
from collect.risks import assess, heat_index_c, top_alerts

TODAY = date(2026, 8, 20)  # monsoon month


def _days(n: int, **row):
    return {(TODAY - timedelta(days=i)).isoformat(): dict(row) for i in range(n)}


def _risk(result, risk_id):
    return next(r for r in result["risks"] if r["id"] == risk_id)


def test_no_environment_rows_means_no_risks():
    assert assess({}) == {"date": None, "place": None, "risks": []}


def test_malaria_follows_region_while_dengue_follows_weather():
    monsoon = dict(temperature_mean_c=28, humidity_percent=82, rain_14d_mm=140, rain_mm=12, country_code="in", climate_zone="tropical")
    odisha = assess(_days(14, **monsoon, state="Odisha"), today=TODAY)
    karnataka = assess(_days(14, **monsoon, state="Karnataka"), today=TODAY)
    assert _risk(odisha, "anopheles")["level"] == "high"
    assert _risk(karnataka, "anopheles")["score"] < _risk(odisha, "anopheles")["score"]
    assert _risk(karnataka, "aedes")["level"] == "high"  # Aedes breeds in stored water anywhere warm and wet


def test_temperate_country_has_no_mosquito_borne_risk():
    rows = _days(14, temperature_mean_c=27, humidity_percent=80, rain_14d_mm=90, rain_mm=6, country_code="de", climate_zone="temperate")
    result = assess(rows, today=TODAY)
    assert _risk(result, "aedes")["level"] == "low"
    assert _risk(result, "anopheles")["level"] == "low"


def test_heavy_rain_raises_water_borne_risk_and_names_leptospirosis():
    dry = assess(_days(14, temperature_mean_c=29, rain_mm=0, country_code="in"), today=TODAY)
    flood = _days(14, temperature_mean_c=29, rain_mm=8, country_code="in")
    flood[TODAY.isoformat()]["rain_mm"] = 110
    wet = assess(flood, today=TODAY)
    assert _risk(wet, "water")["score"] > _risk(dry, "water")["score"]
    assert _risk(wet, "water")["level"] == "high"
    assert any("Leptospirosis" in cause for cause in _risk(wet, "water")["causes"])


def test_air_pollution_reports_each_pollutant_against_who_limits():
    result = assess({TODAY.isoformat(): {"pm2_5": 75, "nitrogen_dioxide": 60, "ozone": 40, "aqi": 160}})
    air = _risk(result, "air_pollution")
    assert air["level"] == "high" and air["kind"] == "measured"
    assert any("PM2.5" in why and "5.0×" in why for why in air["why"])
    assert any("Nitrogen dioxide" in why for why in air["why"])
    assert not any("Ozone" in why for why in air["why"])  # under its limit


def test_heat_index_uses_humidity():
    assert heat_index_c(35, 80) > 45
    assert heat_index_c(25, 90) == 25
    hot = assess({TODAY.isoformat(): {"temperature_c": 35, "humidity_percent": 80}})
    assert _risk(hot, "heat")["level"] == "high"


def test_risk_advice_never_names_medicines():
    rows = _days(14, temperature_mean_c=28, humidity_percent=85, rain_14d_mm=150, rain_mm=20, country_code="in", state="Odisha",
                 pm2_5=90, aqi=170, temperature_c=38, uv_index=10, temperature_min_c=3, sunshine_hours=0.5)
    text = str(assess(rows, today=TODAY)).lower()
    for word in ("paracetamol", "ibuprofen", "antibiotic", "chloroquine", "artemisinin", " mg"):
        assert word not in text


def test_top_alerts_skip_low_risks():
    alerts = top_alerts({"risks": [{"id": "a", "level": "low", "title": "A", "why": []}, {"id": "b", "level": "high", "title": "B", "why": ["x"]}]})
    assert [a["type"] for a in alerts] == ["b"]


def test_outbreak_notices_match_country_and_recent_dates():
    now = datetime(2026, 11, 20, tzinfo=timezone.utc)
    items = [
        {"Title": "Nipah virus infection - India", "PublicationDate": "2026-09-01T10:00:00Z", "UrlName": "2026-DON1"},
        {"Title": "Cholera - India", "PublicationDate": "2025-01-01T10:00:00Z", "UrlName": "old"},
        {"Title": "Chikungunya - Switzerland", "PublicationDate": "2026-11-17T10:00:00Z", "UrlName": "ch"},
    ]
    found = notices_for(items, "India", now=now)
    assert [n["title"] for n in found] == ["Nipah virus infection - India"]
    assert found[0]["url"].endswith("2026-DON1")
    assert notices_for(items, None, now=now) == []


def _ctx(**over):
    base = dict(
        today=TODAY,
        days={},
        field_sources={},
        connected=set(),
        risks={},
        outbreaks=[],
        records={},
        profile={},
        memory=[],
        items=[],
    )
    base.update(over)
    return Ctx(**base)


def _factor(result, factor_id):
    return next(f for c in result["categories"] for f in c["factors"] if f["id"] == factor_id)


def test_factor_statuses_reflect_sources():
    days = {"daily_fitness_data": {TODAY.isoformat(): {"sleep_hours": 6.2, "resting_heart_rate": 61}}}
    ctx = _ctx(days=days, field_sources={"sleep_hours": {"source": "health_connect", "log_date": TODAY.isoformat()}}, connected={"health_connect"})
    result = build_factors(ctx, platform="android")
    assert _factor(result, "sleep_duration")["status"] == "live"
    assert _factor(result, "sleep_duration")["value"] == "6.2 h"
    assert _factor(result, "blood_pressure")["status"] == "waiting"  # Health Connect on, no BP device yet
    assert _factor(result, "screen_time")["status"] == "connect"
    assert _factor(result, "screen_time")["connect_with"] == "phone_usage"
    assert _factor(result, "noise")["status"] == "not_tracked"
    assert _factor(result, "smoking")["status"] == "manual"


def test_web_never_asks_to_connect_android_only_sources():
    result = build_factors(_ctx(), platform="web")
    assert _factor(result, "screen_time")["status"] == "on_phone"
    assert _factor(result, "smoking")["status"] == "manual"
    assert _factor(result, "air_pollution")["status"] == "connect"


def test_sex_specific_factors():
    male = build_factors(_ctx(sex="male"))
    female = build_factors(_ctx(sex="female"))
    ids = lambda r: {f["id"] for c in r["categories"] for f in c["factors"]}  # noqa: E731
    assert "menstrual_cycle" not in ids(male) and "pregnancy" not in ids(male)
    assert {"menstrual_cycle", "pregnancy"} <= ids(female)


def test_orders_feed_food_factors():
    stamp = f"{TODAY.isoformat()}T23:15:00"
    items = [
        {"source": "notifications", "kind": "food_order", "happened_at": stamp, "details": {"junk": True}},
        {"source": "gmail", "kind": "pharmacy_order", "happened_at": stamp, "details": {}},
    ]
    result = build_factors(_ctx(items=items))
    assert _factor(result, "outside_food")["value"] == "1 food order in 7 days"
    assert _factor(result, "late_meals")["status"] == "live"
    assert _factor(result, "junk_food")["value"].startswith("1 fast-food order")
    assert _factor(result, "self_medication")["source"] == "gmail"


def test_demo_profiles_are_labelled_as_sample_data():
    days = {"daily_fitness_data": {TODAY.isoformat(): {"steps": 4000}}}
    result = build_factors(_ctx(days=days, demo=True))
    assert _factor(result, "steps")["source"] == "demo"


def test_connected_sources_merge_server_and_phone():
    on = connected_sources({"screen_time": {}, "location": {}}, ["band", "nonsense"])
    assert on == {"phone_usage", "location", "band"}


def test_days_by_date_and_catalogue_is_complete():
    assert days_by_date({"t": [{"log_date": "2026-08-20", "x": 1}]}) == {"t": {"2026-08-20": {"log_date": "2026-08-20", "x": 1}}}
    assert len(FACTORS) >= 60
    assert len({f.id for f in FACTORS}) == len(FACTORS)
