from __future__ import annotations

import os
import re
import time
from dataclasses import dataclass, replace
from datetime import date, datetime
from typing import Any

from services.log import logger
from services.models import ParsedPassportData
from services.mrz_parser import (
    DirectMrzResult,
    _clean_direct_mrz_lines,
    _direct_mrz_candidates_from_lines,
    _repair_direct_line2,
    _score_direct_line2,
)
from services.image_preprocessor import (
    _mrz_band_score,
    assess_document_quality,
    detect_passport_data_page_crop,
    resize_to_max_edge,
    temporary_mrz_variants,
)
from services.mrz_validation import MrzValidationResult, validate_td3_line2
from services.ocr_runner import build_ocr_config, run_rapid_ocr
from services.mrz_metrics import get_mrz_collector, time_stage

try:
    import cv2
except ImportError:  # pragma: no cover - depends on local environment
    cv2 = None

read_mrz = None
PASSPORTEYE_IMPORT_ERROR = "passporteye is deprecated and replaced by RapidOCR"
pytesseract = None

FIELD_NAMES = (
    "names",
    "surname",
    "number",
    "nationality",
    "date_of_birth",
    "expiration_date",
    "sex",
)
DIRECT_MRZ_MAX_EDGE = 2200


def extract_mrz_data(file_path: str) -> dict[str, Any]:
    quality_penalty, quality_notes = assess_document_quality(file_path)
    try:
        mrz, source_note = _read_best_mrz(file_path)
    except Exception as exc:
        logger.warning("MRZ extraction failed for %s: %s", file_path, exc)
        raise ValueError(f"MRZ extraction failed: {exc}")
        
    if mrz is None:
        logger.warning("MRZ not detected for %s", file_path)
        raise ValueError(_merge_notes("MRZ not detected.", quality_notes))

    collector = get_mrz_collector()
    t0 = time.perf_counter()
    with time_stage("serialization"):
        raw_dict = _to_dictionary(mrz)
    
    data = _repair_extracted_mrz_data(raw_dict)
    
    if not data:
        logger.warning("PassportEye returned empty MRZ data for %s", file_path)
        raise ValueError("PassportEye returned empty MRZ data.")
        
    with time_stage("validation"):
        mrz_validation = _build_mrz_validation(data)

    confidence = _calculate_confidence(mrz, data, quality_penalty)
    if confidence < 0.5:
        logger.debug("Low MRZ confidence (%.2f) for %s", confidence, file_path)

    # Post-selection: update selection status of winning attempt
    if collector is not None and mrz is not None:
        winning_orient = getattr(mrz, "rotation_degrees", 0)
        winning_variant = getattr(mrz, "successful_variant", None)
        winning_width = getattr(mrz, "successful_width", None)
        
        # Search backward to find the successful attempt
        for attempt in reversed(collector.ocr_attempts):
            if (attempt["orientation"] == winning_orient and
                attempt["variant"] == winning_variant and
                attempt["width"] == winning_width):
                attempt["selected"] = True
                attempt["reason"] = "success"
                break

    with time_stage("serialization"):
        result_dict = {
            "data": data,
            "confidence": confidence,
            "notes": _merge_notes(_build_notes(mrz), source_note, quality_notes, _build_validation_note(mrz_validation)),
            "mrzValidation": mrz_validation.to_dict(),
        }
    return result_dict


def _is_optimized_pipeline() -> bool:
    val = os.environ.get("PASSPORT_OCR_PROFILE", "").strip().lower()
    return val in ("optimized", "speed")


def _get_speed_profile() -> bool:
    return _is_optimized_pipeline()


