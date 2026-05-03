from __future__ import annotations

import json
import os
import re
import sys
from difflib import SequenceMatcher

from services.location_normalizer import normalize_location_value
from services.reference_loader import load_reference_workbook, normalize_reference_key

ROOT_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA_DIR = os.path.join(ROOT_DIR, "data")
COMPARE_FIELDS = (
    ("firstName", "firstName"), ("familyName", "familyName"), ("passportNumber", "passportNumber"),
    ("nationality", "nationality"), ("dob", "dob"), ("issueDate", "issueDate"),
    ("expiryDate", "expiryDate"), ("gender", "gender"), ("placeOfBirth", "placeOfBirth"),
    ("issuingOffice", "issuingOffice"),
)


def main() -> None:
    manifest_path, reference_path = resolve_paths()
    if not os.path.exists(manifest_path):
        raise SystemExit(f"Manifest not found: {manifest_path}")
    if not os.path.exists(reference_path):
        raise SystemExit(f"Reference workbook not found: {reference_path}")
    report = build_report(load_manifest(manifest_path), load_reference_workbook(reference_path), manifest_path, reference_path)
    output_dir = os.path.dirname(manifest_path)
    write_json(os.path.join(output_dir, "crosscheck.json"), report)
    write_text(os.path.join(output_dir, "crosscheck.md"), render_markdown(report))
    print(f"Cross-check saved to: {os.path.join(output_dir, 'crosscheck.json')}")
    print(f"Cross-check summary saved to: {os.path.join(output_dir, 'crosscheck.md')}")
    print_summary(report)


def resolve_paths() -> tuple[str, str]:
    manifest_path = sys.argv[1] if len(sys.argv) > 1 else discover_manifest_path()
    reference_path = sys.argv[2] if len(sys.argv) > 2 else os.path.join(DATA_DIR, "AYM_45 PAX_RAMADHAN 1447H.xlsx")
    return os.path.abspath(manifest_path), os.path.abspath(reference_path)


def load_manifest(path: str) -> dict[str, object]:
    with open(path, "r", encoding="utf-8") as handle:
        return json.load(handle)


def write_json(path: str, payload: dict[str, object]) -> None:
    with open(path, "w", encoding="utf-8") as handle:
        json.dump(payload, handle, indent=2, ensure_ascii=False)


def write_text(path: str, content: str) -> None:
    with open(path, "w", encoding="utf-8") as handle:
        handle.write(content)


def build_report(manifest: dict[str, object], references: list[dict[str, str]], manifest_path: str, reference_path: str) -> dict[str, object]:
    reference_rows = [row for row in references if row.get("fullName")]
    reference_by_passport = _build_unique_reference_index(reference_rows, lambda row: row.get("passportNumber", ""))
    reference_by_name = _build_unique_reference_index(reference_rows, lambda row: normalize_reference_key(row.get("fullName", "")))
    reference_by_filename = _build_unique_reference_index(reference_rows, lambda row: normalize_filename_key(row.get("fullName", "")))
    members = [member for member in manifest.get("members", []) if isinstance(member, dict)]
    field_stats = {key: {"compared": 0, "mismatched": 0} for key, _ in COMPARE_FIELDS}
    comparisons: list[dict[str, object]] = []
    skipped: list[dict[str, str]] = []
    mismatched_fields = 0
    reference_conflicts = 0

    for member in members:
        reference, match_by = match_reference(member, reference_rows, reference_by_passport, reference_by_name, reference_by_filename)
        if reference is None:
            skipped.append(
                {
                    "fileName": str(member.get("fileName", "")),
                    "status": str(member.get("status", "")),
                    "passportNumber": member_value(member, "passportNumber"),
                }
            )
            continue
        comparison = compare_member(member, reference, match_by, field_stats)
        comparisons.append(comparison)
        mismatched_fields += len(comparison["mismatches"])
        reference_conflicts += len(comparison["referenceConflicts"])

    return {
        "manifestPath": manifest_path,
        "referencePath": reference_path,
        "summary": {
            "scannedMembers": len(members),
            "references": len(references),
            "comparableMembers": len(comparisons),
            "skippedMembers": len(skipped),
            "totalFieldMismatches": mismatched_fields,
            "suspectedReferenceConflicts": reference_conflicts,
        },
        "fieldStats": field_stats,
        "comparisons": comparisons,
        "skipped": skipped,
    }


