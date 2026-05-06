from __future__ import annotations

import re
from collections import Counter
from datetime import date

from services.layout_profiles import load_indonesia_passport_layout_profile
from services.location_normalizer import pick_best_location_value
from services.parser import clean_gender
from services.passport_page import collect_ocr_lines, configure_tesseract, crop_relative, extract_aligned_passport_page
from services.visual_region_scanner import scan_region_texts

MONTHS = {"JAN": 1, "FEB": 2, "MAR": 3, "APR": 4, "MAY": 5, "JUN": 6, "JUL": 7, "AUG": 8, "SEP": 9, "OCT": 10, "NOV": 11, "DEC": 12}
FIELD_CONFIG = {"fullName": {"psm": 7, "whitelist": "ABCDEFGHIJKLMNOPQRSTUVWXYZ ", "kind": "name"}, "nationality": {"psm": 7, "whitelist": "ABCDEFGHIJKLMNOPQRSTUVWXYZ ", "kind": "country"}, "dob": {"psm": 7, "whitelist": "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ ", "kind": "date"}, "gender": {"psm": 7, "whitelist": "ABCDEFGHIJKLMNOPQRSTUVWXYZ ", "kind": "gender"}, "placeOfBirth": {"psm": 7, "whitelist": "ABCDEFGHIJKLMNOPQRSTUVWXYZ ", "kind": "text"}, "issueDate": {"psm": 7, "whitelist": "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ ", "kind": "date"}, "expiryDate": {"psm": 7, "whitelist": "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ ", "kind": "date"}, "issuingOffice": {"psm": 6, "whitelist": "ABCDEFGHIJKLMNOPQRSTUVWXYZ ", "kind": "text"}}
LABEL_FRAGMENTS = ("BIRTH", "DATE", "EXPI", "ISSU", "KANTOR", "KELAMIN", "KEWARGA", "LAHIR", "NATION", "NEGARA", "OFFICE", "PLACE", "SEX", "TEMPAT")
NAME_NOISE_TOKENS = {"COUNTRY", "IDN", "INDONESIA", "JENIS", "KODE", "NAME", "NEGARA", "PASPOR", "PASSPORT", "TYPE"}


def extract_visual_fields(
    file_path: str,
    page: object | None = None,
    field_names: tuple[str, ...] | None = None,
) -> dict[str, str]:
    if not configure_tesseract():
        return {}
    page = page if page is not None else extract_aligned_passport_page(file_path)
    if page is None:
        return {}
    extracted: dict[str, str] = {}
    requested_fields = (
        tuple(FIELD_CONFIG)
        if field_names is None
        else tuple(field_name for field_name in field_names if field_name in FIELD_CONFIG)
    )
    for field_name in requested_fields:
        value = _extract_field(page, field_name)
        if value:
            extracted[field_name] = value
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
        for text in scan_region_texts(region, config["psm"], config["whitelist"], variant_mode=variant_mode, max_lines=12):
            value = _clean_value(field_name, text, config["kind"])
            if _is_valid(value, field_name):
                candidates.append(value)
        if _has_stable_field_candidate(field_name, candidates):
            break
    return _pick_best_field_value(field_name, candidates)


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
        return bool(best_value and counts.get(best_value, 0) >= 2)
    return False


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
