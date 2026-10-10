"""Read identity evidence from the full-page OCR already used for locations."""
from __future__ import annotations

import re
import os
from dataclasses import dataclass, field
from difflib import SequenceMatcher
import numpy as np
import cv2

from services.ocr_result_cache import build_region_cache_key, get_cached_detailed_result, store_cached_detailed_result
from services.ocr_runner import run_rapid_ocr_detailed
from services.passport_ocr_index import PassportOcrIndex
from services.spatial_field_resolver import resolve_location_fields
from services.spatial_field_resolver import _normalize_candidate
from services.image_preprocessor import detect_document_crop, _crop_page_around_mrz
from services.ocr_runner import ocr_time_remaining
from services.indonesia_field_ocr import (
    _load_image, _orient_image, _select_fast_location_image,
    detect_passport_data_page_crop, resize_to_max_edge, FAST_LOCATION_OCR_MAX_EDGE,
)


@dataclass
class VisualIdentityEvidence:
    fields: dict[str, str] = field(default_factory=dict)
    confidence: dict[str, float] = field(default_factory=dict)
    name_candidates: tuple[str, ...] = ()
    name_words_verified: bool = False
    location_values: dict[str, str] = field(default_factory=dict)


def extract_cached_visual_identity(file_path: str, rotation_degrees: int = 0) -> dict[str, str]:
    return extract_visual_identity_evidence(file_path, rotation_degrees).fields


def extract_visual_identity_evidence(
    file_path: str, rotation_degrees: int = 0, *, allow_scan: bool = False,
) -> VisualIdentityEvidence:
    if not os.path.isfile(file_path):
        return VisualIdentityEvidence()
    original = _orient_image(_load_image(file_path), rotation_degrees)
    image = original
    image = _select_fast_location_image(image, detect_passport_data_page_crop(image))
    image = resize_to_max_edge(image, max_edge=FAST_LOCATION_OCR_MAX_EDGE)
    key = build_region_cache_key("spatial-full-page", image, "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789 /-", "det-rec-v1")
    detailed = get_cached_detailed_result(key)
    if detailed is None:
        if not allow_scan or image is None:
            return VisualIdentityEvidence()
        detailed = run_rapid_ocr_detailed(
            image, whitelist="ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789 /-", use_cls=False, source="visual_identity",
        )
        store_cached_detailed_result(key, detailed)
    index = PassportOcrIndex.from_result(detailed)
    evidence = resolve_visual_identity_evidence(image, index)
    printed_names = _printed_mrz_names(index)
    current = evidence.fields.get("fullName", "")
    if (allow_scan and len(printed_names) == 1 and current
            and re.sub(r"[^A-Z]", "", current) != re.sub(r"[^A-Z]", "", printed_names[0])
            and ocr_time_remaining() >= 3.0):
        # A second frame changes resampling around glare and weak letter strokes.
        # Keep competing observations for review, and use an alternative only
        # when its actual letters also match the printed MRZ name.
        document = detect_document_crop(original)
        alternate = _crop_page_around_mrz(document, width_margin=1.10)
        alternate = resize_to_max_edge(alternate, max_edge=FAST_LOCATION_OCR_MAX_EDGE)
        if alternate is not None:
            result = run_rapid_ocr_detailed(alternate, whitelist="ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789 /-",
                use_cls=False, source="visual_name_recovery")
            recovered = resolve_visual_identity_evidence(alternate, PassportOcrIndex.from_result(result))
            value = recovered.fields.get("fullName", "")
            if value and re.sub(r"[^A-Z]", "", value) == re.sub(r"[^A-Z]", "", printed_names[0]):
                evidence.name_candidates = tuple(sorted(set((*evidence.name_candidates, *recovered.name_candidates))))
                evidence.fields["fullName"] = value
                evidence.confidence["fullName"] = recovered.confidence["fullName"]
                evidence.name_words_verified = recovered.name_words_verified
    return evidence


def resolve_visual_identity(image: object, index: PassportOcrIndex) -> dict[str, str]:
    return resolve_visual_identity_evidence(image, index).fields


