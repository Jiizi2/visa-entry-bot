from __future__ import annotations

import os
import re
from collections import Counter
from dataclasses import dataclass
from datetime import date

import numpy as np

from services.image_preprocessor import _load_image, build_processed_document_image
from services.layout_profiles import load_indonesia_passport_layout_profile
from services.location_normalizer import is_known_location_value, pick_best_location_value
from services.parser import clean_gender
from services.passport_page import collect_ocr_lines, configure_tesseract, crop_relative, extract_aligned_passport_page
from services.visual_region_scanner import scan_region_texts

MONTHS = {"JAN": 1, "FEB": 2, "MAR": 3, "APR": 4, "MAY": 5, "JUN": 6, "JUL": 7, "AUG": 8, "SEP": 9, "OCT": 10, "NOV": 11, "DEC": 12}
FIELD_CONFIG = {"fullName": {"psm": 7, "whitelist": "ABCDEFGHIJKLMNOPQRSTUVWXYZ ", "kind": "name"}, "nationality": {"psm": 7, "whitelist": "ABCDEFGHIJKLMNOPQRSTUVWXYZ ", "kind": "country"}, "dob": {"psm": 7, "whitelist": "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ ", "kind": "date"}, "gender": {"psm": 7, "whitelist": "ABCDEFGHIJKLMNOPQRSTUVWXYZ ", "kind": "gender"}, "placeOfBirth": {"psm": 7, "whitelist": "ABCDEFGHIJKLMNOPQRSTUVWXYZ ", "kind": "text"}, "issueDate": {"psm": 7, "whitelist": "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ ", "kind": "date"}, "expiryDate": {"psm": 7, "whitelist": "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ ", "kind": "date"}, "issuingOffice": {"psm": 6, "whitelist": "ABCDEFGHIJKLMNOPQRSTUVWXYZ ", "kind": "text"}}
RAW_LOCATION_WINDOWS = {
    "placeOfBirth": (
        (0.52, 0.62, 0.30, 0.92),
        (0.50, 0.61, 0.58, 0.96),
        (0.50, 0.61, 0.34, 0.70),
        (0.54, 0.68, 0.30, 0.92),
        (0.44, 0.56, 0.78, 0.98),
        (0.60, 0.68, 0.45, 0.70),
        (0.40, 0.62, 0.62, 0.99),
        (0.44, 0.66, 0.60, 1.00),
    ),
    "issuingOffice": (
        (0.70, 0.84, 0.34, 0.68),
        (0.70, 0.84, 0.54, 0.92),
        (0.68, 0.86, 0.30, 0.92),
        (0.60, 0.82, 0.35, 0.68),
        (0.61, 0.69, 0.54, 0.92),
        (0.61, 0.69, 0.30, 0.70),
        (0.64, 0.80, 0.74, 0.99),
        (0.65, 0.75, 0.47, 0.68),
        (0.70, 0.94, 0.62, 1.00),
    ),
}
RAW_LOCATION_PSM_VALUES = {"placeOfBirth": (6, 11, 7), "issuingOffice": (6, 11, 12, 7)}
RAW_LOCATION_WINDOW_ORDER = {
    "placeOfBirth": (0, 1, 2, 4, 5, 3, 6, 7),
    "issuingOffice": (0, 1, 2, 6, 7, 8, 3, 4, 5),
}
RAW_LOCATION_PRIMARY_VARIANT_MODE = "fast"
RAW_LOCATION_VARIANT_MODE = "default"
SPEED_LOCATION_WINDOWS = {
    "placeOfBirth": (
        (0.48, 0.64, 0.68, 0.99),
        (0.50, 0.63, 0.72, 0.99),
        (0.46, 0.66, 0.62, 0.99),
    ),
    "issuingOffice": (
        (0.66, 0.84, 0.62, 0.99),
        (0.70, 0.90, 0.62, 0.99),
        (0.64, 0.94, 0.58, 1.00),
    ),
}
SPEED_LOCATION_PSM_VALUES = {"placeOfBirth": (6, 7), "issuingOffice": (6, 7)}
LABEL_FRAGMENTS = ("BERLA", "BIRTH", "DATE", "EXPI", "ISSU", "KANTOR", "KELAMIN", "KEWARGA", "LAHIR", "MENGELUAR", "NATION", "NEGARA", "OFFICE", "PLACE", "SEX", "TEMPAT")
LABEL_NOISE_TOKENS = {"ARKAN", "ELUARKAN", "MENGELUARKAN"}
NAME_NOISE_TOKENS = {"COUNTRY", "IDN", "INDONESIA", "JENIS", "KODE", "NAME", "NEGARA", "PASPOR", "PASSPORT", "TYPE"}


