import logging
import os
import threading
import time

from dotenv import load_dotenv
from supabase import Client, create_client

logger = logging.getLogger(__name__)

# One client per (url, key): building a client costs ~0.4 s, so reuse it across requests.
_clients: dict[tuple[str, str], Client] = {}
_clients_lock = threading.Lock()

# When the database can't be reached (DNS failure, refused connection, timeout), every query
# would wait for the same failure. Skip queries for a while instead; callers fall back exactly
# as they do for a failed query, just without the wait.
UNREACHABLE_COOLDOWN_SECONDS = 60.0
_unreachable_until = 0.0

_CONNECTION_HINTS = (
    "connecterror",
    "connecttimeout",
    "getaddrinfo",
    "name or service not known",
    "nodename nor servname",
    "temporary failure in name resolution",
    "connection refused",
    "network is unreachable",
    "timed out",
)


def get_supabase() -> Client:
    load_dotenv()

    url = os.environ.get("SUPABASE_URL")
    key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY")
    if not url or not key:
        raise RuntimeError("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set")

    with _clients_lock:
        client = _clients.get((url, key))
        if client is not None:
            return client
        try:
            client = create_client(url, key)
        except Exception:
            logger.error("Supabase client initialization failed")
            raise
        _clients[(url, key)] = client
        return client


def is_connection_error(exc: BaseException) -> bool:
    text = f"{type(exc).__name__} {exc}".lower()
    return any(hint in text for hint in _CONNECTION_HINTS)


def mark_unreachable(seconds: float = UNREACHABLE_COOLDOWN_SECONDS) -> None:
    global _unreachable_until
    if not database_marked_unreachable():
        logger.warning("Database unreachable; skipping queries for %ss", int(seconds))
    _unreachable_until = time.monotonic() + seconds


def database_marked_unreachable() -> bool:
    return time.monotonic() < _unreachable_until


def reset_unreachable() -> None:
    global _unreachable_until
    _unreachable_until = 0.0
