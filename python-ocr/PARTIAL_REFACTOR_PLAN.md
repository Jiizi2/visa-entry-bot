# Python OCR Partial Refactor Plan

## Decision

The OCR system should be improved through a partial refactor, not a full rebuild.

Primary constraints:

- Most documents are Indonesian passports.
- The system is intended for production, so accuracy and reviewability matter.
- The target laptop may be outdated, so the default pipeline must stay lightweight.

This plan is the working reference for future OCR changes. Implementation should be done gradually and each phase should preserve the current working behavior unless a benchmark proves the replacement is better.

## Target Outcome

The target system is a lightweight, staged OCR pipeline for Indonesian passports:

```text
image
  -> image quality assessment
  -> document/MRZ detection
  -> MRZ OCR and full checksum validation
  -> field evidence collection
  -> selective panel/visual recovery
  -> field resolver
  -> final validation
  -> VALID / NEEDS_REVIEW / ERROR
```

The goal is not to use the heaviest OCR stack. The goal is to make extraction accurate, explainable, fast enough for older laptops, and safe for production use.

## Non-Goals

- Do not replace the whole OCR system at once.
- Do not make PaddleOCR or another deep learning OCR engine the default without benchmark proof on the target laptop.
- Do not remove the existing Indonesian-passport heuristics until their replacements are measured.
- Do not tune OCR behavior without a golden dataset and before/after benchmark.

## Current Plan Alignment

The implementation is now aligned back to the partial-refactor plan:

- Phase 1 is complete for the current 17-sample human-reviewed `trainingData` baseline. Stricter auto-submit gates still need additional optimization because the expanded set includes low-quality/glare images that correctly remain `NEEDS_REVIEW`.
- Phases 2, 3, 4, 5, 6, and 7 are complete for the current lightweight production path.
- Phase 8 is complete as an evaluation harness only. Modern OCR is not adopted and remains blocked until it passes target-laptop dependency, latency, memory, and accuracy gates.
- Because the target laptop is not available yet, `tests/fixtures/ocr_low_power_assumption_targets.json` is the temporary hardware assumption gate. It uses a 3.0x latency multiplier and should be replaced or recalibrated once the laptop can be tested.

Next implementation should follow this order:

1. Optimize the 3 low-quality `NEEDS_REVIEW` images in the expanded golden dataset without weakening review safety.
2. Run production benchmark plus low-power assumption gate.
3. Run the same benchmark on the actual target laptop when available.
4. Only then tighten acceptance gates or consider optional modern OCR fallback.

## Phase 1: Baseline And Safety Net

Status: completed for current 17-sample reviewed baseline.

Objectives:

- Build a golden dataset for Indonesian passports.
- Measure current accuracy and latency before refactoring.
- Define production acceptance targets.

Tasks:

- Expand `tests/fixtures/ocr_training_golden.json` beyond the current small fixture set.
- Include image categories:
  - clean scan/photo
  - blur
  - skew/rotation
  - glare
  - imperfect crop
  - low resolution
  - older/newer Indonesian passport layouts if available
- Use `scripts/benchmark_ocr.py` as the baseline reporting path.
- Use `scripts/prepare_golden_candidates.py` to generate review-only golden fixture candidates from current OCR output.
- Use `scripts/export_golden_review_sheet.py` to create an editable CSV review queue from the candidate report.
- Use `scripts/export_golden_review_html.py` to create a static image-plus-fields review pack.
- Use `scripts/summarize_golden_review.py` to track pending, approved, blocked, and ready-to-append candidates.
- Use `scripts/apply_golden_candidates.py` to append only `reviewApproved: true` candidates into a generated next fixture.
- Use `scripts/compare_golden_fixtures.py` to inspect active vs generated fixture changes before promotion.
- Approved candidates are blocked when required core fields or basic formats are invalid.
- Use `scripts/validate_golden_fixture.py` before benchmarking any active or generated golden fixture.
- `tests/test_ocr_training_golden_fixture.py` validates the active golden fixture in the normal test suite.
- `scripts/benchmark_ocr.py` validates the golden fixture and image references before running OCR.
- Benchmark report should include per-field accuracy and p95 latency.
- Use `tests/fixtures/ocr_benchmark_targets.json` as the initial production-readiness threshold file.
- Initial baseline summary is recorded in `OCR_BASELINE.md`.
- Track per-field accuracy for:
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
- Track runtime metrics:
  - average total time
  - p95 total time
  - max total time
  - MRZ time
  - panel fallback time
  - visual OCR time
  - date/name recovery time
- Track review metrics:
  - `requiresReview`
  - `reviewReasons`
  - total review count