def _read_best_mrz(file_path: str) -> tuple[Any, str]:
    collector = get_mrz_collector()
    direct_mrz = _read_direct_mrz(file_path)
    if _is_high_confidence_indonesian_direct_mrz(direct_mrz):
        if collector is not None and direct_mrz is not None:
            collector.direct_success = True
            collector.successful_orientation = direct_mrz.successful_orientation
            collector.successful_variant = direct_mrz.successful_variant
            collector.successful_width = direct_mrz.successful_width
        return direct_mrz, _direct_mrz_note(direct_mrz)

    is_speed = _get_speed_profile()
    if is_speed and direct_mrz is not None and getattr(direct_mrz, "valid_score", 0) >= 98:
        if collector is not None:
            collector.direct_success = True
            collector.successful_orientation = direct_mrz.successful_orientation
            collector.successful_variant = direct_mrz.successful_variant
            collector.successful_width = direct_mrz.successful_width
        return direct_mrz, _direct_mrz_note(direct_mrz)

    best_mrz = direct_mrz
    best_note = _direct_mrz_note(direct_mrz) if direct_mrz is not None else ""
    best_score = getattr(direct_mrz, "valid_score", -1) if direct_mrz is not None else -1
    
    with temporary_mrz_variants(file_path) as variants:
        if collector is not None:
            collector.fallback_used = True
        for variant_path, note in variants:
            mrz = None
            try:
                mrz = _read_mrz(variant_path)
            except RuntimeError:
                mrz = None
            score = getattr(mrz, "valid_score", -1) if mrz is not None else -1
            if mrz is not None and score > best_score:
                best_mrz = mrz
                best_note = note
                best_score = score
            if mrz is not None and getattr(mrz, "valid", False):
                if collector is not None:
                    collector.fallback_success = True
                    collector.successful_orientation = mrz.successful_orientation
                    collector.successful_variant = mrz.successful_variant
                    collector.successful_width = mrz.successful_width
                return mrz, note

    if collector is not None and best_mrz is not None:
        if best_mrz is direct_mrz:
            collector.direct_success = True
            collector.successful_orientation = direct_mrz.successful_orientation
            collector.successful_variant = direct_mrz.successful_variant
            collector.successful_width = direct_mrz.successful_width
        else:
            collector.fallback_success = True
            collector.successful_orientation = best_mrz.successful_orientation
            collector.successful_variant = best_mrz.successful_variant
            collector.successful_width = best_mrz.successful_width

    return best_mrz, best_note


def _read_image(file_path: str) -> Any:
    if cv2 is None:
        return None
    with time_stage("load_image"):
        return cv2.imread(file_path)


def _read_mrz(file_path: str) -> Any:
    image = _read_image(file_path)
    if image is None:
        return None
    return _scan_document(image, try_full_image_first=True)


def _read_direct_mrz(file_path: str) -> DirectMrzResult | None:
    image = _read_image(file_path)
    if image is None:
        return None
    return _scan_document(image, try_full_image_first=False)


def _scan_document(image: Any, try_full_image_first: bool) -> DirectMrzResult | None:
    collector = get_mrz_collector()
    if try_full_image_first:
        if collector is not None:
            collector.current_orientation = 0
        result = _extract_direct_mrz_from_region(image)
        if result and result.valid:
            return result

    with time_stage("document_detection"):
        document = detect_passport_data_page_crop(image)
    if document is None:
        document = image
        
    with time_stage("resize"):
        document = resize_to_max_edge(document, max_edge=DIRECT_MRZ_MAX_EDGE)

    best_result: DirectMrzResult | None = None
    for candidate_document, rotation_degrees in _direct_mrz_orientation_candidates(document):
        if collector is not None:
            collector.current_orientation = rotation_degrees
        for start_ratio in (0.82, 0.75):
            height = candidate_document.shape[0]
            with time_stage("crop"):
                region = candidate_document[int(height * start_ratio) :, :]
            result = _extract_direct_mrz_from_region(region)
            if result is None:
                continue
            result = replace(result, rotation_degrees=rotation_degrees)
            if best_result is None or result.valid_score > best_result.valid_score:
                best_result = result
            if _is_high_confidence_indonesian_direct_mrz(result):
                return result
    return best_result


