from __future__ import annotations

import re

from services.name_support import clean_existing_first_name, expand_compact_name, repair_given_tokens, repair_single_word_name, salvage_family_hints, score_given_name_layout, score_name_fields
from services.passport_page import build_mrz_relative_crops, collect_ocr_lines, crop_relative, extract_aligned_passport_page

NOISE_WORDS = {
    "AGES",
    "APR", "AUG", "COUNTRY", "DATE", "DEC", "FEB", "FULL", "HABIS", "INDONESIA", "ISSUE", "JAN", "JENIS",
    "JUL", "JUN", "KANTOR", "KEWARGANEGARAAN", "KODE", "LAHIR", "LENGKAP", "MAR", "MAY", "NAME", "NAMA",
    "NATIONALITY", "NEGARA", "NO", "NOV", "OCT", "PASPOR", "PASSPORT", "PLACE", "REG", "REPUBLIC", "REPUBLIK",
    "SEP", "SEX", "SIG", "TYPE",
}
NOISE_FRAGMENTS = (
    "BERLAK", "COUNTR", "EXPIR", "FULL", "GARAAN", "ISSU", "KANTOR", "KELUAR", "LAHIR", "LENG",
    "MAME", "NAME", "NALIT", "NATIO", "NEGAR", "PASP", "PLACE", "REG", "TEMPAT", "TIONAL", "WAKIS",
)
NOISE_SUFFIXES = ("CODE", "DATE", "FULL", "ITY", "TION")
FOCUSED_PAGE_WINDOWS = ((0.22, 0.44, 0.08, 0.94), (0.18, 0.42, 0.08, 0.94))
PAGE_WINDOWS = ((0.18, 0.58, 0.08, 0.92), (0.22, 0.52, 0.08, 0.92))
RAW_WINDOWS = ((8.0, 1.2, 0.35, 0.35), (7.0, 1.0, 0.35, 0.45))


def refine_names_from_scan(
    file_path: str,
    parsed: ParsedPassportData,
    page: object | None = None,
    preferred_full_name: str = "",
) -> tuple[ParsedPassportData, str]:
    parsed = clean_existing_first_name(parsed)
    full_name = preferred_full_name or extract_full_name(file_path, parsed, page=page)
    if not full_name:
        return repair_single_word_name(parsed)
    if _should_keep_single_word_mrz_name(parsed, full_name):
        return repair_single_word_name(parsed)
    resolved, single_word = _split_full_name(full_name, parsed)
    if not resolved:
        return parsed, ""
    projected_first_name = _project_given_name_layout(parsed.firstName, resolved["firstName"])
    if projected_first_name:
        resolved["firstName"] = projected_first_name
    current_compact = re.sub(r"[^A-Z]", "", parsed.firstName.upper())
    resolved_compact = re.sub(r"[^A-Z]", "", resolved["firstName"].upper())
    if (
        current_compact
        and current_compact == resolved_compact
        and parsed.familyName == resolved["familyName"]
        and score_given_name_layout(parsed.firstName) >= score_given_name_layout(resolved["firstName"])
    ):
        return repair_single_word_name(parsed)
    current_score = score_name_fields(parsed.firstName, parsed.familyName)
    resolved_score = score_name_fields(resolved["firstName"], resolved["familyName"])
    prefer_visual_name = _should_prefer_visual_name(parsed, resolved)
    if current_score > resolved_score and not prefer_visual_name:
        return repair_single_word_name(parsed)
    if (
        current_score == resolved_score
        and score_given_name_layout(parsed.firstName) > score_given_name_layout(resolved["firstName"])
        and not prefer_visual_name
    ):
        return repair_single_word_name(parsed)
    notes = []
    if resolved["firstName"] != parsed.firstName or resolved["familyName"] != parsed.familyName:
        parsed.update(resolved)
        parsed = clean_existing_first_name(parsed)
        notes.append("NAME NORMALIZED FROM FULL NAME FIELD")
    if single_word:
        notes.append("SINGLE-WORD NAME DUPLICATED TO SATISFY REQUIRED FIELDS")
    return parsed, "; ".join(notes)


