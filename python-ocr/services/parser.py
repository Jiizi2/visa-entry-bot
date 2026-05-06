from __future__ import annotations

import re
from datetime import date, datetime
from typing import Any

COUNTRY_NAMES = {
    "IDN": "INDONESIA",
    "ARE": "UNITED ARAB EMIRATES",
    "EGY": "EGYPT",
    "GBR": "UNITED KINGDOM",
    "IND": "INDIA",
    "MYS": "MALAYSIA",
    "PAK": "PAKISTAN",
    "QAT": "QATAR",
    "SAU": "SAUDI ARABIA",
    "SGP": "SINGAPORE",
    "TUR": "TURKIYE",
    "USA": "UNITED STATES",
}


def parse_mrz_data(data: dict[str, Any]) -> dict[str, str]:
    line_values = _parse_line_fields(data)
    first_name = _pick_best_name(
        clean_name(_pick(data, "names", "given_names", "firstName")),
        line_values["firstName"],
        allow_multi=True,
    )
    family_name = _pick_best_name(
        clean_name(_pick(data, "surname", "last_name", "familyName")),
        line_values["familyName"],
    )

    return {
        "firstName": first_name,
        "familyName": family_name,
        "passportNumber": _pick_best_document(clean_document(_pick(data, "number", "passport_number")), line_values["passportNumber"]),
        "nationality": clean_country(_pick(data, "nationality")) or line_values["nationality"],
        "dob": format_date(_pick(data, "date_of_birth", "dob"), "birth") or line_values["dob"],
        "issueDate": format_date(_pick(data, "date_of_issue", "issue_date"), "issue"),
        "expiryDate": format_date(_pick(data, "expiration_date", "expiry_date"), "expiry")
        or line_values["expiryDate"],
        "gender": line_values["gender"] or clean_gender(_pick(data, "sex", "gender")),
    }


def format_date(value: Any, date_type: str = "birth") -> str:
    if value is None:
        return ""
    if isinstance(value, datetime):
        return value.date().isoformat()
    if isinstance(value, date):
        return value.isoformat()

    text = re.sub(r"[^0-9-]", "", str(value).strip())
    if not text:
        return ""
    if re.fullmatch(r"\d{4}-\d{2}-\d{2}", text):
        try:
            return datetime.strptime(text, "%Y-%m-%d").date().isoformat()
        except ValueError:
            return ""
    if re.fullmatch(r"\d{6}", text):
        return _expand_date(text, date_type)
    return ""


def clean_name(value: Any) -> str:
    if value is None:
        return ""
    text = str(value).replace("<", " ")
    tokens = [_normalize_name_token(token) for token in re.sub(r"\s+", " ", text).strip().upper().split()]
    return " ".join(token for token in tokens if token)


def clean_document(value: Any) -> str:
    if value is None:
        return ""
    return _repair_document_ocr_noise(re.sub(r"[^A-Z0-9]", "", str(value).upper()))


def clean_country(value: Any) -> str:
    if value is None:
        return ""
    country_code = _normalize_country_code(re.sub(r"[^A-Z0-9]", "", str(value).upper()))
    return COUNTRY_NAMES.get(country_code, country_code)


def clean_gender(value: Any) -> str:
    if value is None:
        return ""
    gender = str(value).strip().upper()
    if gender.startswith("M"):
        return "MALE"
    if gender.startswith("F"):
        return "FEMALE"
    return ""


def _pick_best_name(primary: str, fallback: str, allow_multi: bool = False) -> str:
    primary_score = _score_name(primary, allow_multi)
    fallback_score = _score_name(fallback, allow_multi)
    if fallback_score > primary_score:
        return fallback
    return primary or fallback


def _pick_best_document(primary: str, fallback: str) -> str:
    primary = clean_document(primary)
    fallback = clean_document(fallback)
    primary_valid = _is_passport_number(primary)
    fallback_valid = _is_passport_number(fallback)
    if fallback_valid and not primary_valid:
        return fallback
    return primary or fallback


def _pick(data: dict[str, Any], *keys: str) -> Any:
    for key in keys:
        value = data.get(key)
        if value not in (None, "") and str(value).strip():
            return value
    return None


