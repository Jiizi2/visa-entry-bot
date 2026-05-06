from __future__ import annotations

import json
from functools import lru_cache
from pathlib import Path
from typing import Any

Window = tuple[float, float, float, float]
VisualFieldProfile = dict[str, Any]

_DATA_DIR = Path(__file__).resolve().parent / "data"
_INDONESIA_LAYOUT_PATH = _DATA_DIR / "indonesia_passport_layouts.json"
_REQUIRED_VISUAL_FIELDS = (
    "fullName",
    "nationality",
    "dob",
    "gender",
    "placeOfBirth",
    "issueDate",
    "expiryDate",
    "issuingOffice",
)
_REQUIRED_PANEL_FIELDS = (
    "name",
    "passportNumber",
    "nationality",
    "dob",
    "gender",
    "placeOfBirth",
    "issueDate",
    "expiryDate",
    "issuingOffice",
)


@lru_cache(maxsize=1)
def load_indonesia_passport_layout_profile() -> VisualFieldProfile:
    with _INDONESIA_LAYOUT_PATH.open("r", encoding="utf-8") as handle:
        payload = json.load(handle)
    return _parse_indonesia_layout_profile(payload)


def clear_layout_profile_cache() -> None:
    load_indonesia_passport_layout_profile.cache_clear()


def load_indonesia_panel_modes() -> dict[str, dict[str, tuple[Window, ...]]]:
    return load_indonesia_passport_layout_profile()["panelModes"]


def _parse_indonesia_layout_profile(payload: dict[str, Any]) -> VisualFieldProfile:
    if payload.get("country") != "IDN":
        raise ValueError("Indonesia layout profile must use country IDN")
    if payload.get("documentType") != "passport":
        raise ValueError("Indonesia layout profile must use documentType passport")

    visual_ocr = payload.get("visualFieldOcr")
    if not isinstance(visual_ocr, dict):
        raise ValueError("Indonesia layout profile is missing visualFieldOcr")

    field_templates = _parse_field_templates(visual_ocr.get("fieldTemplates"))
    return {
        "country": payload["country"],
        "documentType": payload["documentType"],
        "version": str(payload.get("version") or "unknown"),
        "fieldTemplates": field_templates,
        "extraWindows": _parse_window_map(visual_ocr.get("extraWindows", {}), require_known_fields=False),
        "nameWindows": _parse_window_list(visual_ocr.get("nameWindows"), "nameWindows"),
        "nameValueWindows": _parse_window_list(visual_ocr.get("nameValueWindows"), "nameValueWindows"),
        "panelModes": _parse_panel_modes(payload.get("panelFallback")),
    }


def _parse_field_templates(value: object) -> tuple[dict[str, Window], ...]:
    if not isinstance(value, list) or not value:
        raise ValueError("fieldTemplates must be a non-empty list")
    parsed = []
    for index, template in enumerate(value):
        if not isinstance(template, dict):
            raise ValueError(f"fieldTemplates[{index}] must be an object")
        missing = [field_name for field_name in _REQUIRED_VISUAL_FIELDS if field_name not in template]
        if missing:
            raise ValueError(f"fieldTemplates[{index}] missing fields: {', '.join(missing)}")
        parsed.append(
            {
                field_name: _parse_window(template[field_name], f"fieldTemplates[{index}].{field_name}")
                for field_name in _REQUIRED_VISUAL_FIELDS
            }
        )
    return tuple(parsed)


def _parse_window_map(value: object, *, require_known_fields: bool) -> dict[str, tuple[Window, ...]]:
    if not isinstance(value, dict):
        raise ValueError("window map must be an object")
    parsed = {}
    for field_name, windows in value.items():
        if require_known_fields and field_name not in _REQUIRED_VISUAL_FIELDS:
            raise ValueError(f"unknown visual field: {field_name}")
        parsed[str(field_name)] = _parse_window_list(windows, str(field_name))
    return parsed


def _parse_panel_modes(value: object) -> dict[str, dict[str, tuple[Window, ...]]]:
    if not isinstance(value, dict):
        raise ValueError("Indonesia layout profile is missing panelFallback")
    modes = value.get("modes")
    if not isinstance(modes, dict) or not modes:
        raise ValueError("panelFallback.modes must be a non-empty object")
    parsed = {}
    for mode_name, mode_config in modes.items():
        if not isinstance(mode_config, dict):
            raise ValueError(f"panelFallback.modes.{mode_name} must be an object")
        missing = [field_name for field_name in _REQUIRED_PANEL_FIELDS if field_name not in mode_config]
        if missing:
            raise ValueError(f"panelFallback.modes.{mode_name} missing fields: {', '.join(missing)}")
        parsed[str(mode_name)] = {
            field_name: _parse_window_list(mode_config[field_name], f"panelFallback.modes.{mode_name}.{field_name}")
            for field_name in _REQUIRED_PANEL_FIELDS
        }
    return parsed


def _parse_window_list(value: object, label: str) -> tuple[Window, ...]:
    if not isinstance(value, list) or not value:
        raise ValueError(f"{label} must be a non-empty list")
    return tuple(_parse_window(window, f"{label}[{index}]") for index, window in enumerate(value))


def _parse_window(value: object, label: str) -> Window:
    if not isinstance(value, list) or len(value) != 4:
        raise ValueError(f"{label} must contain exactly four numeric coordinates")
    coordinates = tuple(float(item) for item in value)
    if not all(0.0 <= coordinate <= 1.0 for coordinate in coordinates):
        raise ValueError(f"{label} coordinates must be between 0.0 and 1.0")
    top, bottom, left, right = coordinates
    if top >= bottom or left >= right:
        raise ValueError(f"{label} must use increasing top/bottom and left/right coordinates")
    return coordinates
