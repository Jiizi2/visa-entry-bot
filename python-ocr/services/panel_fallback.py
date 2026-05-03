from __future__ import annotations

import re
from datetime import date

from services.expiry_date_extractor import pick_expiry_date
from services.image_preprocessor import _load_image, detect_document_crop
from services.issue_date_extractor import infer_issue_date, pick_issue_date
from services.location_normalizer import pick_best_location_value
from services.name_support import salvage_family_hints, score_name_fields
from services.panel_name_support import normalize_name_candidate, pick_best_name_candidate, score_full_name
from services.passport_page import collect_ocr_lines, crop_relative

LOW_CONFIDENCE_THRESHOLD = 0.6
MONTHS = {"JAN": 1, "FEB": 2, "MAR": 3, "APR": 4, "MAY": 5, "JUN": 6, "JUL": 7, "AUG": 8, "SEP": 9, "OCT": 10, "NOV": 11, "DEC": 12}
MODES = {
    "compact": {
        "name": ((0.24, 0.34, 0.36, 0.82), (0.22, 0.30, 0.38, 0.80), (0.18, 0.30, 0.34, 0.86)),
        "passportNumber": ((0.14, 0.26, 0.72, 0.98), (0.16, 0.28, 0.70, 0.98), (0.12, 0.24, 0.70, 0.98)),
        "nationality": ((0.34, 0.48, 0.34, 0.62),),
        "dob": ((0.48, 0.62, 0.30, 0.54),),
        "gender": ((0.48, 0.62, 0.56, 0.68),),
        "placeOfBirth": ((0.48, 0.62, 0.74, 0.98),),
        "issueDate": ((0.60, 0.76, 0.28, 0.56),),
        "expiryDate": ((0.60, 0.76, 0.72, 0.98),),
        "issuingOffice": ((0.72, 0.94, 0.70, 0.99),),
    },
    "panel": {
        "name": ((0.20, 0.30, 0.22, 0.82), (0.18, 0.28, 0.22, 0.82), (0.22, 0.32, 0.20, 0.84)),
        "passportNumber": ((0.14, 0.28, 0.68, 0.98), (0.10, 0.24, 0.70, 0.98), (0.12, 0.26, 0.68, 0.98)),
        "nationality": ((0.32, 0.44, 0.22, 0.58),),
        "dob": ((0.44, 0.58, 0.22, 0.50),),
        "gender": ((0.44, 0.58, 0.50, 0.62),),
        "placeOfBirth": ((0.44, 0.58, 0.72, 0.98),),
        "issueDate": ((0.58, 0.72, 0.22, 0.50),),
        "expiryDate": ((0.58, 0.72, 0.72, 0.98),),
        "issuingOffice": ((0.58, 0.78, 0.68, 0.99), (0.72, 0.96, 0.70, 0.99)),
    },
}
TEXT_FIELDS = {"placeOfBirth", "issuingOffice", "nationality", "gender"}
NOISE = {"COUNTRY", "FULL", "IDN", "INDONESIA", "JENIS", "KELAMIN", "KEWARGANEGARAAN", "KODE", "LENGKAP", "NAME", "NAMA", "NATIONALITY", "NEGARA", "NO", "PASPOR", "PASSPORT", "TYPE"}


def should_use_panel_fallback(extraction: dict[str, object] | None) -> bool:
    if not extraction:
        return True
    notes = str(extraction.get("notes", "") or "").upper()
    return float(extraction.get("confidence", 0.0) or 0.0) < LOW_CONFIDENCE_THRESHOLD or "LOW PASSPORTEYE CONFIDENCE" in notes


def extract_document_panel_fields(file_path: str, family_hint: str = "", given_hint: str = "") -> dict[str, str]:
    panel, mode = _build_panel(file_path)
    if panel is None:
        return {}
    config = MODES[mode]
    fields = {"fullName": _extract_name(panel, config["name"], family_hint, given_hint), "passportNumber": _extract_passport_number(panel, config["passportNumber"])}
    for field_name in ("nationality", "dob", "gender", "placeOfBirth", "issuingOffice"):
        value = _extract_simple_field(panel, config[field_name], field_name)
        if value:
            fields[field_name] = value
    fields.update(_extract_date_fields(panel, mode, fields.get("dob", "")))
    return {key: value for key, value in fields.items() if value}