@dataclass(frozen=True)
class RawLocationScan:
    value: str
    candidates: tuple[str, ...]
    stopped: bool


def extract_visual_fields(
    file_path: str,
    page: object | None = None,
    field_names: tuple[str, ...] | None = None,
    allow_aligned_fallback: bool = True,
    rotation_degrees: int = 0,
) -> dict[str, str]:
    if not configure_tesseract():
        return {}
    extracted: dict[str, str] = {}
    requested_fields = (
        tuple(FIELD_CONFIG)
        if field_names is None
        else tuple(field_name for field_name in field_names if field_name in FIELD_CONFIG)
    )

    for field_name in requested_fields:
        if field_name in RAW_LOCATION_WINDOWS:
            value = _extract_raw_location_field(file_path, field_name, rotation_degrees=rotation_degrees)
            if value:
                extracted[field_name] = value

    remaining_fields = tuple(field_name for field_name in requested_fields if not extracted.get(field_name))
    if not remaining_fields:
        return extracted
    if not allow_aligned_fallback and page is None:
        return extracted

    if page is None:
        page = extract_aligned_passport_page(file_path)
    if page is None:
        page = build_processed_document_image(file_path)
    page = _orient_image(page, rotation_degrees)
    if page is not None:
        for field_name in remaining_fields:
            value = _extract_field(page, field_name)
            if value:
                extracted[field_name] = value
    return extracted


def extract_fast_location_fields(
    file_path: str,
    field_names: tuple[str, ...] = ("placeOfBirth", "issuingOffice"),
    rotation_degrees: int = 0,
) -> dict[str, str]:
    if not configure_tesseract():
        return {}
    requested_fields = tuple(field_name for field_name in field_names if field_name in SPEED_LOCATION_WINDOWS)
    if not requested_fields:
        return {}

    image = _orient_image(_load_image(file_path), rotation_degrees)
    extracted: dict[str, str] = {}
    missing_fields = list(requested_fields)
    if image is not None:
        missing_fields = []
        for field_name in requested_fields:
            value = _extract_fast_location_from_image(image, field_name)
            if value:
                extracted[field_name] = value
            else:
                missing_fields.append(field_name)

    if not missing_fields or not _fast_location_preprocess_enabled():
        return extracted

    processed_image = _orient_image(build_processed_document_image(file_path), rotation_degrees)
    if processed_image is None or _same_image_shape(image, processed_image):
        return extracted

    for field_name in missing_fields:
        value = _extract_fast_location_from_image(processed_image, field_name)
        if value:
            extracted[field_name] = value
    return extracted
    for field_name in requested_fields:
        for image in images:
            value = _extract_fast_location_from_image(image, field_name)
            if value:
                extracted[field_name] = value
                break
    return extracted


def merge_visual_fields(parsed: dict[str, str], visual_fields: dict[str, str]) -> dict[str, str]:
    merged = dict(parsed)
    if visual_fields.get("nationality") == "INDONESIA" and merged.get("nationality") in {"", "ID", "DNI"}:
        merged["nationality"] = "INDONESIA"
    for field_name in ("nationality", "dob", "gender", "issueDate", "expiryDate"):
        if _prefer_visual_value(field_name, merged.get(field_name, ""), visual_fields.get(field_name, "")):
            merged[field_name] = visual_fields[field_name]
    return merged


