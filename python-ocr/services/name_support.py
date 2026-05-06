from __future__ import annotations

import re

MONTHS = ("JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC")
COMMON_JOINED_GIVEN_NAMES = {"MUHAMMAD"}
COMMON_GIVEN_ABBREVIATIONS = {"MUH": "MUHAMMAD"}


def clean_existing_first_name(parsed: dict[str, str]) -> dict[str, str]:
    updated = dict(parsed)
    tokens = []
    for index, token in enumerate(re.sub(r"[^A-Z\s]", " ", str(updated.get("firstName", "") or "").upper()).split()):
        cleaned = strip_repeated_suffix(token)
        if len(cleaned) == 1 and cleaned.isalpha():
            if index == 0 and not tokens:
                tokens.append(cleaned)
            else:
                break
            continue
        if index > 0 and len(cleaned) >= 5 and cleaned.startswith("K") and cleaned[1] not in "AEIOUY" and is_reasonable_token(cleaned[1:]):
            cleaned = cleaned[1:]
        if is_reasonable_token(cleaned):
            tokens.append(cleaned)
        elif tokens:
            break
    updated["firstName"] = " ".join(tokens)
    return updated


def repair_single_word_name(parsed: dict[str, str]) -> tuple[dict[str, str], str]:
    updated = dict(parsed)
    family_name = str(updated.get("familyName", "") or "").strip()
    if not updated.get("firstName") and family_name and is_reasonable_name_value(family_name) and len(family_name.split()) == 1:
        updated["firstName"] = family_name
        return updated, "SINGLE-WORD NAME DUPLICATED TO SATISFY REQUIRED FIELDS"
    return updated, ""


def repair_common_given_name_spacing(parsed: dict[str, str]) -> tuple[dict[str, str], str]:
    updated = dict(parsed)
    tokens = re.sub(r"[^A-Z\s]", " ", str(updated.get("firstName", "") or "").upper()).split()
    if tokens and tokens[0] in COMMON_GIVEN_ABBREVIATIONS:
        tokens[0] = COMMON_GIVEN_ABBREVIATIONS[tokens[0]]
        updated["firstName"] = " ".join(tokens)
        return updated, "GIVEN NAME ABBREVIATION REPAIRED FROM MRZ"
    joined = "".join(tokens)
    if len(tokens) == 2 and joined in COMMON_JOINED_GIVEN_NAMES:
        updated["firstName"] = joined
        return updated, "GIVEN NAME SPACING REPAIRED FROM MRZ"
    if len(tokens) == 1:
        cleaned = _strip_common_given_name_noise(tokens[0])
        if cleaned != tokens[0]:
            updated["firstName"] = cleaned
            return updated, "GIVEN NAME NOISE REPAIRED FROM MRZ"
    return updated, ""


def repair_common_name_noise(parsed: dict[str, str]) -> tuple[dict[str, str], str]:
    updated = dict(parsed)
    first_tokens = _name_tokens(updated.get("firstName", ""))
    family_tokens = _name_tokens(updated.get("familyName", ""))
    repaired_first = _repair_given_name_tokens(first_tokens)
    repaired_family = [_repair_family_token(token) for token in family_tokens]
    repaired_family = [token for token in repaired_family if token]
    first_name = " ".join(repaired_first)
    family_name = " ".join(repaired_family)
    changed = False
    if first_name and first_name != updated.get("firstName", ""):
        updated["firstName"] = first_name
        changed = True
    if family_name and family_name != updated.get("familyName", ""):
        updated["familyName"] = family_name
        changed = True
    return updated, "COMMON NAME OCR NOISE REPAIRED" if changed else ""


def salvage_family_hints(value: str) -> list[str]:
    hints = []
    seen = set()
    for token in re.sub(r"[^A-Z\\s]", " ", str(value or "").upper()).split():
        for candidate in _hint_variants(token):
            if candidate not in seen:
                hints.append(candidate)
                seen.add(candidate)
    return hints[:3]


