import { basenameFromPath, escapeHtml } from "./main-utils.js";

const PREPARED_IMAGE_OUTPUT_TYPE = "image/jpeg";
const PREPARED_IMAGE_OUTPUT_QUALITY = 0.92;

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
  openPreparedCropModal,
  renderAll,
  imageFactory = () => new Image(),
  documentRef = globalThis.document,
}) {
  let activeImageRequestId = 0;

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
    updateControls();
    requestFrame(() => {
      void ensureThumbnailImages(items);
    });
  }

  function renderSummary(items) {
    const editedCount = items.filter((item) => Boolean(item.editedPath)).length;
    if (dom.preparePreviewTitle) {
      dom.preparePreviewTitle.textContent = items.length
        ? `${items.length} foto siap dicek`
        : "Belum ada foto siap preview";
    }
    if (dom.preparePreviewSubtitle) {
      const convertedCount = Number(state.preparedSession?.convertedCount || 0);
      const errorCount = Number(state.preparedSession?.errorCount || 0);
      dom.preparePreviewSubtitle.textContent = `${convertedCount} hasil PDF | ${editedCount} diedit | ${errorCount} error`;
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
        <button class="prepared-passport-item ${itemId === activeId ? "is-active" : ""}" type="button" data-prepared-id="${escapeHtml(itemId)}">
          <span class="prepared-thumb-frame">
            <img class="prepared-thumb-image" data-prepared-thumb-id="${escapeHtml(itemId)}" alt="" />
          </span>
          <span class="prepared-item-copy">
            <strong>${escapeHtml(fileName)}</strong>
            <small>${escapeHtml(sourceLabel)}</small>
          </span>
          <span class="prepared-item-status ${edited ? "valid" : "neutral"}">${edited ? "Edited" : "Asli"}</span>
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
      dom.preparedPreviewFile.textContent = preparedItemSourceLabel(item);
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
    state.statusDetail = "Foto hasil rotasi akan dipakai saat scan.";
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

  return {
    activePreparedItem,
    applyPreparedSession,
    openCropActive,
    render,
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

function cssEscape(value) {
  if (globalThis.CSS?.escape) {
    return globalThis.CSS.escape(value);
  }
  return String(value).replace(/"/g, '\\"');
}
