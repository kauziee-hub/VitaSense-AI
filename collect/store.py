"""Local store for automatically collected data.

Everything collected (phone health data, calendar load, weather and air, food
and pharmacy orders, check-ins) is written field by field into the same daily
tables the forecast and chat already read (daily_fitness_data,
daily_environment_data, ...), with the source of every value. The loader lays
these over whatever the hosted database has, so collected data shows up in the
forecast, chat and doctor report with no other changes.

Also holds connection state per source and, while the hosted database is
offline, locally created users.
"""

from __future__ import annotations

import json
import sqlite3
import threading
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from records.store import data_dir, hosted_storage

DAILY_TABLES = (
    "daily_fitness_data",
    "daily_environment_data",
    "daily_device_behavior_data",
    "daily_calendar_data",
    "daily_user_memory_logs",
)

# Fields that accumulate across sources and syncs instead of being replaced.
LIST_FIELDS = {"food_flags", "daily_events", "events", "symptom_today", "collected_orders"}

# Local users get ids far above hosted ones so the two never collide.
LOCAL_USER_ID_START = 100_000

_SCHEMA = """
CREATE TABLE IF NOT EXISTS collected_daily (
    user_id INTEGER NOT NULL,
    table_name TEXT NOT NULL,
    log_date TEXT NOT NULL,
    field TEXT NOT NULL,
    value_json TEXT NOT NULL,
    source TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    PRIMARY KEY (user_id, table_name, log_date, field)
);
CREATE INDEX IF NOT EXISTS idx_collected_user_date ON collected_daily(user_id, log_date);

CREATE TABLE IF NOT EXISTS collected_items (
    user_id INTEGER NOT NULL,
    source TEXT NOT NULL,
    item_id TEXT NOT NULL,
    happened_at TEXT,
    kind TEXT NOT NULL,
    summary TEXT NOT NULL,
    details_json TEXT NOT NULL,
    created_at TEXT NOT NULL,
    PRIMARY KEY (user_id, source, item_id)
);

CREATE TABLE IF NOT EXISTS connections (
    user_id INTEGER NOT NULL,
    source TEXT NOT NULL,
    connected_at TEXT NOT NULL,
    last_sync_at TEXT,
    last_result_json TEXT,
    PRIMARY KEY (user_id, source)
);

CREATE TABLE IF NOT EXISTS local_users (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL,
    user_code TEXT NOT NULL,
    created_at TEXT NOT NULL
);
"""


def _now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