def match_reference(member: dict[str, object], reference_rows: list[dict[str, str]], reference_by_passport: dict[str, dict[str, str]], reference_by_name: dict[str, dict[str, str]], reference_by_filename: dict[str, dict[str, str]]) -> tuple[dict[str, str] | None, str]:
    passport_number = normalize_value(member_value(member, "passportNumber"))
    if passport_number in reference_by_passport:
        return reference_by_passport[passport_number], "passport"
    full_name = f"{member_value(member, 'firstName')} {member_value(member, 'familyName')}"
    reference = reference_by_name.get(normalize_reference_key(full_name))
    if reference:
        return reference, "name"
    filename_key = normalize_filename_key(member.get("fileName", ""))
    if filename_key in reference_by_filename and _has_matchable_identity(member):
        return reference_by_filename[filename_key], "filename"
    reference = match_reference_profile(member, reference_rows)
    if reference:
        return reference, "profile"
    return match_reference_fuzzy(member, reference_rows)


def match_reference_profile(member: dict[str, object], reference_rows: list[dict[str, str]]) -> dict[str, str] | None:
    passport_tail = normalize_passport_tail(member_value(member, "passportNumber"))
    dob = normalize_value(member_value(member, "dob"))
    issue_date = normalize_value(member_value(member, "issueDate"))
    expiry_date = normalize_value(member_value(member, "expiryDate"))
    gender = normalize_value(member_value(member, "gender"))
    name_tokens = extract_match_tokens(f"{member_value(member, 'firstName')} {member_value(member, 'familyName')}")
    best_row = None
    best_score = 0
    for row in reference_rows:
        score = 0
        if passport_tail and passport_tail == normalize_passport_tail(row.get("passportNumber", "")):
            score += 5
        if dob and dob == normalize_value(row.get("dob", "")):
            score += 3
        if issue_date and issue_date == normalize_value(row.get("issueDate", "")):
            score += 2
        if expiry_date and expiry_date == normalize_value(row.get("expiryDate", "")):
            score += 2
        if gender and gender == normalize_value(row.get("gender", "")):
            score += 1
        score += len(name_tokens & extract_match_tokens(row.get("fullName", "")))
        if score > best_score:
            best_row, best_score = row, score
        elif score == best_score and score:
            best_row = None
    return best_row if best_row is not None and best_score >= 8 else None


def match_reference_fuzzy(member: dict[str, object], reference_rows: list[dict[str, str]]) -> tuple[dict[str, str] | None, str]:
    name_tokens = extract_match_tokens(f"{member_value(member, 'firstName')} {member_value(member, 'familyName')}")
    file_tokens = extract_match_tokens(member.get("fileName", ""), from_filename=True)
    dob = normalize_value(member_value(member, "dob"))
    if not name_tokens:
        return None, ""

    best_row = None
    best_score = 0
    for row in reference_rows:
        reference_tokens = extract_match_tokens(row.get("fullName", ""))
        overlap_name = len(name_tokens & reference_tokens)
        overlap_file = len(file_tokens & reference_tokens)
        score = 0
        if name_tokens and name_tokens == reference_tokens:
            score = max(score, 100)
        elif name_tokens and name_tokens.issubset(reference_tokens):
            score = max(score, 72 + len(name_tokens))
        elif overlap_name >= 2:
            score = max(score, 66 + overlap_name)
        if file_tokens and file_tokens == reference_tokens:
            score = max(score, 90)
        elif file_tokens and file_tokens.issubset(reference_tokens):
            score = max(score, 62 + len(file_tokens))
        elif overlap_file >= 2:
            score = max(score, 56 + overlap_file)
        if dob and dob == normalize_value(row.get("dob", "")):
            score += 1
        if score > best_score:
            best_row, best_score = row, score
        elif score == best_score and score:
            best_row = None
    if best_row is None or best_score < 61:
        return None, ""
    return best_row, "fuzzy"


def compare_member(member: dict[str, object], reference: dict[str, str], match_by: str, field_stats: dict[str, dict[str, int]]) -> dict[str, object]:
    extracted = extract_visual_notes(str(member.get("notes", "") or ""))
    mismatches = []
    for manifest_key, reference_key in COMPARE_FIELDS:
        raw_actual = extracted.get(manifest_key) if manifest_key in extracted else member_value(member, manifest_key)
        raw_expected = normalize_value(reference.get(reference_key, ""))
        actual = normalize_compare_value(manifest_key, raw_actual)
        expected = normalize_compare_value(manifest_key, raw_expected)
        if not expected:
            continue
        field_stats[manifest_key]["compared"] += 1
        if not compare_values(manifest_key, actual, expected):
            field_stats[manifest_key]["mismatched"] += 1
            mismatches.append({"field": manifest_key, "actual": raw_actual, "expected": raw_expected})
    reference_conflicts = detect_reference_conflicts(member, reference, mismatches)
    return {
        "fileName": member.get("fileName", ""), "status": member.get("status", ""), "matched": True,
        "matchBy": match_by, "passportNumber": member_value(member, "passportNumber"),
        "referencePassportNumber": reference.get("passportNumber", ""),
        "referenceFullName": reference.get("fullName", ""), "mismatches": mismatches,
        "referenceConflicts": reference_conflicts,
    }


