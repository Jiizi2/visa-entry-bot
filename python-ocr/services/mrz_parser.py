from __future__ import annotations

import re
from dataclasses import dataclass, replace
from typing import Any

from services.mrz_validation import calculate_mrz_check_digit as _mrz_check_digit
from services.mrz_validation import validate_td3_line2


@dataclass(frozen=True)
class DirectMrzResult:
    line1: str
    line2: str
    valid_score: int
    valid: bool = True
    rotation_degrees: int = 0

    @property
    def raw_text(self) -> str:
        return f"{self.line1}\n{self.line2}"

    @property
    def text(self) -> str:
        return self.raw_text

    @property
    def mrz_text(self) -> str:
        return self.raw_text

    def to_dict(self) -> dict[str, Any]:
        return {
            "line1": self.line1,
            "line2": self.line2,
            "raw_text": self.raw_text,
            "text": self.raw_text,
            "mrz_text": self.raw_text,
            "rotationDegrees": self.rotation_degrees,
        }


def _clean_direct_mrz_lines(text: str) -> list[str]:
    lines: list[str] = []
    for raw_line in str(text or "").splitlines():
        cleaned = re.sub(r"[^A-Z0-9<]", "", raw_line.upper())
        if len(cleaned.replace("<", "")) >= 8:
            lines.append(cleaned)
    return lines


def _direct_mrz_candidates_from_lines(lines: list[str]) -> list[DirectMrzResult]:
    candidates: list[DirectMrzResult] = []
    for index, line in enumerate(lines):
        if len(line) >= 10 and line[0] == "P" and (line[1] == "<" or line.count("<") >= 2 or "IDN" in line[1:8] or line.startswith(("P1", "PI"))):
            line1 = _repair_direct_line1(line)
            for line2 in _direct_line2_candidates(lines[index + 1 :]):
                score = _score_direct_mrz(line1, line2)
                if score >= 70:
                    candidates.append(DirectMrzResult(line1=line1, line2=line2, valid_score=score))
    return candidates


def _repair_direct_line1(value: str) -> str:
    line = value
    if len(line) >= 5 and line[0] == "P" and line[1] != "<" and not line.startswith(("P1", "PI")):
        line = "P<" + line[2:]
    line = line.replace("P1", "P<", 1).replace("PI", "P<", 1)
    if line.startswith("P<ID") and len(line) >= 5 and line[4] != "N":
        line = f"P<IDN{line[5:]}"
    return line[:44].ljust(44, "<")


def _pick_direct_line2(lines: list[str]) -> str:
    return next(iter(_direct_line2_candidates(lines)), "")


def _direct_line2_candidates(lines: list[str]) -> list[str]:
    candidates: list[str] = []
    for line in lines[:4]:
        candidate = _repair_direct_line2(line)
        if _score_direct_line2(candidate) >= 2:
            candidates.append(candidate)
    return sorted(set(candidates), key=_score_direct_line2, reverse=True)


def _repair_direct_line2(value: str) -> str:
    line = value[:44].ljust(44, "<")
    candidates = {line}
    candidates.update(_direct_line2_alignment_repairs(line))
    repaired = {_repair_direct_line2_digits(_repair_direct_line2_country(candidate)) for candidate in candidates}
    repaired.update(_repair_missing_composite_check_digit(candidate) for candidate in list(repaired))
    return max(repaired, key=_line2_repair_score)


def _direct_line2_alignment_repairs(line: str) -> set[str]:
    repairs: set[str] = set()
    if len(line) != 44:
        return repairs
    if line[0] in {"1", "7", "I", "L"} and line[1:8].isdigit() and line[8] == "<":
        repairs.add("E" + line[1:])
    if re.match(r"^[A-Z0-9][EX]\d{7}<", line):
        repairs.add((line[1:] + "<")[:44].ljust(44, "<"))
    return repairs


def _repair_direct_line2_digits(line: str) -> str:
    chars = list(line)
    digit_table = str.maketrans({"O": "0", "Q": "0", "D": "0", "I": "1", "L": "1", "S": "5", "B": "8", "Z": "2", "G": "6"})
    for index in (9, 42, 43):
        if index < len(chars):
            chars[index] = chars[index].translate(digit_table)
    for start, end in ((13, 20), (21, 28)):
        for index in range(start, min(end, len(chars))):
            chars[index] = chars[index].translate(digit_table)
    if len(chars) > 20 and chars[20] in {"L", "I", "1"}:
        chars[20] = "M"
    if len(chars) > 20 and chars[20] == "P":
        chars[20] = "F"
    return "".join(chars)


def _repair_missing_composite_check_digit(line: str) -> str:
    result = validate_td3_line2(line)
    if result.valid or result.valid_check_count < 4 or len(line) != 44:
        return line
    if line[43].isdigit():
        return line
    chars = list(line)
    chars[43] = _mrz_check_digit(line[0:10] + line[13:20] + line[21:43])
    candidate = "".join(chars)
    return candidate if validate_td3_line2(candidate).valid_check_count > result.valid_check_count else line


def _line2_repair_score(line: str) -> tuple[int, int, int]:
    result = validate_td3_line2(line)
    return (100 if result.valid else 0, result.valid_check_count, _score_direct_line2(line))


def _repair_direct_line2_country(line: str) -> str:
    if len(line) < 14:
        return line

    def normalize_country(value: str) -> str:
        table = str.maketrans({"1": "I", "L": "I", "0": "D", "O": "D", "Q": "D"})
        return value.translate(table)

    if normalize_country(line[10:13]) == "IDN":
        return f"{line[:10]}IDN{line[13:]}"[:44].ljust(44, "<")
    if normalize_country(line[11:14]) == "IDN" and line[10] in {"1", "I", "L", "<"}:
        shifted = line[:10] + line[11:] + "<"
        return f"{shifted[:10]}IDN{shifted[13:]}"[:44].ljust(44, "<")
    return line


def _score_direct_mrz(line1: str, line2: str) -> int:
    score = 62 + _score_direct_line2(line2) * 12
    if line1.startswith("P<") and "<<" in line1:
        score += 8
    return min(score, 100)


def _score_direct_line2(line2: str) -> int:
    checks = 0
    checks += _mrz_check_digit(line2[0:9]) == line2[9]
    checks += _mrz_check_digit(line2[13:19]) == line2[19]
    checks += _mrz_check_digit(line2[21:27]) == line2[27]
    return int(checks)


def _mrz_char_value(char: str) -> int:
    if char == "<":
        return 0
    if char.isdigit():
        return int(char)
    if "A" <= char <= "Z":
        return ord(char) - 55
    return 0