def expand_compact_name(token: str, family_hints: list[str]) -> str:
    if not token.isalpha():
        return token
    for family_hint in family_hints:
        if len(token) - len(family_hint) == 1 and token[1:] == family_hint and token[0].isalpha():
            return f"{token[0]} {family_hint}"
    if len(token) < 9:
        return token
    for family_hint in family_hints:
        for size in range(min(12, len(token) - 3), 3, -1):
            suffix = token[-size:]
            if token_matches_simple(suffix, family_hint):
                prefix = token[:-size]
                if len(prefix) >= 3:
                    return f"{split_given_names(prefix)} {suffix}"
                if len(prefix) == 1 and prefix.isalpha():
                    return f"{prefix} {suffix}"
    generic = split_compact_full_name(token)
    return generic or token


def split_given_names(value: str) -> str:
    if len(value) <= 8:
        return value
    best = value
    best_score = (14 if is_reasonable_token(value) else 0) - max(0, len(value) - 8) * 4
    for index in range(3, len(value) - 2):
        left, right = value[:index], value[index:]
        if not (is_reasonable_token(left) and is_reasonable_token(right)):
            continue
        score = 14 - abs(len(left) - 6) - abs(len(right) - 4)
        if score > best_score:
            best, best_score = f"{left} {right}", score
    return best


def split_compact_full_name(value: str) -> str:
    if len(value) < 11 or not value.isalpha():
        return ""
    best = ""
    best_score = 0
    for index in range(3, len(value) - 3):
        left, right = value[:index], value[index:]
        if not (is_reasonable_token(left) and is_reasonable_token(right)):
            continue
        score = 18 - abs(len(left) - 5) - abs(len(right) - 7)
        if token_matches_simple(left, right):
            score -= 8
        if score > best_score:
            best, best_score = f"{left} {right}", score
    return best


def repair_given_tokens(tokens: list[str]) -> list[str]:
    cleaned = [token for token in tokens if token]
    if len(cleaned) <= 1 or (len(cleaned) == 2 and len(cleaned[0]) == 1):
        return cleaned
    joined = "".join(cleaned)
    if len(cleaned) == 2 and joined in COMMON_JOINED_GIVEN_NAMES:
        return [joined]
    merged = split_given_names("".join(cleaned)).split()
    if not merged or merged == cleaned:
        return cleaned
    if len(merged) == 1:
        return merged if len(cleaned) == 2 and len(cleaned[0]) <= 3 and len("".join(cleaned)) <= 8 else cleaned
    return merged if len(cleaned[0]) <= 4 else cleaned


def _repair_given_name_tokens(tokens: list[str]) -> list[str]:
    repaired: list[str] = []
    for index, token in enumerate(tokens):
        repaired.extend(_repair_given_token(token, index=index))
    return [token for token in repaired if token]


def _repair_given_token(token: str, *, index: int) -> list[str]:
    if token.startswith("DIU") and len(token) >= 6:
        token = "DJU" + token[3:]
    if token.startswith("DUI") and len(token) >= 6:
        token = "DJU" + token[3:]
    if token == "KAL":
        return ["AL"]
    if token == "KLA":
        return ["LA"]
    if len(token) >= 6 and token.endswith("KAL") and is_reasonable_token(token[:-3]):
        return [token[:-3], "AL"]
    token = _strip_name_noise_suffix(token)
    if not token:
        return []
    if token in COMMON_GIVEN_ABBREVIATIONS:
        return [COMMON_GIVEN_ABBREVIATIONS[token]]
    if index > 0 and len(token) >= 5 and token.startswith("K") and token[1] not in "AEIOUY" and is_reasonable_token(token[1:]):
        return [token[1:]]
    if index > 0 and len(token) >= 5 and token.startswith("X") and is_reasonable_token(token[1:]):
        return [token[1:]]
    if len(token) >= 6 and token.endswith("MS") and is_reasonable_token(token[:-1]):
        return [token[:-1]]
    if _is_short_filler_token(token):
        return []
    return [token]


def _repair_family_token(token: str) -> str:
    token = _strip_name_noise_suffix(token)
    if len(token) >= 6 and token.startswith("NM") and is_reasonable_token(token[1:]):
        return token[1:]
    if len(token) >= 6 and token.endswith("C") and is_reasonable_token(token[:-1]):
        return token[:-1]
    if _is_short_filler_token(token):
        return ""
    return token


def _strip_name_noise_suffix(token: str) -> str:
    if len(token) >= 6 and token.endswith("KK"):
        stripped = re.sub(r"K{2,}$", "", token)
        if is_reasonable_token(stripped):
            return stripped
    if len(token) >= 6 and token.endswith("KE") and is_reasonable_token(token[:-2]):
        return token[:-2]
    if len(token) >= 6 and token.endswith("K") and not token.endswith(("FIK", "LIK")) and is_reasonable_token(token[:-1]):
        return token[:-1]
    return token