def build_visual_notes(visual_fields: dict[str, str]) -> str:
    notes = []
    if visual_fields.get("placeOfBirth"):
        notes.append(f"VISUAL PLACE OF BIRTH: {visual_fields['placeOfBirth']}")
    if visual_fields.get("issuingOffice"):
        notes.append(f"VISUAL ISSUING OFFICE: {visual_fields['issuingOffice']}")
    return "; ".join(notes)


def _extract_field(page: object, field_name: str) -> str:
    if field_name == "fullName":
        return _extract_full_name(page)
    config = FIELD_CONFIG[field_name]
    layout_profile = load_indonesia_passport_layout_profile()
    candidates: list[str] = []
    windows = [template[field_name] for template in layout_profile["fieldTemplates"]] + list(
        layout_profile["extraWindows"].get(field_name, ())
    )
    variant_mode = "numeric" if config["kind"] == "date" else "fast"
    for window in windows:
        region = crop_relative(page, *window)
        if region is None:
            continue
        psm_values = _field_psm_values(field_name, config["psm"])
        include_psm_fallback = len(psm_values) == 1
        for psm in psm_values:
            for text in scan_region_texts(
                region,
                psm,
                config["whitelist"],
                variant_mode=variant_mode,
                max_lines=12,
                stop_when=_field_stop_when(field_name, config["kind"]),
                include_psm_fallback=include_psm_fallback,
            ):
                value = _clean_value(field_name, text, config["kind"])
                if _is_valid(value, field_name):
                    candidates.append(value)
            if _has_stable_field_candidate(field_name, candidates):
                break
        if _has_stable_field_candidate(field_name, candidates):
            break
    return _pick_best_field_value(field_name, candidates)


def _field_psm_values(field_name: str, default_psm: int) -> tuple[int, ...]:
    if field_name == "placeOfBirth":
        return (6, 7)
    return (default_psm,)


def _extract_raw_location_field(file_path: str, field_name: str, rotation_degrees: int = 0) -> str:
    image = _orient_image(_load_image(file_path), rotation_degrees)
    if image is None:
        return ""

    primary = _scan_raw_location_field(image, field_name, RAW_LOCATION_PRIMARY_VARIANT_MODE)
    if _accept_raw_location_scan(field_name, primary) or RAW_LOCATION_VARIANT_MODE == RAW_LOCATION_PRIMARY_VARIANT_MODE:
        return primary.value
    if not primary.value:
        return ""

    fallback = _scan_raw_location_field(image, field_name, RAW_LOCATION_VARIANT_MODE)
    return fallback.value or primary.value


def _fast_location_preprocess_enabled() -> bool:
    value = os.environ.get("PASSPORT_FAST_LOCATION_PREPROCESS", "").strip().lower()
    return value in {"1", "true", "yes", "on", "fallback"}


def _same_image_shape(left: object | None, right: object | None) -> bool:
    if left is None or right is None:
        return False
    return getattr(left, "shape", None) == getattr(right, "shape", None)


def _orient_image(image: object | None, rotation_degrees: int = 0) -> object | None:
    if image is None:
        return None
    rotation = int(rotation_degrees or 0) % 360
    if rotation == 0:
        return image
    try:
        if rotation == 90:
            return np.rot90(image, 3).copy()
        if rotation == 180:
            return np.rot90(image, 2).copy()
        if rotation == 270:
            return np.rot90(image, 1).copy()
        return image
    except Exception:  # noqa: BLE001
        return image