def extract_visual_notes(notes: str) -> dict[str, str]:
    extracted: dict[str, str] = {}
    patterns = {"placeOfBirth": r"VISUAL PLACE OF BIRTH:\s*([^;]+)", "issuingOffice": r"VISUAL ISSUING OFFICE:\s*([^;]+)"}
    for field, pattern in patterns.items():
        match = re.search(pattern, notes.upper())
        if match:
            extracted[field] = normalize_value(match.group(1))
    return extracted


def normalize_value(value: object) -> str:
    return re.sub(r"\s+", " ", str(value or "").upper()).strip()


def normalize_compare_value(field_name: str, value: str) -> str:
    if field_name in {"placeOfBirth", "issuingOffice"}:
        normalized = normalize_location_value(field_name, value) or value
        return re.sub(r"[^A-Z]", "", normalized)
    return normalize_value(value)


def member_value(member: dict[str, object], field_name: str) -> str:
    extracted = _member_section(member, "passportExtracted")
    resolved = _member_section(member, "resolvedProfile")
    if field_name == "placeOfBirth":
        return str(extracted.get("birthCity", "") or resolved.get("birthCity", "") or member.get("placeOfBirth", "") or "")
    if field_name == "issuingOffice":
        return str(extracted.get("cityOfIssued", "") or resolved.get("cityOfIssued", "") or member.get("issuingOffice", "") or "")
    if field_name == "issueDate":
        return str(resolved.get("issueDate", "") or resolved.get("releaseDate", "") or extracted.get("issueDate", "") or member.get("issueDate", "") or "")
    return str(resolved.get(field_name, "") or extracted.get(field_name, "") or member.get(field_name, "") or "")


def compare_values(field_name: str, actual: str, expected: str) -> bool:
    if actual == expected:
        return True
    return field_name in {"placeOfBirth", "issuingOffice"} and bool(actual and expected) and SequenceMatcher(None, actual, expected).ratio() >= 0.92


def detect_reference_conflicts(member: dict[str, object], reference: dict[str, str], mismatches: list[dict[str, str]]) -> list[dict[str, str]]:
    mismatch_fields = {item["field"] for item in mismatches}
    if not mismatch_fields:
        return []

    conflicts: list[dict[str, str]] = []
    actual_issue = normalize_value(member_value(member, "issueDate"))
    actual_expiry = normalize_value(member_value(member, "expiryDate"))
    actual_dob = normalize_value(member_value(member, "dob"))
    reference_issue = normalize_value(reference.get("issueDate", ""))
    reference_expiry = normalize_value(reference.get("expiryDate", ""))
    reference_dob = normalize_value(reference.get("dob", ""))
    actual_term = passport_term_years(actual_issue, actual_expiry)
    reference_term = passport_term_years(reference_issue, reference_expiry)

    if actual_term in {5, 10} and reference_term not in {5, 10}:
        for field_name in ("issueDate", "expiryDate"):
            if field_name in mismatch_fields:
                conflicts.append(
                    {
                        "field": field_name,
                        "reason": f"reference issue/expiry pair looks unusual ({reference_term}Y term)",
                    }
                )
    if "issueDate" in mismatch_fields and reference_issue and reference_issue == reference_dob and actual_issue and actual_issue != reference_issue:
        conflicts.append({"field": "issueDate", "reason": "reference issueDate matches DOB"})
    return dedupe_conflicts(conflicts)


def normalize_filename_key(value: object) -> str:
    text = os.path.splitext(normalize_value(value))[0]
    for pattern in (r"^COPY OF\s+", r"^PASPOR\s+", r"^PASSPORT\s+", r"^0+\s*", r"IMG[_\s-]*\d+", r"\d+$"):
        text = re.sub(pattern, "", text)
    return re.sub(r"[^A-Z]", "", text)


def normalize_passport_tail(value: object) -> str:
    digits = re.sub(r"\D", "", normalize_value(value))
    return digits[-6:] if len(digits) >= 6 else ""


