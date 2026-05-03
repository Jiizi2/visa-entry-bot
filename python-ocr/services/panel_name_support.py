from __future__ import annotations

from difflib import SequenceMatcher
import re

from services.name_support import is_reasonable_token, score_name_fields, token_matches_simple

NAME_NOISE_FRAGMENTS = ("FULL", "LENGKAP", "NAME", "NAMA", "PASPOR", "PASSPORT")
BOUNDARY_PREFIXES = ("AL", "DZ", "SY", "KH", "SK")
ALLOWED_START_CLUSTERS = BOUNDARY_PREFIXES + ("BR", "CR", "DJ", "DR", "FR", "GR", "KR", "PR", "TR")


def normalize_name_candidate(cleaned: str, hints: list[str]) -> str:
    if not cleaned or any(fragment in cleaned for fragment in NAME_NOISE_FRAGMENTS):
        return ""
    tokens = cleaned.split()
    while len(tokens) >= 2 and len(tokens[0]) < 4 and len(tokens[1]) >= 7:
        tokens.pop(0)
    cleaned = " ".join(tokens)
    options = []
    if len(tokens) >= 2 and all(len(token) >= 4 for token in tokens[:-1]):
        spaced = " ".join(_canonicalize_hint(token, hints) for token in tokens)
        if looks_like_full_name(spaced):
            options.append(_ScoredName(spaced, 24))
    if len(tokens) >= 2:
        combined = f"{split_compact_name(''.join(tokens[:-1]), [])} {_canonicalize_hint(tokens[-1], hints)}".strip()
        if looks_like_full_name(combined):
            options.append(combined)
    compact = re.sub(r"[^A-Z]", "", cleaned.upper())
    if len(tokens) == 1 and hints:
        canonical = _canonicalize_hint(compact, hints)
        if canonical in hints and is_reasonable_token(canonical):
            options.append(canonical)
    if compact:
        for candidate, penalty in _compact_variants(compact):
            compact_split = split_compact_name(candidate, hints)
            if compact_split:
                options.append(_ScoredName(compact_split, -penalty))
    return str(max(options, default="", key=lambda item: score_full_name(item, hints)))


def split_compact_name(token: str, hints: list[str]) -> str:
    compact = re.sub(r"[^A-Z]", "", token.upper())
    if not compact:
        return ""
    candidates = _split_with_hints(compact, hints) + _partition_compact_name(compact, 4, 2)
    return " ".join(max(candidates, key=lambda tokens: _score_token_sequence(tokens, hints))) if candidates else ""


def score_full_name(value: str, hints: list[str]) -> int:
    if isinstance(value, _ScoredName):
        return _score_token_sequence(str(value).split(), hints) + value.adjustment
    return _score_token_sequence(value.split(), hints) if looks_like_full_name(value) else -10_000


def pick_best_name_candidate(candidates: list[tuple[int, str]], hints: list[str]) -> str:
    best_name = ""
    best_score = -10_000
    for index, (base_score, name) in enumerate(candidates):
        total = base_score
        total += sum(int(other_score * _name_similarity(name, other_name) * 0.12) for other_index, (other_score, other_name) in enumerate(candidates) if other_index != index)
        if total > best_score:
            best_name, best_score = name, total
    return best_name


def looks_like_full_name(value: str) -> bool:
    tokens = value.split()
    return 1 <= len(tokens) <= 4 and all(is_reasonable_token(token) for token in tokens)


def _split_with_hints(compact: str, hints: list[str]) -> list[list[str]]:
    candidates: list[list[str]] = []
    for hint in hints:
        for size in range(max(4, len(hint) - 2), min(12, len(hint) + 2) + 1):
            if size >= len(compact):
                continue
            suffix = compact[-size:]
            if not token_matches_simple(suffix, hint):
                continue
            prefix = compact[:-size]
            for tokens in _partition_compact_name(prefix, 3, 1):
                candidates.append([*(_canonicalize_hint(token, hints) for token in tokens), hint])
    return candidates