def resolve_visual_identity_evidence(image: object, index: PassportOcrIndex) -> VisualIdentityEvidence:
    evidence = VisualIdentityEvidence()
    for field_name, resolution in resolve_location_fields(index).items():
        if resolution.value:
            evidence.location_values[field_name] = resolution.value
            evidence.confidence[field_name] = resolution.confidence
    markers = {
        "fullName": ("NAMALENGKAP", "FULLNAME"),
        "issueDate": ("TGLPENGELUARAN", "PENGELUARAN", "DATEOFISSUE"),
        "expiryDate": ("TGLHABISBERLAKU", "HABISBERLAKU", "DATEOFEXPIRY"),
        "dob": ("TGLLAHIR", "DATEOFBIRTH"),
        "passportNumber": ("NOPASPOR", "PASSPORTNO"),
        "nationality": ("KEWARGANEGARAAN", "NATIONALITY"),
        "gender": ("KELAMIN", "SEX"),
    }
    for field, labels in markers.items():
        anchors = [item for item in index.observations if _is_identity_label(item.text, field, labels)]
        candidates: set[str] = set()
        confidences: dict[str, float] = {}
        verified_words: dict[str, bool] = {}
        for anchor in anchors:
            # Skewed lines can have overlapping bounding-box corners even when
            # their text centers clearly lie on consecutive rows.
            below = sorted((item for item in index.observations
                if 0.012 <= item.center_y - anchor.center_y <= 0.10
                and _same_field_column(anchor, item)),
                key=lambda item: (item.center_y - anchor.center_y + abs(item.center_x - anchor.center_x) * 0.3))
            for item in below:
                if item.confidence < 0.85:
                    continue
                if field == "fullName":
                    text = re.sub(r"\s+", " ", item.text.upper()).strip()
                    if not re.fullmatch(r"[A-Z]+(?: [A-Z]+)*", text):
                        continue
                    if text in {"IDN", "P", "L", "M", "F"} or any(word in text for word in ("NATIONALITY", "KEWARGANEGARAAN", "INDONESIA", "NAME", "NAMA")):
                        continue
                    recognized = recognize_name_words(image, item)
                    # Keep the actual observation even if word segmentation fails.
                    # It must still participate in the identity disagreement check.
                    value = recognized or text
                    verified_words[value] = bool(recognized or " " in text)
                elif field in {"issueDate", "expiryDate", "dob"}:
                    value = _visual_date(item.text)
                elif field == "passportNumber":
                    value = re.sub(r"\s", "", item.text.upper())
                    if not re.fullmatch(r"[EXY]\d{7}", value):
                        value = ""
                elif field == "nationality":
                    value = "INDONESIA" if item.text.strip().upper() == "INDONESIA" else ""
                else:
                    text = re.sub(r"\s", "", item.text.upper())
                    value = "MALE" if text in {"L/M", "M/L", "M", "MALE"} else "FEMALE" if text in {"P/F", "F/P", "F", "FEMALE"} else ""
                if value:
                    candidates.add(value)
                    confidences[value] = min(confidences.get(value, 1.0), item.confidence)
                    break
        # Conflicting observations require review, never a best-looking guess.
        if len(candidates) == 1:
            value = next(iter(candidates))
            evidence.fields[field] = value
            evidence.confidence[field] = confidences[value]
            if field == "fullName":
                evidence.name_words_verified = verified_words[value]
        if field == "fullName":
            evidence.name_candidates = tuple(sorted(candidates))
    if not evidence.fields.get("fullName") and not evidence.name_candidates:
        # An unreadable label need not hide the visible name. Match every letter
        # against the name actually printed in MRZ line 1, even if line 2 is cut.
        # This does not confer MRZ verification or fill from a filename.
        for mrz in index.observations:
            text = re.sub(r"\s", "", mrz.text.upper())
            if not text.startswith("P<IDN") or "<<" not in text[5:]:
                continue
            family, given = text[5:].split("<<", 1)
            printed = " ".join((given.replace("<", " ").strip(), family.replace("<", " ").strip())).strip()
            letters = re.sub(r"[^A-Z]", "", printed)
            for item in index.observations:
                observed = re.sub(r"\s+", " ", item.text.upper()).strip()
                if (item.center_y >= mrz.center_y or item.confidence < 0.85
                        or not re.fullmatch(r"[A-Z]+(?: [A-Z]+)*", observed)
                        or re.sub(r"[^A-Z]", "", observed) != letters):
                    continue
                recognized = recognize_name_words(image, item)
                value = recognized or observed
                evidence.fields["fullName"] = value
                evidence.confidence["fullName"] = item.confidence
                evidence.name_words_verified = bool(recognized or " " in observed)
                evidence.name_candidates = (value,)
                break
            if evidence.fields.get("fullName"):
                break
    if not evidence.fields.get("passportNumber") and evidence.fields.get("fullName"):
        name_rows = [item.center_y for item in index.observations
            if re.sub(r"[^A-Z]", "", item.text.upper()) == re.sub(r"[^A-Z]", "", evidence.fields["fullName"])]
        serials = [item for item in index.observations
            if item.confidence >= 0.95 and item.center_y < min(name_rows, default=0.45)
            and re.fullmatch(r"[EXY]\d{7}", re.sub(r"\s", "", item.text.upper()))]
        if len(serials) == 1:
            evidence.fields["passportNumber"] = re.sub(r"\s", "", serials[0].text.upper())
            evidence.confidence["passportNumber"] = serials[0].confidence
    if not evidence.location_values.get("placeOfBirth"):
        dob_hint = evidence.fields.get("dob") or _verified_mrz_dob(index)
        locations = {}
        for birth in index.observations:
            if not dob_hint or _visual_date(birth.text) != dob_hint:
                continue
            for item in index.observations:
                if (abs(item.center_y - birth.center_y) > 0.025
                        or not 0.25 <= item.center_x - birth.center_x <= 0.60
                        or item.confidence < 0.90):
                    continue
                value = _normalize_candidate("placeOfBirth", item.text, item.confidence)
                if value:
                    locations[value] = item.confidence
        if len(locations) == 1:
            value = next(iter(locations))
            evidence.location_values["placeOfBirth"] = value
            evidence.confidence["placeOfBirth"] = locations[value]
    issue_date = evidence.fields.get("issueDate", "")
    if issue_date and evidence.fields.get("expiryDate", "") <= issue_date:
        # Read the actual date on the same printed row when the expiry label is
        # hidden by a reflection. No date is generated from the validity period.
        from datetime import date
        issued = date.fromisoformat(issue_date)
        expiry_candidates = {}
        for issue in index.observations:
            if _visual_date(issue.text) != issue_date:
                continue
            for item in index.observations:
                value = _visual_date(item.text)
                if (not value or item.confidence < 0.90
                        or abs(item.center_y - issue.center_y) > 0.025
                        or item.center_x - issue.center_x < 0.20):
                    continue
                expires = date.fromisoformat(value)
                if (expires.year - issued.year in {5, 10}
                        and (expires.month, expires.day) == (issued.month, issued.day)):
                    expiry_candidates[value] = item.confidence
        if len(expiry_candidates) == 1:
            value = next(iter(expiry_candidates))
            evidence.fields["expiryDate"] = value
            evidence.confidence["expiryDate"] = expiry_candidates[value]
    return evidence