def extract_match_tokens(value: object, from_filename: bool = False) -> set[str]:
    text = normalize_value(value)
    if from_filename:
        text = os.path.splitext(text)[0]
        for pattern in (r"^COPY OF\s+", r"^PASPOR\s+", r"^PASSPORT\s+", r"IMG[_\s-]*\d+", r"\d+$"):
            text = re.sub(pattern, "", text)
    return {token for token in re.split(r"[^A-Z]+", text) if len(token) >= 3}


def discover_manifest_path() -> str:
    manifest_paths = [os.path.join(root, "manifest.json") for root, _, files in os.walk(DATA_DIR) if "manifest.json" in files]
    return max(manifest_paths, key=os.path.getmtime) if manifest_paths else os.path.join(DATA_DIR, "example-group", "manifest.json")


def _member_section(member: dict[str, object], key: str) -> dict[str, object]:
    section = member.get(key, {})
    return section if isinstance(section, dict) else {}


def _build_unique_reference_index(reference_rows: list[dict[str, str]], key_builder: object) -> dict[str, dict[str, str]]:
    buckets: dict[str, list[dict[str, str]]] = {}
    for row in reference_rows:
        key = str(key_builder(row) or "")
        if key:
            buckets.setdefault(key, []).append(row)
    return {key: rows[0] for key, rows in buckets.items() if len(rows) == 1}


def _has_matchable_identity(member: dict[str, object]) -> bool:
    return any(
        (
            member_value(member, "passportNumber"),
            member_value(member, "dob"),
            member_value(member, "firstName"),
            member_value(member, "familyName"),
        )
    )


def passport_term_years(issue_date: str, expiry_date: str) -> int:
    if not issue_date or not expiry_date:
        return -1
    if issue_date[5:] != expiry_date[5:]:
        return -1
    try:
        return int(expiry_date[:4]) - int(issue_date[:4])
    except ValueError:
        return -1


def dedupe_conflicts(conflicts: list[dict[str, str]]) -> list[dict[str, str]]:
    seen: set[tuple[str, str]] = set()
    unique: list[dict[str, str]] = []
    for item in conflicts:
        key = (item["field"], item["reason"])
        if key not in seen:
            unique.append(item)
            seen.add(key)
    return unique


def render_markdown(report: dict[str, object]) -> str:
    summary = report["summary"]
    lines = [
        "# Cross-check Summary", "",
        f"- Manifest: `{report['manifestPath']}`", f"- Reference: `{report['referencePath']}`",
        f"- Scanned members: `{summary['scannedMembers']}`", f"- Comparable members: `{summary['comparableMembers']}`",
        f"- Skipped members without reference: `{summary['skippedMembers']}`",
        f"- Total field mismatches: `{summary['totalFieldMismatches']}`", "",
        "## Field Stats", "", "| Field | Compared | Mismatched | Accuracy |", "| --- | ---: | ---: | ---: |",
    ]
    if summary.get("suspectedReferenceConflicts"):
        lines.insert(7, f"- Suspected reference conflicts: `{summary['suspectedReferenceConflicts']}`")
    for field_name, stats in report["fieldStats"].items():
        compared = stats["compared"]
        mismatched = stats["mismatched"]
        accuracy = f"{round((1 - mismatched / compared) * 100, 1)}%" if compared else "-"
        lines.append(f"| {field_name} | {compared} | {mismatched} | {accuracy} |")
    if report["skipped"]:
        lines.extend(["", "## Skipped Members", ""])
        for item in report["skipped"]:
            lines.append(f"- `{item['fileName']}` passport=`{item['passportNumber']}` status=`{item['status']}`")
    lines.extend(["", "## Member Mismatches", ""])
    mismatched_members = [item for item in report["comparisons"] if item["mismatches"]]
    if not mismatched_members:
        return "\n".join(lines + ["No mismatches found."]) + "\n"
    for item in mismatched_members:
        lines.append(f"### {item['fileName']}")
        lines.append(f"- Match by: `{item['matchBy'] or 'unmatched'}`")
        lines.append(f"- Reference: `{item['referenceFullName']}` / `{item['referencePassportNumber']}`")
        for mismatch in item["mismatches"]:
            lines.append(f"- `{mismatch['field']}`: actual=`{mismatch['actual']}` expected=`{mismatch['expected']}`")
        for conflict in item.get("referenceConflicts", []):
            lines.append(f"- `referenceConflict.{conflict['field']}`: {conflict['reason']}")
        lines.append("")
    return "\n".join(lines).strip() + "\n"


def print_summary(report: dict[str, object]) -> None:
    summary = report["summary"]
    print(f"Compared {summary['comparableMembers']} members and skipped {summary['skippedMembers']} without reference; {summary['totalFieldMismatches']} field mismatches.")


if __name__ == "__main__":
    main()