def extract_full_name(file_path: str, parsed: ParsedPassportData, page: object | None = None) -> str:
    candidates: dict[str, int] = {}
    page = page if page is not None else extract_aligned_passport_page(file_path)
    if page is not None:
        for top, bottom, left, right in FOCUSED_PAGE_WINDOWS:
            _add_candidates(
                candidates,
                collect_ocr_lines(crop_relative(page, top, bottom, left, right), variant_mode="fast", max_lines=20),
                parsed,
                bonus=8,
            )
        for top, bottom, left, right in PAGE_WINDOWS:
            _add_candidates(
                candidates,
                collect_ocr_lines(crop_relative(page, top, bottom, left, right), variant_mode="fast", max_lines=24),
                parsed,
            )
    for crop in build_mrz_relative_crops(file_path, RAW_WINDOWS):
        _add_raw_candidates(candidates, crop, parsed)

    for candidate, score in sorted(candidates.items(), key=lambda item: item[1], reverse=True):
        if _is_confident_candidate(candidate, score, parsed):
            return _extend_with_mrz_hints(page, candidate)
    return ""


def _score_candidate(line: str, parsed: ParsedPassportData) -> int:
    if not _looks_like_name(line):
        return -10_000
    tokens = line.split()
    score = len("".join(tokens)) + (12 if len(tokens) <= 4 else 0) + (4 if len(tokens) == 2 else 0)
    family_tokens = _family_reference_tokens(parsed.familyName)
    first_tokens = _reference_tokens(parsed.firstName)
    reliable_tokens = family_tokens + first_tokens
    if reliable_tokens and not _contains_any_token(tokens, reliable_tokens):
        return -10_000
    if family_tokens:
        score += 30 if _token_matches(tokens[-1], family_tokens[0]) else 10 if _contains_any_token(tokens, family_tokens) else -15
    elif len(tokens) > 3:
        score -= 10
    if first_tokens and any(_token_matches(token, first_tokens[0]) for token in tokens):
        score += 8
    return score


def _add_candidates(candidates: dict[str, int], lines: list[str], parsed: ParsedPassportData, bonus: int = 0) -> None:
    for line in lines:
        prepared = _prepare_candidate(line, parsed)
        if not prepared:
            continue
        score = _score_candidate(prepared, parsed) + bonus
        if score > candidates.get(prepared, -10_000):
            candidates[prepared] = score


def _add_raw_candidates(candidates: dict[str, int], crop: object, parsed: ParsedPassportData) -> None:
    lines = collect_ocr_lines(
        crop,
        psm_values=(6,),
        whitelist="ABCDEFGHIJKLMNOPQRSTUVWXYZ ",
        variant_mode="fast",
        max_lines=30,
    )
    _add_candidates(candidates, lines, parsed, bonus=12)
    for index, line in enumerate(lines):
        if not _is_name_label(line):
            continue
        for offset in (1, 2):
            if index + offset >= len(lines):
                break
            prepared = _prepare_candidate(lines[index + offset], parsed)
            if not prepared:
                continue
            score = _score_candidate(prepared, parsed) + 40
            if score > candidates.get(prepared, -10_000):
                candidates[prepared] = score


def _looks_like_name(line: str) -> bool:
    tokens = line.split()
    if not tokens or len(tokens) > 6 or any(len(token) > 12 for token in tokens):
        return False
    if len(tokens) > 2 and any(len(token) <= 2 for token in tokens[1:]):
        return False
    if any(token in NOISE_WORDS or _contains_noise_word(token) or _is_noise_token(token) for token in tokens):
        return False
    if any(not _has_name_shape(token) for token in tokens):
        return False
    letters = "".join(tokens)
    return len(letters) >= 3 and len(set(letters)) > 2


