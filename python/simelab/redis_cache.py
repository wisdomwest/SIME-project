"""Redis-backed cache for completed SIMElab analysis results.

Uploads are always recomputed.  Redis is only used to restore the completed
result after a page/backend reload; it is never consulted to skip an upload.
Payloads are JSON (not pickle) and compressed to reduce Redis memory use.
"""

from __future__ import annotations

import json
import os
import time
import zlib
from functools import lru_cache
from pathlib import Path
from typing import Any, Dict, List, Optional

try:
    import redis
    from redis import Redis
    from redis.exceptions import RedisError
except ImportError:  # Keep analysis usable when Redis dependencies are absent.
    redis = None
    Redis = Any

    class RedisError(Exception):
        pass


REDIS_URL = os.environ.get("SIMELAB_REDIS_URL", "redis://127.0.0.1:6379/0")
KEY_PREFIX = os.environ.get("SIMELAB_REDIS_PREFIX", "simelab")
CACHE_TTL_SECONDS = max(int(os.environ.get("SIMELAB_CACHE_TTL_SECONDS", "86400")), 60)
SCHEMA_VERSION = 1

_client: Optional[Redis] = None
_last_error: Optional[str] = None


def safe_json(value: Any) -> str:
    """Serialize numpy/date-like values without allowing executable payloads."""

    class _Encoder(json.JSONEncoder):
        def default(self, obj):
            if hasattr(obj, "isoformat"):
                return obj.isoformat()
            if hasattr(obj, "item"):
                try:
                    return obj.item()
                except (TypeError, ValueError):
                    pass
            try:
                return float(obj)
            except (TypeError, ValueError):
                return str(obj)

    return json.dumps(value, cls=_Encoder, separators=(",", ":"))


def _analysis_key(dataset_id: str) -> str:
    return f"{KEY_PREFIX}:analysis:{dataset_id}"


def _index_key() -> str:
    return f"{KEY_PREFIX}:datasets"


def get_client() -> Optional[Redis]:
    """Return a lazy Redis client; connection errors are handled by callers."""
    global _client, _last_error
    if _client is not None:
        return _client
    if redis is None:
        _last_error = "Python package 'redis' is not installed"
        return None
    _client = redis.Redis.from_url(
        REDIS_URL,
        socket_connect_timeout=1.5,
        socket_timeout=3.0,
        health_check_interval=30,
        decode_responses=False,
    )
    return _client


def cache_status() -> Dict[str, Any]:
    """Report Redis availability without raising into an API request."""
    global _last_error
    client = get_client()
    if client is None:
        return {"available": False, "error": _last_error}
    try:
        started = time.perf_counter()
        client.ping()
        _last_error = None
        return {
            "available": True,
            "latency_ms": round((time.perf_counter() - started) * 1000, 2),
            "ttl_seconds": CACHE_TTL_SECONDS,
        }
    except RedisError as exc:
        _last_error = f"{type(exc).__name__}: {exc}"
        return {"available": False, "error": _last_error}


def save_full_analysis(dataset_id: str, meta: Dict[str, Any], analysis: Dict[str, Any]) -> bool:
    """Atomically cache one completed analysis and refresh its TTL."""
    global _last_error
    client = get_client()
    if client is None:
        return False

    payload = {
        "schema_version": SCHEMA_VERSION,
        "cached_at": time.time(),
        "dataset_id": dataset_id,
        "meta": meta,
        "analysis": analysis,
    }
    try:
        encoded = safe_json(payload).encode("utf-8")
        compressed = zlib.compress(encoded, level=3)
        expires_at = int(time.time()) + CACHE_TTL_SECONDS
        with client.pipeline(transaction=True) as pipe:
            pipe.set(_analysis_key(dataset_id), compressed, ex=CACHE_TTL_SECONDS)
            pipe.zadd(_index_key(), {dataset_id: expires_at})
            pipe.expire(_index_key(), CACHE_TTL_SECONDS)
            pipe.execute()
        _load_payload.cache_clear()
        _last_error = None
        return True
    except (RedisError, TypeError, ValueError, zlib.error) as exc:
        _last_error = f"{type(exc).__name__}: {exc}"
        return False


@lru_cache(maxsize=4)
def _load_payload(dataset_id: str) -> Optional[Dict[str, Any]]:
    client = get_client()
    if client is None:
        return None
    raw = client.get(_analysis_key(dataset_id))
    if raw is None:
        return None
    payload = json.loads(zlib.decompress(raw).decode("utf-8"))
    if payload.get("schema_version") != SCHEMA_VERSION:
        return None
    return payload


def load_full_analysis(dataset_id: str) -> Optional[Dict[str, Any]]:
    """Load and decompress a cached analysis, returning None on cache failure."""
    global _last_error
    try:
        payload = _load_payload(dataset_id)
        _last_error = None
        return payload
    except (RedisError, json.JSONDecodeError, UnicodeDecodeError, zlib.error) as exc:
        _last_error = f"{type(exc).__name__}: {exc}"
        _load_payload.cache_clear()
        return None