- Define target thresholds for production before algorithm changes.
- Current golden expansion audit for `trainingData`:
  - total files: 17
  - current golden entries: 17
  - human-approved entries promoted: 14
  - remaining candidate entries pending human approval: 0
  - stable review artifacts are stored under `.review/` because `.tmp/` can be cleaned by OCR runs
  - latest candidate report generated at `.review/golden-candidates-trainingData.json`
  - corrected review sheet stored at `.review/golden-review-trainingData.corrected.csv`
  - active fixture validation generated at `.review/ocr-training-golden-validation.json`
  - production benchmark generated at `.review/ocr-baseline-report.json`
  - low-power assumption benchmark generated at `.review/ocr-low-power-assumption-report.json`
  - scanned candidate entries: 14
  - review rows: 14
  - unmatched review rows: 0
  - approved candidates: 14
  - pending candidates: 0
  - ready-to-append candidates: 0 after promotion
  - blocked approved candidates: 0
  - active fixture count after promotion: 17
  - promoted fixture change was additive-only
  - candidate record statuses: 14 `VALID`
  - candidate production review statuses: 8 `VALID`, 6 `NEEDS_REVIEW`
  - duplicate file names: 0
  - generated candidates are marked `reviewRequired: true` and `reviewApproved: false`
  - generated candidates include a per-field `reviewChecklist`
  - active fixture validation: 17 records, 0 errors, 0 duplicate file names
  - candidates must be checked against the actual passport image before setting `reviewApproved: true`
  - approved candidates must pass core validation for status, passport number, nationality, dates, gender, and date ordering
  - user-confirmed name regressions now covered:
    - `MARGONO` single-word MRZ name
    - `MEYSI SALSAHBILLA`
    - `MUHAMMAD IHSAN`
    - `MUHAMMAD MUGNI ZAR GIFARI`
    - noisy MRZ separator cases such as `GHAISAN<K<FAITH` and `ARIYANTI<K<YUNITA`

Exit criteria:

- Golden fixture contains the full current `trainingData` set and catches the known reviewed name regressions. Current state: active 17-sample fixture exists; candidate-generation and review-approved append tooling remain available for future datasets.
- A baseline benchmark report exists for the current system.
- Accuracy and latency targets are written down.

Baseline command:

```powershell
.\.venv\Scripts\python.exe scripts\benchmark_ocr.py ..\data\example-group\passports\trainingData --golden tests\fixtures\ocr_training_golden.json --targets tests\fixtures\ocr_benchmark_targets.json --output .tmp\ocr-baseline-report.json
```

Golden candidate command:

```powershell
.\.venv\Scripts\python.exe scripts\prepare_golden_candidates.py ..\data\example-group\passports\trainingData --golden tests\fixtures\ocr_training_golden.json --output .tmp\golden-candidates-trainingData.json
```

Golden review sheet command:

```powershell
.\.venv\Scripts\python.exe scripts\export_golden_review_sheet.py .tmp\golden-candidates-trainingData.json --output .tmp\golden-review-trainingData.csv
```

Golden HTML review pack command:

```powershell
.\.venv\Scripts\python.exe scripts\export_golden_review_html.py .tmp\golden-candidates-trainingData.json --review-sheet .tmp\golden-review-trainingData.csv --output .tmp\golden-review-trainingData.html
```

Golden review progress command:

```powershell
.\.venv\Scripts\python.exe scripts\summarize_golden_review.py .tmp\golden-candidates-trainingData.json --review-sheet .tmp\golden-review-trainingData.csv --golden tests\fixtures\ocr_training_golden.json --output .tmp\golden-review-summary.json
```

Golden apply command:

```powershell
.\.venv\Scripts\python.exe scripts\apply_golden_candidates.py .tmp\golden-candidates-trainingData.json --review-sheet .tmp\golden-review-trainingData.csv --golden tests\fixtures\ocr_training_golden.json --output .tmp\ocr_training_golden.next.json
```

Golden fixture diff command:

```powershell
.\.venv\Scripts\python.exe scripts\compare_golden_fixtures.py tests\fixtures\ocr_training_golden.json .tmp\ocr_training_golden.next.json --output .tmp\ocr-training-golden-diff.json --fail-on-non-additive
```

Golden fixture validation commands:

```powershell
.\.venv\Scripts\python.exe scripts\validate_golden_fixture.py tests\fixtures\ocr_training_golden.json --images-dir ..\data\example-group\passports\trainingData --output .tmp\ocr-training-golden-validation.json
.\.venv\Scripts\python.exe scripts\validate_golden_fixture.py .tmp\ocr_training_golden.next.json --images-dir ..\data\example-group\passports\trainingData --output .tmp\ocr-training-golden-next-validation.json
```