class CollectedStore:
    def __init__(self, db_path: Path | str | None = None) -> None:
        self._db_path = str(db_path or data_dir() / "vitasense_local.db")
        self._lock = threading.Lock()
        self._conn = sqlite3.connect(self._db_path, check_same_thread=False)
        self._conn.row_factory = sqlite3.Row
        with self._lock:
            self._conn.executescript(_SCHEMA)
            self._conn.commit()

    # ---------- daily fields ----------

    def write_fields(
        self,
        *,
        user_id: int,
        source: str,
        rows: dict[str, dict[str, dict[str, Any]]],
    ) -> int:
        """rows: {table_name: {log_date: {field: value}}}. Returns how many fields were written."""
        written = 0
        now = _now()
        with self._lock:
            for table_name, by_date in rows.items():
                if table_name not in DAILY_TABLES:
                    raise ValueError(f"Unknown daily table: {table_name}")
                for log_date, fields in by_date.items():
                    for field, value in fields.items():
                        if value is None:
                            continue
                        if field in LIST_FIELDS:
                            value = self._merged_list(user_id, table_name, log_date, field, value)
                        self._conn.execute(
                            "INSERT INTO collected_daily (user_id, table_name, log_date, field, value_json, source, updated_at) "
                            "VALUES (?, ?, ?, ?, ?, ?, ?) "
                            "ON CONFLICT(user_id, table_name, log_date, field) DO UPDATE SET "
                            "value_json = excluded.value_json, source = excluded.source, updated_at = excluded.updated_at",
                            (int(user_id), table_name, log_date, field, json.dumps(value), source, now),
                        )
                        written += 1
            self._conn.commit()
        return written

    def _merged_list(self, user_id: int, table_name: str, log_date: str, field: str, value: Any) -> list[Any]:
        row = self._conn.execute(
            "SELECT value_json FROM collected_daily WHERE user_id = ? AND table_name = ? AND log_date = ? AND field = ?",
            (int(user_id), table_name, log_date, field),
        ).fetchone()
        existing = json.loads(row["value_json"]) if row else []
        merged = list(existing) if isinstance(existing, list) else []
        for item in value if isinstance(value, list) else [value]:
            if item not in merged:
                merged.append(item)
        return merged

    def read_days(self, user_id: int, since: str) -> dict[str, dict[str, dict[str, Any]]]:
        """{table_name: {log_date: {field: value}}} for dates on or after `since`."""
        with self._lock:
            rows = self._conn.execute(
                "SELECT table_name, log_date, field, value_json FROM collected_daily WHERE user_id = ? AND log_date >= ?",
                (int(user_id), since),
            ).fetchall()
        out: dict[str, dict[str, dict[str, Any]]] = {}
        for row in rows:
            out.setdefault(row["table_name"], {}).setdefault(row["log_date"], {})[row["field"]] = json.loads(row["value_json"])
        return out

    def field_sources(self, user_id: int, since: str) -> dict[str, dict[str, str]]:
        """{field: {"source": ..., "log_date": ...}} for the newest value of each field."""
        with self._lock:
            rows = self._conn.execute(
                "SELECT field, source, MAX(log_date) AS log_date FROM collected_daily "
                "WHERE user_id = ? AND log_date >= ? GROUP BY field, source",
                (int(user_id), since),
            ).fetchall()
        out: dict[str, dict[str, str]] = {}
        for row in rows:
            current = out.get(row["field"])
            if current is None or row["log_date"] > current["log_date"]:
                out[row["field"]] = {"source": row["source"], "log_date": row["log_date"]}
        return out

    def delete_source(self, user_id: int, source: str) -> None:
        with self._lock:
            self._conn.execute("DELETE FROM collected_daily WHERE user_id = ? AND source = ?", (int(user_id), source))
            self._conn.execute("DELETE FROM collected_items WHERE user_id = ? AND source = ?", (int(user_id), source))
            self._conn.execute("DELETE FROM connections WHERE user_id = ? AND source = ?", (int(user_id), source))
            self._conn.commit()

    # ---------- individual items (orders, purchases) ----------

    def add_item(
        self,
        *,
        user_id: int,
        source: str,
        item_id: str,
        happened_at: str | None,
        kind: str,
        summary: str,
        details: dict[str, Any],
    ) -> bool:
        """Returns False if this item was already collected (e.g. the same email on the next sync)."""
        with self._lock:
            cursor = self._conn.execute(
                "INSERT OR IGNORE INTO collected_items (user_id, source, item_id, happened_at, kind, summary, details_json, created_at) "
                "VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
                (int(user_id), source, item_id, happened_at, kind, summary, json.dumps(details), _now()),
            )
            self._conn.commit()
            return cursor.rowcount > 0

    def has_item(self, user_id: int, source: str, item_id: str) -> bool:
        with self._lock:
            row = self._conn.execute(
                "SELECT 1 FROM collected_items WHERE user_id = ? AND source = ? AND item_id = ?", (int(user_id), source, item_id)
            ).fetchone()
        return row is not None

    def item_ids(self, user_id: int, source: str) -> set[str]:
        """Everything already looked at from a source, relevant or not."""
        with self._lock:
            rows = self._conn.execute(
                "SELECT item_id FROM collected_items WHERE user_id = ? AND source = ?", (int(user_id), source)
            ).fetchall()
        return {row["item_id"] for row in rows}

    def recent_items(self, user_id: int, limit: int = 20) -> list[dict[str, Any]]:
        with self._lock:
            rows = self._conn.execute(
                "SELECT source, item_id, happened_at, kind, summary, details_json FROM collected_items "
                "WHERE user_id = ? AND kind != 'not_relevant' ORDER BY COALESCE(happened_at, created_at) DESC LIMIT ?",
                (int(user_id), limit),
            ).fetchall()
        return [{**{k: row[k] for k in ("source", "item_id", "happened_at", "kind", "summary")}, "details": json.loads(row["details_json"])} for row in rows]

    # ---------- connections ----------

    def mark_sync(self, user_id: int, source: str, result: dict[str, Any]) -> None:
        now = _now()
        with self._lock:
            self._conn.execute(
                "INSERT INTO connections (user_id, source, connected_at, last_sync_at, last_result_json) VALUES (?, ?, ?, ?, ?) "
                "ON CONFLICT(user_id, source) DO UPDATE SET last_sync_at = excluded.last_sync_at, last_result_json = excluded.last_result_json",
                (int(user_id), source, now, now, json.dumps(result)),
            )
            self._conn.commit()

    def connections(self, user_id: int) -> dict[str, dict[str, Any]]:
        with self._lock:
            rows = self._conn.execute(
                "SELECT source, connected_at, last_sync_at, last_result_json FROM connections WHERE user_id = ?", (int(user_id),)
            ).fetchall()
        return {
            row["source"]: {
                "connected_at": row["connected_at"],
                "last_sync_at": row["last_sync_at"],
                "last_result": json.loads(row["last_result_json"] or "{}"),
            }
            for row in rows
        }

    # ---------- local users (hosted database offline) ----------

    def create_user(self, name: str, user_code: str) -> dict[str, Any]:
        with self._lock:
            row = self._conn.execute("SELECT MAX(id) AS max_id FROM local_users").fetchone()
            next_id = max(LOCAL_USER_ID_START, (row["max_id"] or 0) + 1)
            self._conn.execute(
                "INSERT INTO local_users (id, name, user_code, created_at) VALUES (?, ?, ?, ?)", (next_id, name, user_code, _now())
            )
            self._conn.commit()
        return {"id": next_id, "name": name, "user_code": user_code}

    def list_users(self) -> list[dict[str, Any]]:
        with self._lock:
            rows = self._conn.execute("SELECT id, name, user_code FROM local_users ORDER BY id").fetchall()
        return [dict(row) for row in rows]


