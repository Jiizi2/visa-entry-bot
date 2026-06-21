from __future__ import annotations

import os
import re
import shutil
from dataclasses import dataclass

from services.mrz_validation import validate_td3_line2
from services.ocr_runner import build_ocr_config, run_rapid_ocr


DEFAULT_PDF_DPI = 200
MAX_PDF_DPI = 200
DEFAULT_JPEG_QUALITY = 85
PDF_PREFLIGHT_DPI = 110
PDF_PREFLIGHT_TIMEOUT_SECONDS = 1.5
PDF_PREFLIGHT_MIN_PASSPORT_SCORE = 70
PDF_PREFLIGHT_MRZ_WHITELIST = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789<"
PASSPORT_KEYWORDS = (
    "INDONESIA",
    "NATIONALITY",
    "PASPOR",
    "PASSPORT",
    "REPUBLIC",
    "REPUBLIK",
)


class PdfConversionError(RuntimeError):
    pass


@dataclass(frozen=True)
class PdfImageConversionResult:
    selected_paths: list[str]
    skipped_paths: list[str]
    page_scores: list[int]
    selected_page_indices: tuple[int, ...]


def convert_pdf_to_images(
    pdf_path: str,
    output_dir: str,
    *,
    dpi: int = DEFAULT_PDF_DPI,
    jpeg_quality: int = DEFAULT_JPEG_QUALITY,
    preflight: bool = True,
    include_skipped: bool = False,
) -> list[str] | PdfImageConversionResult:
    result = _convert_pdf_to_image_result(
        pdf_path,
        output_dir,
        dpi=dpi,
        jpeg_quality=jpeg_quality,
        preflight=preflight,
        render_skipped=include_skipped,
    )
    return result if include_skipped else result.selected_paths


def _convert_pdf_to_image_result(
    pdf_path: str,
    output_dir: str,
    *,
    dpi: int,
    jpeg_quality: int,
    preflight: bool,
    render_skipped: bool,
) -> PdfImageConversionResult:
    try:
        import pypdfium2 as pdfium
    except ImportError as exc:  # pragma: no cover - depends on local environment
        raise PdfConversionError(
            "PDF renderer pypdfium2 belum terpasang. Jalankan instalasi requirements Python terbaru."
        ) from exc

    normalized_dpi = max(72, min(int(dpi or DEFAULT_PDF_DPI), MAX_PDF_DPI))
    normalized_quality = max(60, min(int(jpeg_quality or DEFAULT_JPEG_QUALITY), 95))
    scale = normalized_dpi / 72.0
    os.makedirs(output_dir, exist_ok=True)

    document = None
    output_paths: list[str] = []
    selected_paths: list[str] = []
    skipped_paths: list[str] = []
    try:
        document = pdfium.PdfDocument(pdf_path)
        page_count = len(document)
        if page_count <= 0:
            return PdfImageConversionResult([], [], [], ())

        stem = _safe_stem(pdf_path)
        is_batch_mode = os.environ.get("PASSPORT_PDF_BATCH_MODE") == "1"
        
        if is_batch_mode:
            page_scores = [100] * page_count
            selected_page_indices = tuple(range(page_count))
        else:
            page_scores = _first_page_only_scores(page_count)
            selected_page_indices = (0,)
            
        selected_set = set(selected_page_indices)
        render_indices = tuple(range(page_count)) if render_skipped else selected_page_indices
        for page_index in render_indices:
            page = None
            bitmap = None
            image = None
            output_path = os.path.join(output_dir, f"{stem}_page_{page_index + 1:03d}.jpg")
            try:
                page = document[page_index]
                bitmap = page.render(scale=scale)
                image = bitmap.to_pil()
                if image.mode != "RGB":
                    image = image.convert("RGB")
                image.save(output_path, format="JPEG", quality=normalized_quality, optimize=True)
                output_paths.append(output_path)
                if page_index in selected_set:
                    selected_paths.append(output_path)
                else:
                    skipped_paths.append(output_path)
            finally:
                if image is not None:
                    close = getattr(image, "close", None)
                    if callable(close):
                        close()
                if bitmap is not None:
                    close = getattr(bitmap, "close", None)
                    if callable(close):
                        close()
                if page is not None:
                    close = getattr(page, "close", None)
                    if callable(close):
                        close()
    except Exception as exc:  # noqa: BLE001
        for output_path in output_paths:
            try:
                if os.path.exists(output_path):
                    os.remove(output_path)
            except OSError:
                continue
        if isinstance(exc, PdfConversionError):
            raise
        raise PdfConversionError(f"Gagal mengubah PDF menjadi JPG: {exc}") from exc
    finally:
        if document is not None:
            close = getattr(document, "close", None)
            if callable(close):
                close()

    return PdfImageConversionResult(selected_paths, skipped_paths, page_scores, selected_page_indices)


