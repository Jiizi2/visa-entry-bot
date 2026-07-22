from __future__ import annotations

import unicodedata
from dataclasses import dataclass


Point = tuple[float, float]
Box = tuple[Point, ...]


@dataclass(frozen=True)
class OcrObservation:
    text: str
    normalized_text: str
    confidence: float
    box: Box
    normalized_box: Box
    center_x: float
    center_y: float
    width: float
    height: float


@dataclass(frozen=True)
class OcrDetailedResult:
    observations: tuple[OcrObservation, ...]
    elapsed_ms: int
    detector_used: bool
    classifier_used: bool
    source: str

    @property
    def lines(self) -> list[str]:
        return [item.normalized_text for item in self.observations if item.normalized_text]

    @property
    def text(self) -> str:
        return "\n".join(self.lines)


def normalize_ocr_text(value: str) -> str:
    """Transliterate OCR output to stable ASCII without field-specific repairs."""
    decomposed = unicodedata.normalize("NFKD", str(value or ""))
    return "".join(char for char in decomposed if not unicodedata.combining(char))


def filter_ocr_text(value: str, whitelist: str = "") -> str:
    normalized = normalize_ocr_text(value)
    if not whitelist:
        return normalized.strip()
    return "".join(char for char in normalized if char in whitelist or char.isspace()).strip()


def build_observation(
    *,
    text: str,
    confidence: float,
    box: object,
    image_width: int,
    image_height: int,
    whitelist: str = "",
) -> OcrObservation:
    points = _coerce_box(box, image_width=image_width, image_height=image_height)
    normalized_points = tuple(
        (
            _clamp(point[0] / max(image_width, 1)),
            _clamp(point[1] / max(image_height, 1)),
        )
        for point in points
    )
    xs = [point[0] for point in normalized_points]
    ys = [point[1] for point in normalized_points]
    min_x, max_x = min(xs, default=0.0), max(xs, default=0.0)
    min_y, max_y = min(ys, default=0.0), max(ys, default=0.0)
    return OcrObservation(
        text=str(text or "").strip(),
        normalized_text=filter_ocr_text(text, whitelist),
        confidence=max(0.0, min(1.0, float(confidence or 0.0))),
        box=points,
        normalized_box=normalized_points,
        center_x=(min_x + max_x) / 2.0,
        center_y=(min_y + max_y) / 2.0,
        width=max_x - min_x,
        height=max_y - min_y,
    )


def _coerce_box(box: object, *, image_width: int, image_height: int) -> Box:
    points: list[Point] = []
    if isinstance(box, (list, tuple)) or hasattr(box, "tolist"):
        raw_points = box.tolist() if hasattr(box, "tolist") else box
        if isinstance(raw_points, (list, tuple)):
            for point in raw_points:
                if not isinstance(point, (list, tuple)) or len(point) < 2:
                    continue
                try:
                    points.append((float(point[0]), float(point[1])))
                except (TypeError, ValueError):
                    continue
    if len(points) >= 2:
        return tuple(points)
    return (
        (0.0, 0.0),
        (float(max(image_width, 1)), 0.0),
        (float(max(image_width, 1)), float(max(image_height, 1))),
        (0.0, float(max(image_height, 1))),
    )


def _clamp(value: float) -> float:
    return max(0.0, min(1.0, float(value)))