def list_datasets() -> List[Dict[str, Any]]:
    """List live Redis entries without downloading every analysis blob."""
    global _last_error
    client = get_client()
    if client is None:
        return []
    try:
        now = int(time.time())
        client.zremrangebyscore(_index_key(), "-inf", now)
        raw_ids = client.zrevrangebyscore(_index_key(), "+inf", now + 1)
        results = []
        for raw_id in raw_ids:
            dataset_id = raw_id.decode("utf-8") if isinstance(raw_id, bytes) else str(raw_id)
            if client.exists(_analysis_key(dataset_id)):
                results.append({"id": dataset_id})
            else:
                client.zrem(_index_key(), dataset_id)
        _last_error = None
        return results
    except RedisError as exc:
        _last_error = f"{type(exc).__name__}: {exc}"
        return []


def get_dataset_meta(dataset_id: str) -> Optional[Dict[str, Any]]:
    """Return the cached metadata in the row-like shape expected by server.py."""
    payload = load_full_analysis(dataset_id)
    if not payload:
        return None
    meta = payload.get("meta", {})
    graph_stats = meta.get("graph_stats", {})
    return {
        "id": dataset_id,
        "name": meta.get("filename", dataset_id),
        "filepath": meta.get("filepath", ""),
        "source_hash": meta.get("source_hash"),
        "nodes_count": graph_stats.get("node_count", 0),
        "edges_count": graph_stats.get("edge_count", 0),
        "density": graph_stats.get("density", 0.0),
        "reciprocity": graph_stats.get("reciprocity"),
        "components": graph_stats.get("connected_components", 0),
        "edge_types_json": safe_json(graph_stats.get("edge_types", {})),
        "overall_metrics_json": safe_json(meta.get("overall_metrics", {})),
    }


def get_stored_filepath(dataset_id: str) -> Optional[str]:
    meta = get_dataset_meta(dataset_id)
    if not meta:
        return None
    filepath = meta.get("filepath")
    return filepath if filepath and Path(filepath).is_file() else None


def load_vertices(dataset_id: str) -> List[Dict[str, Any]]:
    payload = load_full_analysis(dataset_id) or {}
    rows = []
    for vertex in payload.get("analysis", {}).get("vertices", []):
        row = dict(vertex)
        row["features_json"] = safe_json(row.pop("features", {}))
        row["hashtags_json"] = safe_json(row.pop("hashtags", []))
        for key in (
            "label", "degree", "in_degree", "out_degree", "betweenness",
            "closeness", "eigenvector", "pagerank", "clustering_coefficient",
            "cluster", "sentiment", "followers", "layout_x", "layout_y",
            "tweet_text", "platform", "topic", "bot_score",
        ):
            row.setdefault(key, None)
        row.setdefault("is_bot", False)
        rows.append(row)
    return rows


def load_edges(dataset_id: str) -> List[Dict[str, Any]]:
    payload = load_full_analysis(dataset_id) or {}
    return payload.get("analysis", {}).get("edges", [])


def load_disinfo_scores(dataset_id: str) -> List[Dict[str, Any]]:
    payload = load_full_analysis(dataset_id) or {}
    rows = []
    for score in payload.get("analysis", {}).get("disinfo_scores", []):
        row = dict(score)
        row["signals_json"] = safe_json(row.pop("signals", {}))
        rows.append(row)
    return rows


def load_hashtags(dataset_id: str) -> List[Dict[str, Any]]:
    payload = load_full_analysis(dataset_id) or {}
    return payload.get("analysis", {}).get("hashtags", [])


def load_structural_holes(dataset_id: str) -> List[Dict[str, Any]]:
    payload = load_full_analysis(dataset_id) or {}
    return payload.get("analysis", {}).get("structural_holes", [])


def update_sentiment_analysis(
    dataset_id: str,
    labels: Dict[str, str],
    overall_metrics: Dict[str, Any],
) -> bool:
    payload = load_full_analysis(dataset_id)
    if not payload:
        return False
    for vertex in payload.get("analysis", {}).get("vertices", []):
        vertex["sentiment"] = labels.get(vertex.get("id"), vertex.get("sentiment", "Neu"))
    payload.setdefault("meta", {})["overall_metrics"] = overall_metrics
    return save_full_analysis(dataset_id, payload["meta"], payload["analysis"])


def clear_analysis_cache() -> bool:
    """Delete only SIMElab analysis keys; useful for tests and administration."""
    client = get_client()
    if client is None:
        return False
    try:
        keys = list(client.scan_iter(match=f"{KEY_PREFIX}:analysis:*", count=100))
        if keys:
            client.delete(*keys)
        client.delete(_index_key())
        _load_payload.cache_clear()
        return True
    except RedisError:
        return False