def _is_short_filler_token(token: str) -> bool:
    if len(token) <= 3 and not any(char in "AEIOUY" for char in token):
        return True
    return len(token) >= 4 and set(token) <= {"E", "G", "K", "S"} and (token.count("K") + token.count("G")) >= 2


def _name_tokens(value: str) -> list[str]:
    return re.sub(r"[^A-Z\s]", " ", str(value or "").upper()).split()


def strip_repeated_suffix(token: str) -> str:
    match = re.search(r"(.)\1{2,}$", token)
    if not match:
        return token
    cleaned = token[: match.start()]
    return cleaned if len(cleaned) >= 3 else token


def is_reasonable_name_value(value: str) -> bool:
    tokens = re.sub(r"[^A-Z\\s]", " ", str(value or "").upper()).split()
    return bool(tokens) and all(is_reasonable_token(token) for token in tokens)


def score_name_fields(first_name: str, family_name: str) -> int:
    score = _score_value(first_name) + _score_value(family_name)
    if not re.sub(r"[^A-Z]", "", str(first_name or "").upper()):
        score -= 12
    if not re.sub(r"[^A-Z]", "", str(family_name or "").upper()):
        score -= 12
    return score


def score_given_name_layout(value: str) -> int:
    score = 0
    tokens = re.sub(r"[^A-Z\\s]", " ", str(value or "").upper()).split()
    if not tokens:
        return -12
    for token in tokens:
        score += 8 if is_reasonable_token(token) else -8
        if len(token) == 1:
            score -= 6
        if re.search(r"^[BCDFGHJKLMNPQRSTVWXYZ]{2,}", token):
            score -= 4
        if re.search(r"[BCDFGHJKLMNPQRSTVWXYZ]{2,}$", token):
            score -= 3
    if len(tokens) == 2:
        score += 2
    if len(tokens) > 3:
        score -= 4
    return score


def is_reasonable_token(token: str) -> bool:
    vowels = sum(char in "AEIOUY" for char in token)
    dominant = max(token.count(char) for char in set(token)) / max(len(token), 1)
    return 2 <= len(token) <= 12 and vowels >= 1 and dominant < 0.65 and not any(month in token and len(token) <= len(month) + 2 for month in MONTHS)


def token_matches_simple(observed: str, reference: str) -> bool:
    short, long = sorted((observed, reference), key=len)
    if len(short) >= 4 and long.startswith(short):
        return True
    mismatches = sum(char_a != char_b for char_a, char_b in zip(observed, reference)) + abs(len(observed) - len(reference))
    return mismatches <= 1 and min(len(observed), len(reference)) >= 4


def _score_value(value: str) -> int:
    score = 0
    for token in re.sub(r"[^A-Z\\s]", " ", str(value or "").upper()).split():
        score += 8 if is_reasonable_token(token) else -6
        if len(token) == 1:
            score -= 6
        if len(token) == 2:
            score -= 2
        if len(token) > 10:
            score -= 3
        if len(token) >= 6 and len(set(token)) <= 3:
            score -= 8
        if re.search(r"[AEIOUY]{3,}", token):
            score -= 3
        if re.search(r"[BCDFGHJKLMNPQRSTVWXYZ]{2,}$", token):
            score -= 3
    return score


def _hint_variants(token: str) -> list[str]:
    variants = []
    cleaned = strip_repeated_suffix(re.sub(r"[^A-Z]", "", token.upper()))
    if 3 <= len(cleaned) <= 12 and is_reasonable_token(cleaned):
        variants.append(cleaned)
    if len(cleaned) >= 6 and cleaned.startswith("NM") and is_reasonable_token(cleaned[1:]):
        variants.append(cleaned[1:])
    if len(cleaned) >= 6 and cleaned.endswith("S") and is_reasonable_token(cleaned[:-1]):
        variants.append(cleaned[:-1])
    return variants


def _strip_common_given_name_noise(token: str) -> str:
    for common_name in COMMON_JOINED_GIVEN_NAMES:
        suffix = token[len(common_name) :]
        if token.startswith(common_name) and suffix and set(suffix) <= {"K"}:
            return common_name
    return token
