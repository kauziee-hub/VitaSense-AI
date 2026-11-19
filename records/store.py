"""Store for uploaded health records, medicines and dose logs.

By default SQLite on the API machine, so records keep working when the hosted database is
offline: one file (VITASENSE_DATA_DIR/vitasense_local.db) plus the original uploads under
VITASENSE_DATA_DIR/uploads/<user_id>/. Hosted deployments set VITASENSE_STORAGE=supabase and
get records.supabase_store instead (tables in db/vitasense_hosted_storage.sql).
"""

from __future__ import annotations

import hashlib
import json
import os
import sqlite3
import threading
import uuid
from datetime import date, datetime, timezone
from pathlib import Path
from typing import Any

_SCHEMA = """
CREATE TABLE IF NOT EXISTS health_records (
    id TEXT PRIMARY KEY,
    user_id INTEGER NOT NULL,
    created_at TEXT NOT NULL,
    file_name TEXT NOT NULL,
    mime_type TEXT NOT NULL,
    file_path TEXT,
    document_type TEXT NOT NULL,
    document_date TEXT,
    title TEXT,
    facility TEXT,
    doctor TEXT,
    summary TEXT,
    extracted_json TEXT NOT NULL,
    file_hash TEXT
);
CREATE INDEX IF NOT EXISTS idx_records_user ON health_records(user_id, created_at);

CREATE TABLE IF NOT EXISTS medications (
    id TEXT PRIMARY KEY,
    user_id INTEGER NOT NULL,
    record_id TEXT,
    name TEXT NOT NULL,
    strength TEXT,
    form TEXT,
    dose TEXT,
    times_json TEXT NOT NULL,
    as_needed INTEGER NOT NULL DEFAULT 0,
    food_timing TEXT,
    instructions TEXT,
    start_date TEXT NOT NULL,
    end_date TEXT,
    active INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_meds_user ON medications(user_id, active);

CREATE TABLE IF NOT EXISTS dose_logs (
    medication_id TEXT NOT NULL,
    user_id INTEGER NOT NULL,
    dose_date TEXT NOT NULL,
    dose_time TEXT NOT NULL,
    status TEXT NOT NULL,
    logged_at TEXT NOT NULL,
    PRIMARY KEY (medication_id, dose_date, dose_time)
);
"""


def _now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def data_dir() -> Path:
    root = os.environ.get("VITASENSE_DATA_DIR")
    path = Path(root) if root else Path(__file__).resolve().parent.parent / "data"
    path.mkdir(parents=True, exist_ok=True)
    return path