def _parse_line_fields(data: dict[str, Any]) -> dict[str, str]:
    empty = {
        "firstName": "",
        "familyName": "",
        "passportNumber": "",
        "nationality": "",
        "dob": "",
        "issueDate": "",
        "expiryDate": "",
        "gender": "",
    }
    line_pair = _extract_mrz_line_pair(data)
    if line_pair is None:
        return empty

    line1, line2 = line_pair
    surname, names = _split_name_section(line1[5:44])
    empty["firstName"] = clean_name(names)
    empty["familyName"] = clean_name(surname)
    empty["passportNumber"] = clean_document(line2[0:9])
    empty["nationality"] = clean_country(line2[10:13])
    empty["dob"] = format_date(line2[13:19], "birth")
    empty["gender"] = clean_gender(line2[20])
    empty["expiryDate"] = format_date(line2[21:27], "expiry")
    return empty


def _extract_mrz_line_pair(data: dict[str, Any]) -> tuple[str, str] | None:
    explicit_line1 = _clean_mrz_line(data.get("line1"))
    explicit_line2 = _repair_line2_ocr_confusions(_clean_mrz_line(data.get("line2")))
    if _looks_like_line1(explicit_line1) and _looks_like_line2(explicit_line2):
        return explicit_line1, explicit_line2

    lines = _extract_lines(data)
    if _looks_like_line2(explicit_line2):
        for line1 in lines:
            if _looks_like_line1(line1):
                return line1, explicit_line2
    for index in range(len(lines) - 1):
        line1, line2 = lines[index], _repair_line2_ocr_confusions(lines[index + 1])
        if _looks_like_line1(line1) and _looks_like_line2(line2):
            return line1, line2
    return None


def _extract_lines(data: dict[str, Any]) -> list[str]:
    raw_lines: list[str] = []
    for key in ("mrz_text", "raw_text", "text"):
        value = data.get(key)
        if value is None:
            continue
        if isinstance(value, (list, tuple)):
            raw_lines.extend(str(item) for item in value)
        else:
            raw_lines.extend(str(value).splitlines())

    cleaned_lines = []
    for line in raw_lines:
        cleaned = _clean_mrz_line(line)
        if cleaned and "<" in cleaned:
            cleaned_lines.append(cleaned)
    return cleaned_lines


def _split_name_section(value: str) -> tuple[str, str]:
    value = _repair_name_separator_noise(value)
    if "<<" not in value:
        if value.count("<") == 1:
            family_name, first_name = value.split("<", 1)
            repaired_family = _repair_noisy_direct_name_token(family_name)
            repaired_first = _repair_noisy_direct_given_names(first_name)
            if repaired_family and repaired_first:
                return repaired_family, repaired_first
        return value.split("<", 1)[0], ""
    family_name, first_name = value.split("<<", 1)
    if "<" in family_name:
        return family_name.split("<", 1)[0], ""
    return family_name, first_name.replace("<<", " ")


def _repair_name_separator_noise(value: str) -> str:
    return re.sub(r"<K<(?=[A-Z]{3})", "<<", value)


def _repair_noisy_direct_name_token(value: str) -> str:
    token = re.sub(r"[^A-Z]", "", str(value or "").upper())
    for suffix in ("SK", "KS", "KK", "KE"):
        if len(token) > len(suffix) + 3 and token.endswith(suffix) and _has_name_shape(token[: -len(suffix)]):
            return token[: -len(suffix)]
    return token


def _repair_noisy_direct_given_names(value: str) -> str:
    token = re.sub(r"[^A-Z]", "", str(value or "").upper())
    if not token:
        return ""
    token = re.split(r"S{3,}|N{2,}|R{2,}", token, maxsplit=1)[0] or token
    variants = [token]
    if len(token) >= 5 and token[0] in {"N", "S"} and token[1] in "AEIOUY":
        variants.append(token[1:])

    embedded_separator = _repair_embedded_direct_name_separator(variants)
    if embedded_separator:
        return embedded_separator

    best_value = ""
    best_score = -10_000
    for variant in variants:
        for candidate in _noisy_given_name_candidates(variant):
            score = _score_noisy_given_name(candidate)
            if score > best_score:
                best_value, best_score = candidate, score
    return best_value if best_score > 0 else token


def _repair_embedded_direct_name_separator(variants: list[str]) -> str:
    best_value = ""
    best_score = -10_000
    for variant in variants:
        for index in range(3, len(variant) - 3):
            left = variant[:index]
            right = variant[index:]
            if len(right) < 4 or right[0] not in {"N", "S"} or right[1] not in "AEIOUY":
                continue
            right = right[1:]
            if not (3 <= len(right) <= 12 and _has_name_shape(left) and _has_name_shape(right)):
                continue
            score = 50 - abs(len(left) - 6) * 2 - abs(len(right) - 5) * 2
            if len(left) >= 5 and left[0] in {"N", "S"} and left[1] in "AEIOUY":
                score -= 12
            if len(left) >= 6 and left.endswith(("K", "S")):
                score -= 8
            if score > best_score:
                best_value, best_score = f"{left} {right}", score
    return best_value if best_score > 0 else ""