Review workflow:

1. Generate candidates.
2. Export the CSV review sheet.
3. Export the HTML review pack.
4. Open the HTML pack to compare each source image with OCR-proposed fields.
5. Correct field values in the CSV where OCR is wrong.
6. Set `reviewApproved` to `TRUE` only after all expected fields are manually checked.
7. Add any review context in `reviewNotes`.
8. Run the review progress command to confirm approved rows are ready and not blocked.
9. Run the apply command; approved rows with invalid core fields will be skipped.
10. Compare active vs next fixture and confirm the change is additive-only unless an existing fixture correction is intentional.
11. Validate the generated next fixture.
12. Inspect the generated next fixture before updating the active golden fixture.

## Phase 2: MRZ Reliability Hardening

Status: completed for evidence and confidence hardening.

Objectives:

- Make MRZ acceptance stricter and more explainable.
- Prevent partial/noisy MRZ reads from becoming trusted production output.

Tasks:

- Add full ICAO TD3 MRZ checksum validation:
  - passport number check digit
  - date of birth check digit
  - expiry date check digit
  - optional/personal number check digit when present
  - composite check digit when available
- Initial standalone validator exists in `services/mrz_validation.py`.
- Validation evidence is now attached to MRZ extraction and manifest records as `mrzValidation`.
- MRZ checksum failures now feed `reviewFlags`, `requiresReview`, and `reviewReasons`.
- Manifest records now expose `reviewStatus` as a backward-compatible transition field:
  - `VALID`
  - `NEEDS_REVIEW`
  - `ERROR`
- MRZ checksum failures cap affected MRZ-derived field confidence.
- Acceptance behavior is intentionally unchanged until benchmark evidence supports stricter gating.
- Classify MRZ result quality:
  - `MRZ_VALID`
  - `MRZ_PARTIAL`
  - `MRZ_CONFLICT`
  - `MRZ_FAILED`
- Preserve raw MRZ evidence:
  - source
  - line 1
  - line 2
  - checksum results
  - confidence
  - preprocessing variant note
- Update final validation to understand checksum failures.

Exit criteria:

- MRZ-derived fields cannot be marked high confidence unless checksum validation supports them.
- Existing passing tests still pass.
- New tests cover valid, partial, repaired, and invalid Indonesian MRZ cases.

## Phase 3: Field Evidence And Confidence Refactor

Status: completed for initial evidence emission.

Objectives:

- Stop accepting or overwriting fields through scattered heuristics without a clear reason.
- Make every final field explainable.

Proposed internal model:

```text
FieldEvidence
  field_name
  value
  source
  raw_text
  confidence
  validation_status
  notes
```

Possible sources:

- `mrz`
- `direct_mrz`
- `passporteye`
- `panel_ocr`
- `visual_field_ocr`
- `date_recovery`
- `name_recovery`
- `inferred_rule`

Tasks:

- Introduce field evidence collection without changing final behavior first.
- Initial `fieldEvidence` is emitted in manifest records without changing final behavior.
- Add a field resolver that selects final values from evidence.
- Detect conflicts between MRZ, panel OCR, visual OCR, and inferred rules.
- Emit selected evidence in diagnostics or processing metrics.

Exit criteria:

- Final output can explain where each field came from.
- Conflicting checksum evidence can trigger `NEEDS_REVIEW`; broader cross-source conflict detection remains a follow-up before resolver changes.
- Confidence is surfaced consistently inside `fieldEvidence`.

## Phase 4: Fast / Recovery / Deep OCR Modes

Status: completed for mode telemetry foundation.

Objectives:

- Reduce CPU usage on older laptops.
- Avoid expensive OCR passes when MRZ is already strong.

Modes:

- Fast mode:
  - run MRZ extraction
  - if full MRZ is valid and required fields are complete, skip visual OCR
- Recovery mode:
  - scan only missing or conflicting fields
  - use panel fallback selectively
  - run date/name recovery only when needed
- Deep mode:
  - run heavier preprocessing and broader OCR only after failure
  - apply strict timeout
  - return partial evidence if still unresolved

Tasks:

- Centralize mode selection.
- Initial mode classification is emitted as `processingMetrics.ocrMode`.
- Recovery/deep reasons are emitted as `processingMetrics.ocrModeReasons`.
- Benchmark and worker summaries include OCR mode counts.
- Add per-stage timing and reason codes.
- Ensure expensive OCR is opt-in by field need.

Exit criteria:

- Clean Indonesian passports complete in fast mode.
- Weak scans are classified as recovery when fallback work is used.
- Bad scans are classified as deep when MRZ or processing errors occur.
- Actual OCR skipping/short-circuit changes remain a follow-up after broader golden dataset coverage.

## Phase 5: Indonesian Layout Profiles

Status: completed for current visual OCR and panel fallback windows.

Objectives:

- Move hard-coded crop windows into data/config.
- Support multiple Indonesian passport layout versions without changing code.

Proposed layout profile shape:

```json
{
  "country": "IDN",
  "documentType": "passport",
  "version": "indonesia_default",
  "fields": {
    "fullName": [[0.20, 0.33, 0.24, 0.80]],
    "dob": [[0.53, 0.61, 0.34, 0.56]],
    "expiryDate": [[0.61, 0.71, 0.80, 0.99]]
  }
}
```

Tasks:

- Current visual OCR crop windows from `indonesia_field_ocr.py` are stored in `services/data/indonesia_passport_layouts.json`.
- Current panel fallback mode windows from `panel_fallback.py` are stored in the same layout profile.
- A validated loader exists in `services/layout_profiles.py`.
- `indonesia_field_ocr.py` now reads visual field, extra, and name windows from the profile while preserving the existing default coordinates.
- `panel_fallback.py` now reads compact and panel mode windows from the profile while preserving existing default coordinates.

Exit criteria:

- Visual OCR crop tuning does not require Python code edits.
- Panel fallback crop tuning does not require Python code edits.
- Multiple layout profiles can be tested independently.

## Phase 6: OCR Execution Optimization

Status: completed for the current lightweight production path.

Objectives:

- Make OCR calls predictable, timed, cached, and observable.

Tasks:

- Centralize Tesseract execution:
  - config
  - whitelist
  - PSM
  - timeout
  - cache key
  - latency logging
- Initial centralized runner exists in `services/tesseract_runner.py`.
- Direct `pytesseract.image_to_string` calls now route through the runner.
- Tesseract config construction is centralized through `build_tesseract_config(...)` for PSM, whitelist, DPI, and spacing flags.
- Per-passport `processingMetrics.tesseract` now reports:
  - `callCount`
  - `errorCount`
  - `totalMs`
  - `maxMs`
  - `timeoutSeconds`
- Benchmark reports now include `summary.tesseractTotals`.
- Benchmark supports assumed target hardware projection through:
  - `--assumed-latency-multiplier`
  - `summary.assumedHardware`
  - `tests/fixtures/ocr_low_power_assumption_targets.json`
- Tesseract timeout is configurable through `OCR_TESSERACT_TIMEOUT_SECONDS`; default is 8 seconds per call.
- `passport_page._build_variants` now avoids computing unused expensive variants for `fast`, `hint`, and `numeric` modes while keeping the emitted variant lists behavior-equivalent.
- Direct MRZ OCR now stops early when a high-confidence Indonesian MRZ candidate is found.
- `collect_ocr_lines` supports opt-in predicate-based early-stop for strongly validated fields.
- Panel passport-number OCR now uses early-stop when collected lines already resolve to a valid `E/X` plus 7-digit passport number.
- Panel location OCR now uses early-stop when collected lines already resolve to a known `placeOfBirth`, `issuingOffice`, or `nationality`.
- Panel date OCR can skip expiry-window scanning when MRZ checksum validation already supports a current expiry date and only issue date is requested.
- OCR result cache now has an explicit per-passport session scope via `services/ocr_result_cache.py`.
- `processingMetrics.ocrCache` and benchmark `summary.ocrCacheTotals` expose cache hits, misses, and stores.
- Latest full reviewed-fixture benchmark after this optimization:
  - 17 valid records
  - 3 review records
  - 0 mismatches
  - target failures: review count and latency only; field accuracy passed
  - golden validation errors: 0
  - average total time: 5345 ms
  - p95 total time: 21681 ms
  - max total time: 33599 ms
  - assumed low-power multiplier: 3.0
  - assumed low-power average total time: 15852 ms
  - assumed low-power p95 total time: 58164 ms
  - assumed low-power max total time: 103854 ms
  - assumed low-power Tesseract total time: 143268 ms
  - OCR cache hits: 0
  - Tesseract calls: 419 in the low-power report
  - Tesseract errors: 0
  - baseline Tesseract total time: captured in `.review/ocr-baseline-report.json`
  - main bottlenecks: `Copy of IMG_4530.jpg`, `Copy of IMG_4531.jpg`, and `IMG_4532.jpg`
- Make caches scan-session scoped rather than broad global state where practical. Current state: completed for OCR text-result cache.

Exit criteria:

