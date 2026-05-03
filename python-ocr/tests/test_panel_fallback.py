from __future__ import annotations

import sys
import unittest
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from services.panel_fallback import _clean_date, _extract_date_fields


class PanelFallbackTests(unittest.TestCase):
    def test_clean_date_rejects_impossible_dates(self) -> None:
        self.assertEqual(_clean_date("31 FEB 2025"), "")
        self.assertEqual(_clean_date("11 JUL 2027"), "2027-07-11")

    def test_extract_date_fields_uses_only_date_windows(self) -> None:
        with patch(
            "services.panel_fallback._collect_date_candidates",
            side_effect=[["2022-07-11"], ["2027-07-11", "1969-04-27"]],
        ) as collector:
            fields = _extract_date_fields(object(), "panel", "1969-04-27")

        self.assertEqual(collector.call_count, 2)
        self.assertEqual(fields["issueDate"], "2022-07-11")
        self.assertEqual(fields["expiryDate"], "2027-07-11")


if __name__ == "__main__":
    unittest.main()
