from __future__ import annotations

import sys
import unittest
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from services.ocr_result_cache import (  # noqa: E402
    build_region_cache_key,
    end_ocr_result_cache_session,
    get_cached_lines,
    get_ocr_result_cache_stats,
    start_ocr_result_cache_session,
    store_cached_lines,
)


class OcrResultCacheTests(unittest.TestCase):
    def tearDown(self) -> None:
        end_ocr_result_cache_session()

    def test_cache_keys_are_scoped_to_scan_session(self) -> None:
        region = np.zeros((10, 10), dtype=np.uint8)

        start_ocr_result_cache_session("passport-a")
        key_a = build_region_cache_key("collect", region, (6,), "", "fast", 10)
        store_cached_lines(key_a, ["A"])
        self.assertEqual(get_cached_lines(key_a), ["A"])

        start_ocr_result_cache_session("passport-b")
        key_b = build_region_cache_key("collect", region, (6,), "", "fast", 10)

        self.assertNotEqual(key_a, key_b)
        self.assertIsNone(get_cached_lines(key_b))
        self.assertEqual(get_ocr_result_cache_stats()["missCount"], 1)

    def test_cache_stats_track_hits_misses_and_stores(self) -> None:
        region = np.zeros((10, 10), dtype=np.uint8)
        start_ocr_result_cache_session("passport-a")
        key = build_region_cache_key("collect", region, (6,), "", "fast", 10)

        self.assertIsNone(get_cached_lines(key))
        store_cached_lines(key, ["TEXT"])
        self.assertEqual(get_cached_lines(key), ["TEXT"])

        stats = get_ocr_result_cache_stats()
        self.assertEqual(stats["hitCount"], 1)
        self.assertEqual(stats["missCount"], 1)
        self.assertEqual(stats["storeCount"], 1)
        self.assertEqual(stats["entryCount"], 1)
        self.assertEqual(stats["scopeId"], "passport-a")


if __name__ == "__main__":
    unittest.main()
