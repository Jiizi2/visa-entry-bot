from __future__ import annotations

import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))

from location_ocr_debug_report import build_report  # noqa: E402


class LocationOcrDebugReportTests(unittest.TestCase):
    def test_build_report_classifies_not_run_and_accepted_but_empty(self) -> None:
        report = build_report(
            {
                "members": [
                    {
                        "fileName": "skip.png",
                        "passportExtracted": {"passportNumber": "E1234567", "birthCity": "", "cityOfIssued": ""},
                        "processingMetrics": {"fastLocationOcr": {"scanCalls": 0}},
                    },
                    {
                        "fileName": "accepted.png",
                        "passportExtracted": {"passportNumber": "E7654321", "birthCity": "", "cityOfIssued": ""},
                        "processingMetrics": {
                            "visualFieldScope": ["placeOfBirth", "issuingOffice"],
                            "fastLocationOcr": {
                                "scanCalls": 2,
                                "cropAttempts": 2,
                                "requestedFields": ["placeOfBirth", "issuingOffice"],
                                "foundFields": [],
                                "debugEnabled": True,
                                "debugSamples": [
                                    {
                                        "field": "issuingOffice",
                                        "raw": ["KANTOR YANG MENGELUARKAN", "PARE-PARE"],
                                        "candidates": ["PARE-PARE"],
                                        "accepted": ["PAREPARE"],
                                    }
                                ],
                            },
                        },
                    },
                ]
            },
            source="manifest.json",
        )

        self.assertEqual(report["source"], "manifest.json")
        self.assertEqual(report["totalRecords"], 2)
        self.assertEqual(report["summary"]["locationOcrSkipped"], 1)
        self.assertEqual(report["summary"]["acceptedButOutputEmpty"], 1)
        self.assertEqual(report["summary"]["diagnosisCounts"]["NOT_RUN"], 1)
        self.assertEqual(report["summary"]["diagnosisCounts"]["ACCEPTED_BUT_OUTPUT_EMPTY"], 1)
        self.assertEqual(report["records"][1]["acceptedValues"], ["PAREPARE"])
        self.assertEqual(report["records"][1]["rawPreview"], ["KANTOR YANG MENGELUARKAN", "PARE-PARE"])

    def test_build_report_classifies_label_only_and_partial_output(self) -> None:
        report = build_report(
            {
                "members": [
                    {
                        "fileName": "label.png",
                        "passportExtracted": {"birthCity": "", "cityOfIssued": ""},
                        "processingMetrics": {
                            "fastLocationOcr": {
                                "scanCalls": 1,
                                "debugEnabled": True,
                                "debugSamples": [{"field": "placeOfBirth", "raw": ["TEMPAT LAHIR"], "accepted": []}],
                            }
                        },
                    },
                    {
                        "fileName": "partial.png",
                        "passportExtracted": {"birthCity": "PAREPARE", "cityOfIssued": ""},
                        "processingMetrics": {"fastLocationOcr": {"scanCalls": 1}},
                    },
                ]
            }
        )

        self.assertEqual(report["summary"]["outputBirthOnly"], 1)
        self.assertEqual(report["records"][0]["diagnosis"], "LABEL_ONLY_OR_VALUE_OUTSIDE_CROP")
        self.assertEqual(report["records"][1]["diagnosis"], "OUTPUT_PARTIAL")


if __name__ == "__main__":
    unittest.main()