_store: Any = None
_store_lock = threading.Lock()


def get_collected_store() -> CollectedStore:
    """SQLite on this machine by default; Supabase when VITASENSE_STORAGE=supabase. Same methods either way."""
    global _store
    with _store_lock:
        if _store is None:
            if hosted_storage():
                from .supabase_store import SupabaseCollectedStore

                _store = SupabaseCollectedStore()
            else:
                _store = CollectedStore()
        return _store


def overlay_daily_rows(
    rows_by_table: dict[str, list[dict[str, Any]]],
    collected: dict[str, dict[str, dict[str, Any]]],
    *,
    user_id: int,
) -> dict[str, list[dict[str, Any]]]:
    """Lay collected fields over loaded daily rows (collected wins), adding days that only exist locally.
    Rows stay newest first, as the hosted queries return them."""
    out: dict[str, list[dict[str, Any]]] = {}
    for table_name in set(rows_by_table) | set(collected):
        by_date: dict[str, dict[str, Any]] = {}
        for row in rows_by_table.get(table_name, []):
            key = str(row.get("log_date") or str(row.get("created_at", ""))[:10])
            by_date[key] = dict(row)
        for log_date, fields in collected.get(table_name, {}).items():
            base = by_date.setdefault(log_date, {"user_id": user_id, "log_date": log_date})
            for field, value in fields.items():
                if field in LIST_FIELDS and isinstance(base.get(field), list) and isinstance(value, list):
                    merged = list(base[field])
                    merged.extend(item for item in value if item not in merged)
                    base[field] = merged
                else:
                    base[field] = value
            base.setdefault("created_at", f"{log_date}T21:00:00")
        out[table_name] = sorted(by_date.values(), key=lambda r: str(r.get("log_date") or ""), reverse=True)
    return out
