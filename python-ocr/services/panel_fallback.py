from __future__ import annotations

import re
from datetime import date

from services.expiry_date_extractor import pick_expiry_date
from services.image_preprocessor import _load_image, detect_passport_data_page_crop, resize_to_max_edge
from services.issue_date_extractor import infer_issue_date, pick_issue_date
from services.layout_profiles import load_indonesia_panel_modes
from services.location_normalizer import is_known_location_value, pick_best_location_value
from services.name_support import repair_given_tokens, salvage_family_hints, score_name_fields, token_matches_simple
from services.panel_name_support import normalize_name_candidate, pick_best_name_candidate, score_full_name
from services.passport_page import collect_ocr_lines, crop_relative

LOW_CONFIDENCE_THRESHOLD = 0.6
MONTHS = {"JAN": 1, "FEB": 2, "MAR": 3, "APR": 4, "MAY": 5, "JUN": 6, "JUL": 7, "AUG": 8, "SEP": 9, "OCT": 10, "NOV": 11, "DEC": 12}
TEXT_FIELDS = {"placeOfBirth", "issuingOffice", "nationality", "gender"}
PANEL_OCR_MAX_EDGE = 1800
ISSUING_OFFICE_TIGHT_FOCUS_WINDOWS = (
    ((0.26, 0.52, 0.60, 1.00), True),
    ((0.30, 0.55, 0.62, 1.00), True),
    ((0.34, 0.58, 0.64, 1.00), True),
)
ISSUING_OFFICE_STANDARD_FOCUS_WINDOWS = (
    ((0.52, 0.75, 0.62, 1.00), True),
    ((0.54, 0.75, 0.68, 0.99), True),
    ((0.56, 0.76, 0.70, 0.99), True),
    ((0.58, 0.80, 0.68, 1.00), False),
    ((0.60, 0.80, 0.70, 1.00), False),
)
ISSUING_OFFICE_FOCUS_WINDOWS = ISSUING_OFFICE_STANDARD_FOCUS_WINDOWS + ISSUING_OFFICE_TIGHT_FOCUS_WINDOWS
ISSUING_OFFICE_LABEL_MARKERS = (
    "KANTORYANGMENGELUARKAN",
    "MENGELUARKAN",
    "ISSUINGOFFICE",
    "KANTOR",
    "OFFICE",
)
ISSUING_OFFICE_NOISE_FRAGMENTS = (
    "BERLAKU",
    "DATE",
    "EXPIRY",
    "EXPIBY",
    "HABIS",
    "ISSUING",
    "KANTOR",
    "MENGELUARKAN",
    "OFFICE",
)
DEFAULT_PANEL_FIELDS = (
    "fullName",
    "passportNumber",
    "nationality",
    "dob",
    "gender",
    "placeOfBirth",
    "issueDate",
    "expiryDate",
    "issuingOffice",
)
NOISE = {"COUNTRY", "FULL", "IDN", "INDONESIA", "JENIS", "KELAMIN", "KEWARGANEGARAAN", "KODE", "LENGKAP", "NAME", "NAMA", "NATIONALITY", "NEGARA", "NO", "PASPOR", "PASSPORT", "TYPE"}


def should_use_panel_fallback(extraction: dict[str, object] | None) -> bool:
    if not extraction:
        return True
    notes = str(extraction.get("notes", "") or "").upper()
    return (
        float(extraction.get("confidence", 0.0) or 0.0) < LOW_CONFIDENCE_THRESHOLD
        or "LOW PASSPORTEYE CONFIDENCE" in notes
        or "DIRECT LOWER-BAND OCR" in notes
    )


def extract_document_panel_fields(
    file_path: str,
    family_hint: str = "",
    given_hint: str = "",
    field_names: tuple[str, ...] | None = None,
    current_dob: str = "",
    current_issue_date: str = "",
    current_expiry_date: str = "",
) -> dict[str, str]:
    panel, mode = _build_panel(file_path)
    if panel is None:
        return {}
    requested = set(field_names or DEFAULT_PANEL_FIELDS)
    config = load_indonesia_panel_modes()[mode]
    fields: dict[str, str] = {}
    if "fullName" in requested:
        fields["fullName"] = _extract_name(panel, config["name"], family_hint, given_hint)
    if "passportNumber" in requested:
        fields["passportNumber"] = _extract_passport_number(panel, config["passportNumber"])
    for field_name in ("nationality", "dob", "gender", "placeOfBirth", "issuingOffice"):
        if field_name not in requested:
            continue
        value = _extract_simple_field(panel, config[field_name], field_name)
        if value:
            fields[field_name] = value
    date_field_names = tuple(field_name for field_name in ("issueDate", "expiryDate") if field_name in requested)
    if date_field_names:
        date_fields = _extract_date_fields(
            panel,
            mode,
            fields.get("dob", "") or current_dob,
            requested_fields=date_field_names,
            current_issue_date=current_issue_date,
            current_expiry_date=current_expiry_date,
        )
        fields.update({key: value for key, value in date_fields.items() if key in requested})
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
        if (
            _panel_name_matches_existing_hints(full_name, updated)
            and score_name_fields(candidate["firstName"], candidate["familyName"]) > score_name_fields(updated.get("firstName", ""), updated.get("familyName", ""))
        ):
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
    crop = detect_passport_data_page_crop(image)
    if crop is None:
        return None, "compact"
    crop = resize_to_max_edge(crop, max_edge=PANEL_OCR_MAX_EDGE)
    height, width = crop.shape[:2]
    return (crop[int(height * 0.48) : int(height * 0.98), : int(width * 0.98)], "panel") if height >= width else (crop, "compact")


