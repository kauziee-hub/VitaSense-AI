"""Official outbreak notices for the user's country from WHO Disease Outbreak News.

Public API, no key. Cached for six hours per process because notices change a few times a
week. Country matching uses the English country name (from reverse geocoding, accept-language
en) against the notice title, e.g. "Chikungunya virus disease - Switzerland".
"""

from __future__ import annotations

import logging
import time
from datetime import datetime, timedelta, timezone
from typing import Any

import httpx

logger = logging.getLogger(__name__)

WHO_DON_URL = "https://www.who.int/api/news/diseaseoutbreaknews"
WHO_ITEM_URL = "https://www.who.int/emergencies/disease-outbreak-news/item/"
CACHE_SECONDS = 6 * 60 * 60
LOOKBACK_DAYS = 180

_cache: dict[str, Any] = {"at": 0.0, "items": []}

# Notice titles sometimes use a different name than OpenStreetMap does.
ALIASES = {
    "united states": ["united states of america", "usa"],
    "united kingdom": ["united kingdom of great britain", "uk"],
    "russia": ["russian federation"],
    "iran": ["islamic republic of iran"],
    "vietnam": ["viet nam"],
    "democratic republic of the congo": ["drc"],
    "south korea": ["republic of korea"],
    "laos": ["lao people's democratic republic"],
}


async def fetch_notices(*, http: httpx.AsyncClient | None = None) -> list[dict[str, Any]]:
    if time.time() - _cache["at"] < CACHE_SECONDS and _cache["items"]:
        return _cache["items"]
    owns = http is None
    client = http or httpx.AsyncClient(timeout=20.0)
    try:
        response = await client.get(
            WHO_DON_URL,
            params={"$orderby": "PublicationDate desc", "$top": "100", "$select": "Title,PublicationDate,UrlName"},
        )
        response.raise_for_status()
        items = response.json().get("value") or []
    except Exception:
        logger.warning("WHO outbreak news fetch failed")
        return _cache["items"]
    finally:
        if owns:
            await client.aclose()
    _cache.update(at=time.time(), items=items)
    return items


def cached_notices() -> list[dict[str, Any]]:
    """Whatever the last fetch returned, without a network call (for synchronous prompt building)."""
    return list(_cache["items"])


def notices_for(items: list[dict[str, Any]], country: str | None, *, now: datetime | None = None) -> list[dict[str, str]]:
    if not country:
        return []
    names = [country.lower(), *ALIASES.get(country.lower(), [])]
    cutoff = (now or datetime.now(timezone.utc)) - timedelta(days=LOOKBACK_DAYS)
    found = []
    for item in items:
        title = str(item.get("Title") or "")
        published = str(item.get("PublicationDate") or "")
        try:
            when = datetime.fromisoformat(published.replace("Z", "+00:00"))
        except ValueError:
            continue
        if when < cutoff:
            continue
        if any(name in title.lower() for name in names):
            found.append(
                {
                    "title": title,
                    "date": when.date().isoformat(),
                    "url": WHO_ITEM_URL + str(item.get("UrlName") or ""),
                    "source": "WHO Disease Outbreak News",
                }
            )
    return found
