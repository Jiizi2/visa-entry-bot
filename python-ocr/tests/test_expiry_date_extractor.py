from __future__ import annotations

import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from services.expiry_date_extractor import pick_expiry_date


class ExpiryDateExtractorTests(unittest.TestCase):
    def test_pick_expiry_date_prefers_direct_candidate_over_inferred_snap(self) -> None:
        result = pick_expiry_date(
            ["2031-01-18", "2034-01-18"],
            dob="1952-10-12",
            issue_date="2026-01-18",
        )

        self.assertEqual(result, "2031-01-18")


if __name__ == "__main__":
    unittest.main()