def _prepare_candidate(line: str, parsed: ParsedPassportData) -> str:
    tokens = [_strip_repeated_suffix(token) for token in _normalize_line(line).split()]
    tokens = [token for token in tokens if token]
    if len(tokens) == 1:
        tokens = expand_compact_name(tokens[0], salvage_family_hints(parsed.familyName)).split()
    if not tokens:
        return ""
    while len(tokens) > 2 and len(tokens[0]) <= 2:
        tokens.pop(0)
    family_tokens = _family_reference_tokens(parsed.familyName)
    if family_tokens:
        family_index = _find_matching_index(tokens, family_tokens)
        if family_index >= len(tokens) // 2:
            tokens = tokens[: family_index + 1]
    while tokens and (tokens[-1] in NOISE_WORDS or _is_noise_token(tokens[-1])):
        tokens.pop()
    while tokens and (tokens[0] in NOISE_WORDS or (len(tokens) > 2 and len(tokens[0]) <= 2)):
        tokens.pop(0)
    if family_tokens and len(tokens) > 4:
        family_index = _find_matching_index(tokens, family_tokens)
        if family_index >= 0:
            tokens = tokens[max(0, family_index - 3) : family_index + 1]
    return " ".join(tokens)


def _split_full_name(full_name: str, parsed: ParsedPassportData) -> tuple[dict[str, str], bool]:
    tokens = _normalize_line(full_name).split()
    while tokens and (tokens[0] in NOISE_WORDS or _is_noise_token(tokens[0]) or (len(tokens) > 2 and len(tokens[0]) <= 2)):
        tokens.pop(0)
    tokens = _drop_leading_visual_noise(tokens, parsed)
    if not tokens:
        return {}, False
    if len(tokens) == 2 and len(tokens[0]) == 1:
        return {"firstName": tokens[0], "familyName": tokens[1]}, False
    raw_family_token = tokens[-1]
    family_tokens = _match_family_suffix(tokens, parsed.familyName)
    single_word = False
    if family_tokens:
        family_name = " ".join(family_tokens)
        first_tokens = tokens[: len(tokens) - len(family_tokens)]
    elif len(tokens) == 1:
        family_name, first_tokens, single_word = tokens[0], [tokens[0]], True
    else:
        family_name, first_tokens = tokens[-1], tokens[:-1]
    first_tokens, family_name = _repair_boundary_shift(first_tokens, raw_family_token, family_name, parsed.familyName)
    first_tokens = repair_given_tokens(first_tokens)
    first_name = " ".join(first_tokens).strip() or family_name
    single_word = single_word or first_name == family_name
    return {"firstName": first_name, "familyName": family_name}, single_word


def _should_keep_single_word_mrz_name(parsed: ParsedPassportData, full_name: str) -> bool:
    if parsed.firstName.strip():
        return False
    family_name = _normalize_line(parsed.familyName)
    if not family_name or len(family_name.split()) != 1:
        return False
    tokens = _normalize_line(full_name).split()
    while tokens and (tokens[0] in NOISE_WORDS or _is_noise_token(tokens[0]) or (len(tokens) > 2 and len(tokens[0]) <= 2)):
        tokens.pop(0)
    if len(tokens) <= 1:
        return False
    if _token_matches(tokens[-1], family_name) and len(tokens[:-1]) >= 2:
        return False
    for token in tokens:
        if _token_matches(token, family_name):
            return _prefer_family_token(token, family_name) == family_name
    return False


def _drop_leading_visual_noise(tokens: list[str], parsed: ParsedPassportData) -> list[str]:
    if len(tokens) <= 2:
        return tokens
    first_tokens = _reference_tokens(parsed.firstName)
    if not first_tokens:
        return tokens
    for index, token in enumerate(tokens[:-1]):
        for reference_index, reference in enumerate(first_tokens):
            if _token_matches(token, reference):
                return tokens[max(0, index - reference_index) :]
        if index == 0 and len(token) >= 5 and token[0] == "S" and any(_token_matches(token[1:], reference) for reference in first_tokens):
            return [token[1:], *tokens[1:]]
    return tokens


def _match_family_suffix(tokens: list[str], family_name: str) -> list[str]:
    family_tokens = _reference_tokens(family_name)
    if not tokens or not family_tokens:
        return []
    suffix = _match_multi_token_suffix(tokens, family_tokens)
    if suffix:
        return suffix
    last_token = tokens[-1]
    if len(family_tokens) > 1 and _is_compact_visual_family(last_token, family_tokens):
        return [last_token]
    for family_token in _family_reference_tokens(family_name):
        if _token_matches(last_token, family_token):
            return [_prefer_family_token(last_token, family_token)]
    return []


