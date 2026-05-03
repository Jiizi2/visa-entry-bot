from __future__ import annotations


def build_confidence_levels(record_confidence: float, field_confidence: dict[str, object]) -> dict[str, object]:
    return {
        "record": _to_level(record_confidence),
        "passportExtracted": _map_levels(field_confidence.get("passportExtracted", {})),
        "resolvedProfile": _map_levels(field_confidence.get("resolvedProfile", {})),
    }


def empty_confidence_levels() -> dict[str, object]:
    return {"record": "NONE", "passportExtracted": {}, "resolvedProfile": {}}


def _map_levels(value: object) -> object:
    if not isinstance(value, dict):
        return "NONE"
    levels: dict[str, object] = {}
    for key, nested in value.items():
        levels[key] = _map_levels(nested) if isinstance(nested, dict) else _to_level(nested)
    return levels


def _to_level(value: object) -> str:
    score = _as_float(value)
    if score <= 0:
        return "NONE"
    if score >= 0.85:
        return "HIGH"
    if score >= 0.7:
        return "MEDIUM"
    return "LOW"


def _as_float(value: object) -> float:
    try:
        return float(value or 0.0)
    except (TypeError, ValueError):
        return 0.0