def fuse_panel_fields(parsed: dict[str, str], extraction: dict[str, object] | None, panel_fields: dict[str, str]) -> tuple[dict[str, str], str]:
    if not panel_fields:
        return parsed, ""
    updated = dict(parsed)
    notes: list[str] = []
    current_passport = str(updated.get("passportNumber", "") or "")
    repaired_passport = _repair_passport_number(current_passport, extraction, panel_fields.get("passportNumber", ""))
    if repaired_passport and repaired_passport != current_passport:
        updated["passportNumber"] = repaired_passport
        notes.append("PASSPORT NUMBER RECOVERED FROM DOCUMENT PANEL")
    full_name = panel_fields.get("fullName", "")
    if full_name:
        candidate = _split_full_name(full_name)
        if score_name_fields(candidate["firstName"], candidate["familyName"]) > score_name_fields(updated.get("firstName", ""), updated.get("familyName", "")):
            updated.update(candidate)
            notes.append("NAME RECOVERED FROM DOCUMENT PANEL")
    if panel_fields.get("nationality") == "INDONESIA" and updated.get("nationality") != "INDONESIA":
        updated["nationality"] = "INDONESIA"
        notes.append("NATIONALITY RECOVERED FROM DOCUMENT PANEL")
    for field_name in ("dob", "gender", "issueDate", "expiryDate"):
        if _prefer_panel_value(updated.get(field_name, ""), panel_fields.get(field_name, "")):
            updated[field_name] = panel_fields[field_name]
            notes.append(f"{field_name.upper()} RECOVERED FROM DOCUMENT PANEL")
    return updated, "; ".join(notes)


def _build_panel(file_path: str) -> tuple[object | None, str]:
    image = _load_image(file_path)
    crop = detect_document_crop(image)
    if crop is None:
        return None, "compact"
    height, width = crop.shape[:2]
    return (crop[int(height * 0.48) : int(height * 0.98), : int(width * 0.98)], "panel") if height >= width else (crop, "compact")


def _extract_name(panel: object, windows: tuple[tuple[float, float, float, float], ...], family_hint: str, given_hint: str) -> str:
    hints = salvage_family_hints(family_hint)
    candidates: list[tuple[int, str]] = []
    for window in windows:
        for line in collect_ocr_lines(crop_relative(panel, *window), psm_values=(6, 7, 8), whitelist="ABCDEFGHIJKLMNOPQRSTUVWXYZ ", variant_mode="fast", max_lines=8):
            cleaned = _clean_name_line(line)
            normalized = normalize_name_candidate(cleaned, hints)
            if not normalized:
                continue
            tokens = cleaned.split()
            spaced_bonus = 14 if len(tokens) >= 2 and all(len(token) >= 4 for token in tokens[:-1]) else 0
            candidates.append((score_full_name(normalized, hints) + spaced_bonus + _given_hint_bonus(normalized, given_hint), normalized))
    return pick_best_name_candidate(candidates, hints)


def _extract_passport_number(panel: object, windows: tuple[tuple[float, float, float, float], ...]) -> str:
    candidates: list[str] = []
    for window in windows:
        for line in collect_ocr_lines(crop_relative(panel, *window), psm_values=(6, 7, 8), whitelist="ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789", variant_mode="fast", max_lines=8):
            for token in re.findall(r"[A-Z0-9]{7,10}", re.sub(r"[^A-Z0-9]", "", line.upper())):
                candidates.extend(_expand_passport_candidates(token))
    return _best_passport_candidate(candidates)


def _extract_simple_field(panel: object, windows: tuple[tuple[float, float, float, float], ...], field_name: str) -> str:
    whitelist = "ABCDEFGHIJKLMNOPQRSTUVWXYZ " if field_name in TEXT_FIELDS else "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ "
    candidates: list[str] = []
    for window in windows:
        for line in collect_ocr_lines(crop_relative(panel, *window), psm_values=(6, 7), whitelist=whitelist, variant_mode="fast", max_lines=8):
            value = _clean_field(field_name, line)
            if value:
                candidates.append(value)
    if field_name == "dob":
        return min(candidates, default="")
    if field_name in {"placeOfBirth", "issuingOffice"}:
        return pick_best_location_value(field_name, candidates)
    return max(set(candidates), key=lambda value: (candidates.count(value), len(value))) if candidates else ""