def _printed_mrz_names(index: PassportOcrIndex) -> tuple[str, ...]:
    names = set()
    for item in index.observations:
        text = re.sub(r"\s", "", item.text.upper())
        if not re.fullmatch(r"P<IDN[A-Z<]+", text) or "<<" not in text[5:]:
            continue
        family, given = text[5:].split("<<", 1)
        name = re.sub(r"\s+", " ", given.replace("<", " ") + " " + family.replace("<", " ")).strip()
        if name:
            names.add(name)
    return tuple(sorted(names))


def _verified_mrz_dob(index: PassportOcrIndex) -> str:
    from services.mrz_validation import validate_td3_line2
    from services.parser import format_date
    dates = set()
    for item in index.observations:
        text = re.sub(r"\s", "", item.text.upper())
        if not re.match(r"^[EXY]\d{7}<\dIDN", text):
            continue
        validation = validate_td3_line2(text)
        if any(check.field_name == "dob" and check.valid for check in validation.check_results):
            if value := format_date(validation.line2[13:19], "birth"):
                dates.add(value)
    return next(iter(dates)) if len(dates) == 1 else ""


def _is_identity_label(text: str, field: str, labels: tuple[str, ...]) -> bool:
    compact = re.sub(r"[^A-Z]", "", text.upper())
    if field == "fullName" and any(word in compact for word in ("ADDITIONAL", "TAMBAHAN", "ENDORSEMENT")):
        return False
    if any(label in compact for label in labels):
        return True
    # Keep the field-specific prefix: DATE OF BIRTH and PLACE OF BIRTH are
    # adjacent, and an issue-date label must never become an expiry anchor.
    prefixes = {"fullName": ("NAMALEN", "FULLN"), "issueDate": ("TGLPE", "GLPENG", "PENGELU", "PEHGELU"),
        "expiryDate": ("TGLHABIS", "TGLRABIS", "GLHABIS", "HABISBE", "HABISEE", "RABISBE"), "dob": ("TGLLAH", "GLLAH", "DATOFB"),
        "passportNumber": ("NOPAS",), "nationality": ("KEWARG", "WARGAN", "NATION", "NATON", "NAION"), "gender": ("KELAM", "ELAMIN")}
    if not any(prefix in compact for prefix in prefixes.get(field, ())):
        return False
    return any(SequenceMatcher(None, compact[start:start + len(label)], label).ratio() >= 0.72
        for label in labels if len(label) >= 7
        for start in range(max(1, len(compact) - len(label) + 1)))