def _extract_fast_location_from_image(image: object, field_name: str) -> str:
    config = FIELD_CONFIG[field_name]
    candidates: list[str] = []
    for window in SPEED_LOCATION_WINDOWS[field_name]:
        region = crop_relative(image, *window)
        if region is None:
            continue
        for psm in SPEED_LOCATION_PSM_VALUES[field_name]:
            texts = scan_region_texts(
                region,
                psm,
                config["whitelist"],
                variant_mode="fast",
                max_lines=12,
                stop_when=_field_stop_when(field_name, config["kind"]),
                include_psm_fallback=False,
            )
            for text in texts:
                value = _clean_value(field_name, text, config["kind"])
                if _is_valid(value, field_name):
                    candidates.append(value)
            best_value = _pick_best_field_value(field_name, candidates)
            if best_value and is_known_location_value(field_name, best_value):
                return best_value
        if _has_stable_field_candidate(field_name, candidates):
            return _pick_best_field_value(field_name, candidates)
    return _pick_best_field_value(field_name, candidates)


def _scan_raw_location_field(image: object, field_name: str, variant_mode: str) -> RawLocationScan:
    config = FIELD_CONFIG[field_name]
    candidates: list[str] = []
    stopped = False
    for window_index in RAW_LOCATION_WINDOW_ORDER[field_name]:
        window = RAW_LOCATION_WINDOWS[field_name][window_index]
        region = crop_relative(image, *window)
        if region is None:
            continue
        for psm in RAW_LOCATION_PSM_VALUES[field_name]:
            texts = scan_region_texts(
                region,
                psm,
                config["whitelist"],
                variant_mode=variant_mode,
                max_lines=30,
                stop_when=None if field_name == "issuingOffice" else _field_stop_when(field_name, config["kind"]),
                include_psm_fallback=False,
            )
            for text, weight in _weighted_raw_location_texts(field_name, texts, window_index):
                value = _clean_value(field_name, text, config["kind"])
                if _is_valid(value, field_name):
                    candidates.extend([value] * weight)
            if _should_stop_raw_location_scan(field_name, candidates, window_index):
                stopped = True
                break
        if stopped:
            break
    return RawLocationScan(_pick_best_field_value(field_name, candidates), tuple(candidates), stopped)


def _accept_raw_location_scan(field_name: str, scan: RawLocationScan) -> bool:
    if not scan.value:
        return False
    return _has_dominant_raw_location_value(scan)


def _has_dominant_raw_location_value(scan: RawLocationScan) -> bool:
    counts = Counter(scan.candidates).most_common(2)
    if not counts or counts[0][0] != scan.value:
        return False
    if len(counts) == 1:
        return True
    top_count = counts[0][1]
    runner_up_count = counts[1][1]
    return top_count >= runner_up_count + 4 and top_count >= int(runner_up_count * 1.35)


def _should_stop_raw_location_scan(field_name: str, candidates: list[str], window_index: int) -> bool:
    if not _has_stable_field_candidate(field_name, candidates):
        return False
    if field_name != "issuingOffice":
        return True
    return window_index in {0, 1, 2, 7, 8}


def _weighted_raw_location_texts(field_name: str, texts: list[str], window_index: int) -> list[tuple[str, int]]:
    if field_name != "issuingOffice":
        return [(text, 1) for text in texts]
    weighted: list[tuple[str, int]] = []
    marker_seen = False
    for line_index, text in enumerate(texts):
        weight = 1
        if marker_seen:
            weight += 3
        if window_index <= 3:
            weight += 1
        if line_index >= 4:
            weight += 1
        weighted.append((text, weight))
        if _has_issuing_office_marker(text):
            marker_seen = True
    return weighted


def _has_issuing_office_marker(text: str) -> bool:
    compact = re.sub(r"[^A-Z]", "", str(text or "").upper())
    return any(fragment in compact for fragment in ("ISSUING", "OFFICE", "KANTOR", "MENGELUARKAN"))