def _match_multi_token_suffix(tokens: list[str], family_tokens: list[str]) -> list[str]:
    max_length = min(len(tokens), len(family_tokens))
    for length in range(max_length, 1, -1):
        suffix = tokens[-length:]
        expected = family_tokens[-length:]
        if all(_token_matches(observed, reference) for observed, reference in zip(suffix, expected)):
            return expected
    return []


def _repair_boundary_shift(
    first_tokens: list[str],
    raw_family_name: str,
    family_name: str,
    family_reference: str,
) -> tuple[list[str], str]:
    if not first_tokens or len(raw_family_name) < 5 or raw_family_name == family_name:
        return first_tokens, family_name
    shifted_first = f"{first_tokens[-1]}{raw_family_name[0]}"
    shifted_family = raw_family_name[1:]
    if not _has_name_shape(shifted_first):
        return first_tokens, family_name
    references = list(dict.fromkeys([family_name, *_family_reference_tokens(family_reference)]))
    for reference in references:
        if _token_matches(shifted_family, reference):
            adjusted_first = [*first_tokens[:-1], shifted_first]
            return adjusted_first, _prefer_family_token(shifted_family, reference)
    return first_tokens, family_name


def _project_given_name_layout(current_first_name: str, resolved_first_name: str) -> str:
    current_tokens = _normalize_line(current_first_name).split()
    resolved_tokens = _normalize_line(resolved_first_name).split()
    if len(current_tokens) < 2 or len(resolved_tokens) != 1:
        return ""
    compact = resolved_tokens[0]
    lengths = [len(token) for token in current_tokens]
    if sum(lengths) != len(compact):
        return ""
    parts = []
    start = 0
    for length in lengths:
        part = compact[start : start + length]
        start += length
        if not _has_name_shape(part):
            return ""
        parts.append(part)
    return " ".join(parts)


def _normalize_line(line: str) -> str:
    return re.sub(r"\s+", " ", re.sub(r"[^A-Z\s]", " ", str(line or "").upper().replace("|", " "))).strip()


def _extend_with_mrz_hints(page: object | None, candidate: str) -> str:
    tokens = candidate.split()
    if page is None or len(tokens) < 2:
        return candidate

    first_hint, last_hint = tokens[0], tokens[-1]
    for window in ((0.80, 0.98, 0.05, 0.98), (0.82, 0.98, 0.05, 0.98)):
        for line in collect_ocr_lines(
            crop_relative(page, *window),
            psm_values=(6,),
            whitelist="ABCDEFGHIJKLMNOPQRSTUVWXYZ<",
            variant_mode="hint",
            max_lines=6,
        ):
            mrz_first, mrz_last = _extract_mrz_hint_tokens(line)
            if _starts_with_token(tokens[0], mrz_first) and len(mrz_first) > len(first_hint):
                first_hint = mrz_first
            if _starts_with_token(tokens[-1], mrz_last) and len(mrz_last) > len(last_hint):
                last_hint = mrz_last

    return " ".join([first_hint, *tokens[1:-1], last_hint])


def _extract_mrz_hint_tokens(line: str) -> tuple[str, str]:
    cleaned = re.sub(r"[^A-Z<]", "", str(line or "").upper())
    if "<<" not in cleaned:
        return "", ""
    left, right = cleaned.split("<<", 1)
    last = _strip_repeated_suffix(_suffix_token(left))
    first = _strip_repeated_suffix(_prefix_token(right))
    return first, last


def _suffix_token(value: str) -> str:
    letters = re.sub(r"[^A-Z]", "", value)
    for prefix in ("P", "IDN", "IDU", "ID", "TD", "DU", "DN", "DEI", "CID", "UM"):
        if letters.startswith(prefix) and len(letters) - len(prefix) >= 4:
            letters = letters[len(prefix) :]
    for start in range(max(0, len(letters) - 12), len(letters)):
        token = letters[start:]
        if 4 <= len(token) <= 12 and not _is_noise_token(token):
            return token
    return ""


def _prefix_token(value: str) -> str:
    letters = re.sub(r"[^A-Z]", "", value)
    for end in range(min(12, len(letters)), 3, -1):
        token = letters[:end]
        if not _is_noise_token(token):
            return token
    return ""


