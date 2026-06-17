"""
Redis-backed caching layer with graceful in-memory fallback.

Usage:
    from core.cache import cache

    # Cache contract metadata (dict/JSON)
    cache.set(f"contract:{cid}", contract_doc, ttl=300)
    doc = cache.get(f"contract:{cid}")

    # Cache binary data (PDF bytes)
    cache.set_bytes(f"pdf:{cid}", pdf_bytes, ttl=3600)
    raw = cache.get_bytes(f"pdf:{cid}")

    # Invalidate all keys for a contract
    cache.invalidate_pattern(f"contract:{cid}*")
    cache.invalidate_pattern(f"pdf:{cid}")

Configure via environment:
    REDIS_URL=redis://redis:6379/0   -> uses Redis
    REDIS_URL= (or unset)            -> in-memory fallback (no Redis dependency)
"""

import json
import logging
import os
import time
from typing import Any, Optional

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# In-memory fallback — bounded LRU-style dict
# ---------------------------------------------------------------------------
_MAX_INMEMORY_ITEMS = 512


class _InMemoryBackend:
    """Simple TTL dict.  Good enough for single-process dev / no-Redis deploys."""

    def __init__(self) -> None:
        self._store: dict[str, tuple[Any, float]] = {}

    def get(self, key: str) -> Optional[bytes]:
        entry = self._store.get(key)
        if entry is None:
            return None
        value, expires_at = entry
        if expires_at and time.time() > expires_at:
            self._store.pop(key, None)
            return None
        return value

    def set(self, key: str, value: bytes, ttl: int = 300) -> None:
        if len(self._store) >= _MAX_INMEMORY_ITEMS:
            # Evict oldest (first inserted) — good enough heuristic
            oldest = next(iter(self._store), None)
            if oldest:
                self._store.pop(oldest, None)
        self._store[key] = (value, time.time() + ttl if ttl else 0)

    def delete(self, key: str) -> None:
        self._store.pop(key, None)

    def invalidate_pattern(self, pattern: str) -> int:
        """Simple glob-style invalidation (only supports prefix*)."""
        prefix = pattern.rstrip("*")
        keys = [k for k in self._store if k.startswith(prefix)]
        for k in keys:
            self._store.pop(k, None)
        return len(keys)

    def ping(self) -> bool:
        return True


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------
class CacheService:
    """Unified cache interface.  Reads REDIS_URL from env; falls back to in-memory."""

    def __init__(self) -> None:
        self._backend: Any = None
        self._is_redis = False
        self._connect()

    def _connect(self) -> None:
        redis_url = os.getenv("REDIS_URL", "").strip()
        if not redis_url:
            logger.info("CACHE: No REDIS_URL set — using in-memory fallback.")
            self._backend = _InMemoryBackend()
            return
        try:
            import redis as redis_lib
            self._backend = redis_lib.from_url(
                redis_url,
                decode_responses=False,  # we handle bytes ourselves
                socket_connect_timeout=3,
                socket_timeout=3,
                retry_on_timeout=True,
            )
            self._backend.ping()
            self._is_redis = True
            logger.info(f"CACHE: Connected to Redis at {redis_url.split('@')[-1]}")
        except Exception as exc:
            logger.warning(f"CACHE: Redis connection failed ({exc}), falling back to in-memory.")
            self._backend = _InMemoryBackend()

    # -- JSON / dict caching ------------------------------------------------

    def get(self, key: str) -> Optional[Any]:
        """Retrieve a JSON-serializable object. Returns None on miss."""
        raw = self._backend.get(key)
        if raw is None:
            return None
        try:
            return json.loads(raw)
        except (json.JSONDecodeError, TypeError):
            return None

    def set(self, key: str, value: Any, ttl: int = 300) -> None:
        """Store a JSON-serializable object with TTL in seconds."""
        try:
            self._backend.set(key, json.dumps(value, default=str).encode(), ttl)
        except Exception as exc:
            logger.debug(f"CACHE: set failed for {key}: {exc}")

    # -- Binary caching (PDF bytes, images) ---------------------------------

    def get_bytes(self, key: str) -> Optional[bytes]:
        """Retrieve raw bytes. Returns None on miss."""
        return self._backend.get(key)

    def set_bytes(self, key: str, value: bytes, ttl: int = 3600) -> None:
        """Store raw bytes with TTL in seconds."""
        try:
            self._backend.set(key, value, ttl)
        except Exception as exc:
            logger.debug(f"CACHE: set_bytes failed for {key}: {exc}")

    # -- Invalidation -------------------------------------------------------

    def delete(self, key: str) -> None:
        self._backend.delete(key)

    def invalidate_pattern(self, pattern: str) -> int:
        """Delete all keys matching a glob pattern (prefix*). Returns count."""
        if self._is_redis:
            try:
                cursor = 0
                count = 0
                while True:
                    cursor, keys = self._backend.scan(cursor, match=pattern, count=100)
                    if keys:
                        self._backend.delete(*keys)
                        count += len(keys)
                    if cursor == 0:
                        break
                return count
            except Exception as exc:
                logger.debug(f"CACHE: invalidate_pattern failed for {pattern}: {exc}")
                return 0
        return self._backend.invalidate_pattern(pattern)

    # -- Health -------------------------------------------------------------

    def ping(self) -> bool:
        try:
            return self._backend.ping()
        except Exception:
            return False


# Module-level singleton
cache = CacheService()