def _partition_compact_name(value: str, max_tokens: int, min_tokens: int) -> list[list[str]]:
    results: list[list[str]] = []

    def walk(index: int, tokens: list[str]) -> None:
        remaining = len(value) - index
        if remaining == 0:
            if min_tokens <= len(tokens) <= max_tokens:
                results.append(list(tokens))
            return
        if len(tokens) >= max_tokens:
            return
        for size in range(2 if tokens else 3, min(12, remaining) + 1):
            tail = remaining - size
            slots = max_tokens - len(tokens) - 1
            if tail and (tail < 2 or tail > max(2, slots) * 12):
                continue
            token = value[index : index + size]
            if not is_reasonable_token(token):
                continue
            tokens.append(token)
            walk(index + size, tokens)
            tokens.pop()

    walk(0, [])
    return results


def _score_token_sequence(tokens: list[str], hints: list[str]) -> int:
    score = sum(len(token) * 2 for token in tokens) + {1: 18, 2: 26, 3: 24, 4: -12}.get(len(tokens), -18)
    score += score_name_fields(" ".join(tokens[:-1]), tokens[-1])
    score += max(0, min(len(tokens[0]), 8) - 4) * 4
    score += sum(18 for token in tokens[1:] if token.startswith(BOUNDARY_PREFIXES))
    score -= _leading_noise_penalty(tokens[0])
    score -= _boundary_penalty(tokens)
    score -= _compound_token_penalty(tokens)
    score -= sum(12 for token in tokens if len(token) < 4)
    score -= sum(16 for token in tokens if len(token) > 9)
    if hints:
        score += 70 if tokens[-1] in hints else 40 if any(token_matches_simple(tokens[-1], hint) for hint in hints) else 0
    if len(tokens) >= 2 and tokens[-1] == tokens[0]:
        score -= 12
    return score


def _name_similarity(left: str, right: str) -> float:
    left_tokens = left.split()
    right_tokens = right.split()
    if not left_tokens or not right_tokens:
        return 0.0
    family = _token_similarity(left_tokens[-1], right_tokens[-1])
    given = _token_similarity("".join(left_tokens[:-1]), "".join(right_tokens[:-1]))
    return (family * 0.55) + (given * 0.45)


def _token_similarity(left: str, right: str) -> float:
    if left == right:
        return 1.0
    return SequenceMatcher(None, left, right).ratio()


def _canonicalize_hint(token: str, hints: list[str]) -> str:
    for hint in hints:
        if token_matches_simple(token, hint):
            return hint
    return token


def _compact_variants(compact: str) -> list[tuple[str, int]]:
    variants: list[tuple[str, int]] = [(compact, 0)]
    if len(compact) >= 10:
        for offset in (1, 2):
            trimmed = compact[offset:]
            if len(trimmed) >= 8 and all(trimmed != value for value, _ in variants):
                variants.append((trimmed, offset * 24))
    return variants


def _leading_noise_penalty(token: str) -> int:
    if len(token) < 6:
        return 0
    prefix = token[:2]
    if prefix in ALLOWED_START_CLUSTERS:
        return 0
    if prefix[0] not in "AEIOU" and prefix[1] not in "AEIOU":
        return 18
    return 0


def _compound_token_penalty(tokens: list[str]) -> int:
    penalty = 0
    for token in tokens[:-1]:
        if len(token) >= 8 and _has_plausible_inner_boundary(token):
            penalty += 30
    return penalty


def _boundary_penalty(tokens: list[str]) -> int:
    penalty = 0
    for left, right in zip(tokens, tokens[1:]):
        if re.search(r"[BCDFGHJKLMNPQRSTVWXYZ]{2}$", left) and right[:1] in "AEIOUY":
            penalty += 14
    return penalty


def _has_plausible_inner_boundary(token: str) -> bool:
    for index in range(4, len(token) - 3):
        left, right = token[:index], token[index:]
        if is_reasonable_token(left) and is_reasonable_token(right):
            return True
    return False


class _ScoredName(str):
    def __new__(cls, value: str, adjustment: int) -> "_ScoredName":
        item = str.__new__(cls, value)
        item.adjustment = adjustment
        return item
