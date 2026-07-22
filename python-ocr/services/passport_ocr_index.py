from __future__ import annotations

from dataclasses import dataclass

from services.ocr_observation import OcrDetailedResult, OcrObservation


@dataclass(frozen=True)
class PassportOcrIndex:
    observations: tuple[OcrObservation, ...]
    source: str

    @classmethod
    def from_result(cls, result: OcrDetailedResult) -> "PassportOcrIndex":
        ordered = tuple(sorted(result.observations, key=lambda item: (item.center_y, item.center_x)))
        return cls(observations=ordered, source=result.source)

    def below(
        self,
        anchor: OcrObservation,
        *,
        max_vertical_distance: float = 0.065,
        max_horizontal_distance: float = 0.22,
    ) -> list[OcrObservation]:
        candidates = []
        anchor_bottom = _bottom(anchor)
        for item in self.observations:
            vertical_distance = _top(item) - anchor_bottom
            if vertical_distance < -0.004 or vertical_distance > max_vertical_distance:
                continue
            if abs(item.center_x - anchor.center_x) > max_horizontal_distance and _horizontal_overlap(anchor, item) < 0.2:
                continue
            candidates.append(item)
        return sorted(
            candidates,
            key=lambda item: (
                max(0.0, _top(item) - anchor_bottom),
                abs(item.center_x - anchor.center_x),
                -item.confidence,
            ),
        )


def _left(item: OcrObservation) -> float:
    return min((point[0] for point in item.normalized_box), default=0.0)


def _right(item: OcrObservation) -> float:
    return max((point[0] for point in item.normalized_box), default=0.0)


def _top(item: OcrObservation) -> float:
    return min((point[1] for point in item.normalized_box), default=0.0)


def _bottom(item: OcrObservation) -> float:
    return max((point[1] for point in item.normalized_box), default=0.0)


def _horizontal_overlap(left: OcrObservation, right: OcrObservation) -> float:
    overlap = max(0.0, min(_right(left), _right(right)) - max(_left(left), _left(right)))
    narrowest = max(min(left.width, right.width), 0.0001)
    return overlap / narrowest