class RecordsStore:
    def __init__(self, db_path: Path | str | None = None) -> None:
        self._db_path = str(db_path or data_dir() / "vitasense_local.db")
        self._lock = threading.Lock()
        self._conn = sqlite3.connect(self._db_path, check_same_thread=False)
        self._conn.row_factory = sqlite3.Row
        with self._lock:
            self._conn.executescript(_SCHEMA)
            columns = {row["name"] for row in self._conn.execute("PRAGMA table_info(health_records)")}
            if "file_hash" not in columns:  # databases created before duplicate detection
                self._conn.execute("ALTER TABLE health_records ADD COLUMN file_hash TEXT")
            self._conn.commit()

    @staticmethod
    def file_hash(data: bytes) -> str:
        return hashlib.sha256(data).hexdigest()

    def find_by_hash(self, user_id: int, file_hash: str) -> dict[str, Any] | None:
        with self._lock:
            row = self._conn.execute(
                "SELECT * FROM health_records WHERE user_id = ? AND file_hash = ?", (int(user_id), file_hash)
            ).fetchone()
        return self._record_out(dict(row)) if row else None

    # ---------- files ----------

    def save_upload(self, user_id: int, file_name: str, data: bytes) -> str:
        folder = data_dir() / "uploads" / str(int(user_id))
        folder.mkdir(parents=True, exist_ok=True)
        suffix = Path(file_name).suffix.lower()[:8] or ".bin"
        path = folder / f"{uuid.uuid4().hex}{suffix}"
        path.write_bytes(data)
        return str(path)

    # ---------- records ----------

    def add_record(
        self,
        *,
        user_id: int,
        file_name: str,
        mime_type: str,
        file_path: str | None,
        extracted: dict[str, Any],
        file_hash: str | None = None,
    ) -> dict[str, Any]:
        record_id = uuid.uuid4().hex
        row = {
            "id": record_id,
            "user_id": int(user_id),
            "created_at": _now(),
            "file_name": file_name,
            "mime_type": mime_type,
            "file_path": file_path,
            "document_type": extracted.get("document_type") or "other",
            "document_date": extracted.get("document_date"),
            "title": extracted.get("title"),
            "facility": extracted.get("facility"),
            "doctor": extracted.get("doctor"),
            "summary": extracted.get("summary"),
            "extracted_json": json.dumps(extracted),
            "file_hash": file_hash,
        }
        with self._lock:
            self._conn.execute(
                f"INSERT INTO health_records ({', '.join(row)}) VALUES ({', '.join('?' for _ in row)})",
                list(row.values()),
            )
            self._conn.commit()
        return self._record_out(row)

    def list_records(self, user_id: int) -> list[dict[str, Any]]:
        with self._lock:
            rows = self._conn.execute(
                "SELECT * FROM health_records WHERE user_id = ? "
                "ORDER BY COALESCE(document_date, substr(created_at, 1, 10)) DESC, created_at DESC",
                (int(user_id),),
            ).fetchall()
        return [self._record_out(dict(row)) for row in rows]

    def get_record(self, user_id: int, record_id: str) -> dict[str, Any] | None:
        with self._lock:
            row = self._conn.execute(
                "SELECT * FROM health_records WHERE user_id = ? AND id = ?", (int(user_id), record_id)
            ).fetchone()
        return self._record_out(dict(row)) if row else None

    def delete_record(self, user_id: int, record_id: str) -> bool:
        record = self.get_record(user_id, record_id)
        if record is None:
            return False
        with self._lock:
            self._conn.execute("DELETE FROM health_records WHERE user_id = ? AND id = ?", (int(user_id), record_id))
            # Medicines that came from this record go with it.
            med_ids = [
                r["id"]
                for r in self._conn.execute(
                    "SELECT id FROM medications WHERE user_id = ? AND record_id = ?", (int(user_id), record_id)
                ).fetchall()
            ]
            for med_id in med_ids:
                self._conn.execute("DELETE FROM dose_logs WHERE medication_id = ?", (med_id,))
            self._conn.execute("DELETE FROM medications WHERE user_id = ? AND record_id = ?", (int(user_id), record_id))
            self._conn.commit()
        path = record.get("file_path")
        if path:
            try:
                Path(path).unlink(missing_ok=True)
            except OSError:
                pass
        return True

    @staticmethod
    def _record_out(row: dict[str, Any]) -> dict[str, Any]:
        extracted = json.loads(row.pop("extracted_json") or "{}")
        row.pop("file_path", None)
        row.pop("file_hash", None)
        return {**row, "extracted": extracted}

    # ---------- medications ----------

    def add_medication(self, *, user_id: int, record_id: str | None, med: dict[str, Any]) -> dict[str, Any]:
        row = {
            "id": uuid.uuid4().hex,
            "user_id": int(user_id),
            "record_id": record_id,
            "name": med["name"],
            "strength": med.get("strength"),
            "form": med.get("form"),
            "dose": med.get("dose"),
            "times_json": json.dumps(med.get("times") or []),
            "as_needed": 1 if med.get("as_needed") else 0,
            "food_timing": med.get("food_timing"),
            "instructions": med.get("instructions"),
            "start_date": med.get("start_date") or date.today().isoformat(),
            "end_date": med.get("end_date"),
            "active": 1,
            "created_at": med.get("created_at") or _now(),
        }
        with self._lock:
            self._conn.execute(
                f"INSERT INTO medications ({', '.join(row)}) VALUES ({', '.join('?' for _ in row)})",
                list(row.values()),
            )
            self._conn.commit()
        return self._med_out(row)

    def list_medications(self, user_id: int, *, include_inactive: bool = False) -> list[dict[str, Any]]:
        query = "SELECT * FROM medications WHERE user_id = ?"
        if not include_inactive:
            query += " AND active = 1"
        with self._lock:
            rows = self._conn.execute(query + " ORDER BY created_at", (int(user_id),)).fetchall()
        return [self._med_out(dict(row)) for row in rows]

    def update_medication(self, user_id: int, med_id: str, changes: dict[str, Any]) -> dict[str, Any] | None:
        allowed = {"active", "times", "end_date", "dose", "food_timing"}
        sets: list[str] = []
        values: list[Any] = []
        for key, value in changes.items():
            if key not in allowed:
                continue
            if key == "times":
                sets.append("times_json = ?")
                values.append(json.dumps(value))
            elif key == "active":
                sets.append("active = ?")
                values.append(1 if value else 0)
            else:
                sets.append(f"{key} = ?")
                values.append(value)
        if sets:
            with self._lock:
                self._conn.execute(
                    f"UPDATE medications SET {', '.join(sets)} WHERE user_id = ? AND id = ?",
                    [*values, int(user_id), med_id],
                )
                self._conn.commit()
        with self._lock:
            row = self._conn.execute(
                "SELECT * FROM medications WHERE user_id = ? AND id = ?", (int(user_id), med_id)
            ).fetchone()
        return self._med_out(dict(row)) if row else None

    @staticmethod
    def _med_out(row: dict[str, Any]) -> dict[str, Any]:
        row["times"] = json.loads(row.pop("times_json") or "[]")
        row["as_needed"] = bool(row["as_needed"])
        row["active"] = bool(row["active"])
        return row

    # ---------- doses ----------

    def log_dose(self, *, user_id: int, med_id: str, dose_date: str, dose_time: str, status: str) -> None:
        with self._lock:
            if status == "pending":
                self._conn.execute(
                    "DELETE FROM dose_logs WHERE medication_id = ? AND dose_date = ? AND dose_time = ?",
                    (med_id, dose_date, dose_time),
                )
            else:
                self._conn.execute(
                    "INSERT INTO dose_logs (medication_id, user_id, dose_date, dose_time, status, logged_at) "
                    "VALUES (?, ?, ?, ?, ?, ?) "
                    "ON CONFLICT(medication_id, dose_date, dose_time) DO UPDATE SET status = excluded.status, "
                    "logged_at = excluded.logged_at",
                    (med_id, int(user_id), dose_date, dose_time, status, _now()),
                )
            self._conn.commit()

    def dose_logs(self, user_id: int, since: str) -> list[dict[str, Any]]:
        with self._lock:
            rows = self._conn.execute(
                "SELECT medication_id, dose_date, dose_time, status FROM dose_logs WHERE user_id = ? AND dose_date >= ?",
                (int(user_id), since),
            ).fetchall()
        return [dict(row) for row in rows]


def hosted_storage() -> bool:
    """True when records and collected data live in Supabase (VITASENSE_STORAGE=supabase), e.g. on Vercel."""
    return os.environ.get("VITASENSE_STORAGE", "").strip().lower() == "supabase"


_store: Any = None
_store_lock = threading.Lock()


def get_records_store() -> RecordsStore:
    """SQLite on this machine by default; Supabase when VITASENSE_STORAGE=supabase. Same methods either way."""
    global _store
    with _store_lock:
        if _store is None:
            if hosted_storage():
                from .supabase_store import SupabaseRecordsStore

                _store = SupabaseRecordsStore()
            else:
                _store = RecordsStore()
        return _store
