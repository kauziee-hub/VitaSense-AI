"""Hosted (Supabase) version of the records store, used when VITASENSE_STORAGE=supabase.

Same methods and return shapes as records.store.RecordsStore, so main.py and the summaries
don't care which one they get. Tables come from db/vitasense_hosted_storage.sql; original
uploads go to the private "health-records" storage bucket.
"""

from __future__ import annotations

import mimetypes
import uuid
from datetime import date, datetime, timezone
from pathlib import Path
from typing import Any

from db.supabase_client import get_supabase

from .store import RecordsStore

BUCKET = "health-records"
STORAGE_PREFIX = f"storage://{BUCKET}/"
PAGE = 1000


def _now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def _select_all(make_query) -> list[dict[str, Any]]:
    """PostgREST returns at most 1000 rows per request; page through everything."""
    rows: list[dict[str, Any]] = []
    start = 0
    while True:
        chunk = make_query().range(start, start + PAGE - 1).execute().data or []
        rows.extend(chunk)
        if len(chunk) < PAGE:
            return rows
        start += PAGE


class SupabaseRecordsStore:
    file_hash = staticmethod(RecordsStore.file_hash)

    def __init__(self, client=None) -> None:
        self._client = client

    @property
    def db(self):
        return self._client or get_supabase()

    def _table(self, name: str):
        return self.db.table(name)

    # ---------- files ----------

    def save_upload(self, user_id: int, file_name: str, data: bytes) -> str:
        suffix = Path(file_name).suffix.lower()[:8] or ".bin"
        path = f"{int(user_id)}/{uuid.uuid4().hex}{suffix}"
        content_type = mimetypes.guess_type(file_name)[0] or "application/octet-stream"
        self.db.storage.from_(BUCKET).upload(path, data, {"content-type": content_type})
        return STORAGE_PREFIX + path

    def _remove_upload(self, file_path: str | None) -> None:
        if not file_path or not file_path.startswith(STORAGE_PREFIX):
            return
        try:
            self.db.storage.from_(BUCKET).remove([file_path[len(STORAGE_PREFIX) :]])
        except Exception:  # the record is gone either way; a stray file is harmless
            pass

    # ---------- records ----------

    def find_by_hash(self, user_id: int, file_hash: str) -> dict[str, Any] | None:
        rows = (
            self._table("vs_health_records").select("*").eq("user_id", int(user_id)).eq("file_hash", file_hash).limit(1).execute().data
        )
        return self._record_out(rows[0]) if rows else None

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
        row = {
            "id": uuid.uuid4().hex,
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
            "extracted": extracted,
            "file_hash": file_hash,
        }
        self._table("vs_health_records").insert(row).execute()
        return self._record_out(row)

    def list_records(self, user_id: int) -> list[dict[str, Any]]:
        rows = _select_all(lambda: self._table("vs_health_records").select("*").eq("user_id", int(user_id)).order("created_at", desc=True))
        # Same order as the SQLite store: document date (or upload day) newest first, then upload time.
        rows.sort(key=lambda r: (r.get("document_date") or str(r.get("created_at", ""))[:10], str(r.get("created_at", ""))), reverse=True)
        return [self._record_out(r) for r in rows]

    def get_record(self, user_id: int, record_id: str) -> dict[str, Any] | None:
        rows = self._table("vs_health_records").select("*").eq("user_id", int(user_id)).eq("id", record_id).limit(1).execute().data
        return self._record_out(rows[0]) if rows else None

    def delete_record(self, user_id: int, record_id: str) -> bool:
        rows = self._table("vs_health_records").select("id, file_path").eq("user_id", int(user_id)).eq("id", record_id).execute().data
        if not rows:
            return False
        # Medicines from this record (and their dose logs) go with it: the foreign keys cascade.
        self._table("vs_health_records").delete().eq("user_id", int(user_id)).eq("id", record_id).execute()
        self._remove_upload(rows[0].get("file_path"))
        return True

    @staticmethod
    def _record_out(row: dict[str, Any]) -> dict[str, Any]:
        out = {k: v for k, v in row.items() if k not in ("file_path", "file_hash", "extracted")}
        out["created_at"] = str(out.get("created_at") or "")
        out["extracted"] = row.get("extracted") or {}
        return out

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
            "times": med.get("times") or [],
            "as_needed": bool(med.get("as_needed")),
            "food_timing": med.get("food_timing"),
            "instructions": med.get("instructions"),
            "start_date": med.get("start_date") or date.today().isoformat(),
            "end_date": med.get("end_date"),
            "active": True,
            "created_at": med.get("created_at") or _now(),
        }
        self._table("vs_medications").insert(row).execute()
        return self._med_out(row)

    def list_medications(self, user_id: int, *, include_inactive: bool = False) -> list[dict[str, Any]]:
        def query():
            q = self._table("vs_medications").select("*").eq("user_id", int(user_id))
            if not include_inactive:
                q = q.eq("active", True)
            return q.order("created_at")

        return [self._med_out(r) for r in _select_all(query)]

    def update_medication(self, user_id: int, med_id: str, changes: dict[str, Any]) -> dict[str, Any] | None:
        allowed = {"active", "times", "end_date", "dose", "food_timing"}
        update = {k: (bool(v) if k == "active" else v) for k, v in changes.items() if k in allowed}
        if update:
            self._table("vs_medications").update(update).eq("user_id", int(user_id)).eq("id", med_id).execute()
        rows = self._table("vs_medications").select("*").eq("user_id", int(user_id)).eq("id", med_id).limit(1).execute().data
        return self._med_out(rows[0]) if rows else None

    @staticmethod
    def _med_out(row: dict[str, Any]) -> dict[str, Any]:
        out = dict(row)
        out["times"] = list(out.get("times") or [])
        out["as_needed"] = bool(out.get("as_needed"))
        out["active"] = bool(out.get("active"))
        out["created_at"] = str(out.get("created_at") or "")
        return out

    # ---------- doses ----------

    def log_dose(self, *, user_id: int, med_id: str, dose_date: str, dose_time: str, status: str) -> None:
        table = self._table("vs_dose_logs")
        if status == "pending":
            table.delete().eq("medication_id", med_id).eq("dose_date", dose_date).eq("dose_time", dose_time).execute()
            return
        table.upsert(
            {
                "medication_id": med_id,
                "user_id": int(user_id),
                "dose_date": dose_date,
                "dose_time": dose_time,
                "status": status,
                "logged_at": _now(),
            },
            on_conflict="medication_id,dose_date,dose_time",
        ).execute()

    def dose_logs(self, user_id: int, since: str) -> list[dict[str, Any]]:
        return _select_all(
            lambda: self._table("vs_dose_logs")
            .select("medication_id, dose_date, dose_time, status")
            .eq("user_id", int(user_id))
            .gte("dose_date", since)
        )