def _extract_name(panel: object, windows: tuple[tuple[float, float, float, float], ...], family_hint: str, given_hint: str) -> str:
    hints = salvage_family_hints(family_hint)
    candidates: list[tuple[int, str]] = []
    for window in _prioritized_name_windows(windows, hints):
        for line in collect_ocr_lines(crop_relative(panel, *window), psm_values=(6,), whitelist="ABCDEFGHIJKLMNOPQRSTUVWXYZ ", variant_mode="fast", max_lines=8):
            cleaned = _clean_name_line(line)
            normalized = normalize_name_candidate(cleaned, hints)
            if not normalized:
                continue
            tokens = cleaned.split()
            spaced_bonus = 14 if len(tokens) >= 2 and all(len(token) >= 4 for token in tokens[:-1]) else 0
            candidates.append((score_full_name(normalized, hints) + spaced_bonus + _given_hint_bonus(normalized, given_hint), normalized))
    strong_candidate = _pick_strong_name_candidate(candidates, hints)
    if strong_candidate:
        return strong_candidate
    return pick_best_name_candidate(candidates, hints)


def _extract_passport_number(panel: object, windows: tuple[tuple[float, float, float, float], ...]) -> str:
    candidates: list[str] = []
    for window in windows:
        lines = collect_ocr_lines(
            crop_relative(panel, *window),
            psm_values=(6, 7, 8, 11),
            whitelist="ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789",
            variant_mode="fast",
            max_lines=20,
            stop_when=_has_strong_passport_candidate,
        )
        candidates.extend(_extract_passport_candidates_from_lines(lines))
        best_candidate = _best_passport_candidate(candidates)
        if re.fullmatch(r"[EX]\d{7}", best_candidate):
            return best_candidate
    return _best_passport_candidate(candidates)


def _has_strong_passport_candidate(lines: list[str]) -> bool:
    return bool(re.fullmatch(r"[EX]\d{7}", _best_passport_candidate(_extract_passport_candidates_from_lines(lines))))


def _extract_passport_candidates_from_lines(lines: list[str]) -> list[str]:
    cleaned_lines = [re.sub(r"[^A-Z0-9]", "", line.upper()) for line in lines]
    candidates: list[str] = []
    for index, cleaned in enumerate(cleaned_lines):
        for token in re.findall(r"[A-Z0-9]{7,10}", cleaned):
            candidates.extend(_expand_passport_candidates(token))
            if re.fullmatch(r"\d{7}", token):
                candidates.extend(_neighbor_prefixed_passports(cleaned_lines, index, token))
            if re.fullmatch(r"\d{7}[EX]", token):
                candidates.append(token[-1] + token[:7])
    return candidates


def _neighbor_prefixed_passports(lines: list[str], index: int, digits: str) -> list[str]:
    candidates: list[str] = []
    for neighbor_index in (index - 1, index + 1):
        if not 0 <= neighbor_index < len(lines):
            continue
        if lines[neighbor_index] in {"E", "X"}:
            candidates.append(lines[neighbor_index] + digits)
    return candidates


def _extract_simple_field(panel: object, windows: tuple[tuple[float, float, float, float], ...], field_name: str) -> str:
    whitelist = "ABCDEFGHIJKLMNOPQRSTUVWXYZ " if field_name in TEXT_FIELDS else "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ "
    candidates: list[str] = []
    if field_name == "issuingOffice":
        focused_value = _extract_issuing_office_focus(panel, allow_value_only=False)
        if focused_value:
            return focused_value
    for psm_values in _simple_field_psm_passes(field_name):
        for window in windows:
            for line in collect_ocr_lines(
                crop_relative(panel, *window),
                psm_values=psm_values,
                whitelist=whitelist,
                variant_mode="fast",
                max_lines=8,
                stop_when=_simple_field_stop_when(field_name),
            ):
                value = _clean_field(field_name, line)
                if value:
                    candidates.append(value)
            stable_candidate = _pick_stable_simple_field(field_name, candidates)
            if stable_candidate:
                return stable_candidate
    if field_name == "dob":
        return min(candidates, default="")
    if field_name in {"placeOfBirth", "issuingOffice"}:
        focused_value = _extract_issuing_office_focus(panel) if field_name == "issuingOffice" else ""
        return focused_value or pick_best_location_value(field_name, candidates)
    return max(set(candidates), key=lambda value: (candidates.count(value), len(value))) if candidates else ""


