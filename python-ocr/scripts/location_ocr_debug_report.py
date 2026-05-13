from __future__ import annotations

import argparse
import json
from pathlib import Path
from typing import Any


LOCATION_FIELDS = ("birthCity", "cityOfIssued")


def main() -> int:
    args = parse_args()
    payload = json.loads(args.manifest.read_text(encoding="utf-8"))
    report = build_report(payload, source=str(args.manifest))
    output = json.dumps(report, indent=2, ensure_ascii=False)
    if args.output:
        args.output.parent.mkdir(parents=True, exist_ok=True)
        args.output.write_text(output + "\n", encoding="utf-8")
    else:
        print(output)
    return 0


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Summarize fast location OCR debug samples from a scan manifest.")
    parser.add_argument("manifest", type=Path, help="Path to a generated manifest JSON.")
    parser.add_argument("--output", type=Path, help="Write report JSON to this path.")
    return parser.parse_args()


def build_report(payload: dict[str, Any], source: str = "") -> dict[str, Any]:
    members = _members(payload)
    records = [_summarize_member(member) for member in members]
    return {
        "source": source,
        "totalRecords": len(records),
        "summary": _summarize_records(records),
        "records": records,
    }


def _members(payload: dict[str, Any]) -> list[dict[str, Any]]:
    members = payload.get("members", [])
    if isinstance(members, list):
        return [member for member in members if isinstance(member, dict)]
    records = payload.get("records", [])
    if isinstance(records, list):
        return [record for record in records if isinstance(record, dict)]
    return []


def _summarize_member(member: dict[str, Any]) -> dict[str, Any]:
    passport = _dict_value(member.get("passportExtracted", {}))
    metrics = _dict_value(member.get("processingMetrics", {}))
    fast_location = _dict_value(metrics.get("fastLocationOcr", {}))
    debug_samples = _list_value(fast_location.get("debugSamples", []))
    outputs = {field: str(passport.get(field, "") or "") for field in LOCATION_FIELDS}
    accepted_values = _accepted_values(debug_samples)
    raw_values = _raw_values(debug_samples)
    return {
        "fileName": str(member.get("fileName", "") or ""),
        "passportNumber": str(passport.get("passportNumber", "") or ""),
        "outputs": outputs,
        "visualFieldScope": _list_value(metrics.get("visualFieldScope", [])),
        "scanCalls": int(fast_location.get("scanCalls", 0) or 0),
        "cropAttempts": int(fast_location.get("cropAttempts", 0) or 0),
        "requestedFields": _list_value(fast_location.get("requestedFields", [])),
        "foundFields": _list_value(fast_location.get("foundFields", [])),
        "debugEnabled": bool(fast_location.get("debugEnabled")),
        "debugSamples": debug_samples,
        "acceptedValues": accepted_values,
        "rawPreview": raw_values[:8],
        "diagnosis": _diagnose(outputs, fast_location, debug_samples, accepted_values, raw_values),
    }


def _summarize_records(records: list[dict[str, Any]]) -> dict[str, Any]:
    summary = {
        "outputBoth": 0,
        "outputBirthOnly": 0,
        "outputIssuedOnly": 0,
        "outputNone": 0,
        "locationOcrRan": 0,
        "locationOcrSkipped": 0,
        "debugEnabled": 0,
        "acceptedButOutputEmpty": 0,
        "rawEmpty": 0,
        "diagnosisCounts": {},
        "totalScanCalls": 0,
        "totalCropAttempts": 0,
    }
    for record in records:
        birth = bool(record["outputs"].get("birthCity"))
        issued = bool(record["outputs"].get("cityOfIssued"))
        if birth and issued:
            summary["outputBoth"] += 1
        elif birth:
            summary["outputBirthOnly"] += 1
        elif issued:
            summary["outputIssuedOnly"] += 1
        else:
            summary["outputNone"] += 1
        if int(record.get("scanCalls", 0) or 0) > 0:
            summary["locationOcrRan"] += 1
        else:
            summary["locationOcrSkipped"] += 1
        if record.get("debugEnabled"):
            summary["debugEnabled"] += 1
        if record.get("diagnosis") == "ACCEPTED_BUT_OUTPUT_EMPTY":
            summary["acceptedButOutputEmpty"] += 1
        if record.get("diagnosis") == "RAW_EMPTY":
            summary["rawEmpty"] += 1
        diagnosis = str(record.get("diagnosis", "UNKNOWN"))
        summary["diagnosisCounts"][diagnosis] = summary["diagnosisCounts"].get(diagnosis, 0) + 1
        summary["totalScanCalls"] += int(record.get("scanCalls", 0) or 0)
        summary["totalCropAttempts"] += int(record.get("cropAttempts", 0) or 0)
    return summary


def _diagnose(
    outputs: dict[str, str],
    fast_location: dict[str, Any],
    debug_samples: list[dict[str, Any]],
    accepted_values: list[str],
    raw_values: list[str],
) -> str:
    if outputs.get("birthCity") and outputs.get("cityOfIssued"):
        return "OUTPUT_BOTH_PRESENT"
    if outputs.get("birthCity") or outputs.get("cityOfIssued"):
        return "OUTPUT_PARTIAL"
    if int(fast_location.get("scanCalls", 0) or 0) <= 0:
        return "NOT_RUN"
    if not bool(fast_location.get("debugEnabled")):
        return "NO_DEBUG_SAMPLES"
    if not debug_samples or not raw_values:
        return "RAW_EMPTY"
    if accepted_values:
        return "ACCEPTED_BUT_OUTPUT_EMPTY"
    if any(_looks_like_location_label(value) for value in raw_values):
        return "LABEL_ONLY_OR_VALUE_OUTSIDE_CROP"
    return "RAW_PRESENT_NO_ACCEPTED_VALUE"


def _accepted_values(debug_samples: list[dict[str, Any]]) -> list[str]:
    values: list[str] = []
    for sample in debug_samples:
        values.extend(str(value or "") for value in _list_value(sample.get("accepted", [])))
    return _unique_nonempty(values)


def _raw_values(debug_samples: list[dict[str, Any]]) -> list[str]:
    values: list[str] = []
    for sample in debug_samples:
        values.extend(str(value or "") for value in _list_value(sample.get("raw", [])))
    return _unique_nonempty(values)


def _looks_like_location_label(value: str) -> bool:
    compact = str(value or "").upper()
    return any(marker in compact for marker in ("TEMPAT", "LAHIR", "BIRTH", "KANTOR", "ISSUING", "OFFICE"))


def _dict_value(value: Any) -> dict[str, Any]:
    return value if isinstance(value, dict) else {}


def _list_value(value: Any) -> list[Any]:
    return value if isinstance(value, list) else []


def _unique_nonempty(values: list[str]) -> list[str]:
    unique: list[str] = []
    seen: set[str] = set()
    for value in values:
        cleaned = " ".join(str(value or "").split())
        if not cleaned or cleaned in seen:
            continue
        unique.append(cleaned)
        seen.add(cleaned)
    return unique


if __name__ == "__main__":
    raise SystemExit(main())
