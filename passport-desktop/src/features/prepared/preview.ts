import { basenameFromPath, escapeHtml } from "../../shared/utils.js";

const PREPARED_IMAGE_OUTPUT_TYPE = "image/jpeg";
const PREPARED_IMAGE_OUTPUT_QUALITY = 0.92;
const PREPARED_PREVIEW_ZOOM_MIN = 0.5;
const PREPARED_PREVIEW_ZOOM_MAX = 2.5;
const PREPARED_PREVIEW_ZOOM_DEFAULT = 1;

export function preparedItemsForState(state) {
  const items = state.preparedSession?.items;
  return Array.isArray(items) ? items : [];
}

export function effectivePreparedImagePath(item) {
  return String(item?.editedPath || item?.scanPath || "").trim();
}

export function createPreparedPreviewController({
  state,
  dom,
  requestFrame,
  loadPreparedImageData,
  savePreparedPassportImage,
  removePreparedPassportImage = null as any,
  openPreparedCropModal,
  renderAll,
  imageFactory = () => new Image(),
  documentRef = globalThis.document,
}) {
  let activeImageRequestId = 0;
  let deleteCandidateId = "";

  function activePreparedItem() {
    const items = preparedItemsForState(state);
    if (!items.length) {
      return null;
    }
    const activeId = String(state.activePreparedItemId || "");
    return items.find((item) => String(item.id || "") === activeId) || items[0];
  }

  function render() {
    if (!dom.preparePreviewPanel) {
      return;
    }

    const items = preparedItemsForState(state);
    const hasSession = Boolean(state.preparedSession);
    dom.preparePreviewPanel.classList.toggle("is-hidden", !hasSession);
    if (!hasSession) {
      return;
    }

    if (!state.activePreparedItemId && items[0]?.id) {
      state.activePreparedItemId = String(items[0].id);
    }

    renderSummary(items);
    renderList(items);
    renderActivePreview();
    renderZoomControls();
    updateControls();
    requestFrame(() => {
      void ensureThumbnailImages(items);
    });
  }

  function renderSummary(items) {
    const editedCount = items.filter((item) => Boolean(item.editedPath)).length;
    const convertedCount = Number(state.preparedSession?.convertedCount || 0);
    const errorCount = Number(state.preparedSession?.errorCount || 0);
    if (dom.preparePreviewTitle) {
      dom.preparePreviewTitle.textContent = items.length
        ? "Preview dan rapikan foto"
        : "Belum ada foto siap preview";
    }
    if (dom.preparePreviewSubtitle) {
      const parts = [`${items.length} foto siap scan`];
      if (convertedCount > 0) {
        parts.push(`${convertedCount} hasil PDF`);
      }
      if (editedCount > 0) {
        parts.push(`${editedCount} sudah dirapikan`);
      }
      if (errorCount > 0) {
        parts.push(`${errorCount} error`);
      }
      dom.preparePreviewSubtitle.textContent = parts.join(" | ");
    }
  }

  function renderList(items) {
    if (!dom.preparedPassportList) {
      return;
    }
    if (!items.length) {
      dom.preparedPassportList.innerHTML = `<div class="friendly-empty">Tidak ada foto passport yang bisa dipreview.</div>`;
      return;
    }

    const activeId = String(activePreparedItem()?.id || "");
    dom.preparedPassportList.innerHTML = items.map((item, index) => {
      const itemId = String(item.id || "");
      const fileName = item.fileName || basenameFromPath(effectivePreparedImagePath(item)) || `passport-${index + 1}`;
      const sourceLabel = preparedItemSourceLabel(item);
      const edited = Boolean(item.editedPath);
      return `
        <button class="prepared-passport-item ${itemId === activeId ? "is-active" : ""}" type="button" data-prepared-id="${escapeHtml(itemId)}" aria-pressed="${itemId === activeId ? "true" : "false"}">
          <span class="prepared-thumb-frame">
            <img class="prepared-thumb-image" data-prepared-thumb-id="${escapeHtml(itemId)}" alt="" />
          </span>
          <span class="prepared-item-copy">
            <strong>${escapeHtml(fileName)}</strong>
            <small>${escapeHtml(sourceLabel)}</small>
          </span>
          <span class="prepared-item-status ${edited ? "valid" : "neutral"}">${edited ? "Dirapikan" : "Siap"}</span>
        </button>
      `;
    }).join("");
  }

  async function ensureThumbnailImages(items) {
    for (const item of items) {
      const thumb = dom.preparedPassportList?.querySelector?.(`[data-prepared-thumb-id="${cssEscape(String(item.id || ""))}"]`);
      if (!thumb || thumb.getAttribute("src")) {
        continue;
      }
      const result = await loadPreparedImage(item);
      if (result?.dataUrl) {
        thumb.src = result.dataUrl;
      }
    }
  }

  function renderActivePreview() {
    const item = activePreparedItem();
    if (!dom.preparedPreviewImage || !dom.preparedPreviewEmpty) {
      return;
    }

    if (!item) {
      dom.preparedPreviewImage.removeAttribute("src");
      dom.preparedPreviewImage.style.transform = "";
      dom.preparedPreviewImage.classList.add("is-hidden");
      dom.preparedPreviewEmpty.classList.remove("is-hidden");
      dom.preparedPreviewEmpty.textContent = "Belum ada foto dipilih.";
      if (dom.preparedPreviewName) {
        dom.preparedPreviewName.textContent = "Belum ada foto";
      }
      if (dom.preparedPreviewFile) {
        dom.preparedPreviewFile.textContent = "Siapkan folder terlebih dahulu.";
      }
      return;
    }

    if (dom.preparedPreviewName) {
      dom.preparedPreviewName.textContent = item.fileName || basenameFromPath(effectivePreparedImagePath(item));
    }
    if (dom.preparedPreviewFile) {
      const editedCopy = item.editedPath ? " | Sudah dirapikan" : "";
      dom.preparedPreviewFile.textContent = `Sumber: ${preparedItemSourceLabel(item)}${editedCopy}`;
    }

    void ensureActiveImage(item);
  }

  async function ensureActiveImage(item) {
    const requestId = ++activeImageRequestId;
    dom.preparedPreviewEmpty.classList.remove("is-hidden");
    dom.preparedPreviewEmpty.textContent = "Memuat foto...";
    dom.preparedPreviewImage.classList.add("is-hidden");

    const result = await loadPreparedImage(item);
    if (requestId !== activeImageRequestId || String(activePreparedItem()?.id || "") !== String(item.id || "")) {
      return;
    }
    if (!result?.dataUrl) {
      dom.preparedPreviewImage.removeAttribute("src");
      dom.preparedPreviewImage.classList.add("is-hidden");
      dom.preparedPreviewEmpty.classList.remove("is-hidden");
      dom.preparedPreviewEmpty.textContent = "Foto tidak bisa dimuat.";
      return;
    }

    dom.preparedPreviewEmpty.classList.add("is-hidden");
    dom.preparedPreviewImage.classList.remove("is-hidden");
    dom.preparedPreviewImage.src = result.dataUrl;
    dom.preparedPreviewImage.alt = item.fileName ? `Preview ${item.fileName}` : "Preview passport";
    dom.preparedPreviewImage.style.transform = `scale(${clampPreparedPreviewZoom(state.preparedPreviewZoom)})`;
    dom.preparedPreviewImage.style.transformOrigin = "center center";
  }

  async function loadPreparedImage(item) {
    const imagePath = effectivePreparedImagePath(item);
    const key = `${item?.id || ""}|${imagePath}`;
    const cached = state.preparedImageCache.get(key);
    if (cached) {
      return cached;
    }
    const result = await loadPreparedImageData({
      imagePath,
      fileName: String(item?.fileName || ""),
    });
    state.preparedImageCache.set(key, result || {});
    return result;
  }

  function selectPreparedItem(itemId) {
    const id = String(itemId || "");
    if (!id || state.activePreparedItemId === id) {
      return;
    }
    state.activePreparedItemId = id;
    renderAll();
  }

  async function rotateActivePreparedItem(direction) {
    const item = activePreparedItem();
    if (!item || state.isPreparingImages || state.isScanning) {
      return;
    }

    const delta = direction < 0 ? -90 : 90;
    const loaded = await loadPreparedImage(item);
    if (!loaded?.dataUrl) {
      return;
    }

    state.statusHeadline = "Menyimpan rotasi foto";
    state.statusDetail = item.fileName || "Foto passport";
    renderAll();

    const dataUrl = await renderRotatedDataUrl(loaded.dataUrl, delta);
    const nextRotation = normalizeRotation(Number(item.rotationDegrees || 0) + delta);
    const session = await savePreparedPassportImage({
      preparedManifestPath: String(state.preparedSession?.preparedManifestPath || ""),
      itemId: String(item.id || ""),
      sourceImagePath: effectivePreparedImagePath(item),
      dataUrl,
      crop: {
        operation: "rotate",
        rotationDeltaDegrees: delta,
        rotationDegrees: nextRotation,
        sourceImagePath: effectivePreparedImagePath(item),
      },
      rotationDegrees: nextRotation,
    });
    applyPreparedSession(session, String(item.id || ""));
    state.statusHeadline = "Rotasi foto tersimpan";
    state.statusDetail = "Foto hasil rotasi akan dipakai saat scan OCR.";
    renderAll();
  }

  async function flipActivePreparedItem(axis = "horizontal") {
    const item = activePreparedItem();
    if (!item || state.isPreparingImages || state.isScanning) {
      return;
    }

    const normalizedAxis = axis === "vertical" ? "vertical" : "horizontal";
    const loaded = await loadPreparedImage(item);
    if (!loaded?.dataUrl) {
      return;
    }

    state.statusHeadline = "Menyimpan flip foto";
    state.statusDetail = item.fileName || "Foto passport";
    renderAll();

    const dataUrl = await renderFlippedDataUrl(loaded.dataUrl, normalizedAxis);
    const session = await savePreparedPassportImage({
      preparedManifestPath: String(state.preparedSession?.preparedManifestPath || ""),
      itemId: String(item.id || ""),
      sourceImagePath: effectivePreparedImagePath(item),
      dataUrl,
      crop: {
        operation: normalizedAxis === "vertical" ? "flip-vertical" : "flip-horizontal",
        sourceImagePath: effectivePreparedImagePath(item),
      },
      rotationDegrees: Number(item.rotationDegrees || 0),
    });
    applyPreparedSession(session, String(item.id || ""));
    state.statusHeadline = "Flip foto tersimpan";
    state.statusDetail = "Foto hasil flip akan dipakai saat scan OCR.";
    renderAll();
  }

  function changeZoom(delta) {
    state.preparedPreviewZoom = clampPreparedPreviewZoom(Number(state.preparedPreviewZoom || PREPARED_PREVIEW_ZOOM_DEFAULT) + Number(delta || 0));
    renderZoomControls();
    if (dom.preparedPreviewImage) {
      dom.preparedPreviewImage.style.transform = `scale(${state.preparedPreviewZoom})`;
    }
  }

  function resetZoom() {
    state.preparedPreviewZoom = PREPARED_PREVIEW_ZOOM_DEFAULT;
    renderZoomControls();
    if (dom.preparedPreviewImage) {
      dom.preparedPreviewImage.style.transform = `scale(${state.preparedPreviewZoom})`;
    }
  }

  function renderZoomControls() {
    const zoom = clampPreparedPreviewZoom(state.preparedPreviewZoom);
    state.preparedPreviewZoom = zoom;
    if (dom.preparedZoomLabel) {
      dom.preparedZoomLabel.textContent = `${Math.round(zoom * 100)}%`;
    }
    if (dom.preparedZoomOutButton) {
      dom.preparedZoomOutButton.disabled = !activePreparedItem() || zoom <= PREPARED_PREVIEW_ZOOM_MIN || state.isPreparingImages || state.isScanning;
      dom.preparedZoomOutButton.setAttribute("aria-disabled", dom.preparedZoomOutButton.disabled ? "true" : "false");
    }
    if (dom.preparedZoomInButton) {
      dom.preparedZoomInButton.disabled = !activePreparedItem() || zoom >= PREPARED_PREVIEW_ZOOM_MAX || state.isPreparingImages || state.isScanning;
      dom.preparedZoomInButton.setAttribute("aria-disabled", dom.preparedZoomInButton.disabled ? "true" : "false");
    }
    if (dom.preparedZoomResetButton) {
      dom.preparedZoomResetButton.disabled = !activePreparedItem() || zoom === PREPARED_PREVIEW_ZOOM_DEFAULT || state.isPreparingImages || state.isScanning;
      dom.preparedZoomResetButton.setAttribute("aria-disabled", dom.preparedZoomResetButton.disabled ? "true" : "false");
    }
  }

  async function openLargePreview() {
    const item = activePreparedItem();
    if (!item || !dom.preparedPreviewModal) {
      return;
    }
    dom.preparedPreviewModal.classList.remove("is-hidden");
    dom.preparedPreviewModal.setAttribute("aria-hidden", "false");
    if (dom.preparedPreviewModalTitle) {
      dom.preparedPreviewModalTitle.textContent = item.fileName || "Preview Besar";
    }
    if (dom.preparedPreviewModalImage) {
      dom.preparedPreviewModalImage.classList.add("is-hidden");
      dom.preparedPreviewModalImage.removeAttribute("src");
    }
    if (dom.preparedPreviewModalEmpty) {
      dom.preparedPreviewModalEmpty.classList.remove("is-hidden");
      dom.preparedPreviewModalEmpty.textContent = "Memuat foto...";
    }
    const result = await loadPreparedImage(item);
    if (!result?.dataUrl || String(activePreparedItem()?.id || "") !== String(item.id || "")) {
      if (dom.preparedPreviewModalEmpty) {
        dom.preparedPreviewModalEmpty.textContent = "Foto tidak bisa dimuat.";
      }
      return;
    }
    if (dom.preparedPreviewModalEmpty) {
      dom.preparedPreviewModalEmpty.classList.add("is-hidden");
    }
    if (dom.preparedPreviewModalImage) {
      dom.preparedPreviewModalImage.src = result.dataUrl;
      dom.preparedPreviewModalImage.alt = item.fileName ? `Preview besar ${item.fileName}` : "Preview besar passport";
      dom.preparedPreviewModalImage.classList.remove("is-hidden");
    }
  }

  function closeLargePreview() {
    dom.preparedPreviewModal?.classList.add("is-hidden");
    dom.preparedPreviewModal?.setAttribute("aria-hidden", "true");
  }

  function openDeleteActive() {
    const item = activePreparedItem();
    if (!item || !dom.preparedDeleteModal) {
      return;
    }
    deleteCandidateId = String(item.id || "");
    if (dom.preparedDeleteModalDesc) {
      const fileName = item.fileName || basenameFromPath(effectivePreparedImagePath(item)) || "foto ini";
      dom.preparedDeleteModalDesc.textContent = `${fileName} akan dikeluarkan dari antrean OCR dan dipindahkan dari folder kerja.`;
    }
    dom.preparedDeleteModal.classList.remove("is-hidden");
    dom.preparedDeleteModal.setAttribute("aria-hidden", "false");
    requestFrame(() => dom.preparedDeleteCancelButton?.focus?.());
  }

  function closeDeleteModal() {
    deleteCandidateId = "";
    dom.preparedDeleteModal?.classList.add("is-hidden");
    dom.preparedDeleteModal?.setAttribute("aria-hidden", "true");
  }

  async function confirmDeleteActive() {
    if (!removePreparedPassportImage || !deleteCandidateId) {
      closeDeleteModal();
      return;
    }
    const itemId = deleteCandidateId;
    closeDeleteModal();
    state.statusHeadline = "Menghapus foto";
    state.statusDetail = "Foto dikeluarkan dari antrean OCR.";
    renderAll();
    const session = await removePreparedPassportImage({
      preparedManifestPath: String(state.preparedSession?.preparedManifestPath || ""),
      itemId,
    });
    const nextItems = Array.isArray(session?.items) ? session.items : [];
    const nextActive = nextItems.find((item) => String(item.id || "") !== itemId)?.id || nextItems[0]?.id || "";
    applyPreparedSession(session, String(nextActive || ""));
    state.statusHeadline = "Foto dihapus dari persiapan";
    state.statusDetail = `${nextItems.length} foto tersisa untuk OCR.`;
    renderAll();
  }

  function openCropActive() {
    const item = activePreparedItem();
    if (!item) {
      return;
    }
    openPreparedCropModal(item);
  }

  function applyPreparedSession(session, activeId = state.activePreparedItemId) {
    state.preparedSession = session;
    state.activePreparedItemId = activeId || String(preparedItemsForState(state)[0]?.id || "");
    state.preparedImageCache = new Map();
  }

  function updateControls() {
    const hasItem = Boolean(activePreparedItem());
    for (const button of [
      dom.preparedCropButton,
      dom.preparedDeleteButton,
      dom.preparedFlipHorizontalButton,
      dom.preparedFlipVerticalButton,
      dom.preparedPreviewLargeButton,
      dom.preparedRotateLeftButton,
      dom.preparedRotateRightButton,
    ]) {
      if (!button) {
        continue;
      }
      button.disabled = !hasItem || state.isPreparingImages || state.isScanning;
      button.setAttribute("aria-disabled", button.disabled ? "true" : "false");
    }
  }

  function renderRotatedDataUrl(dataUrl, deltaDegrees) {
    return new Promise((resolve, reject) => {
      const image = imageFactory();
      image.onload = () => {
        const rotateQuarter = Math.abs(deltaDegrees) % 180 === 90;
        const canvas = documentRef.createElement("canvas");
        canvas.width = rotateQuarter ? image.naturalHeight : image.naturalWidth;
        canvas.height = rotateQuarter ? image.naturalWidth : image.naturalHeight;
        const context = canvas.getContext("2d", { alpha: false });
        if (!context) {
          reject(new Error("Canvas rotasi tidak tersedia."));
          return;
        }
        context.fillStyle = "#ffffff";
        context.fillRect(0, 0, canvas.width, canvas.height);
        context.translate(canvas.width / 2, canvas.height / 2);
        context.rotate((deltaDegrees * Math.PI) / 180);
        context.drawImage(image, -image.naturalWidth / 2, -image.naturalHeight / 2);
        resolve(canvas.toDataURL(PREPARED_IMAGE_OUTPUT_TYPE, PREPARED_IMAGE_OUTPUT_QUALITY));
      };
      image.onerror = () => reject(new Error("Foto tidak bisa diputar."));
      image.src = dataUrl;
    });
  }

  function renderFlippedDataUrl(dataUrl, axis) {
    return new Promise((resolve, reject) => {
      const image = imageFactory();
      image.onload = () => {
        const canvas = documentRef.createElement("canvas");
        canvas.width = image.naturalWidth;
        canvas.height = image.naturalHeight;
        const context = canvas.getContext("2d", { alpha: false });
        if (!context) {
          reject(new Error("Canvas flip tidak tersedia."));
          return;
        }
        context.fillStyle = "#ffffff";
        context.fillRect(0, 0, canvas.width, canvas.height);
        if (axis === "vertical") {
          context.translate(0, canvas.height);
          context.scale(1, -1);
        } else {
          context.translate(canvas.width, 0);
          context.scale(-1, 1);
        }
        context.drawImage(image, 0, 0);
        resolve(canvas.toDataURL(PREPARED_IMAGE_OUTPUT_TYPE, PREPARED_IMAGE_OUTPUT_QUALITY));
      };
      image.onerror = () => reject(new Error("Foto tidak bisa diflip."));
      image.src = dataUrl;
    });
  }

  return {
    activePreparedItem,
    applyPreparedSession,
    changeZoom,
    closeDeleteModal,
    closeLargePreview,
    confirmDeleteActive,
    flipActivePreparedItem,
    openDeleteActive,
    openCropActive,
    openLargePreview,
    render,
    resetZoom,
    rotateActivePreparedItem,
    selectPreparedItem,
  };
}

function preparedItemSourceLabel(item) {
  if (item?.sourceType === "pdf") {
    const page = Number(item.pdfPageNumber || 0);
    return page > 0
      ? `${item.sourceFileName || "PDF"} | Halaman ${page}`
      : `${item.sourceFileName || "PDF"} | PDF`;
  }
  return item?.sourceFileName || basenameFromPath(item?.sourcePath || "");
}

function normalizeRotation(value) {
  const normalized = Number.isFinite(value) ? value : 0;
  return ((normalized % 360) + 360) % 360;
}

function clampPreparedPreviewZoom(value) {
  const numeric = Number(value);
  const safeValue = Number.isFinite(numeric) ? numeric : PREPARED_PREVIEW_ZOOM_DEFAULT;
  return Math.round(Math.min(PREPARED_PREVIEW_ZOOM_MAX, Math.max(PREPARED_PREVIEW_ZOOM_MIN, safeValue)) * 100) / 100;
}

function cssEscape(value) {
  if (globalThis.CSS?.escape) {
    return globalThis.CSS.escape(value);
  }
  return String(value).replace(/"/g, '\\"');
}