def _direct_mrz_orientation_candidates(document: Any):
    yield document, 0
    if _is_optimized_pipeline():
        return
    if not _should_try_direct_mrz_rotations(document):
        return
    with time_stage("rotation"):
        r180 = _rotate_image_180(document)
    yield r180, 180
    with time_stage("rotation"):
        r90 = _rotate_image_90(document)
    yield r90, 90
    with time_stage("rotation"):
        r270 = _rotate_image_270(document)
    yield r270, 270


def _should_try_direct_mrz_rotations(document: Any) -> bool:
    height, width = document.shape[:2]
    if width >= height and _mrz_band_score(document) >= 120.0:
        return False
    return True


def _rotate_image_180(image: Any) -> Any:
    return _rotate_image(image, 180)


def _rotate_image_90(image: Any) -> Any:
    return _rotate_image(image, 90)


def _rotate_image_270(image: Any) -> Any:
    return _rotate_image(image, 270)


def _rotate_image(image: Any, degrees: int) -> Any:
    rotation = int(degrees or 0) % 360
    if rotation == 90 and hasattr(cv2, "ROTATE_90_CLOCKWISE"):
        return cv2.rotate(image, cv2.ROTATE_90_CLOCKWISE)
    if rotation == 180 and hasattr(cv2, "ROTATE_180"):
        return cv2.rotate(image, cv2.ROTATE_180)
    if rotation == 270 and hasattr(cv2, "ROTATE_90_COUNTERCLOCKWISE"):
        return cv2.rotate(image, cv2.ROTATE_90_COUNTERCLOCKWISE)
    if rotation == 90:
        return image.transpose(1, 0, *range(2, len(image.shape)))[:, ::-1].copy()
    if rotation == 180:
        return image[::-1, ::-1].copy()
    if rotation == 270:
        return image.transpose(1, 0, *range(2, len(image.shape)))[::-1, :].copy()
    return image


def _is_high_confidence_indonesian_direct_mrz(mrz: DirectMrzResult | None) -> bool:
    return bool(mrz and mrz.line1.startswith("P<IDN") and mrz.valid_score >= 98 and _score_direct_line2(mrz.line2) == 3)


def _direct_mrz_note(mrz: DirectMrzResult | None) -> str:
    rotation_degrees = int(getattr(mrz, "rotation_degrees", 0) or 0) % 360
    if rotation_degrees:
        return f"MRZ recovered from direct lower-band OCR after {rotation_degrees}-degree rotation."
    return "MRZ recovered from direct lower-band OCR."


def _scale_gray_image(gray: Any, target_width: int) -> Any:
    if gray.shape[1] == target_width:
        return gray
    scale = target_width / max(gray.shape[1], 1)
    interp = cv2.INTER_CUBIC if scale > 1 else cv2.INTER_AREA
    with time_stage("resize"):
        return cv2.resize(gray, None, fx=scale, fy=scale, interpolation=interp)


def _run_ocr_on_variant(variant: Any) -> str:
    config = build_ocr_config(whitelist="ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789<", dpi=300)
    collector = get_mrz_collector()
    
    ocr_runtime_ms = 0
    t0 = time.perf_counter()
    with time_stage("ocr"):
        res = run_rapid_ocr(variant, config)
    ocr_runtime_ms = (time.perf_counter() - t0) * 1000.0
    
    if collector is not None:
        collector.rapidocr_runs += 1
        collector.variant_attempts += 1
        collector.orientation_attempts[collector.current_orientation] = (
            collector.orientation_attempts.get(collector.current_orientation, 0) + 1
        )
        
        attempt_id = f"{collector.passport_id}_{len(collector.ocr_attempts) + 1}"
        attempt = {
            "attempt_id": attempt_id,
            "passport_id": collector.passport_id,
            "orientation": collector.current_orientation,
            "width": collector.current_width,
            "variant": collector.current_variant,
            "runtime_ms": round(ocr_runtime_ms, 2),
            "candidate_found": False,
            "candidate_repaired": False,
            "checksum_passed": False,
            "selected": False,
            "reason": "no_text"
        }
        collector.ocr_attempts.append(attempt)
        collector.current_attempt_index = len(collector.ocr_attempts) - 1
        
    return res