def _extract_full_name(page: object) -> str:
    layout_profile = load_indonesia_passport_layout_profile()
    collected: list[str] = []
    for window in layout_profile["nameWindows"]:
        lines = collect_ocr_lines(
            crop_relative(page, *window),
            psm_values=(6,),
            whitelist="ABCDEFGHIJKLMNOPQRSTUVWXYZ /",
            variant_mode="fast",
            max_lines=12,
        )
        for index, line in enumerate(lines):
            options = [_extract_name_tail(line)]
            if _extract_name_tail(line):
                options.append(lines[index + 1] if index + 1 < len(lines) else "")
            elif "NAME" in line or "NAMA" in line:
                options.append(lines[index + 1] if index + 1 < len(lines) else "")
            else:
                options.append(line)
            for candidate in options:
                cleaned = _clean_visual_name(candidate)
                if _is_valid(cleaned, "fullName"):
                    collected.append(cleaned)

    config = FIELD_CONFIG["fullName"]
    for window in layout_profile["nameValueWindows"]:
        region = crop_relative(page, *window)
        if region is None:
            continue
        for text in scan_region_texts(region, 6, config["whitelist"], max_lines=10):
            cleaned = _clean_visual_name(text)
            if _is_valid(cleaned, "fullName"):
                collected.append(cleaned)
    return _pick_best_name_candidate(collected)


def _clean_value(field_name: str, text: str, kind: str) -> str:
    if kind == "name":
        return _clean_visual_name(text)
    if kind == "date":
        return _clean_date(text)
    if kind == "gender":
        return _clean_visual_gender(text)
    if kind == "country":
        return _clean_visual_country(text)
    return pick_best_location_value(field_name, [_clean_visual_text(text)]) if field_name in {"placeOfBirth", "issuingOffice"} else _clean_visual_text(text)


def _pick_best_field_value(field_name: str, candidates: list[str]) -> str:
    if not candidates:
        return ""
    if field_name in {"placeOfBirth", "issuingOffice"}:
        return pick_best_location_value(field_name, candidates)
    if field_name == "dob":
        return min(candidates)
    if field_name == "gender":
        return max(set(candidates), key=candidates.count)
    if field_name in {"issueDate", "expiryDate"}:
        return max(candidates)
    return max(set(candidates), key=candidates.count)


def _has_stable_field_candidate(field_name: str, candidates: list[str]) -> bool:
    if not candidates:
        return False
    if field_name == "nationality":
        return "INDONESIA" in candidates
    if field_name == "gender":
        return len(candidates) >= 2 and len(set(candidates)) == 1
    counts = Counter(candidates)
    if field_name in {"dob", "issueDate", "expiryDate"}:
        return any(count >= 2 for count in counts.values())
    if field_name in {"placeOfBirth", "issuingOffice"}:
        best_value = _pick_best_field_value(field_name, candidates)
        return bool(best_value and (is_known_location_value(field_name, best_value) or counts.get(best_value, 0) >= 2))
    return False


def _field_stop_when(field_name: str, kind: str) -> object | None:
    if field_name not in {"placeOfBirth", "issuingOffice"}:
        return None

    def stop_when(lines: list[str]) -> bool:
        for line in lines:
            value = _clean_value(field_name, line, kind)
            if value and is_known_location_value(field_name, value):
                return True
        return False

    return stop_when


def _prefer_visual_value(field_name: str, current: str, candidate: str) -> bool:
    if not candidate:
        return False
    if field_name in {"dob", "issueDate", "expiryDate"}:
        return _is_iso_date(candidate) and not _is_iso_date(current)
    if field_name == "gender":
        return current not in {"MALE", "FEMALE"}
    if field_name == "nationality":
        return current in {"", "ID", "DNI"}
    return not current


def _is_iso_date(value: str) -> bool:
    try:
        date.fromisoformat(value)
        return True
    except ValueError:
        return False


def _clean_date(text: str) -> str:
    normalized = re.sub(r"[^A-Z0-9]", " ", text.upper())
    match = re.search(r"\b(\d{1,2})\s*([A-Z]{3})\s*(\d{4})\b", normalized)
    if not match:
        return ""
    day, month_text, year = match.groups()
    month = MONTHS.get(month_text)
    if month is None:
        return ""
    try:
        return date(int(year), month, int(day)).isoformat()
    except ValueError:
        return ""


