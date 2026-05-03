from __future__ import annotations

import hashlib
from collections import OrderedDict

try:
    import numpy as np
except ImportError:  # pragma: no cover - depends on local environment
    np = None

_CACHE_LIMIT = 256
_RESULT_CACHE: OrderedDict[tuple[object, ...], tuple[str, ...]] = OrderedDict()


def build_region_cache_key(prefix: str, region: object, *parts: object) -> tuple[object, ...] | None:
    if region is None or np is None:
        return None
    array = np.ascontiguousarray(region)
    digest = hashlib.blake2b(memoryview(array), digest_size=16).hexdigest()
    return (prefix, array.shape, str(array.dtype), digest, *parts)


def get_cached_lines(cache_key: tuple[object, ...] | None) -> list[str] | None:
    if cache_key is None:
        return None
    cached = _RESULT_CACHE.get(cache_key)
    if cached is None:
        return None
    _RESULT_CACHE.move_to_end(cache_key)
    return list(cached)


def store_cached_lines(cache_key: tuple[object, ...] | None, lines: list[str]) -> list[str]:
    if cache_key is None:
        return list(lines)
    _RESULT_CACHE[cache_key] = tuple(lines)
    _RESULT_CACHE.move_to_end(cache_key)
    while len(_RESULT_CACHE) > _CACHE_LIMIT:
        _RESULT_CACHE.popitem(last=False)
    return list(lines)


def clear_ocr_result_cache() -> None:
    _RESULT_CACHE.clear()
