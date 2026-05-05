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
        "passportNumber": clean_document(_pick(data, "number", "passport_number")) or line_values["passportNumber"],
        "nationality": clean_country(_pick(data, "nationality")) or line_values["nationality"],
        "dob": format_date(_pick(data, "date_of_birth", "dob"), "birth") or line_values["dob"],
        "issueDate": format_date(_pick(data, "date_of_issue", "issue_date"), "issue"),
        "expiryDate": format_date(_pick(data, "expiration_date", "expiry_date"), "expiry")
        or line_values["expiryDate"],
        "gender": clean_gender(_pick(data, "sex", "gender")) or line_values["gender"],
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
    return re.sub(r"[^A-Z0-9]", "", str(value).upper())


def clean_country(value: Any) -> str:
    if value is None:
        return ""
    country_code = re.sub(r"[^A-Z]", "", str(value).upper())
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
    if "<<" not in value:
        return value.split("<", 1)[0], ""
    family_name, first_name = value.split("<<", 1)
    if "<" in family_name:
        return family_name.split("<", 1)[0], ""
    return family_name, first_name.replace("<<", " ")


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
    if normalized == "K" or (len(normalized) >= 3 and set(normalized) == {"K"}):
        return ""
    if len(normalized) >= 4 and set(normalized) <= {"S", "K"} and normalized.count("K") >= 3:
        return ""
    if len(normalized) >= 3 and set(normalized) <= {"E", "K"}:
        return ""
    if normalized.startswith("DUI") and len(normalized) >= 6:
        normalized = "DJU" + normalized[3:]
    if normalized.startswith("DJUU") and len(normalized) >= 6:
        normalized = "DJU" + normalized[4:]
    if normalized.startswith("NJU") and len(normalized) >= 6:
        normalized = "JU" + normalized[3:]
    if normalized.endswith("XK") and len(normalized) > 5:
        normalized = normalized[:-2]
    elif normalized.endswith("X") and len(normalized) > 5 and normalized[-2] not in "AEIOUY":
        normalized = normalized[:-1]
    return normalized


def _clean_mrz_line(value: Any) -> str:
    cleaned = re.sub(r"[^A-Z0-9<]", "", str(value or "").upper().replace(" ", ""))
    return cleaned[:44].ljust(44, "<") if cleaned else ""


def _repair_line2_ocr_confusions(value: str) -> str:
    if len(value) != 44:
        return value
    chars = list(value)
    nationality = "".join(chars[10:13]).translate(str.maketrans({"1": "I", "L": "I", "0": "D", "O": "D", "Q": "D"}))
    if nationality == "IDN":
        chars[10:13] = list("IDN")
    if chars[20] in {"L", "I", "1"}:
        chars[20] = "M"
    if chars[20] in {"P"}:
        chars[20] = "F"
    return "".join(chars)


def _looks_like_line1(value: str) -> bool:
    return len(value) == 44 and value.startswith(("P<", "I<", "A<", "C<")) and value.count("<") >= 4


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