def _process_variants_for_width(scaled_gray: Any, best_candidate: DirectMrzResult | None) -> DirectMrzResult | None:
    candidates: list[DirectMrzResult] = []
    variant_names = ["gray", "clahe", "otsu", "adaptive"]
    collector = get_mrz_collector()
    for idx, variant in enumerate(_build_direct_mrz_variants(scaled_gray)):
        if collector is not None:
            collector.current_variant = variant_names[idx]
            
        attempt_index = len(collector.ocr_attempts) if collector else None
        text = _run_ocr_on_variant(variant)
        if not text:
            continue
            
        if collector is not None and attempt_index is not None and attempt_index < len(collector.ocr_attempts):
            collector.ocr_attempts[attempt_index]["reason"] = "invalid_candidate"
            
        lines = _clean_direct_mrz_lines(text)
        
        # Check raw line 1 pattern candidate existence
        has_raw_candidate = any(
            len(line) >= 10 and line[0] == "P" and (line[1] == "<" or line.count("<") >= 2 or "IDN" in line[1:8] or line.startswith(("P1", "PI")))
            for line in lines
        )
        if has_raw_candidate and collector is not None and attempt_index is not None and attempt_index < len(collector.ocr_attempts):
            attempt = collector.ocr_attempts[attempt_index]
            attempt["candidate_found"] = True
            attempt["reason"] = "checksum_failed"

        cands = _direct_mrz_candidates_from_lines(lines)
        
        if len(cands) > 0 and collector is not None and attempt_index is not None and attempt_index < len(collector.ocr_attempts):
            attempt = collector.ocr_attempts[attempt_index]
            # Check if any candidates passed checksum
            has_checksum_passed = any(_score_direct_line2(c.line2) >= 2 for c in cands)
            if has_checksum_passed:
                attempt["checksum_passed"] = True
                attempt["reason"] = "low_confidence"
                
            for cand in cands:
                if cand.valid_score >= 70:
                    attempt["reason"] = "rejected_by_selector"

        for cand in cands:
            cand = replace(
                cand,
                successful_variant=collector.current_variant if collector else None,
                successful_orientation=collector.current_orientation if collector else 0,
                successful_width=collector.current_width if collector else 0
            )
            candidates.append(cand)
            
        current_best = max(candidates, default=None, key=lambda candidate: candidate.valid_score)
        if current_best is not None:
            if best_candidate is None or current_best.valid_score > best_candidate.valid_score:
                best_candidate = current_best
            if _is_high_confidence_indonesian_direct_mrz(current_best):
                if collector is not None:
                    collector.successful_variant = current_best.successful_variant
                    collector.successful_orientation = current_best.successful_orientation
                    collector.successful_width = current_best.successful_width
                    collector.early_exit_triggered = True
                return current_best
    return best_candidate


def _extract_direct_mrz_from_region(region: Any) -> DirectMrzResult | None:
    gray = cv2.cvtColor(region, cv2.COLOR_BGR2GRAY) if len(region.shape) == 3 else region
    best_candidate: DirectMrzResult | None = None
    collector = get_mrz_collector()
    
    widths = (1600,) if _is_optimized_pipeline() else (1600, 2000)
    for target_width in widths:
        if _is_high_confidence_indonesian_direct_mrz(best_candidate):
            return best_candidate
            
        if collector is not None:
            collector.current_width = target_width
            
        scaled_gray = _scale_gray_image(gray, target_width)
        best_candidate = _process_variants_for_width(scaled_gray, best_candidate)
        
    return best_candidate