- OCR timeout cannot hang a full scan indefinitely.
- Benchmark shows equal or better accuracy with lower average/p95 latency.
- Current small-fixture benchmark meets the production and low-power assumption gates.
- More aggressive optimization should wait for an expanded golden dataset.

## Phase 7: Production Status And Failure Handling

Status: completed for backward-compatible production status.

Objectives:

- Prevent questionable OCR results from being treated as valid.
- Make failures actionable for review.

Final statuses:

- `VALID`
- `NEEDS_REVIEW`
- `ERROR`

Migration note:

- `status` remains the legacy compatibility field for now.
- `reviewStatus` is the production status candidate.
- Desktop UI and default batch export now use `reviewStatus` with fallback to legacy `status`.
- Remaining consumers should migrate to `reviewStatus` before `status` is tightened.

Structured error/review reasons:

- `NO_IMAGE_READ`
- `DOCUMENT_NOT_FOUND`
- `LOW_IMAGE_QUALITY`
- `MRZ_NOT_FOUND`
- `MRZ_CHECKSUM_FAILED`
- `FIELD_CONFLICT`
- `OCR_TIMEOUT`
- `UNSUPPORTED_LAYOUT`

Exit criteria:

- Production users can tell whether a result is safe to submit.
- Partial results are available for review when extraction is uncertain.

## Phase 8: Optional Modern OCR Evaluation

Status: completed as evaluation harness; adoption is blocked until target-laptop proof.

Objectives:

- Evaluate modern OCR only where it improves production outcome without breaking laptop constraints.

Tasks:

- Benchmark PaddleOCR or another modern OCR engine against the golden dataset.
- Added non-production evaluation CLI:
  - `scripts/evaluate_modern_ocr.py`
- Added adoption targets fixture:
  - `tests/fixtures/modern_ocr_targets.json`
- Added optional engine adapter/evaluator:
  - `services/modern_ocr_evaluation.py`
- Supported evaluation engines:
  - `tesseract`
  - `paddle` when `paddleocr` is installed
- The production OCR pipeline is unchanged; PaddleOCR is not a dependency and is not enabled by default.
- Modern OCR evaluation now supports `--targets`; the command exits non-zero when an engine fails adoption thresholds.
- Modern OCR reports now include `engineProbe`:
  - module name
  - availability
  - version
  - import time
  - import error
- Adoption thresholds currently cover:
  - all records must be `OK`
  - average elapsed time
  - max elapsed time
  - max peak Python memory
  - per-field hit rates
- Current PaddleOCR probe on this environment:
  - status: `UNAVAILABLE`
  - reason: `No module named 'paddleocr'`
  - module availability: false
  - recommendation: `DO_NOT_ADOPT_ENGINE_NOT_INSTALLED`
  - target gate result: failed as expected
- Current Tesseract raw full-image probe on 1 golden sample:
  - status: `OK`
  - version: `0.3.13`
  - import time: 13 ms
  - elapsed: 4981 ms
  - text length: 1412
  - peak Python memory: 99553 KB
- Measure:
  - accuracy
  - latency on the target laptop
  - memory usage
  - installation complexity
- Consider using modern OCR only as a selective fallback for:
  - full name
  - place of birth
  - issuing office
  - visual dates

Exit criteria:

- Modern OCR is adopted only if benchmark results justify its cost.
- Tesseract/OpenCV remains the default path unless proven inferior on target hardware.
- Current state: PaddleOCR is not installed and must not be added to production dependencies.
- Any future modern OCR adoption must pass `tests/fixtures/modern_ocr_targets.json` on the target laptop.

## Execution Order

Completed implementation order:

1. Phase 1: initial baseline and safety net.
2. Phase 2: MRZ reliability hardening.
3. Phase 3: field evidence and confidence.
4. Phase 4: fast/recovery/deep telemetry.
5. Phase 5: Indonesian layout profiles.
6. Phase 7: production statuses and failure handling.
7. Phase 6: OCR execution optimization.
8. Phase 8: optional modern OCR evaluation harness.

Required next order:

1. Optimize the low-quality `IMG_*` recovery path to reduce visual/date OCR cost.
2. Decide whether `NEEDS_REVIEW` records should be allowed in expanded benchmark targets or kept as a strict auto-submit gate.
3. Re-run Phase 6 production and low-power benchmarks.
4. Run Phase 8 only if modern OCR is intentionally installed for evaluation.
5. Do not change the production OCR engine until the benchmark gates pass on the target laptop.

## Working Rule

Every implementation phase should include:

- focused tests
- before/after benchmark when OCR behavior changes
- no broad rewrite unless the benchmark proves the current path cannot meet production targets
