"""The Supabase-backed stores behave like the SQLite ones (VITASENSE_STORAGE=supabase).

Runs against a small in-memory stand-in for the supabase-py query builder, so no network is used.
"""

from __future__ import annotations

from datetime import datetime, timezone
from types import SimpleNamespace
from typing import Any

import pytest

from collect.supabase_store import SupabaseCollectedStore
from records.supabase_store import STORAGE_PREFIX, SupabaseRecordsStore

KEYS = {
    "vs_health_records": ("id",),
    "vs_medications": ("id",),
    "vs_dose_logs": ("medication_id", "dose_date", "dose_time"),
    "vs_collected_daily": ("user_id", "table_name", "log_date", "field"),
    "vs_collected_items": ("user_id", "source", "item_id"),
    "vs_connections": ("user_id", "source"),
}


class FakeQuery:
    def __init__(self, db: "FakeDB", table: str) -> None:
        self.db, self.table = db, table
        self.action, self.payload, self.cols = "select", None, "*"
        self.filters: list[tuple[str, str, Any]] = []
        self.order_by: list[tuple[str, bool]] = []
        self.limit_n: int | None = None
        self.window: tuple[int, int] | None = None
        self.on_conflict: str | None = None
        self.ignore = False

    # builders
    def select(self, cols="*"):
        self.cols = cols
        return self

    def insert(self, payload):
        self.action, self.payload = "insert", payload
        return self

    def upsert(self, payload, on_conflict=None, ignore_duplicates=False):
        self.action, self.payload, self.on_conflict, self.ignore = "upsert", payload, on_conflict, ignore_duplicates
        return self

    def update(self, payload):
        self.action, self.payload = "update", payload
        return self

    def delete(self):
        self.action = "delete"
        return self

    def eq(self, col, val):
        self.filters.append(("eq", col, val))
        return self

    def neq(self, col, val):
        self.filters.append(("neq", col, val))
        return self

    def gte(self, col, val):
        self.filters.append(("gte", col, val))
        return self

    def in_(self, col, vals):
        self.filters.append(("in", col, list(vals)))
        return self

    def order(self, col, desc=False):
        self.order_by.append((col, desc))
        return self

    def limit(self, n):
        self.limit_n = n
        return self

    def range(self, start, end):
        self.window = (start, end)
        return self

    # execution
    def _match(self, row):
        for op, col, val in self.filters:
            have = row.get(col)
            if op == "eq" and have != val:
                return False
            if op == "neq" and have == val:
                return False
            if op == "gte" and not (have is not None and have >= val):
                return False
            if op == "in" and have not in val:
                return False
        return True

    def execute(self):
        rows = self.db.tables.setdefault(self.table, [])
        if self.action == "insert":
            for item in self.payload if isinstance(self.payload, list) else [self.payload]:
                rows.append(self.db.with_defaults(self.table, dict(item)))
            return SimpleNamespace(data=[self.payload])
        if self.action == "upsert":
            keys = tuple((self.on_conflict or "").split(",")) if self.on_conflict else KEYS[self.table]
            written = []
            for item in self.payload if isinstance(self.payload, list) else [self.payload]:
                existing = next((r for r in rows if all(r.get(k) == item.get(k) for k in keys)), None)
                if existing is not None:
                    if self.ignore:
                        continue
                    existing.update(item)
                    written.append(existing)
                else:
                    row = self.db.with_defaults(self.table, dict(item))
                    rows.append(row)
                    written.append(row)
            return SimpleNamespace(data=written)
        matched = [r for r in rows if self._match(r)]
        if self.action == "update":
            for r in matched:
                r.update(self.payload)
            return SimpleNamespace(data=matched)
        if self.action == "delete":
            self.db.delete(self.table, matched)
            return SimpleNamespace(data=matched)
        for col, desc in reversed(self.order_by):
            matched.sort(key=lambda r: str(r.get(col) or ""), reverse=desc)
        if self.window:
            matched = matched[self.window[0] : self.window[1] + 1]
        if self.limit_n is not None:
            matched = matched[: self.limit_n]
        if self.cols != "*":
            wanted = [c.strip() for c in self.cols.split(",")]
            matched = [{c: r.get(c) for c in wanted} for r in matched]
        return SimpleNamespace(data=[dict(r) for r in matched])