def _extract_date_fields(panel: object, mode: str, dob: str = "") -> dict[str, str]:
    config = MODES[mode]
    issue_candidates = _collect_date_candidates(panel, config["issueDate"])
    expiry_candidates = _collect_date_candidates(panel, config["expiryDate"])
    shared_candidates = _unique_dates(issue_candidates + expiry_candidates)
    expiry = pick_expiry_date(expiry_candidates or shared_candidates, dob=dob)
    issue = pick_issue_date(issue_candidates + expiry_candidates, dob, expiry)
    fields = {"expiryDate": expiry, "issueDate": issue or infer_issue_date(dob, expiry)}
    return {key: value for key, value in fields.items() if value}


def _collect_date_candidates(panel: object, windows: tuple[tuple[float, float, float, float], ...]) -> list[str]:
    candidates: list[str] = []
    for window in windows:
        for line in collect_ocr_lines(crop_relative(panel, *window), psm_values=(6, 7), whitelist="0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ ", variant_mode="fast", max_lines=10):
            value = _clean_date(line)
            if value:
                candidates.append(value)
    return candidates


def _clean_field(field_name: str, value: str) -> str:
    if field_name == "dob":
        return _clean_date(value)
    if field_name == "gender":
        return _clean_panel_gender(value)
    if field_name == "nationality":
        return _clean_panel_country(value)
    return _clean_text(value)


def _clean_panel_gender(value: str) -> str:
    normalized = re.sub(r"[^A-Z]", "", str(value or "").upper())
    if not normalized or len(normalized) > 4:
        return "MALE" if normalized == "MALE" else "FEMALE" if normalized == "FEMALE" else ""
    if normalized.startswith(("L", "LM", "ML", "M")):
        return "MALE"
    return "FEMALE" if normalized.startswith(("P", "PF", "FP", "PI", "F")) else ""


def _clean_panel_country(value: str) -> str:
    normalized = re.sub(r"[^A-Z]", "", str(value or "").upper())
    return "INDONESIA" if normalized in {"IDN", "INDONESIA"} or "INDONESIA" in normalized else ""


def _clean_name_line(value: str) -> str:
    return " ".join(token for token in _clean_text(value).split() if token not in NOISE)


def _clean_text(value: str) -> str:
    normalized = re.sub(r"[^A-Z\s]", " ", str(value or "").upper())
    return " ".join(token for token in normalized.split() if len(token) >= 2 and token not in NOISE)


def _clean_date(value: str) -> str:
    match = re.search(r"(\d{1,2})\s*([A-Z]{3})\s*(\d{4})", re.sub(r"[^A-Z0-9]", " ", str(value or "").upper()))
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


def _split_full_name(full_name: str) -> dict[str, str]:
    tokens = full_name.split()
    return {"firstName": tokens[0], "familyName": tokens[0]} if len(tokens) == 1 else {"firstName": " ".join(tokens[:-1]), "familyName": tokens[-1]}


def _repair_passport_number(current: str, extraction: dict[str, object] | None, visual: str) -> str:
    candidates = _expand_passport_candidates(current) + _expand_passport_candidates(visual)
    line2 = _extract_line2(extraction)
    check_digit = line2[9] if _has_trustworthy_line2(line2) and len(line2) > 9 and line2[9].isdigit() else ""
    if line2:
        candidates.extend(_expand_passport_candidates(line2[:9]))
    scored = []
    for candidate in candidates:
        if not re.fullmatch(r"[EX]\d{7}", candidate):
            continue
        score = 50 + (candidate == visual) * 15 + (candidate == current) * 10
        if check_digit and _mrz_check_digit(candidate + "<") == check_digit:
            score += 40
        if current.isdigit():
            score += 18 if candidate[1:] == current[1:] else 16 if candidate[1:] == current[:-1] else 0
        if current and current[-6:] == candidate[-6:]:
            score += 8
        score += max(0, candidates.count(candidate) - 1) * 10
        scored.append((score, candidate))
    return max(scored, default=(0, current), key=lambda item: item[0])[1]


