# OCR Baseline Report

Generated from the current Indonesian passport golden fixture.

Command:

```powershell
.\.venv\Scripts\python.exe scripts\benchmark_ocr.py ..\data\example-group\passports\trainingData --golden tests\fixtures\ocr_training_golden.json --targets tests\fixtures\ocr_benchmark_targets.json --output .review\ocr-baseline-report.json
```

## Baseline Summary

- Dataset: `data/example-group/passports/trainingData`
- Golden fixture: `tests/fixtures/ocr_training_golden.json`
- Files with expected values: 17
- Valid records: 17
- Error records: 0
- Needs review records: 3
- Mismatches: 0
- Target failures: 3 in the normal benchmark: review count, p95 latency, max latency
- Golden validation errors: 0
- Average total time: 5345 ms
- P95 total time: 21681 ms
- Max total time: 33599 ms
- OCR mode counts: 17 `RECOVERY`

## Field Accuracy

All expected fields in the current fixture passed at 100% accuracy:

- `passportNumber`
- `firstName`
- `familyName`
- `nationality`
- `dob`
- `issueDate`
- `expiryDate`
- `gender`
- `birthCity`
- `cityOfIssued`
- `status`

## Notes

- This is the reviewed baseline for the full current `trainingData` set.
- The current fixture includes low-quality/glare images; they pass field accuracy but still expose production review and latency risks.
- Current baseline output is stored locally at `.review/ocr-baseline-report.json`.
- Current low-power assumption output is stored locally at `.review/ocr-low-power-assumption-report.json`.
- Golden expansion helper output is stored locally at `.review/golden-candidates-trainingData.json`.
- Corrected review sheet is stored locally at `.review/golden-review-trainingData.corrected.csv`.
- Current `trainingData` audit: 17 images, 17 golden entries, 0 remaining unapproved candidate entries.
- Latest golden candidate scan generated all 14 missing candidate entries.
- Candidate production review statuses: 8 `VALID`, 6 `NEEDS_REVIEW`.
- Duplicate candidate file names: 0.
- Golden candidates now default to `reviewApproved: false` and include a per-field review checklist.
- CSV review queue is stored locally at `.tmp/golden-review-trainingData.csv`.
- Static HTML review pack is stored locally at `.tmp/golden-review-trainingData.html`.
- Latest HTML review pack contains 14 candidates and all candidate image source paths exist locally.
- Review progress summary is stored locally at `.tmp/golden-review-summary.json`.
- Current review progress after promotion: 14 candidates, 14 review rows, 0 unmatched review rows, 14 approved and promoted, 0 pending, 0 blocked.
- The promoted fixture change was additive-only.
- `scripts/apply_golden_candidates.py` can generate a next fixture from approved candidates without mutating the active golden fixture.
- Approved rows are validated for core field presence, passport number format, Indonesian nationality, ISO dates, gender, and date ordering before append.
- Latest apply with the corrected review sheet processed 14 candidates and promoted all approved entries.
- Active fixture validation is stored locally at `.review/ocr-training-golden-validation.json`.
- Active fixture validation currently reports 17 records, 0 errors, and 0 duplicate file names.
- Active golden fixture validation is also covered by `tests/test_ocr_training_golden_fixture.py`.
- `scripts/benchmark_ocr.py` now validates the golden fixture before running OCR and fails fast when fixture records or image references are invalid.
- User-confirmed name regressions now locked in the fixture:
  - `MARGONO` single-word name, duplicated intentionally for required first/family fields
  - `MEYSI SALSAHBILLA`
  - `MUHAMMAD IHSAN`
  - `MUHAMMAD MUGNI ZAR GIFARI`
  - noisy MRZ separator cases such as `GHAISAN<K<FAITH` and `ARIYANTI<K<YUNITA`

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

## Phase 6 Optimization Snapshot

After centralized Tesseract execution, lazy variant preprocessing, high-confidence direct MRZ early-stop, panel location early-stop, scoped panel date OCR, verified single-word MRZ fast-path, and verified common-name cleanup:

- Valid records: 17
- Error records: 0
- Needs review records: 3
- Mismatches: 0
- Target failures: review count and latency only
- Golden validation errors: 0
- Average total time: 5345 ms
- P95 total time: 21681 ms
- Max total time: 33599 ms
- Assumed low-power multiplier: 3.0
- Assumed low-power average total time: 15852 ms
- Assumed low-power p95 total time: 58164 ms
- Assumed low-power max total time: 103854 ms
- Assumed low-power Tesseract total time: 143268 ms
- Assumed low-power target failures: review count, p95/max latency, and Tesseract total time
- OCR cache hits: 0
- Tesseract calls: 419 in the low-power report
- Tesseract errors: 0
- Primary bottlenecks: `Copy of IMG_4530.jpg`, `Copy of IMG_4531.jpg`, and `IMG_4532.jpg`

Interpretation:

- Accuracy is currently good enough to promote the expanded golden fixture: 0 mismatches across 17 reviewed records.
- Auto-submit readiness is not good enough for all 17 records: 3 low-quality/glare images remain `NEEDS_REVIEW`.
- Performance on the assumed low-power laptop is not acceptable for those low-quality images yet.

## Phase 8 Optional OCR Evaluation Snapshot

The modern OCR harness is available but does not change the production pipeline.

Commands:

```powershell
.\.venv\Scripts\python.exe scripts\evaluate_modern_ocr.py ..\data\example-group\passports\trainingData --engine paddle --golden tests\fixtures\ocr_training_golden.json --limit 1 --output .tmp\modern-ocr-paddle-report.json
.\.venv\Scripts\python.exe scripts\evaluate_modern_ocr.py ..\data\example-group\passports\trainingData --engine paddle --golden tests\fixtures\ocr_training_golden.json --targets tests\fixtures\modern_ocr_targets.json --limit 1 --output .tmp\modern-ocr-paddle-report.json
.\.venv\Scripts\python.exe scripts\evaluate_modern_ocr.py ..\data\example-group\passports\trainingData --engine tesseract --golden tests\fixtures\ocr_training_golden.json --limit 1 --output .tmp\modern-ocr-tesseract-report.json
```

Current probe:

- PaddleOCR status: `UNAVAILABLE`
- PaddleOCR module available: false
- PaddleOCR recommendation: `DO_NOT_ADOPT_ENGINE_NOT_INSTALLED`
- PaddleOCR target gate: failed as expected because `paddleocr` is not installed
- Tesseract raw full-image status: `OK`
- Tesseract module version: `0.3.13`
- Tesseract module import time: 13 ms
- Tesseract raw full-image elapsed time on 1 sample: 4981 ms
- Tesseract raw full-image peak Python memory on 1 sample: 99553 KB