class FakeBucket:
    def __init__(self, db):
        self.db = db

    def upload(self, path, data, options):
        self.db.files[path] = data

    def remove(self, paths):
        for p in paths:
            self.db.files.pop(p, None)


class FakeDB:
    def __init__(self) -> None:
        self.tables: dict[str, list[dict[str, Any]]] = {}
        self.files: dict[str, bytes] = {}
        self.storage = SimpleNamespace(from_=lambda bucket: FakeBucket(self))

    def table(self, name):
        return FakeQuery(self, name)

    @staticmethod
    def with_defaults(table, row):
        now = datetime.now(timezone.utc).isoformat()
        if table == "vs_connections":
            row.setdefault("connected_at", now)
        row.setdefault("created_at", now)
        return row

    def delete(self, table, matched):
        rows = self.tables.get(table, [])
        ids = [r.get("id") for r in matched]
        self.tables[table] = [r for r in rows if r not in matched]
        # Foreign keys cascade like the SQL schema.
        if table == "vs_health_records":
            meds = [m for m in self.tables.get("vs_medications", []) if m.get("record_id") in ids]
            self.delete("vs_medications", meds)
        if table == "vs_medications":
            logs = [d for d in self.tables.get("vs_dose_logs", []) if d.get("medication_id") in ids]
            self.delete("vs_dose_logs", logs)


@pytest.fixture
def db():
    return FakeDB()


def test_records_round_trip_with_duplicates_and_cascade(db):
    store = SupabaseRecordsStore(client=db)
    path = store.save_upload(7, "report.PDF", b"%PDF-1")
    assert path.startswith(STORAGE_PREFIX) and path.endswith(".pdf")
    assert len(db.files) == 1

    digest = store.file_hash(b"%PDF-1")
    record = store.add_record(
        user_id=7,
        file_name="report.pdf",
        mime_type="application/pdf",
        file_path=path,
        extracted={"document_type": "lab_report", "document_date": "2026-10-03", "title": "Lipid profile"},
        file_hash=digest,
    )
    assert record["extracted"]["title"] == "Lipid profile"
    assert "file_path" not in record and "file_hash" not in record
    assert store.find_by_hash(7, digest)["id"] == record["id"]
    assert store.find_by_hash(8, digest) is None

    older = store.add_record(user_id=7, file_name="old.jpg", mime_type="image/jpeg", file_path=None, extracted={"document_date": "2025-01-01"})
    assert [r["id"] for r in store.list_records(7)] == [record["id"], older["id"]]

    med = store.add_medication(user_id=7, record_id=record["id"], med={"name": "Pantoprazole", "times": ["07:30"], "as_needed": False})
    store.log_dose(user_id=7, med_id=med["id"], dose_date="2026-11-19", dose_time="07:30", status="taken")
    assert store.delete_record(7, record["id"]) is True
    assert store.list_medications(7, include_inactive=True) == []
    assert store.dose_logs(7, "2026-11-01") == []
    assert db.files == {}
    assert store.delete_record(7, record["id"]) is False


def test_medications_and_doses(db):
    store = SupabaseRecordsStore(client=db)
    med = store.add_medication(user_id=3, record_id=None, med={"name": "Sucralfate", "times": ["08:00", "21:00"], "as_needed": False})
    assert med["times"] == ["08:00", "21:00"] and med["active"] is True and med["as_needed"] is False

    updated = store.update_medication(3, med["id"], {"active": 0, "dose": "10 ml", "name": "ignored"})
    assert updated["active"] is False and updated["dose"] == "10 ml" and updated["name"] == "Sucralfate"
    assert store.list_medications(3) == []
    assert len(store.list_medications(3, include_inactive=True)) == 1

    store.log_dose(user_id=3, med_id=med["id"], dose_date="2026-11-19", dose_time="08:00", status="taken")
    store.log_dose(user_id=3, med_id=med["id"], dose_date="2026-11-19", dose_time="08:00", status="skipped")
    assert [d["status"] for d in store.dose_logs(3, "2026-11-19")] == ["skipped"]
    store.log_dose(user_id=3, med_id=med["id"], dose_date="2026-11-19", dose_time="08:00", status="pending")
    assert store.dose_logs(3, "2026-11-19") == []


