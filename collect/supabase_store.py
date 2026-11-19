"""Hosted (Supabase) version of the collected-data store, used when VITASENSE_STORAGE=supabase.

Same methods and return shapes as collect.store.CollectedStore. Tables come from
db/vitasense_hosted_storage.sql. Users always live in the hosted users table in this mode,
so the "local users" fallback is empty.
"""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Any

from db.supabase_client import get_supabase
from records.supabase_store import _select_all

from .store import DAILY_TABLES, LIST_FIELDS


def _now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def _merge(existing: Any, value: Any) -> list[Any]:
    merged = list(existing) if isinstance(existing, list) else []
    for item in value if isinstance(value, list) else [value]:
        if item not in merged:
            merged.append(item)
    return merged


class SupabaseCollectedStore:
    def __init__(self, client=None) -> None:
        self._client = client

    @property
    def db(self):
        return self._client or get_supabase()

    def _table(self, name: str):
        return self.db.table(name)

    # ---------- daily fields ----------

    def write_fields(self, *, user_id: int, source: str, rows: dict[str, dict[str, dict[str, Any]]]) -> int:
        now = _now()
        out: list[dict[str, Any]] = []
        list_keys: set[tuple[str, str, str]] = set()
        for table_name, by_date in rows.items():
            if table_name not in DAILY_TABLES:
                raise ValueError(f"Unknown daily table: {table_name}")
            for log_date, fields in by_date.items():
                for field, value in fields.items():
                    if value is None:
                        continue
                    if field in LIST_FIELDS:
                        list_keys.add((table_name, log_date, field))
                    out.append(
                        {
                            "user_id": int(user_id),
                            "table_name": table_name,
                            "log_date": log_date,
                            "field": field,
                            "value": value,
                            "source": source,
                            "updated_at": now,
                        }
                    )
        if not out:
            return 0

        # List fields accumulate: merge with what is already stored for those days.
        if list_keys:
            dates = sorted({d for _, d, _ in list_keys})
            existing = _select_all(
                lambda: self._table("vs_collected_daily")
                .select("table_name, log_date, field, value")
                .eq("user_id", int(user_id))
                .in_("log_date", dates)
                .in_("field", sorted(LIST_FIELDS))
            )
            stored = {(r["table_name"], r["log_date"], r["field"]): r["value"] for r in existing}
            for row in out:
                key = (row["table_name"], row["log_date"], row["field"])
                if key in list_keys:
                    row["value"] = _merge(stored.get(key), row["value"])

        for start in range(0, len(out), 500):
            self._table("vs_collected_daily").upsert(out[start : start + 500], on_conflict="user_id,table_name,log_date,field").execute()
        return len(out)

    def read_days(self, user_id: int, since: str) -> dict[str, dict[str, dict[str, Any]]]:
        rows = _select_all(
            lambda: self._table("vs_collected_daily")
            .select("table_name, log_date, field, value")
            .eq("user_id", int(user_id))
            .gte("log_date", since)
            .order("log_date")
        )
        out: dict[str, dict[str, dict[str, Any]]] = {}
        for row in rows:
            out.setdefault(row["table_name"], {}).setdefault(row["log_date"], {})[row["field"]] = row["value"]
        return out

    def field_sources(self, user_id: int, since: str) -> dict[str, dict[str, str]]:
        rows = _select_all(
            lambda: self._table("vs_collected_daily").select("field, source, log_date").eq("user_id", int(user_id)).gte("log_date", since)
        )
        out: dict[str, dict[str, str]] = {}
        for row in rows:
            current = out.get(row["field"])
            if current is None or row["log_date"] > current["log_date"]:
                out[row["field"]] = {"source": row["source"], "log_date": row["log_date"]}
        return out

    def delete_source(self, user_id: int, source: str) -> None:
        for table in ("vs_collected_daily", "vs_collected_items", "vs_connections"):
            self._table(table).delete().eq("user_id", int(user_id)).eq("source", source).execute()

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
        if self.has_item(user_id, source, item_id):
            return False
        result = (
            self._table("vs_collected_items")
            .upsert(
                {
                    "user_id": int(user_id),
                    "source": source,
                    "item_id": item_id,
                    "happened_at": happened_at,
                    "kind": kind,
                    "summary": summary,
                    "details": details,
                    "created_at": _now(),
                },
                on_conflict="user_id,source,item_id",
                ignore_duplicates=True,
            )
            .execute()
        )
        return bool(result.data)

    def has_item(self, user_id: int, source: str, item_id: str) -> bool:
        rows = (
            self._table("vs_collected_items")
            .select("item_id")
            .eq("user_id", int(user_id))
            .eq("source", source)
            .eq("item_id", item_id)
            .limit(1)
            .execute()
            .data
        )
        return bool(rows)

    def item_ids(self, user_id: int, source: str) -> set[str]:
        rows = _select_all(lambda: self._table("vs_collected_items").select("item_id").eq("user_id", int(user_id)).eq("source", source))
        return {row["item_id"] for row in rows}

    def recent_items(self, user_id: int, limit: int = 20) -> list[dict[str, Any]]:
        rows = (
            self._table("vs_collected_items")
            .select("source, item_id, happened_at, kind, summary, details, created_at")
            .eq("user_id", int(user_id))
            .neq("kind", "not_relevant")
            .order("created_at", desc=True)
            .limit(max(limit * 5, 100))
            .execute()
            .data
            or []
        )
        rows.sort(key=lambda r: str(r.get("happened_at") or r.get("created_at") or ""), reverse=True)
        return [
            {**{k: row.get(k) for k in ("source", "item_id", "happened_at", "kind", "summary")}, "details": row.get("details") or {}}
            for row in rows[:limit]
        ]

    # ---------- connections ----------

    def mark_sync(self, user_id: int, source: str, result: dict[str, Any]) -> None:
        # connected_at is left out so the first connection time survives later syncs (the column defaults to now()).
        self._table("vs_connections").upsert(
            {"user_id": int(user_id), "source": source, "last_sync_at": _now(), "last_result": result},
            on_conflict="user_id,source",
        ).execute()

    def connections(self, user_id: int) -> dict[str, dict[str, Any]]:
        rows = self._table("vs_connections").select("source, connected_at, last_sync_at, last_result").eq("user_id", int(user_id)).execute().data
        return {
            row["source"]: {
                "connected_at": str(row.get("connected_at") or ""),
                "last_sync_at": str(row["last_sync_at"]) if row.get("last_sync_at") else None,
                "last_result": row.get("last_result") or {},
            }
            for row in rows or []
        }

    # ---------- local users: not used when everything is hosted ----------

    def create_user(self, name: str, user_code: str) -> dict[str, Any]:
        raise RuntimeError("The database is unreachable, so a new profile can't be created right now.")

    def list_users(self) -> list[dict[str, Any]]:
        return []
