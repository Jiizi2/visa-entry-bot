from __future__ import annotations

import argparse
import json
import statistics
from pathlib import Path
from typing import Any


METRICS = (
    "mismatchCount",
    "avgTotalMs",
    "p95TotalMs",
    "maxTotalMs",
    "reviewCount",
    "panelFallbackUsed",
)


def main() -> int:
    parser = argparse.ArgumentParser(description="Compare median OCR benchmark metrics across measured runs.")
    parser.add_argument("--baseline", type=Path, nargs="+", required=True)
    parser.add_argument("--candidate", type=Path, nargs="+", required=True)
    parser.add_argument("--output", type=Path)
    args = parser.parse_args()

    baseline = aggregate_reports(args.baseline)
    candidate = aggregate_reports(args.candidate)
    payload = {
        "baseline": baseline,
        "candidate": candidate,
        "delta": {
            metric: candidate[metric] - baseline[metric]
            for metric in METRICS
        },
        "fieldAccuracyDelta": _field_accuracy_delta(baseline, candidate),
    }
    rendered = json.dumps(payload, indent=2, ensure_ascii=False) + "\n"
    if args.output:
        args.output.parent.mkdir(parents=True, exist_ok=True)
        args.output.write_text(rendered, encoding="utf-8")
    else:
        print(rendered, end="")
    return 0


def aggregate_reports(paths: list[Path]) -> dict[str, Any]:
    summaries = [json.loads(path.read_text(encoding="utf-8"))["summary"] for path in paths]
    if not summaries:
        raise ValueError("At least one benchmark report is required.")
    result: dict[str, Any] = {
        "runCount": len(summaries),
        **{metric: _median(summary.get(metric, 0) for summary in summaries) for metric in METRICS},
    }
    rapidocr = [summary.get("rapidocrTotals", {}) for summary in summaries]
    result["rapidocrCallCount"] = _median(item.get("callCount", 0) for item in rapidocr)
    result["rapidocrTotalMs"] = _median(item.get("totalMs", 0) for item in rapidocr)
    result["fieldAccuracy"] = _aggregate_field_accuracy(summaries)
    return result


def _aggregate_field_accuracy(summaries: list[dict[str, Any]]) -> dict[str, float]:
    fields = sorted(
        {
            field_name
            for summary in summaries
            for field_name in summary.get("fieldAccuracy", {})
        }
    )
    return {
        field_name: round(
            float(
                statistics.median(
                    float(summary.get("fieldAccuracy", {}).get(field_name, {}).get("accuracy", 0.0) or 0.0)
                    for summary in summaries
                )
            ),
            4,
        )
        for field_name in fields
    }


def _field_accuracy_delta(baseline: dict[str, Any], candidate: dict[str, Any]) -> dict[str, float]:
    left = baseline.get("fieldAccuracy", {})
    right = candidate.get("fieldAccuracy", {})
    return {
        field_name: round(float(right.get(field_name, 0.0)) - float(left.get(field_name, 0.0)), 4)
        for field_name in sorted(set(left) | set(right))
    }


def _median(values: object) -> int | float:
    result = statistics.median(list(values))
    return int(result) if float(result).is_integer() else float(result)


if __name__ == "__main__":
    raise SystemExit(main())