def _starts_with_token(base: str, hint: str) -> bool:
    growth = len(hint) - len(base)
    suffix = hint[len(base) :]
    return (
        len(base) >= 3
        and 0 < growth <= 3
        and hint.startswith(base)
        and any(char in "AEIOUY" for char in suffix)
        and re.search(r"[BCDFGHJKLMNPQRSTVWXYZ]{2,}", suffix) is None
    )


def _clean_tokens(value: str) -> list[str]:
    return [token for token in _normalize_line(value).split() if token not in NOISE_WORDS and not _is_noise_token(token)]


def _family_reference_tokens(value: str) -> list[str]:
    tokens = [*_reference_tokens(value), *salvage_family_hints(value)]
    tokens = list(dict.fromkeys(tokens))
    if len(tokens) <= 1:
        return tokens
    ordered = [tokens[0], tokens[-1], *tokens[1:-1]]
    return list(dict.fromkeys(ordered))


def _is_confident_candidate(line: str, score: int, parsed: ParsedPassportData) -> bool:
    if score <= 0:
        return False
    tokens = line.split()
    reliable_tokens = _family_reference_tokens(parsed.familyName) + _reference_tokens(parsed.firstName)
    if reliable_tokens:
        return score >= 20
    if len(tokens) < 2 or len(tokens) > 3 or any(len(token) > 10 or len(token) < 4 for token in tokens):
        return False
    return score >= 18 and not any(_contains_noise_word(token) for token in tokens)


def _reference_tokens(value: str) -> list[str]:
    raw_tokens = _normalize_line(value).split()
    if not raw_tokens or len(raw_tokens) > 4:
        return []
    tokens = [token for token in raw_tokens if token not in NOISE_WORDS and not _is_noise_token(token)]
    if not tokens or len(tokens) != len(raw_tokens):
        return []
    if any(not _is_reliable_reference_token(token) for token in tokens):
        return []
    return tokens


def _is_reliable_reference_token(token: str) -> bool:
    return 2 <= len(token) <= 12 and re.search(r"(.)\1{2,}", token) is None


def _strip_repeated_suffix(token: str) -> str:
    if len(token) < 5:
        return token
    match = re.search(r"(.)\1{2,}$", token)
    if not match:
        return token
    cleaned = token[: match.start()]
    return cleaned if len(cleaned) >= 3 else token


def _is_noise_token(token: str) -> bool:
    return len(token) < 2 or (len(set(token)) <= 2 and len(token) >= 4) or re.search(r"(K){4,}", token) is not None


def _contains_noise_word(token: str) -> bool:
    return any(noise in token for noise in NOISE_WORDS if len(noise) >= 4) or any(fragment in token for fragment in NOISE_FRAGMENTS) or token.startswith(("COUNTR", "INDO", "NATIO", "PASSP", "REPUB"))


def _is_name_label(line: str) -> bool:
    normalized = _normalize_line(line)
    return any(fragment in normalized for fragment in ("NAMA", "NAME", "MAME", "FULL", "FUL", "LENG", "GNAP", "GAAP"))


def _has_name_shape(token: str) -> bool:
    vowels = sum(char in "AEIOUY" for char in token)
    return vowels >= 1 and not token.endswith(NOISE_SUFFIXES)


def _contains_any_token(tokens: list[str], references: list[str]) -> bool:
    return any(_token_matches(token, reference) for token in tokens for reference in references)


def _find_matching_index(tokens: list[str], references: list[str]) -> int:
    for reference in references:
        for index, token in enumerate(tokens):
            if _token_matches(token, reference):
                return index
    return -1


def _prefer_family_token(observed: str, reference: str) -> str:
    if observed == reference:
        return reference
    if _is_better_visual_family_spelling(observed, reference):
        return observed
    if len(observed) - len(reference) == 1 and observed[1:] == reference and observed[0] in {"N", "Y"}:
        return reference
    if len(observed) - len(reference) == 1 and observed[1:] == reference and observed[0] == "B":
        return observed
    if len(reference) - len(observed) == 1 and reference[:-1] == observed and reference[-1] in {"G", "H", "K", "S"}:
        return observed
    if len(reference) - len(observed) == 1 and reference[1:] == observed and reference[0] in {"N", "Y"}:
        return observed
    if len(reference) - len(observed) == 1 and reference[0] in {"N", "Y"} and _is_one_edit_apart(reference[1:], observed):
        return observed
    if len(observed) - len(reference) == 1 and observed[0] == "B" and _is_one_edit_apart(observed[1:], reference):
        return observed
    return reference