def _build_direct_mrz_variants(gray: Any) -> list[Any]:
    with time_stage("variant_generation"):
        clahe = cv2.createCLAHE(clipLimit=2.0, tileGridSize=(8, 8)).apply(gray)
        sharpened = cv2.addWeighted(clahe, 1.6, cv2.GaussianBlur(clahe, (0, 0), 1.6), -0.6, 0)
        denoised = cv2.fastNlMeansDenoising(sharpened, None, 8, 7, 21)
        _, otsu = cv2.threshold(denoised, 0, 255, cv2.THRESH_BINARY + cv2.THRESH_OTSU)
        if _is_optimized_pipeline():
            return [gray, clahe, otsu]
        adaptive = cv2.adaptiveThreshold(denoised, 255, cv2.ADAPTIVE_THRESH_GAUSSIAN_C, cv2.THRESH_BINARY, 31, 9)
        return [gray, clahe, otsu, adaptive]


def _repair_extracted_mrz_data(data: dict[str, Any]) -> dict[str, Any]:
    updated = dict(data)
    line2 = str(updated.get("line2") or _extract_line2(updated) or "")
    if line2:
        updated["line2"] = _repair_direct_line2(line2)
    return updated


def _to_dictionary(mrz: Any) -> dict[str, Any]:
    raw_data = {}
    if hasattr(mrz, "to_dict"):
        try:
            raw_data = mrz.to_dict() or {}
        except Exception:  # noqa: BLE001
            raw_data = {}

    data = dict(raw_data) if isinstance(raw_data, dict) else {}
    for field_name in FIELD_NAMES:
        if field_name in data and data[field_name] not in (None, ""):
            continue
        value = getattr(mrz, field_name, None)
        if value not in (None, ""):
            data[field_name] = value

    for key in ("line1", "line2", "text", "mrz_text", "raw_text"):
        value = getattr(mrz, key, None)
        if value not in (None, "") and key not in data:
            data[key] = value
    return data


def _build_mrz_validation(data: dict[str, Any]) -> MrzValidationResult:
    line2 = _extract_line2(data)
    return validate_td3_line2(line2)


def _extract_line2(data: dict[str, Any]) -> str:
    explicit_line2 = str(data.get("line2", "") or "")
    if explicit_line2:
        return explicit_line2
    for key in ("mrz_text", "raw_text", "text"):
        value = data.get(key)
        if value is None:
            continue
        lines = [re.sub(r"[^A-Z0-9<]", "", line.upper()) for line in str(value).splitlines()]
        candidates = [line for line in lines if len(line.replace("<", "")) >= 20]
        if candidates:
            return candidates[-1]
    return ""


def _build_validation_note(result: MrzValidationResult) -> str:
    if result.notes:
        return result.notes
    if result.valid:
        return "MRZ checksum valid."
    failed_fields = [check.field_name for check in result.check_results if not check.valid]
    if failed_fields:
        return f"MRZ checksum partial: {result.valid_check_count}/{len(result.check_results)} valid ({', '.join(failed_fields)} failed)."
    return ""


def _calculate_confidence(mrz: Any, data: dict[str, Any], quality_penalty: float = 0.0) -> float:
    valid_score = getattr(mrz, "valid_score", None)
    if isinstance(valid_score, (int, float)):
        return round(max(0.0, min(float(valid_score) / 100.0, 1.0) - quality_penalty), 2)

    populated_fields = sum(1 for field_name in FIELD_NAMES if _has_value(data.get(field_name)))
    return round(max(0.0, min(0.4 + (populated_fields / len(FIELD_NAMES)) * 0.5, 0.95) - quality_penalty), 2)


def _build_notes(mrz: Any) -> str:
    valid_score = getattr(mrz, "valid_score", None)
    if isinstance(valid_score, (int, float)) and valid_score < 70:
        return "Low PassportEye confidence."
    return ""


def _merge_notes(*values: str) -> str:
    notes = []
    for value in values:
        cleaned = str(value or "").strip()
        if cleaned and cleaned not in notes:
            notes.append(cleaned)
    return "; ".join(notes)


def _has_value(value: Any) -> bool:
    if value is None:
        return False
    if isinstance(value, (date, datetime)):
        return True
    return str(value).strip() != ""