def _extract_issuing_office_focus(panel: object, allow_value_only: bool = True) -> str:
    candidates: list[str] = []
    for window, requires_label in _issuing_office_focus_windows(panel):
        if not requires_label and not allow_value_only:
            continue
        region = crop_relative(panel, *window)
        if region is None:
            continue
        for psm_values in ((6,), (7,), (11,)):
            lines = collect_ocr_lines(
                region,
                psm_values=psm_values,
                whitelist="ABCDEFGHIJKLMNOPQRSTUVWXYZ ",
                variant_mode="fast",
                max_lines=10,
                stop_when=_issuing_office_focus_stop_when(requires_label),
            )
            for text in _issuing_office_focus_texts(lines, requires_label):
                value = pick_best_location_value("issuingOffice", [_clean_issuing_office_candidate(text)])
                if value and is_known_location_value("issuingOffice", value):
                    candidates.append(value)
            stable = _pick_stable_simple_field("issuingOffice", candidates)
            if stable:
                return stable
    return pick_best_location_value("issuingOffice", candidates)


def _issuing_office_focus_windows(panel: object) -> tuple[tuple[tuple[float, float, float, float], bool], ...]:
    height, width = getattr(panel, "shape", (0, 0))[:2]
    if height and width and (height < 560 or height / max(width, 1) < 0.55):
        return ISSUING_OFFICE_TIGHT_FOCUS_WINDOWS + ISSUING_OFFICE_STANDARD_FOCUS_WINDOWS
    return ISSUING_OFFICE_STANDARD_FOCUS_WINDOWS + ISSUING_OFFICE_TIGHT_FOCUS_WINDOWS


def _issuing_office_focus_stop_when(requires_label: bool) -> object:
    def stop_when(lines: list[str]) -> bool:
        for text in _issuing_office_focus_texts(lines, requires_label):
            value = pick_best_location_value("issuingOffice", [_clean_issuing_office_candidate(text)])
            if value and is_known_location_value("issuingOffice", value):
                return True
        return False

    return stop_when


def _issuing_office_focus_texts(lines: list[str], requires_label: bool) -> list[str]:
    candidates: list[str] = []
    label_seen = not requires_label
    for line in lines:
        tail = _issuing_office_label_tail(line)
        has_marker = bool(tail) or _has_issuing_office_label(line)
        if tail:
            candidates.append(tail)
        if has_marker:
            label_seen = True
            continue
        if label_seen:
            candidates.append(line)
    return _unique_texts(candidates)


def _issuing_office_label_tail(value: str) -> str:
    compact = re.sub(r"[^A-Z]", "", str(value or "").upper())
    for marker in ISSUING_OFFICE_LABEL_MARKERS:
        marker_index = compact.find(marker)
        if marker_index < 0:
            continue
        tail = compact[marker_index + len(marker) :]
        return tail if len(tail) >= 4 else ""
    return ""


def _has_issuing_office_label(value: str) -> bool:
    compact = re.sub(r"[^A-Z]", "", str(value or "").upper())
    return any(marker in compact for marker in ISSUING_OFFICE_LABEL_MARKERS)


def _clean_issuing_office_candidate(value: str) -> str:
    return " ".join(
        token
        for token in _clean_text(value).split()
        if not any(fragment in token for fragment in ISSUING_OFFICE_NOISE_FRAGMENTS)
    )


def _unique_texts(values: list[str]) -> list[str]:
    unique: list[str] = []
    seen: set[str] = set()
    for value in values:
        cleaned = str(value or "").strip()
        if not cleaned or cleaned in seen:
            continue
        unique.append(cleaned)
        seen.add(cleaned)
    return unique