def test_collected_fields_merge_lists_and_track_sources(db):
    store = SupabaseCollectedStore(client=db)
    store.write_fields(user_id=5, source="gmail", rows={"daily_user_memory_logs": {"2026-11-18": {"food_flags": ["fried"], "meal_late": True}}})
    store.write_fields(user_id=5, source="gmail", rows={"daily_user_memory_logs": {"2026-11-18": {"food_flags": ["fried", "sugary"]}}})
    store.write_fields(user_id=5, source="location", rows={"daily_environment_data": {"2026-11-19": {"aqi": 152, "skip": None}}})

    days = store.read_days(5, "2026-11-01")
    assert days["daily_user_memory_logs"]["2026-11-18"] == {"food_flags": ["fried", "sugary"], "meal_late": True}
    assert days["daily_environment_data"]["2026-11-19"] == {"aqi": 152}
    assert store.field_sources(5, "2026-11-01")["aqi"] == {"source": "location", "log_date": "2026-11-19"}

    with pytest.raises(ValueError):
        store.write_fields(user_id=5, source="x", rows={"not_a_table": {"2026-11-19": {"a": 1}}})

    store.mark_sync(5, "gmail", {"orders": 2})
    store.delete_source(5, "gmail")
    assert "daily_user_memory_logs" not in store.read_days(5, "2026-11-01")
    assert "gmail" not in store.connections(5)


def test_collected_items_and_connections(db):
    store = SupabaseCollectedStore(client=db)
    assert store.add_item(user_id=5, source="gmail", item_id="m1", happened_at="2026-11-18T23:42:00", kind="food_order", summary="Swiggy", details={"a": 1})
    assert not store.add_item(user_id=5, source="gmail", item_id="m1", happened_at=None, kind="food_order", summary="again", details={})
    store.add_item(user_id=5, source="gmail", item_id="m2", happened_at=None, kind="not_relevant", summary="newsletter", details={})
    store.add_item(user_id=5, source="gmail", item_id="m3", happened_at="2026-11-19T09:05:00", kind="pharmacy_order", summary="PharmEasy", details={})

    assert store.has_item(5, "gmail", "m2") and store.item_ids(5, "gmail") == {"m1", "m2", "m3"}
    assert [i["item_id"] for i in store.recent_items(5)] == ["m3", "m1"]
    assert store.recent_items(5)[1]["details"] == {"a": 1}

    store.mark_sync(5, "location", {"aqi": 152})
    first = store.connections(5)["location"]["connected_at"]
    store.mark_sync(5, "location", {"aqi": 160})
    again = store.connections(5)["location"]
    assert again["connected_at"] == first and again["last_result"] == {"aqi": 160} and again["last_sync_at"]

    assert store.list_users() == []
    with pytest.raises(RuntimeError):
        store.create_user("Asha", "asha")


def test_reads_page_past_the_1000_row_limit(db):
    store = SupabaseCollectedStore(client=db)
    rows = {"daily_fitness_data": {f"2026-{m:02d}-{d:02d}": {f"f{i}": i for i in range(12)} for m in range(1, 11) for d in range(1, 11)}}
    assert store.write_fields(user_id=9, source="health_connect", rows=rows) == 1200
    days = store.read_days(9, "2026-01-01")
    assert sum(len(v) for v in days["daily_fitness_data"].values()) == 1200


def test_factories_pick_the_backend_from_the_environment(monkeypatch):
    import collect.store as collect_store
    import records.store as records_store

    monkeypatch.setattr(records_store, "_store", None)
    monkeypatch.setattr(collect_store, "_store", None)
    monkeypatch.setenv("VITASENSE_STORAGE", "supabase")
    assert isinstance(records_store.get_records_store(), SupabaseRecordsStore)
    assert isinstance(collect_store.get_collected_store(), SupabaseCollectedStore)

    monkeypatch.setattr(records_store, "_store", None)
    monkeypatch.setattr(collect_store, "_store", None)
    monkeypatch.delenv("VITASENSE_STORAGE")
    assert isinstance(records_store.get_records_store(), records_store.RecordsStore)
    assert isinstance(collect_store.get_collected_store(), collect_store.CollectedStore)
    monkeypatch.setattr(records_store, "_store", None)
    monkeypatch.setattr(collect_store, "_store", None)
