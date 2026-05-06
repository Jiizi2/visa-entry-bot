from __future__ import annotations

import argparse
import csv
import html
import json
import os
from pathlib import Path
from typing import Any
from urllib.parse import quote

from apply_golden_candidates import REVIEW_FIELDS, apply_review_sheet


def main() -> int:
    args = parse_args()
    candidate_report = load_candidate_report(args.candidates)
    if args.review_sheet:
        candidate_report = apply_review_sheet(candidate_report, load_review_sheet(args.review_sheet))
    payload = build_review_html(candidate_report, output=args.output)
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(payload, encoding="utf-8")
    print(json.dumps({"candidateCount": len(_candidate_items(candidate_report)), "output": str(args.output)}, indent=2))
    return 0


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Export golden candidates to a static HTML review pack.")
    parser.add_argument("candidates", type=Path, help="Candidate report from prepare_golden_candidates.py.")
    parser.add_argument("--review-sheet", type=Path, help="Optional CSV review sheet to overlay corrected values and approvals.")
    parser.add_argument("--output", type=Path, required=True, help="HTML file to write.")
    return parser.parse_args()


def load_candidate_report(path: Path) -> dict[str, Any]:
    payload = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(payload, dict):
        raise ValueError("Candidate report must be an object.")
    return payload


def load_review_sheet(path: Path) -> list[dict[str, str]]:
    with path.open("r", encoding="utf-8-sig", newline="") as handle:
        return [{str(key): str(value or "") for key, value in row.items()} for row in csv.DictReader(handle)]


def build_review_html(candidate_report: dict[str, Any], *, output: Path | None = None) -> str:
    candidates = _candidate_items(candidate_report)
    status_counts = _status_counts(candidates)
    approved_count = sum(1 for candidate in candidates if candidate.get("reviewApproved", False))
    sections = "\n".join(_candidate_section(candidate, output=output) for candidate in candidates)
    return f"""<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Golden OCR Review Pack</title>
  <style>
    :root {{
      color-scheme: light;
      font-family: Arial, Helvetica, sans-serif;
      background: #f7f8fa;
      color: #1c2530;
    }}
    body {{
      margin: 0;
      padding: 24px;
    }}
    header {{
      margin: 0 0 20px;
    }}
    h1 {{
      margin: 0 0 6px;
      font-size: 28px;
      letter-spacing: 0;
    }}
    .summary {{
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
      margin: 14px 0 0;
    }}
    .badge {{
      display: inline-flex;
      align-items: center;
      min-height: 26px;
      padding: 0 10px;
      border-radius: 6px;
      background: #e8edf2;
      font-size: 13px;
      font-weight: 700;
    }}
    .badge.valid {{ background: #dff3e7; color: #13552b; }}
    .badge.review {{ background: #fff1cc; color: #765000; }}
    .badge.error {{ background: #ffe1df; color: #8d1b15; }}
    .badge.pending {{ background: #e8edf2; color: #354352; }}
    .card {{
      margin: 0 0 22px;
      padding: 16px;
      border: 1px solid #d6dde5;
      border-radius: 8px;
      background: #ffffff;
    }}
    .card-header {{
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
      justify-content: space-between;
      align-items: flex-start;
      margin-bottom: 14px;
    }}
    h2 {{
      margin: 0;
      max-width: 100%;
      font-size: 18px;
      letter-spacing: 0;
      overflow-wrap: anywhere;
    }}
    .source {{
      margin-top: 4px;
      color: #5b6876;
      font-size: 12px;
      overflow-wrap: anywhere;
    }}
    .layout {{
      display: grid;
      grid-template-columns: minmax(280px, 46%) minmax(280px, 1fr);
      gap: 16px;
      align-items: start;
    }}
    img {{
      display: block;
      width: 100%;
      max-height: 760px;
      object-fit: contain;
      border: 1px solid #d8dfe7;
      border-radius: 6px;
      background: #f1f3f6;
    }}
    table {{
      width: 100%;
      border-collapse: collapse;
      font-size: 14px;
      min-width: 520px;
    }}
    .table-wrap {{
      width: 100%;
      overflow-x: auto;
    }}
    th, td {{
      padding: 9px 10px;
      border-bottom: 1px solid #e3e8ee;
      text-align: left;
      vertical-align: top;
    }}
    th {{
      width: 36%;
      color: #52606f;
      font-weight: 700;
    }}
    td {{
      white-space: nowrap;
      overflow-wrap: normal;
      font-weight: 700;
    }}
    .reasons {{
      margin-top: 12px;
      color: #4b5968;
      font-size: 13px;
      overflow-wrap: anywhere;
    }}
    @media (max-width: 860px) {{
      body {{ padding: 12px; }}
      .layout {{ grid-template-columns: 1fr; }}
    }}
  </style>
</head>
<body>
  <header>
    <h1>Golden OCR Review Pack</h1>
    <div>{_escape(str(candidate_report.get("passportsDir", "") or ""))}</div>
    <div class="summary">
      <span class="badge pending">Candidates: {len(candidates)}</span>
      <span class="badge valid">Approved: {approved_count}</span>
      <span class="badge valid">VALID: {status_counts.get("VALID", 0)}</span>
      <span class="badge review">NEEDS_REVIEW: {status_counts.get("NEEDS_REVIEW", 0)}</span>
      <span class="badge error">ERROR: {status_counts.get("ERROR", 0)}</span>
    </div>
  </header>
  <main>
{sections}
  </main>
</body>
</html>
"""