def _extract_date_fields(
    panel: object,
    mode: str,
    dob: str = "",
    requested_fields: tuple[str, ...] = ("issueDate", "expiryDate"),
    current_issue_date: str = "",
    current_expiry_date: str = "",
) -> dict[str, str]:
    config = load_indonesia_panel_modes()[mode]
    requested = set(requested_fields)
    issue_candidates = _collect_date_candidates(panel, config["issueDate"]) if "issueDate" in requested else []
    expiry_candidates = _collect_date_candidates(panel, config["expiryDate"]) if "expiryDate" in requested else []
    shared_candidates = _unique_dates(issue_candidates + expiry_candidates)
    expiry = (
        current_expiry_date
        if _is_iso_date(current_expiry_date) and "expiryDate" not in requested
        else pick_expiry_date(expiry_candidates or shared_candidates, dob=dob)
    )
    issue = (
        current_issue_date
        if _is_iso_date(current_issue_date) and "issueDate" not in requested
        else pick_issue_date(issue_candidates + expiry_candidates, dob, expiry)
    )
    fields = {}
    if "expiryDate" in requested:
        fields["expiryDate"] = expiry
    if "issueDate" in requested:
        fields["issueDate"] = issue or infer_issue_date(dob, expiry)
    return {key: value for key, value in fields.items() if value}


def _is_iso_date(value: str) -> bool:
    try:
        date.fromisoformat(str(value or ""))
        return True
    except ValueError:
        return False


def _collect_date_candidates(panel: object, windows: tuple[tuple[float, float, float, float], ...]) -> list[str]:
    candidates: list[str] = []
    for window in windows:
        for line in collect_ocr_lines(crop_relative(panel, *window), psm_values=(6, 7), whitelist="0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ ", variant_mode="fast", max_lines=10):
            value = _clean_date(line)
            if value:
                candidates.append(value)
        if candidates:
            return candidates
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
    if len(tokens) == 1:
        return {"firstName": tokens[0], "familyName": tokens[0]}
    first_tokens = repair_given_tokens(tokens[:-1])
    return {"firstName": " ".join(first_tokens), "familyName": tokens[-1]}


def _panel_name_matches_existing_hints(full_name: str, parsed: dict[str, str]) -> bool:
    family_hints = salvage_family_hints(parsed.get("familyName", ""))
    if not family_hints:
        return True
    tokens = re.sub(r"[^A-Z\s]", " ", full_name.upper()).split()
    return any(token_matches_simple(token, hint) for token in tokens for hint in family_hints)


def _prioritized_name_windows(windows: tuple[tuple[float, float, float, float], ...], hints: list[str]) -> tuple[tuple[float, float, float, float], ...]:
    if not hints or len(windows) < 3:
        return windows
    return (windows[-1], *windows[:-1])


def _pick_strong_name_candidate(candidates: list[tuple[int, str]], hints: list[str]) -> str:
    if not candidates or not hints:
        return ""
    candidate = pick_best_name_candidate(candidates, hints)
    tokens = candidate.split()
    if len(tokens) < 2:
        return candidate if tokens and any(token_matches_simple(tokens[-1], hint) for hint in hints) else ""
    if not any(token_matches_simple(tokens[-1], hint) for hint in hints):
        return ""
    best_score = max((score for score, name in candidates if name == candidate), default=-10_000)
    threshold = 70 if len(tokens) == 1 else 160
    return candidate if best_score >= threshold else ""


def _pick_stable_simple_field(field_name: str, candidates: list[str]) -> str:
    if not candidates:
        return ""
    if field_name in {"placeOfBirth", "issuingOffice"}:
        value = pick_best_location_value(field_name, candidates)
        return value if value and is_known_location_value(field_name, value) else ""
    if field_name == "nationality" and "INDONESIA" in candidates:
        return "INDONESIA"
    if field_name == "gender":
        return candidates[0] if candidates.count(candidates[0]) >= 2 else ""
    return ""


def _simple_field_psm_passes(field_name: str) -> tuple[tuple[int, ...], ...]:
    if field_name in {"placeOfBirth", "issuingOffice"}:
        return ((6,), (11,), (7,))
    return ((6, 7),)


def _simple_field_stop_when(field_name: str) -> object | None:
    if field_name not in {"placeOfBirth", "issuingOffice", "nationality"}:
        return None

    def stop_when(lines: list[str]) -> bool:
        candidates = []
        for line in lines:
            value = _clean_field(field_name, line)
            if value:
                candidates.append(value)
        return bool(_pick_stable_simple_field(field_name, candidates))

    return stop_when


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
    scored = [
        ((20 if re.fullmatch(r"[EX]\d{7}", candidate) else 10) + min(candidates.count(candidate), 5), candidate)
        for candidate in candidates
        if re.fullmatch(r"[EX]?\d{7,8}", candidate)
    ]
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
    scores = []
    for hint in re.sub(r"[^A-Z\s]", " ", given_hint.upper()).split():
        if len(hint) < 3:
            continue
        scores.append(22 if first_token == hint else 10 if first_token.startswith(hint[:4]) or hint.startswith(first_token[:4]) else 0)
    return max(scores, default=0)


def _unique_dates(values: list[str]) -> list[str]:
    seen: set[str] = set()
    unique_values: list[str] = []
    for value in values:
        if value and value not in seen:
            unique_values.append(value)
            seen.add(value)
    return unique_values