def _select_pdf_page_indices(document: object, page_count: int) -> tuple[int, ...]:
    if page_count <= 1:
        return tuple(range(page_count))

    return _select_pdf_page_indices_from_scores(_score_pdf_pages(document, page_count))


def _score_pdf_pages(document: object, page_count: int) -> list[int]:
    scores: list[int] = []
    for page_index in range(page_count):
        scores.append(_score_pdf_page(document, page_index))
    return scores


def _select_pdf_page_indices_from_scores(scores: list[int]) -> tuple[int, ...]:
    if scores:
        return (0,)
    return ()


def _first_page_only_scores(page_count: int) -> list[int]:
    if page_count <= 0:
        return []
    return [PDF_PREFLIGHT_MIN_PASSPORT_SCORE] + [0] * (page_count - 1)


def _score_pdf_page(document: object, page_index: int) -> int:
    page = None
    bitmap = None
    image = None
    try:
        page = document[page_index]
        bitmap = page.render(scale=PDF_PREFLIGHT_DPI / 72.0)
        image = bitmap.to_pil()
        text = _ocr_pdf_preflight_image(image)
        return _score_pdf_preflight_text(text)
    except Exception:  # noqa: BLE001
        return 0
    finally:
        if image is not None:
            close = getattr(image, "close", None)
            if callable(close):
                close()
        if bitmap is not None:
            close = getattr(bitmap, "close", None)
            if callable(close):
                close()
        if page is not None:
            close = getattr(page, "close", None)
            if callable(close):
                close()


def _ocr_pdf_preflight_image(image: object) -> str:
    config = build_ocr_config(
        whitelist=PDF_PREFLIGHT_MRZ_WHITELIST,
        dpi=PDF_PREFLIGHT_DPI,
    )
    return run_rapid_ocr(image, config, timeout_seconds=PDF_PREFLIGHT_TIMEOUT_SECONDS)


def _score_pdf_preflight_text(text: str) -> int:
    raw_text = str(text or "").upper()
    lines = [re.sub(r"[^A-Z0-9<]", "", line.upper()) for line in raw_text.splitlines()]
    lines = [line for line in lines if line]
    if not lines:
        return 0

    score = 0
    if any(keyword in raw_text for keyword in PASSPORT_KEYWORDS):
        score += min(30, sum(1 for keyword in PASSPORT_KEYWORDS if keyword in raw_text) * 8)

    long_mrz_lines = [line for line in lines if len(line) >= 30 and line.count("<") >= 4]
    if len(long_mrz_lines) >= 2:
        score += 55
    elif long_mrz_lines:
        score += 35

    if any(_looks_like_td3_line1(line) for line in lines):
        score += 70
    if any(line.startswith("P<IDN") for line in lines):
        score += 30

    for line in lines:
        candidate = line[:44].ljust(44, "<")
        validation = validate_td3_line2(candidate)
        if validation.valid_check_count:
            score = max(score, 45 + validation.valid_check_count * 15)
        if validation.valid:
            score = max(score, 120)

    return min(score, 150)


def _looks_like_td3_line1(line: str) -> bool:
    if len(line) < 30:
        return False
    repaired = line.replace("P1", "P<", 1).replace("PI", "P<", 1)
    if not repaired.startswith("P"):
        return False
    return repaired.startswith("P<IDN") or (repaired.startswith("P<") and repaired.count("<") >= 4)







def _safe_stem(path: str) -> str:
    stem = os.path.splitext(os.path.basename(path))[0]
    cleaned = re.sub(r"[^A-Za-z0-9._-]+", "_", stem).strip("._-")
    return cleaned or "passport_pdf"
