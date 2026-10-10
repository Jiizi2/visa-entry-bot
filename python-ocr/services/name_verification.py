"""Compare passport names without spelling repairs or dictionary guesses."""
from __future__ import annotations

import re


def normalize_name(value: str) -> str:
    return re.sub(r"\s+", " ", str(value or "").upper()).strip()


def passport_full_name(parsed: dict[str, str]) -> str:
    first = normalize_name(parsed.get("firstName", ""))
    family = normalize_name(parsed.get("familyName", ""))
    # The entry contract duplicates mononyms into both required fields.
    return first if first == family else " ".join(part for part in (first, family) if part)


def observed_name_pair(
    full_name: str, parsed: dict[str, str], *, preserve_existing_word_boundaries: bool = True,
) -> dict[str, str]:
    """Keep every observed letter and initial, using exact suffixes only."""
    full_name = normalize_name(full_name)
    tokens = full_name.split()
    if not tokens or not re.fullmatch(r"[A-Z]+(?: [A-Z]+)*", full_name):
        return {}
    if passport_full_name(parsed) == full_name:
        return {field: parsed.get(field, "") for field in ("firstName", "familyName")}
    if (preserve_existing_word_boundaries and parsed.get("firstName") and parsed.get("familyName")
            and re.sub(r"\s", "", passport_full_name(parsed)) == re.sub(r"\s", "", full_name)):
        # OCR can split a wide inter-letter gap inside a word. Keep the existing
        # allocation and surface the competing word boundaries for review.
        return {field: parsed.get(field, "") for field in ("firstName", "familyName")}
    if len(tokens) == 1 or (
        len(tokens) == 2 and len(tokens[0]) == 1 and parsed.get("nationality") == "INDONESIA"
    ):
        return {"firstName": full_name, "familyName": full_name}
    family = normalize_name(parsed.get("familyName", ""))
    if family and full_name.endswith(" " + family):
        return {"firstName": full_name[: -len(family)].strip(), "familyName": family}
    return {"firstName": " ".join(tokens[:-1]), "familyName": tokens[-1]}


def verify_name_evidence(
    parsed: dict[str, str],
    mrz_names: dict[str, str],
    observed_name: str,
    *,
    words_verified: bool,
    confidence: float,
    candidates: tuple[str, ...] = (),
) -> dict[str, object]:
    observed = normalize_name(observed_name)
    mrz = passport_full_name(mrz_names)
    final = passport_full_name(parsed)
    status = "UNVERIFIED"
    if len(set(candidates)) > 1 or (observed and mrz and observed != mrz):
        status = "CONFLICT"
    elif observed and words_verified and confidence >= 0.85 and mrz == observed == final:
        status = "VERIFIED"
    return {
        "status": status,
        "mrzFullName": mrz,
        "observedFullName": observed,
        "resolvedFullName": final,
        "visualConfidence": round(confidence, 4),
        "wordBoundariesVerified": words_verified,
        "candidates": list(candidates),
    }