def _noisy_given_name_candidates(value: str) -> list[str]:
    candidates = [value]
    for index in range(3, len(value) - 2):
        left = value[:index]
        right = value[index:]
        candidates.append(f"{left} {right}")
        if len(right) >= 4 and right[0] in {"N", "S"} and right[1] in "AEIOUY":
            candidates.append(f"{left} {right[1:]}")
    return candidates


def _score_noisy_given_name(value: str) -> int:
    tokens = value.split()
    if not tokens or len(tokens) > 3:
        return -10_000
    if any(not (3 <= len(token) <= 12 and _has_name_shape(token)) for token in tokens):
        return -10_000
    score = sum(len(token) + sum(char in "AEIOUY" for char in token) * 2 for token in tokens)
    if len(tokens) >= 2:
        score += 12
    for token in tokens:
        if len(token) >= 6 and token.endswith(("K", "S")):
            score -= 6
        if len(token) >= 5 and token[0] in {"N", "S"} and token[1] in "AEIOUY":
            score -= 4
    return score


def _score_name(value: str, allow_multi: bool) -> int:
    cleaned = clean_name(value)
    if not cleaned:
        return -10_000
    tokens = cleaned.split()
    letters = "".join(tokens)
    vowels = sum(char in "AEIOUY" for char in letters)
    score = len(letters) + vowels
    if len(tokens) > (4 if allow_multi else 2):
        score -= 8
    if any(len(token) > 12 for token in tokens):
        score -= 6
    if re.search(r"(.)\1{2,}", letters):
        score -= 24
    if letters.count("K") >= max(4, len(letters) // 3):
        score -= 16
    if any(sum(char in "AEIOUY" for char in token) == 0 for token in tokens):
        score -= 6
    if any(len(set(token)) <= 2 and len(token) >= 4 for token in tokens):
        score -= 8
    return score


def _normalize_name_token(token: str) -> str:
    normalized = re.sub(r"[^A-Z]", "", str(token or "").upper())
    normalized = _repair_name_particle_noise(normalized)
    normalized = _strip_name_token_suffix_noise(normalized)
    if len(normalized) == 1 and normalized not in {"A", "I", "M", "U"}:
        return ""
    if len(normalized) >= 3 and not any(char in "AEIOUY" for char in normalized) and normalized.count("K") >= 2:
        return ""
    if normalized and set(normalized) == {"K"}:
        return ""
    if len(normalized) >= 6 and normalized.count("K") >= 3 and normalized.count("S") >= 2:
        return ""
    if len(normalized) >= 4 and normalized.count("K") >= 3 and set(normalized) <= {"E", "K", "S"}:
        return ""
    if len(normalized) >= 4 and set(normalized) <= {"S", "K"} and normalized.count("K") >= 3:
        return ""
    if len(normalized) >= 3 and set(normalized) <= {"E", "K"}:
        return ""
    if normalized.startswith("DUI") and len(normalized) >= 6:
        normalized = "DJU" + normalized[3:]
    if normalized.startswith("DIU") and len(normalized) >= 6:
        normalized = "DJU" + normalized[3:]
    if normalized.startswith("DJUU") and len(normalized) >= 6:
        normalized = "DJU" + normalized[4:]
    if normalized.startswith("NJU") and len(normalized) >= 6:
        normalized = "JU" + normalized[3:]
    if normalized.endswith("YVAT") and len(normalized) >= 7:
        normalized = normalized[:-4] + "YAT"
    if normalized.endswith("XK") and len(normalized) > 5:
        normalized = normalized[:-2]
    elif normalized.endswith("X") and len(normalized) > 5 and normalized[-2] not in "AEIOUY":
        normalized = normalized[:-1]
    return normalized


def _repair_name_particle_noise(token: str) -> str:
    embedded = _split_embedded_name_separator_noise(token)
    if embedded:
        return embedded
    if token == "KAL":
        return "AL"
    if token == "KLA":
        return "LA"
    if len(token) >= 6 and token.endswith("KAL") and _has_name_shape(token[:-3]):
        return f"{token[:-3]} AL"
    return token


def _split_embedded_name_separator_noise(token: str) -> str:
    compact = token
    if len(compact) >= 7 and compact.endswith("K") and not compact.endswith(("FIK", "LIK")) and _has_name_shape(compact[:-1]):
        compact = compact[:-1]
    best_value = ""
    best_score = -10_000
    for index in range(4, len(compact) - 2):
        if compact[index] != "K":
            continue
        left = compact[:index]
        right = compact[index + 1 :]
        if not (3 <= len(right) <= 12 and _has_name_shape(left) and _has_name_shape(right)):
            continue
        score = 50 - abs(len(left) - 6) * 2 - abs(len(right) - 5) * 2
        if score > best_score:
            best_value, best_score = f"{left} {right}", score
    return best_value if best_score > 0 else ""


def _strip_name_token_suffix_noise(token: str) -> str:
    if len(token) >= 6 and token.endswith("KK"):
        stripped = re.sub(r"K{2,}$", "", token)
        if _has_name_shape(stripped):
            return stripped
    if len(token) >= 6 and token.endswith("KE") and _has_name_shape(token[:-2]):
        return token[:-2]
    if len(token) >= 6 and token.endswith("MS") and _has_name_shape(token[:-1]):
        return token[:-1]
    return token


def _repair_document_ocr_noise(value: str) -> str:
    if _is_passport_number(value):
        return value
    shifted = re.match(r"^[A-Z0-9]([A-Z][0-9]{7})$", value)
    if shifted:
        return shifted.group(1)
    return value


def _normalize_country_code(value: str) -> str:
    country_code = re.sub(r"[^A-Z0-9]", "", value.upper())
    if not country_code:
        return ""
    if country_code in {"3ID", "31D"}:
        return "IDN"
    repaired = country_code.translate(str.maketrans({"1": "I", "L": "I", "0": "D", "O": "D", "Q": "D"}))
    if repaired == "IDN":
        return "IDN"
    return country_code


def _is_passport_number(value: str) -> bool:
    return bool(re.fullmatch(r"[A-Z][0-9]{7}", str(value or "")))


def _has_name_shape(token: str) -> bool:
    return len(token) >= 2 and any(char in "AEIOUY" for char in token) and len(set(token)) > 2


def _clean_mrz_line(value: Any) -> str:
    cleaned = re.sub(r"[^A-Z0-9<]", "", str(value or "").upper().replace(" ", ""))
    return cleaned[:44].ljust(44, "<") if cleaned else ""


def _repair_line2_ocr_confusions(value: str) -> str:
    if len(value) != 44:
        return value
    chars = list(value)
    digit_table = str.maketrans({"O": "0", "Q": "0", "D": "0", "I": "1", "L": "1", "S": "5", "B": "8", "Z": "2", "G": "6"})
    for index in (9, 42, 43):
        chars[index] = chars[index].translate(digit_table)
    nationality = "".join(chars[10:13]).translate(str.maketrans({"1": "I", "L": "I", "0": "D", "O": "D", "Q": "D"}))
    if nationality == "IDN":
        chars[10:13] = list("IDN")
    if chars[20] in {"L", "I", "1"}:
        chars[20] = "M"
    if chars[20] in {"P"}:
        chars[20] = "F"
    return "".join(chars)


def _looks_like_line1(value: str) -> bool:
    return len(value) == 44 and value.startswith(("P<", "I<", "A<", "C<")) and value.count("<") >= 2


def _looks_like_line2(value: str) -> bool:
    if len(value) != 44 or value.count("<") < 1:
        return False
    return (
        value[0].isalnum()
        and value[1:9].replace("<", "").isalnum()
        and value[10:13].isalpha()
        and _line2_check_score(value) >= 1
    )


def _line2_check_score(line2: str) -> int:
    checks = 0
    checks += _mrz_check_digit(line2[0:9]) == line2[9]
    checks += _mrz_check_digit(line2[13:19]) == line2[19]
    checks += _mrz_check_digit(line2[21:27]) == line2[27]
    return int(checks)


def _mrz_check_digit(value: str) -> str:
    return str(sum(_mrz_char_value(char) * (7, 3, 1)[index % 3] for index, char in enumerate(value)) % 10)


def _mrz_char_value(char: str) -> int:
    if char == "<":
        return 0
    if char.isdigit():
        return int(char)
    if "A" <= char <= "Z":
        return ord(char) - 55
    return 0


def _expand_date(value: str, date_type: str) -> str:
    year = int(value[0:2])
    month = int(value[2:4])
    day = int(value[4:6])
    today = date.today()

    if date_type == "birth":
        century = 2000 if year <= today.year % 100 else 1900
    elif date_type == "issue":
        century = 2000 if year <= today.year % 100 else 1900
    else:
        century = 2000
        if 2000 + year > today.year + 20:
            century = 1900

    try:
        return date(century + year, month, day).isoformat()
    except ValueError:
        return ""
