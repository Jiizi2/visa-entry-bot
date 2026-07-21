# OCR Baseline Report

> **Status dokumen:** Snapshot benchmark historis saat migrasi RapidOCR masih mempertahankan fallback PassportEye/Tesseract. Runtime saat ini sudah menggunakan RapidOCR untuk MRZ dan tidak lagi membawa dependency PassportEye/Tesseract. Angka benchmark di bawah tetap dipertahankan sebagai baseline historis, bukan deskripsi dependency produksi terkini.

Generated from the current Indonesian passport golden fixture.

Command:

```powershell
.\.venv\Scripts\python.exe scripts\benchmark_ocr.py ..\data\example-group\passports\trainingData --golden tests\fixtures\ocr_training_golden.json --targets tests\fixtures\ocr_benchmark_targets.json --output .review\ocr-baseline-report.json
```

## Baseline Summary (RapidOCR Engine)

- **Primary OCR Engine**: RapidOCR (ONNX Runtime)
- **MRZ fallback pada snapshot ini**: Tesseract OCR via PassportEye (sudah tidak aktif pada runtime terkini)
- Dataset: `data/example-group/passports/trainingData`
- Golden fixture: `tests/fixtures/ocr_training_golden.json`
- Files with expected values: 17
- Valid records: 17
- Error records: 0
- Needs review records: 17 (due to `FAST_SCAN_REVIEW` flag in `RECOVERY` mode)
- Mismatches: 8 (out of 17 expected records)
- Average total time: 9357 ms
- P95 total time: 16161 ms
- Max total time: 16824 ms
- OCR mode counts: 17 `RECOVERY`

## Field Accuracy

Field accuracy with the current RapidOCR baseline:

- `passportNumber`: 100.0% (17/17 matches)
- `firstName`: 100.0% (16/16 matches)
- `familyName`: 100.0% (16/16 matches)
- `nationality`: 100.0% (17/17 matches)
- `dob`: 100.0% (17/17 matches)
- `issueDate`: 100.0% (17/17 matches)
- `expiryDate`: 100.0% (17/17 matches)
- `gender`: 100.0% (17/17 matches)
- `birthCity`: 81.25% (13/16 matches, 3 mismatches)
- `cityOfIssued`: 68.75% (11/16 matches, 5 mismatches)
- `status`: 100.0% (17/17 matches)

### Analysis of Mismatches
The RapidOCR engine processes localized regions of the passport. Because the golden fixture contains challenging samples (glare, blur, low lighting), some localized fields are misread or fall back to incorrect values:
- `cityOfIssued` mismatches occur on `Faith Ghaisan 1`, `Margono1`, and `Mawar Nurani La Rani` where RapidOCR extracted alternative texts (e.g. `MAKASSAR`, `BANYUWANGI`, `PINRANG` instead of `TANJUNG REDEB`).
- `birthCity` mismatches occur on `IMG_4530` and `IMG_4531` where the city was not detected (returned empty instead of `KEDIRI` and `KENDAL`).

## Notes

- This is the reviewed baseline for the full current `trainingData` set under the RapidOCR engine.
- Current baseline output is stored locally at `.review/ocr-baseline-report.json`.
- Current `trainingData` audit: 17 images, 17 golden entries.
- Active golden fixture validation is covered by `tests/test_ocr_training_golden_fixture.py`.
- `scripts/benchmark_ocr.py` validates the golden fixture before running OCR and fails fast when fixture records or image references are invalid.

## Golden Expansion Workflow

Generate review candidates:

```powershell
.\.venv\Scripts\python.exe scripts\prepare_golden_candidates.py ..\data\example-group\passports\trainingData --golden tests\fixtures\ocr_training_golden.json --output .tmp\golden-candidates-trainingData.json
```

Export an editable review sheet:

```powershell
.\.venv\Scripts\python.exe scripts\export_golden_review_sheet.py .tmp\golden-candidates-trainingData.json --output .tmp\golden-review-trainingData.csv
```

Export a static image-plus-fields review pack:

```powershell
.\.venv\Scripts\python.exe scripts\export_golden_review_html.py .tmp\golden-candidates-trainingData.json --review-sheet .tmp\golden-review-trainingData.csv --output .tmp\golden-review-trainingData.html
```

Summarize review progress:

```powershell
.\.venv\Scripts\python.exe scripts\summarize_golden_review.py .tmp\golden-candidates-trainingData.json --review-sheet .tmp\golden-review-trainingData.csv --golden tests\fixtures\ocr_training_golden.json --output .tmp\golden-review-summary.json
```

Apply only reviewed candidates into a generated next fixture:

```powershell
.\.venv\Scripts\python.exe scripts\apply_golden_candidates.py .tmp\golden-candidates-trainingData.json --review-sheet .tmp\golden-review-trainingData.csv --golden tests\fixtures\ocr_training_golden.json --output .tmp\ocr_training_golden.next.json
```

Compare active and generated fixtures:

```powershell
.\.venv\Scripts\python.exe scripts\compare_golden_fixtures.py tests\fixtures\ocr_training_golden.json .tmp\ocr_training_golden.next.json --output .tmp\ocr-training-golden-diff.json --fail-on-non-additive
```

Validate golden fixtures before benchmark:

```powershell
.\.venv\Scripts\python.exe scripts\validate_golden_fixture.py tests\fixtures\ocr_training_golden.json --images-dir ..\data\example-group\passports\trainingData --output .tmp\ocr-training-golden-validation.json
.\.venv\Scripts\python.exe scripts\validate_golden_fixture.py .tmp\ocr_training_golden.next.json --images-dir ..\data\example-group\passports\trainingData --output .tmp\ocr-training-golden-next-validation.json
```

## Phase 9 RapidOCR Baseline Snapshot

Pada saat snapshot ini dibuat, migrasi memakai RapidOCR sebagai engine utama dan masih mempertahankan Tesseract sebagai fallback MRZ. Fallback tersebut kemudian dihapus dari runtime:

- Valid records: 17
- Error records: 0
- Needs review records: 17
- Mismatches: 8
- Average total time: 9357 ms
- P95 total time: 16161 ms
- Max total time: 16824 ms
- RapidOCR calls (reported as `tesseract` in the metrics output): 146
- RapidOCR errors: 0
- RapidOCR total time: 123808 ms
- RapidOCR average call time: 7282 ms
- RapidOCR max call time: 3244 ms
- Panel fallback used: 14
- Visual OCR used: 15
- MRZ fallback used: 0