def _candidate_section(candidate: dict[str, Any], *, output: Path | None) -> str:
    expected = _expected_fields(candidate)
    field_rows = "\n".join(
        f"          <tr><th>{_escape(field_name)}</th><td>{_escape(str(expected.get(field_name, '') or ''))}</td></tr>"
        for field_name in REVIEW_FIELDS
    )
    record_status = str(candidate.get("recordReviewStatus", "") or candidate.get("recordStatus", "") or "")
    approval_label = "APPROVED" if candidate.get("reviewApproved", False) else "PENDING"
    approval_class = "valid" if candidate.get("reviewApproved", False) else "pending"
    status_class = _status_class(record_status)
    source_path = str(candidate.get("sourcePath", "") or "")
    image_src = _image_src(source_path, output=output)
    return f"""    <section class="card">
      <div class="card-header">
        <div>
          <h2>{_escape(str(candidate.get("fileName", "") or ""))}</h2>
          <div class="source">{_escape(source_path)}</div>
        </div>
        <div>
          <span class="badge {approval_class}">{approval_label}</span>
          <span class="badge {status_class}">{_escape(record_status or "UNKNOWN")}</span>
        </div>
      </div>
      <div class="layout">
        <a href="{image_src}"><img src="{image_src}" alt="{_escape(str(candidate.get('fileName', '') or 'passport image'))}"></a>
        <div>
          <div class="table-wrap">
          <table>
{field_rows}
          </table>
          </div>
          <div class="reasons">Review reasons: {_escape(_join_reason_list(candidate.get("reviewReasons", [])))}</div>
          <div class="reasons">Record reasons: {_escape(_join_reason_list(candidate.get("recordReviewReasons", [])))}</div>
          <div class="reasons">Notes: {_escape(str(candidate.get("reviewNotes", "") or ""))}</div>
        </div>
      </div>
    </section>"""


def _candidate_items(candidate_report: dict[str, Any]) -> list[dict[str, Any]]:
    candidates = candidate_report.get("candidates", [])
    return [item for item in candidates if isinstance(item, dict)] if isinstance(candidates, list) else []


def _expected_fields(candidate: dict[str, Any]) -> dict[str, str]:
    draft = candidate.get("goldenDraft", {})
    expected = draft.get("expected", {}) if isinstance(draft, dict) else {}
    if not isinstance(expected, dict):
        expected = candidate.get("candidateExpected", {})
    return {str(key): str(value or "") for key, value in expected.items()} if isinstance(expected, dict) else {}


def _status_counts(candidates: list[dict[str, Any]]) -> dict[str, int]:
    counts = {"VALID": 0, "NEEDS_REVIEW": 0, "ERROR": 0}
    for candidate in candidates:
        status = str(candidate.get("recordReviewStatus", "") or candidate.get("recordStatus", "") or "").upper()
        if status:
            counts[status] = counts.get(status, 0) + 1
    return counts


def _status_class(status: str) -> str:
    normalized = status.upper()
    if normalized == "VALID":
        return "valid"
    if normalized == "NEEDS_REVIEW":
        return "review"
    if normalized == "ERROR":
        return "error"
    return "pending"


def _image_src(source_path: str, *, output: Path | None) -> str:
    if not source_path:
        return ""
    source = Path(source_path)
    if output:
        try:
            relative = os.path.relpath(source.resolve(), output.parent.resolve())
            return quote(relative.replace(os.sep, "/"), safe="/:._-")
        except OSError:
            pass
    return quote(source.as_posix(), safe="/:._-")


def _join_reason_list(value: Any) -> str:
    if isinstance(value, list):
        return ", ".join(str(item) for item in value if item)
    return str(value or "")


def _escape(value: str) -> str:
    return html.escape(value, quote=True)


if __name__ == "__main__":
    raise SystemExit(main())
