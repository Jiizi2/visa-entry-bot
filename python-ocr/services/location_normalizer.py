from __future__ import annotations

import os
import re
from difflib import SequenceMatcher
from functools import lru_cache

from services.reference_loader import load_reference_workbook

ROOT_DIR = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
DATA_DIR = os.path.join(ROOT_DIR, "data")
FIELDS = ("placeOfBirth", "issuingOffice")
BUILTINS = {
    "placeOfBirth": {"BERAU", "KEDIRI", "KENDAL", "MAKASSAR", "PAREPARE", "PINRANG", "UJUNG PANDANG"},
    "issuingOffice": {"BANJARMASIN", "TANJUNG PRIOK", "TANJUNG REDEB", "TANJUG REDEB", "TARAKAN"},
}


def normalize_location_value(field_name: str, value: str) -> str:
    return pick_best_location_value(field_name, [value])


def is_known_location_value(field_name: str, value: str) -> bool:
    return _clean_text(value) in _known_values(field_name)


def pick_best_location_value(field_name: str, candidates: list[str]) -> str:
    cleaned = [_clean_text(value) for value in candidates if _clean_text(value)]
    if not cleaned:
        return ""
    vocabulary = _known_values(field_name)
    best_value = cleaned[0]
    best_score = -1.0
    for candidate in cleaned:
        score = float(cleaned.count(candidate)) * 18.0
        normalized, match_score = _best_vocabulary_match(candidate, vocabulary)
        if normalized:
            score += match_score
            if score > best_score:
                best_value, best_score = normalized, score
            continue
        if score > best_score:
            best_value, best_score = candidate, score
    if best_value in vocabulary:
        return best_value
    if field_name == "issuingOffice":
        return ""
    return best_value if cleaned.count(best_value) > 1 else ""


def _best_vocabulary_match(candidate: str, vocabulary: set[str]) -> tuple[str, float]:
    best_value = ""
    best_score = 0.0
    for variant in _variants(candidate):
        compact = _compact(variant)
        if len(compact) < 4:
            continue
        for known in vocabulary:
            score = _score(compact, _compact(known))
            if score > best_score:
                best_value, best_score = known, score
    threshold = 86.0 if candidate.replace(" ", "").endswith("REDEB") else 82.0
    return (best_value, best_score) if best_value and best_score >= threshold else ("", 0.0)


@lru_cache(maxsize=1)
def _known_values(field_name: str) -> set[str]:
    values = set(BUILTINS.get(field_name, set()))
    for root, _, files in os.walk(DATA_DIR):
        for file_name in files:
            if not file_name.lower().endswith(".xlsx"):
                continue
            try:
                rows = load_reference_workbook(os.path.join(root, file_name))
            except Exception:  # noqa: BLE001
                continue
            for row in rows:
                value = _clean_text(row.get(field_name, ""))
                if value:
                    values.add(value)
    return values


def _score(candidate: str, known: str) -> float:
    if candidate == known:
        return 120.0
    if candidate in known and len(candidate) >= 5:
        return 102.0 + min(len(candidate), len(known))
    if known in candidate and len(known) >= 5:
        return 96.0 + min(len(candidate), len(known))
    return SequenceMatcher(None, candidate, known).ratio() * 100.0


def _variants(value: str) -> list[str]:
    variants = [value]
    compact = _compact(value)
    if compact and compact not in variants:
        variants.append(compact)
    if len(compact) >= 6:
        for offset in (1, 2):
            trimmed = compact[offset:]
            if trimmed not in variants:
                variants.append(trimmed)
    return variants


def _clean_text(value: str) -> str:
    normalized = re.sub(r"[^A-Z\s-]", " ", str(value or "").upper())
    normalized = normalized.replace("-", " ")
    return re.sub(r"\s+", " ", normalized).strip()


def _compact(value: str) -> str:
    return re.sub(r"[^A-Z]", "", value.upper())
