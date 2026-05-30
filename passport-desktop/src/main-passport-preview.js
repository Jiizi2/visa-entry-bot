import { basenameFromPath, formatDurationMs } from "./main-utils.js";
import { memberScanTotalMs } from "./main-metrics.js";
import { memberDisplayName } from "./main-members.js";
import {
  passportCropApplied,
  passportPreviewImagePathForMember,
} from "./main-passport-image.js";

export const PASSPORT_PREVIEW_ZOOM_DEFAULT = 1;
export const PASSPORT_PREVIEW_ZOOM_MIN = 0.85;
export const PASSPORT_PREVIEW_ZOOM_MAX = 2.5;
export const PASSPORT_PREVIEW_ZOOM_STEP = 0.15;
export const PASSPORT_PREVIEW_WHEEL_STEP = 0.1;
export const PASSPORT_PREVIEW_WHEEL_THRESHOLD = 120;

export function createPassportPreviewController({
  state,
  dom,
  requestFrame,
  activeMember,
  isMemberReviewConfirmed,
  loadPassportImageData,
}) {
  let imageRequestId = 0;
  let wheelDelta = 0;

  function render() {
    if (!dom.passportPreviewImage || !dom.passportPreviewEmpty) {
      return;
    }

    const member = activeMember();
    if (!member) {
      dom.passportPreviewImage.removeAttribute("src");
      dom.passportPreviewImage.classList.add("is-hidden");
      dom.passportPreviewEmpty.classList.remove("is-hidden");
      dom.passportPreviewEmpty.textContent = "Belum ada passport dipilih.";
      if (dom.passportPreviewName) {
        dom.passportPreviewName.textContent = "Belum ada data";
      }
      if (dom.passportPreviewFile) {
        dom.passportPreviewFile.textContent = "Jalankan scan atau buka riwayat terlebih dahulu.";
      }
      if (dom.passportPreviewStatus) {
        dom.passportPreviewStatus.textContent = "Menunggu";
        dom.passportPreviewStatus.className = "passport-preview-status neutral";
      }
      if (dom.passportPreviewCropStatus) {
        dom.passportPreviewCropStatus.textContent = "Belum ada foto";
        dom.passportPreviewCropStatus.className = "passport-crop-status neutral";
      }
      resetZoomState();
      return;
    }

    if (dom.passportPreviewName) {
      dom.passportPreviewName.textContent = memberDisplayName(member);
    }
    if (dom.passportPreviewFile) {
      const imagePath = passportPreviewImagePathForMember(member);
      const fileLabel = member.fileName || basenameFromPath(imagePath || "");
      const scanDurationMs = memberScanTotalMs(member);
      dom.passportPreviewFile.textContent = scanDurationMs > 0
        ? `${fileLabel} | Scan ${formatDurationMs(scanDurationMs)}`
        : fileLabel;
    }
    if (dom.passportPreviewStatus) {
      const reviewed = isMemberReviewConfirmed(member);
      dom.passportPreviewStatus.textContent = reviewed ? "Sudah direview" : "Belum direview";
      dom.passportPreviewStatus.className = `passport-preview-status ${reviewed ? "valid" : "warn"}`;
    }
    if (dom.passportPreviewCropStatus) {
      const cropped = passportCropApplied(member);
      dom.passportPreviewCropStatus.textContent = cropped ? "Crop Nusuk siap" : "Belum dicrop";
      dom.passportPreviewCropStatus.className = `passport-crop-status ${cropped ? "valid" : "neutral"}`;
    }

    void ensureImageForMember(member);
  }

  async function ensureImageForMember(member) {
    const memberId = String(member?.id || "");
    if (!memberId || !dom.passportPreviewImage || !dom.passportPreviewEmpty) {
      return;
    }

    const cached = state.passportImageCache.get(memberId);
    if (cached) {
      applyImageResult(memberId, cached);
      return;
    }

    const requestId = ++imageRequestId;
    applyImageResult(memberId, {
      status: "loading",
      message: "Memuat foto passport...",
      src: "",
      path: "",
    });

    try {
      const imageData = await loadPassportImageData({
        manifestPath: state.manifestPath,
        imagePath: passportPreviewImagePathForMember(member),
        fileName: String(member.fileName || ""),
      });
      const result = imageData?.dataUrl
        ? {
            status: "ready",
            message: "",
            src: imageData.dataUrl,
            path: imageData.path || "",
          }
        : {
            status: "missing",
            message: "File gambar passport tidak ditemukan.",
            src: "",
            path: "",
          };
      state.passportImageCache.set(memberId, result);
      if (requestId === imageRequestId && String(activeMember()?.id || "") === memberId) {
        applyImageResult(memberId, result);
      }
    } catch (error) {
      const result = {
        status: "error",
        message: `Gagal memuat foto passport: ${String(error)}`,
        src: "",
        path: "",
      };
      state.passportImageCache.set(memberId, result);
      if (requestId === imageRequestId && String(activeMember()?.id || "") === memberId) {
        applyImageResult(memberId, result);
      }
    }
  }

  function applyImageResult(memberId, result) {
    if (!dom.passportPreviewImage || !dom.passportPreviewEmpty || String(activeMember()?.id || "") !== memberId) {
      return;
    }

    if (result.status === "ready" && result.src) {
      dom.passportPreviewEmpty.classList.add("is-hidden");
      dom.passportPreviewImage.classList.remove("is-hidden");
      const sourceChanged = dom.passportPreviewImage.getAttribute("src") !== result.src;
      if (sourceChanged) {
        dom.passportPreviewImage.src = result.src;
      }
      dom.passportPreviewImage.alt = activeMember()?.fileName
        ? `Foto passport ${activeMember().fileName}`
        : "Foto passport";
      applyZoom({ centerRatio: sourceChanged ? { x: 0.5, y: 0.5 } : null });
      return;
    }

    dom.passportPreviewImage.removeAttribute("src");
    dom.passportPreviewImage.classList.add("is-hidden");
    dom.passportPreviewEmpty.classList.remove("is-hidden");
    dom.passportPreviewEmpty.textContent = result.message || "Foto passport belum tersedia.";
    renderZoomControls();
  }

  function changeZoom(delta) {
    if (!isImageReady()) {
      return;
    }
    setZoom(state.passportPreviewZoom + delta, { keepViewportCenter: true });
  }

  function resetZoom() {
    if (!isImageReady()) {
      return;
    }
    setZoom(PASSPORT_PREVIEW_ZOOM_DEFAULT, { centerRatio: { x: 0.5, y: 0.5 } });
  }

  function resetZoomState() {
    state.passportPreviewZoom = PASSPORT_PREVIEW_ZOOM_DEFAULT;
    wheelDelta = 0;
    applyZoom();
  }

  function setZoom(nextZoom, options = {}) {
    const zoom = clampPassportPreviewZoom(nextZoom);
    const previousZoom = state.passportPreviewZoom;
    const centerRatio = options.centerRatio
      || (options.keepViewportCenter ? scrollCenterRatio() : null);

    if (Math.abs(zoom - previousZoom) < 0.001) {
      renderZoomControls();
      return;
    }

    state.passportPreviewZoom = zoom;
    applyZoom({ centerRatio });
  }

  function applyZoom(options = {}) {
    state.passportPreviewZoom = clampPassportPreviewZoom(state.passportPreviewZoom);
    const zoom = state.passportPreviewZoom;
    const hasImage = isImageReady();

    if (dom.passportPreviewFrame) {
      dom.passportPreviewFrame.style.setProperty("--passport-preview-zoom", zoom.toFixed(2));
      dom.passportPreviewFrame.classList.toggle("is-zoomed", hasImage && zoom > PASSPORT_PREVIEW_ZOOM_DEFAULT + 0.001);
    }

    renderZoomControls();

    if (options.centerRatio && dom.passportPreviewFrame) {
      requestFrame(() => {
        restoreScrollCenter(options.centerRatio);
      });
    }
  }

  function handleWheel(event) {
    if (!event.ctrlKey || !isImageReady()) {
      return;
    }

    event.preventDefault();
    wheelDelta += event.deltaY;
    if (Math.abs(wheelDelta) < PASSPORT_PREVIEW_WHEEL_THRESHOLD) {
      return;
    }

    const direction = wheelDelta > 0 ? -1 : 1;
    wheelDelta = 0;
    changeZoom(direction * PASSPORT_PREVIEW_WHEEL_STEP);
  }

  function handleKeydown(event) {
    if (!isImageReady()) {
      return;
    }

    if (event.key === "+" || event.key === "=") {
      event.preventDefault();
      changeZoom(PASSPORT_PREVIEW_ZOOM_STEP);
      return;
    }
    if (event.key === "-" || event.key === "_") {
      event.preventDefault();
      changeZoom(-PASSPORT_PREVIEW_ZOOM_STEP);
      return;
    }
    if (event.key === "0") {
      event.preventDefault();
      resetZoom();
    }
  }

  function renderZoomControls() {
    const hasImage = isImageReady();
    const zoom = clampPassportPreviewZoom(state.passportPreviewZoom);

    if (dom.passportZoomLabel) {
      dom.passportZoomLabel.textContent = `${Math.round(zoom * 100)}%`;
    }
    if (dom.passportZoomOutButton) {
      dom.passportZoomOutButton.disabled = !hasImage || zoom <= PASSPORT_PREVIEW_ZOOM_MIN + 0.001;
    }
    if (dom.passportZoomInButton) {
      dom.passportZoomInButton.disabled = !hasImage || zoom >= PASSPORT_PREVIEW_ZOOM_MAX - 0.001;
    }
    if (dom.passportZoomResetButton) {
      dom.passportZoomResetButton.disabled = !hasImage || Math.abs(zoom - PASSPORT_PREVIEW_ZOOM_DEFAULT) < 0.001;
    }
    if (dom.passportCropButton) {
      dom.passportCropButton.disabled = !hasImage;
      dom.passportCropButton.setAttribute("aria-disabled", dom.passportCropButton.disabled ? "true" : "false");
    }
  }

  function scrollCenterRatio() {
    const frame = dom.passportPreviewFrame;
    if (!frame) {
      return { x: 0.5, y: 0.5 };
    }

    const scrollWidth = Math.max(1, frame.scrollWidth);
    const scrollHeight = Math.max(1, frame.scrollHeight);
    return {
      x: (frame.scrollLeft + (frame.clientWidth / 2)) / scrollWidth,
      y: (frame.scrollTop + (frame.clientHeight / 2)) / scrollHeight,
    };
  }

  function restoreScrollCenter(centerRatio) {
    const frame = dom.passportPreviewFrame;
    if (!frame) {
      return;
    }

    const maxLeft = Math.max(0, frame.scrollWidth - frame.clientWidth);
    const maxTop = Math.max(0, frame.scrollHeight - frame.clientHeight);
    frame.scrollLeft = Math.min(maxLeft, Math.max(0, (frame.scrollWidth * centerRatio.x) - (frame.clientWidth / 2)));
    frame.scrollTop = Math.min(maxTop, Math.max(0, (frame.scrollHeight * centerRatio.y) - (frame.clientHeight / 2)));
  }

  function isImageReady() {
    return Boolean(
      dom.passportPreviewImage
      && !dom.passportPreviewImage.classList.contains("is-hidden")
      && dom.passportPreviewImage.getAttribute("src")
    );
  }

  return {
    render,
    changeZoom,
    resetZoom,
    handleWheel,
    handleKeydown,
    renderZoomControls,
    resetZoomState,
    isImageReady,
  };
}

export function clampPassportPreviewZoom(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return PASSPORT_PREVIEW_ZOOM_DEFAULT;
  }
  const clamped = Math.min(PASSPORT_PREVIEW_ZOOM_MAX, Math.max(PASSPORT_PREVIEW_ZOOM_MIN, numeric));
  return Math.round(clamped * 100) / 100;
}
