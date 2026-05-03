from __future__ import annotations

import sys
import tempfile
import unittest
from datetime import date
from pathlib import Path

from openpyxl import Workbook

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from services.reference_loader import load_reference_workbook


class ReferenceLoaderTests(unittest.TestCase):
    def test_loads_standard_workbook_with_openpyxl(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            path = Path(temp_dir) / "manifest.xlsx"
            workbook = Workbook()
            sheet = workbook.active
            sheet.append(["NO", "NAMA", "PASSPORT", "DOB", "DOI", "DOE", "SEX"])
            sheet.append([1, "ALI HASAN", "X1234567", date(1990, 1, 2), date(2025, 1, 3), date(2030, 1, 3), "M"])
            workbook.save(path)
            workbook.close()

            rows = load_reference_workbook(str(path))

        self.assertEqual(rows[0]["fullName"], "ALI HASAN")
        self.assertEqual(rows[0]["firstName"], "ALI")
        self.assertEqual(rows[0]["familyName"], "HASAN")
        self.assertEqual(rows[0]["passportNumber"], "X1234567")
        self.assertEqual(rows[0]["dob"], "1990-01-02")
        self.assertEqual(rows[0]["issueDate"], "2025-01-03")
        self.assertEqual(rows[0]["expiryDate"], "2030-01-03")
        self.assertEqual(rows[0]["gender"], "MALE")

    def test_loads_passenger_manifest_workbook_with_openpyxl(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            path = Path(temp_dir) / "passenger.xlsx"
            workbook = Workbook()
            sheet = workbook.active
            sheet.append([None, "TITLE", "PASSENGER NAME", "SEX", "POB", "DOB", "NO. PASPORT", "ISSUING OFFICE", "DOI", "DOE"])
            sheet.append([None, "MR", "BUDI SANTOSO", "M", "BERAU", date(1988, 5, 6), "E7654321", "TANJUNG REDEB", date(2024, 5, 7), date(2034, 5, 7)])
            workbook.save(path)
            workbook.close()

            rows = load_reference_workbook(str(path))

        self.assertEqual(rows[0]["fullName"], "BUDI SANTOSO")
        self.assertEqual(rows[0]["passportNumber"], "E7654321")
        self.assertEqual(rows[0]["issuingOffice"], "TANJUNG REDEB")
        self.assertEqual(rows[0]["issueDate"], "2024-05-07")
        self.assertEqual(rows[0]["expiryDate"], "2034-05-07")


if __name__ == "__main__":
    unittest.main()
