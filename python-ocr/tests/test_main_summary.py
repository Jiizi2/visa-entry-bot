from __future__ import annotations

import contextlib
import io
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from main import print_summary  # noqa: E402


class MainSummaryTests(unittest.TestCase):
    def test_print_summary_includes_needs_review_count(self) -> None:
        stream = io.StringIO()

        with contextlib.redirect_stdout(stream):
            print_summary(
                [
                    {"status": "VALID", "reviewStatus": "VALID"},
                    {"status": "VALID", "reviewStatus": "NEEDS_REVIEW"},
                    {"status": "ERROR", "reviewStatus": "ERROR"},
                ]
            )

        self.assertEqual(stream.getvalue().strip(), "Processed 3 files: 2 VALID, 1 ERROR, 1 NEEDS_REVIEW")


if __name__ == "__main__":
    unittest.main()