def _should_prefer_visual_name(parsed: ParsedPassportData, resolved: dict[str, str]) -> bool:
    current_first = _normalize_line(parsed.firstName)
    resolved_first = _normalize_line(resolved.get("firstName", ""))
    current_family = _normalize_line(parsed.familyName)
    resolved_family = _normalize_line(resolved.get("familyName", ""))
    if not current_family or not resolved_family or current_family == resolved_family:
        return False
    if not _given_names_align(current_first, resolved_first):
        return False
    return _is_suspicious_family_repaired_by_visual(current_family, resolved_family)


def _given_names_align(current_first: str, resolved_first: str) -> bool:
    if not current_first:
        return True
    if current_first == resolved_first:
        return True
    current_tokens = current_first.split()
    resolved_tokens = resolved_first.split()
    if not current_tokens or not resolved_tokens:
        return False
    if "".join(current_tokens) == "".join(resolved_tokens):
        return True
    return _token_matches(current_tokens[0], resolved_tokens[0])


def _is_suspicious_family_repaired_by_visual(current_family: str, resolved_family: str) -> bool:
    current_tokens = current_family.split()
    resolved_tokens = resolved_family.split()
    if len(current_tokens) > 1 and len(resolved_tokens) == 1:
        return _is_compact_visual_family(resolved_tokens[0], current_tokens)
    if len(current_tokens) == 1 and len(resolved_tokens) == 1:
        return _is_better_visual_family_spelling(resolved_tokens[0], current_tokens[0])
    return False


def _is_compact_visual_family(observed: str, family_tokens: list[str]) -> bool:
    if len(family_tokens) <= 1 or not observed or not _has_name_shape(observed):
        return False
    compact_reference = "".join(family_tokens)
    if observed == compact_reference:
        return True
    if _is_within_one_edit(observed, compact_reference):
        return True
    length_delta = len(observed) - len(compact_reference)
    return 0 < length_delta <= 2 and observed.startswith(family_tokens[0]) and observed.endswith(family_tokens[-1])


def _is_better_visual_family_spelling(observed: str, reference: str) -> bool:
    return reference.endswith("TLE") and observed.endswith("TIE") and _is_within_one_edit(observed, reference)


def _token_matches(observed: str, reference: str) -> bool:
    if observed == reference:
        return True
    if len(observed) == len(reference) and observed[1:] == reference[1:] and observed[0] != reference[0]:
        return False
    if len(observed) - len(reference) == 1 and observed[1:] == reference and observed[0] in {"N", "Y"}:
        return True
    if len(reference) - len(observed) == 1 and reference[1:] == observed and reference[0] in {"N", "Y"}:
        return True
    if len(observed) - len(reference) == 1 and observed[0] == "B" and _is_one_edit_apart(observed[1:], reference):
        return True
    if len(reference) - len(observed) == 1 and reference[0] in {"N", "Y"} and _is_one_edit_apart(reference[1:], observed):
        return True
    short, long = sorted((observed, reference), key=len)
    if len(short) >= 4 and long.startswith(short):
        return True
    mismatches = sum(char_a != char_b for char_a, char_b in zip(observed, reference)) + abs(len(observed) - len(reference))
    return mismatches <= 1 and min(len(observed), len(reference)) >= 4


def _is_one_edit_apart(left: str, right: str) -> bool:
    if len(left) != len(right):
        return False
    return sum(char_a != char_b for char_a, char_b in zip(left, right)) <= 1


def _is_within_one_edit(left: str, right: str) -> bool:
    if left == right:
        return True
    if abs(len(left) - len(right)) > 1:
        return False
    if len(left) == len(right):
        return _is_one_edit_apart(left, right)
    shorter, longer = sorted((left, right), key=len)
    index_short = 0
    index_long = 0
    edits = 0
    while index_short < len(shorter) and index_long < len(longer):
        if shorter[index_short] == longer[index_long]:
            index_short += 1
            index_long += 1
            continue
        edits += 1
        if edits > 1:
            return False
        index_long += 1
    return True