def _expand_passport_candidates(value: str) -> list[str]:
    cleaned = re.sub(r"[^A-Z0-9]", "", str(value or "").upper())
    if not cleaned:
        return []
    variants = {cleaned}
    if len(cleaned) == 9 and cleaned[0].isdigit() and cleaned[1].isalpha():
        variants.add(cleaned[1:])
    if len(cleaned) == 8 and cleaned[0].isdigit() and cleaned[1:].isdigit():
        variants.update(prefix + cleaned[1:] for prefix in ("E", "X"))
        variants.update(prefix + cleaned[:-1] for prefix in ("E", "X"))
    if len(cleaned) == 7 and cleaned.isdigit():
        variants.update(prefix + cleaned for prefix in ("E", "X"))
    normalized: set[str] = set()
    for variant in variants:
        if len(variant) > 8 and re.search(r"[EX]\d{7}", variant):
            normalized.add(re.search(r"[EX]\d{7}", variant).group(0))
        if len(variant) == 8 and variant[0] in {"E", "X"}:
            for digits in _expand_ambiguous_digits(variant[1:]):
                normalized.add(variant[0] + digits)
        if len(variant) == 7 and variant.isdigit():
            normalized.add(variant)
    return sorted(normalized)


def _expand_ambiguous_digits(value: str) -> list[str]:
    choices, results = {"O": "0", "Q": "02", "D": "0", "I": "1", "L": "1", "S": "5", "B": "8", "Z": "2", "G": "6"}, [""]
    for char in value:
        digits = choices.get(char, char if char.isdigit() else "")
        if not digits:
            return []
        results = [prefix + digit for prefix in results for digit in digits][:16]
    return results


def _best_passport_candidate(candidates: list[str]) -> str:
    scored = [(20 if re.fullmatch(r"[EX]\d{7}", candidate) else 10, candidate) for candidate in candidates if re.fullmatch(r"[EX]?\d{7,8}", candidate)]
    return max(scored, default=(0, ""), key=lambda item: item[0])[1]


def _extract_line2(extraction: dict[str, object] | None) -> str:
    data = extraction.get("data", {}) if extraction else {}
    candidates: list[str] = []
    for key in ("line2", "raw_text", "mrz_text", "text"):
        lines = [re.sub(r"[^A-Z0-9<]", "", line.upper())[:44].ljust(44, "<") for line in str(data.get(key, "") or "").splitlines()]
        lines = [line for line in lines if len(line.replace("<", "")) >= 20]
        if key == "line2" and lines:
            return lines[-1]
        candidates.extend(lines[-2:])
    return max(candidates, default="", key=lambda line: (sum(char.isdigit() for char in line), line.count("<")))


def _has_trustworthy_line2(line2: str) -> bool:
    return bool(line2) and len(line2) >= 10 and line2[0] in {"E", "X"} and line2[1:8].isdigit()


def _mrz_check_digit(value: str) -> str:
    return str(sum(_mrz_char_value(char) * (7, 3, 1)[index % 3] for index, char in enumerate(value)) % 10)


def _mrz_char_value(char: str) -> int:
    return 0 if char == "<" else int(char) if char.isdigit() else ord(char) - 55


def _prefer_panel_value(current: str, candidate: str) -> bool:
    return bool(candidate) and (not current or current == "ID" or current == "DNI")


def _given_hint_bonus(value: str, given_hint: str) -> int:
    if not given_hint:
        return 0
    first_token = value.split()[0]
    return 22 if first_token == given_hint else 10 if first_token.startswith(given_hint[:4]) or given_hint.startswith(first_token[:4]) else 0


def _unique_dates(values: list[str]) -> list[str]:
    seen: set[str] = set()
    unique_values: list[str] = []
    for value in values:
        if value and value not in seen:
            unique_values.append(value)
            seen.add(value)
    return unique_values