def _clean_visual_gender(text: str) -> str:
    normalized = re.sub(r"[^A-Z]", "", text.upper())
    if not normalized:
        return ""
    if normalized.startswith(("LM", "ML", "L", "M")):
        return "MALE"
    if normalized.startswith(("PF", "FP", "P", "F")):
        return "FEMALE"
    return clean_gender(normalized)


def _clean_visual_country(text: str) -> str:
    normalized = _clean_visual_text(text)
    if "INDONESIA" in normalized:
        return "INDONESIA"
    compact = normalized.replace(" ", "")
    if compact == "IDN":
        return "INDONESIA"
    return ""


def _clean_visual_text(text: str) -> str:
    normalized = re.sub(r"[^A-Z\s]", " ", text.upper())
    tokens = []
    for token in normalized.split():
        if len(token) < 2:
            continue
        if token in LABEL_NOISE_TOKENS:
            continue
        if any(fragment in token for fragment in LABEL_FRAGMENTS):
            continue
        tokens.extend(_split_suffix_token(token))
    return " ".join(tokens)


def _clean_visual_name(text: str) -> str:
    normalized = _clean_visual_text(text)
    tokens = [token for token in normalized.split() if 2 <= len(token) <= 12 and token not in NAME_NOISE_TOKENS]
    if len(tokens) > 4:
        return ""
    return " ".join(tokens)


def _extract_name_tail(text: str) -> str:
    normalized = re.sub(r"\s+", " ", str(text or "").upper())
    parts = re.split(r"NAMA LENGKAP\s*/?\s*FULL NAME|FULL NAME|NAMA LENGKAP", normalized, maxsplit=1)
    return parts[-1] if len(parts) > 1 else ""


def _pick_best_name_candidate(candidates: list[str]) -> str:
    best_value = ""
    best_score = -1
    for candidate in candidates:
        tokens = candidate.split()
        score = len("".join(tokens)) + len(tokens) * 8
        if len(tokens) >= 2:
            score += 20
        if score > best_score:
            best_value, best_score = candidate, score
    return best_value


def _split_suffix_token(token: str) -> list[str]:
    for suffix in ("TIMUR", "BARAT", "UTARA", "SELATAN", "REDEB"):
        if token.endswith(suffix) and len(token) > len(suffix) + 2:
            return [token[: -len(suffix)], suffix]
    return [token]


def _is_valid(value: str, field_name: str) -> bool:
    if not value:
        return False
    if field_name == "fullName":
        tokens = value.split()
        return 0 < len(tokens) <= 4 and all(_is_reasonable_name_token(token) for token in tokens)
    if field_name in {"dob", "issueDate", "expiryDate"}:
        return len(value) == 10
    if field_name == "gender":
        return value in {"MALE", "FEMALE"}
    if field_name == "nationality":
        return len(value) >= 3
    if field_name == "placeOfBirth":
        return len(value) >= 4 and len(value.split()) <= 3 and _is_reasonable_location(value)
    if field_name == "issuingOffice":
        return len(value) >= 5 and len(value.split()) <= 4 and _is_reasonable_location(value)
    return True


def _is_reasonable_location(value: str) -> bool:
    tokens = value.split()
    if not tokens:
        return False
    return all(_is_reasonable_location_token(token) for token in tokens)


def _is_reasonable_location_token(token: str) -> bool:
    vowels = sum(char in "AEIOUY" for char in token)
    dominant = max(token.count(char) for char in set(token)) / max(len(token), 1)
    return 3 <= len(token) <= 12 and vowels >= 1 and dominant < 0.7


def _is_reasonable_name_token(token: str) -> bool:
    if not _is_reasonable_location_token(token):
        return False
    return re.search(r"[AEIOUY]{3,}", token) is None and re.search(r"[BCDFGHJKLMNPQRSTVWXYZ]{3,}$", token) is None