def _same_field_column(anchor: object, item: object) -> bool:
    if abs(item.center_x - anchor.center_x) <= 0.20:
        return True
    anchor_left = min(point[0] for point in anchor.normalized_box)
    anchor_right = max(point[0] for point in anchor.normalized_box)
    item_left = min(point[0] for point in item.normalized_box)
    item_right = max(point[0] for point in item.normalized_box)
    overlap = min(anchor_right, item_right) - max(anchor_left, item_left)
    width = min(anchor_right - anchor_left, item_right - item_left)
    return width > 0 and overlap >= width * 0.5


def _visual_date(text: str) -> str:
    from datetime import date
    from services.indonesia_field_ocr import MONTHS
    match = re.fullmatch(r"\s*(\d{1,2})\s*([A-Z]{3})\s*(\d{4})\s*", text.upper())
    if not match or match[2] not in MONTHS:
        return ""
    try:
        return date(int(match[3]), MONTHS[match[2]], int(match[1])).isoformat()
    except ValueError:
        return ""


def recognize_name_words(image: object, observation: object) -> str:
    """Recover word boundaries from visible gaps, without guessing names."""
    if image is None:
        return ""
    points = np.asarray(observation.box, dtype=np.float32)
    width = max(1, int(max(np.linalg.norm(points[1] - points[0]), np.linalg.norm(points[2] - points[3]))))
    height = max(1, int(max(np.linalg.norm(points[3] - points[0]), np.linalg.norm(points[2] - points[1]))))
    target = np.asarray(((0, 0), (width - 1, 0), (width - 1, height - 1), (0, height - 1)), dtype=np.float32)
    line = cv2.warpPerspective(image, cv2.getPerspectiveTransform(points, target), (width, height))
    gray = cv2.cvtColor(line, cv2.COLOR_BGR2GRAY) if line.ndim == 3 else line
    _, ink = cv2.threshold(gray, 0, 255, cv2.THRESH_BINARY_INV | cv2.THRESH_OTSU)
    columns = np.count_nonzero(ink, axis=0)
    empty = columns <= max(1, height // 12)
    runs = []
    start = None
    for index, is_empty in enumerate([*empty, False]):
        if is_empty and start is None:
            start = index
        elif not is_empty and start is not None:
            if start > 0 and index < width:
                runs.append((start, index))
            start = None
    gap_widths = [end - start for start, end in runs]
    if not gap_widths:
        return ""
    min_word_gap = max(height * 0.22, float(np.median(gap_widths)) * 2.2)
    boundaries = [(start + end) // 2 for start, end in runs if end - start >= min_word_gap]
    if not boundaries:
        # Visible inter-letter gaps, with no word-sized gaps, support a mononym.
        return re.sub(r"[^A-Z]", "", observation.text.upper())
    if len(boundaries) > 7:
        return ""
    edges = [0, *boundaries, width]
    compact = re.sub(r"[^A-Z]", "", observation.text.upper())
    for scale in (1, 2):
        words = []
        for left, right in zip(edges, edges[1:]):
            crop = cv2.copyMakeBorder(line[:, left:right], 4, 4, 4, 4, cv2.BORDER_CONSTANT, value=(255, 255, 255))
            if scale > 1:
                crop = cv2.resize(crop, None, fx=scale, fy=scale, interpolation=cv2.INTER_CUBIC)
            result = run_rapid_ocr_detailed(crop, whitelist="ABCDEFGHIJKLMNOPQRSTUVWXYZ", use_det=False, use_cls=False, use_rec=True, source="visual_name_word")
            if len(result.observations) != 1 or result.observations[0].confidence < 0.85:
                break
            word = result.observations[0].text.strip().upper()
            if not re.fullmatch(r"[A-Z]+", word):
                break
            words.append(word)
        # Retry small crops once at a larger size, and accept only when every
        # observed letter survives. No dictionary or spelling repair is used.
        if len(words) == len(edges) - 1 and "".join(words) == compact:
            return " ".join(words)
    return ""
