import {
  applyCroppedPassportImageToMember,
  passportCropSourceImageCandidates,
} from "./main-passport-image.js";
import {
  basenameFromPath,
} from "./main-utils.js";

export const PASSPORT_CROP_OUTPUT_TYPE = "image/jpeg";
export const PASSPORT_CROP_OUTPUT_QUALITY = 0.92;
export const PASSPORT_CROP_MIN_IMAGE_SIZE = 48;
export const PASSPORT_CROP_HANDLE_SIZE = 12;

function numberOr(value, fallback) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
}

export function clampPassportCropZoom(value) {
  const numeric = numberOr(value, 1);
  return Math.round(Math.min(2, Math.max(0.75, numeric)) * 100) / 100;
}

export function normalizeCropRect(rect, imageWidth, imageHeight) {
  const minSize = Math.min(PASSPORT_CROP_MIN_IMAGE_SIZE, imageWidth, imageHeight);
  const width = Math.max(minSize, Math.min(imageWidth, numberOr(rect?.width, imageWidth)));
  const height = Math.max(minSize, Math.min(imageHeight, numberOr(rect?.height, imageHeight)));
  const x = Math.min(Math.max(0, numberOr(rect?.x, 0)), Math.max(0, imageWidth - width));
  const y = Math.min(Math.max(0, numberOr(rect?.y, 0)), Math.max(0, imageHeight - height));
  return {
    x: Math.round(x),
    y: Math.round(y),
    width: Math.round(width),
    height: Math.round(height),
  };
}

export function defaultPassportCropRect(imageWidth, imageHeight) {
  const insetX = Math.round(imageWidth * 0.06);
  const insetY = Math.round(imageHeight * 0.06);
  return normalizeCropRect({
    x: insetX,
    y: insetY,
    width: imageWidth - (insetX * 2),
    height: imageHeight - (insetY * 2),
  }, imageWidth, imageHeight);
}

export function createPassportCropController({
  state,
  dom,
  requestFrame,
  activeMember,
  loadPassportImageData,
  saveCroppedPassportImage,
  replaceMemberInManifest,
  scheduleManifestSave,
  renderAll,
  imageFactory = () => new Image(),
  documentRef = globalThis.document,
}) {
  let image = null;
  let imageData = null;
  let imageFrame = null;
  let cropRect = null;
  let interaction = null;
  let cropRequestId = 0;
  let drawScheduled = false;

  async function openCropModal() {
    const member = activeMember();
    if (!member) {
      return;
    }

    showModal();
    setBusy(true);
    setStatus("Memuat foto untuk crop...", "neutral");
    resetCanvasState();

    const requestId = ++cropRequestId;
    try {
      const loaded = await loadSourceImageForMember(member);
      if (requestId !== cropRequestId) {
        return;
      }
      if (!loaded?.dataUrl) {
        setStatus("Foto passport tidak ditemukan.", "error");
        setBusy(false);
        return;
      }

      imageData = loaded;
      image = await loadImage(loaded.dataUrl);
      if (requestId !== cropRequestId) {
        return;
      }
      const previousRect = member?.cropMetadata?.rect;
      cropRect = normalizeCropRect(previousRect || defaultPassportCropRect(image.naturalWidth, image.naturalHeight), image.naturalWidth, image.naturalHeight);
      state.passportCropZoom = clampPassportCropZoom(state.passportCropZoom || 1);
      syncZoomControl();
      refreshCanvasSize();
      setStatus(`Sumber: ${basenameFromPath(loaded.path || loaded.imagePath || member.fileName || "")}`, "neutral");
      setBusy(false);
      scheduleDraw();
    } catch (error) {
      if (requestId !== cropRequestId) {
        return;
      }
      setStatus(`Gagal membuka crop: ${error instanceof Error ? error.message : String(error)}`, "error");
      setBusy(false);
    }
  }

  function closeCropModal() {
    cropRequestId += 1;
    hideModal();
    resetCanvasState();
    interaction = null;
  }

  function resetCropRect() {
    if (!image) {
      return;
    }
    cropRect = defaultPassportCropRect(image.naturalWidth, image.naturalHeight);
    scheduleDraw();
  }

  function handleZoomInput(event) {
    state.passportCropZoom = clampPassportCropZoom(event?.target?.value);
    syncZoomControl();
    scheduleDraw();
  }

  function handleCanvasPointerDown(event) {
    if (!image || !cropRect || !imageFrame) {
      return;
    }
    const point = canvasPointFromEvent(event);
    const imagePoint = imagePointFromCanvas(point);
    if (!imagePoint) {
      return;
    }
    const mode = hitTestCropHandle(point) || (isPointInsideCrop(point) ? "move" : "");
    if (!mode) {
      return;
    }

    event.preventDefault();
    dom.passportCropCanvas?.setPointerCapture?.(event.pointerId);
    interaction = {
      mode,
      pointerId: event.pointerId,
      startPoint: imagePoint,
      startRect: { ...cropRect },
    };
  }

  function handleCanvasPointerMove(event) {
    if (!image || !cropRect || !imageFrame) {
      return;
    }

    const point = canvasPointFromEvent(event);
    if (!interaction) {
      updateCanvasCursor(point);
      return;
    }

    event.preventDefault();
    const imagePoint = imagePointFromCanvas(point, { clamp: true });
    if (!imagePoint) {
      return;
    }

    const dx = imagePoint.x - interaction.startPoint.x;
    const dy = imagePoint.y - interaction.startPoint.y;
    cropRect = updateCropRectForInteraction(interaction.mode, interaction.startRect, dx, dy, image.naturalWidth, image.naturalHeight);
    scheduleDraw();
  }

  function handleCanvasPointerUp(event) {
    if (!interaction || interaction.pointerId !== event.pointerId) {
      return;
    }
    dom.passportCropCanvas?.releasePointerCapture?.(event.pointerId);
    interaction = null;
    updateCanvasCursor(canvasPointFromEvent(event));
  }

  function handleCanvasKeydown(event) {
    if (!image || !cropRect) {
      return;
    }
    const key = String(event.key || "");
    const step = event.shiftKey ? 12 : 3;
    const deltas = {
      ArrowLeft: { x: -step, y: 0 },
      ArrowRight: { x: step, y: 0 },
      ArrowUp: { x: 0, y: -step },
      ArrowDown: { x: 0, y: step },
    };
    const delta = deltas[key];
    if (!delta) {
      return;
    }
    event.preventDefault();
    cropRect = updateCropRectForInteraction("move", cropRect, delta.x, delta.y, image.naturalWidth, image.naturalHeight);
    scheduleDraw();
  }

  function handleResize() {
    if (isCropModalHidden()) {
      return;
    }
    refreshCanvasSize();
    scheduleDraw();
  }

  async function saveCrop() {
    const member = activeMember();
    if (!member || !image || !imageData || !cropRect) {
      return;
    }

    setBusy(true);
    setStatus("Menyimpan hasil crop...", "neutral");
    try {
      const cropPayload = buildCropPayload();
      const dataUrl = renderCropDataUrl(cropPayload.rect);
      const savedImage = await saveCroppedPassportImage({
        manifestPath: state.manifestPath,
        memberId: String(member.id || ""),
        fileName: String(member.fileName || ""),
        sourceImagePath: imageData.path || imageData.imagePath || "",
        dataUrl,
        crop: cropPayload,
      });
      const nextMember = applyCroppedPassportImageToMember(member, savedImage, {
        ...cropPayload,
        sourceImagePath: imageData.path || imageData.imagePath || "",
      });
      replaceMemberInManifest(member.id, nextMember);
      state.passportImageCache.delete(String(member.id || ""));
      state.statusHeadline = "Crop foto tersimpan";
      state.statusDetail = "Hasil crop akan dipakai sebagai file upload Nusuk untuk passport ini.";
      scheduleManifestSave(0);
      closeCropModal();
      renderAll();
    } catch (error) {
      setStatus(`Gagal menyimpan crop: ${error instanceof Error ? error.message : String(error)}`, "error");
    } finally {
      setBusy(false);
    }
  }

  async function loadSourceImageForMember(member) {
    const candidates = passportCropSourceImageCandidates(member);
    if (!candidates.length && member.fileName) {
      candidates.push("");
    }
    for (const imagePath of candidates) {
      const loaded = await loadPassportImageData({
        manifestPath: state.manifestPath,
        imagePath,
        fileName: String(member.fileName || ""),
      });
      if (loaded?.dataUrl) {
        return { ...loaded, imagePath };
      }
    }
    return null;
  }

  function buildCropPayload() {
    return {
      rect: normalizeCropRect(cropRect, image.naturalWidth, image.naturalHeight),
      naturalWidth: image.naturalWidth,
      naturalHeight: image.naturalHeight,
      outputType: PASSPORT_CROP_OUTPUT_TYPE,
      outputQuality: PASSPORT_CROP_OUTPUT_QUALITY,
    };
  }

  function renderCropDataUrl(rect) {
    const canvas = documentRef.createElement("canvas");
    canvas.width = Math.max(1, Math.round(rect.width));
    canvas.height = Math.max(1, Math.round(rect.height));
    const context = canvas.getContext("2d", { alpha: false });
    if (!context) {
      throw new Error("Canvas crop tidak tersedia.");
    }
    context.fillStyle = "#ffffff";
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.imageSmoothingEnabled = true;
    context.imageSmoothingQuality = "high";
    context.drawImage(
      image,
      rect.x,
      rect.y,
      rect.width,
      rect.height,
      0,
      0,
      canvas.width,
      canvas.height,
    );
    return canvas.toDataURL(PASSPORT_CROP_OUTPUT_TYPE, PASSPORT_CROP_OUTPUT_QUALITY);
  }

  function loadImage(dataUrl) {
    return new Promise((resolve, reject) => {
      const nextImage = imageFactory();
      nextImage.onload = () => resolve(nextImage);
      nextImage.onerror = () => reject(new Error("Gambar crop tidak bisa dimuat."));
      nextImage.src = dataUrl;
    });
  }

  function showModal() {
    dom.passportCropModal?.classList.remove("is-hidden");
    dom.passportCropModal?.setAttribute("aria-hidden", "false");
    requestFrame(() => {
      dom.passportCropCanvas?.focus?.();
      handleResize();
    });
  }

  function hideModal() {
    dom.passportCropModal?.classList.add("is-hidden");
    dom.passportCropModal?.setAttribute("aria-hidden", "true");
  }

  function isCropModalHidden() {
    return Boolean(!dom.passportCropModal || dom.passportCropModal.classList.contains("is-hidden"));
  }

  function setBusy(isBusy) {
    if (dom.passportCropSaveButton) {
      dom.passportCropSaveButton.disabled = Boolean(isBusy || !image || !cropRect);
      dom.passportCropSaveButton.textContent = isBusy ? "Menyimpan..." : "Simpan Crop";
    }
    if (dom.passportCropResetButton) {
      dom.passportCropResetButton.disabled = Boolean(isBusy || !image);
    }
    if (dom.passportCropZoomInput) {
      dom.passportCropZoomInput.disabled = Boolean(isBusy || !image);
    }
  }

  function setStatus(message, tone = "neutral") {
    if (!dom.passportCropStatus) {
      return;
    }
    dom.passportCropStatus.textContent = String(message || "");
    dom.passportCropStatus.className = `passport-crop-modal-status ${tone || "neutral"}`;
  }

  function syncZoomControl() {
    if (dom.passportCropZoomInput) {
      dom.passportCropZoomInput.value = String(clampPassportCropZoom(state.passportCropZoom || 1));
    }
    if (dom.passportCropZoomValue) {
      dom.passportCropZoomValue.textContent = `${Math.round(clampPassportCropZoom(state.passportCropZoom || 1) * 100)}%`;
    }
  }

  function resetCanvasState() {
    image = null;
    imageData = null;
    imageFrame = null;
    cropRect = null;
    drawScheduled = false;
    if (dom.passportCropCanvas) {
      const context = dom.passportCropCanvas.getContext?.("2d");
      context?.clearRect(0, 0, dom.passportCropCanvas.width, dom.passportCropCanvas.height);
      dom.passportCropCanvas.style.cursor = "default";
    }
    setBusy(false);
  }

  function refreshCanvasSize() {
    const canvas = dom.passportCropCanvas;
    if (!canvas) {
      return;
    }
    const stage = dom.passportCropStage || canvas.parentElement;
    const stageRect = stage?.getBoundingClientRect?.() || {};
    const width = Math.max(320, Math.round(stageRect.width || canvas.clientWidth || 720));
    const height = Math.max(280, Math.round(stageRect.height || canvas.clientHeight || 480));
    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width;
      canvas.height = height;
    }
  }

  function scheduleDraw() {
    if (drawScheduled) {
      return;
    }
    drawScheduled = true;
    requestFrame(() => {
      drawScheduled = false;
      draw();
    });
  }

  function draw() {
    const canvas = dom.passportCropCanvas;
    if (!canvas) {
      return;
    }
    const context = canvas.getContext?.("2d");
    if (!context) {
      return;
    }
    context.clearRect(0, 0, canvas.width, canvas.height);
    context.fillStyle = "#111827";
    context.fillRect(0, 0, canvas.width, canvas.height);
    if (!image || !cropRect) {
      return;
    }

    imageFrame = imageFrameForCanvas(canvas, image, state.passportCropZoom || 1);
    context.drawImage(image, imageFrame.x, imageFrame.y, imageFrame.width, imageFrame.height);
    drawCropOverlay(context);
  }

  function imageFrameForCanvas(canvas, sourceImage, zoom) {
    const padding = 18;
    const availableWidth = Math.max(1, canvas.width - (padding * 2));
    const availableHeight = Math.max(1, canvas.height - (padding * 2));
    const fitScale = Math.min(availableWidth / sourceImage.naturalWidth, availableHeight / sourceImage.naturalHeight);
    const scale = fitScale * clampPassportCropZoom(zoom);
    const width = sourceImage.naturalWidth * scale;
    const height = sourceImage.naturalHeight * scale;
    return {
      x: (canvas.width - width) / 2,
      y: (canvas.height - height) / 2,
      width,
      height,
      scale,
    };
  }

  function drawCropOverlay(context) {
    const rect = canvasRectFromCrop(cropRect);
    context.save();
    context.fillStyle = "rgba(9, 15, 25, 0.62)";
    context.beginPath();
    context.rect(0, 0, context.canvas.width, context.canvas.height);
    context.rect(rect.x, rect.y, rect.width, rect.height);
    context.fill("evenodd");
    context.strokeStyle = "#f8fafc";
    context.lineWidth = 2;
    context.strokeRect(rect.x, rect.y, rect.width, rect.height);
    context.strokeStyle = "rgba(248, 250, 252, 0.58)";
    context.lineWidth = 1;
    context.beginPath();
    context.moveTo(rect.x + (rect.width / 3), rect.y);
    context.lineTo(rect.x + (rect.width / 3), rect.y + rect.height);
    context.moveTo(rect.x + ((rect.width * 2) / 3), rect.y);
    context.lineTo(rect.x + ((rect.width * 2) / 3), rect.y + rect.height);
    context.moveTo(rect.x, rect.y + (rect.height / 3));
    context.lineTo(rect.x + rect.width, rect.y + (rect.height / 3));
    context.moveTo(rect.x, rect.y + ((rect.height * 2) / 3));
    context.lineTo(rect.x + rect.width, rect.y + ((rect.height * 2) / 3));
    context.stroke();
    context.fillStyle = "#f8fafc";
    for (const handle of cropHandlePoints(rect)) {
      context.fillRect(handle.x - 5, handle.y - 5, 10, 10);
    }
    context.restore();
  }

  function canvasRectFromCrop(rect) {
    return {
      x: imageFrame.x + (rect.x * imageFrame.scale),
      y: imageFrame.y + (rect.y * imageFrame.scale),
      width: rect.width * imageFrame.scale,
      height: rect.height * imageFrame.scale,
    };
  }

  function canvasPointFromEvent(event) {
    const canvas = dom.passportCropCanvas;
    const bounds = canvas?.getBoundingClientRect?.() || {};
    const widthRatio = canvas?.width && bounds.width ? canvas.width / bounds.width : 1;
    const heightRatio = canvas?.height && bounds.height ? canvas.height / bounds.height : 1;
    return {
      x: (event.clientX - (bounds.left || 0)) * widthRatio,
      y: (event.clientY - (bounds.top || 0)) * heightRatio,
    };
  }

  function imagePointFromCanvas(point, options = {}) {
    if (!imageFrame) {
      return null;
    }
    const rawX = (point.x - imageFrame.x) / imageFrame.scale;
    const rawY = (point.y - imageFrame.y) / imageFrame.scale;
    if (!options.clamp && (rawX < 0 || rawY < 0 || rawX > image.naturalWidth || rawY > image.naturalHeight)) {
      return null;
    }
    return {
      x: Math.min(image.naturalWidth, Math.max(0, rawX)),
      y: Math.min(image.naturalHeight, Math.max(0, rawY)),
    };
  }

  function hitTestCropHandle(point) {
    if (!cropRect || !imageFrame) {
      return "";
    }
    const rect = canvasRectFromCrop(cropRect);
    for (const handle of cropHandlePoints(rect)) {
      if (Math.abs(point.x - handle.x) <= PASSPORT_CROP_HANDLE_SIZE && Math.abs(point.y - handle.y) <= PASSPORT_CROP_HANDLE_SIZE) {
        return handle.mode;
      }
    }
    return "";
  }

  function isPointInsideCrop(point) {
    const rect = canvasRectFromCrop(cropRect);
    return point.x >= rect.x && point.x <= rect.x + rect.width && point.y >= rect.y && point.y <= rect.y + rect.height;
  }

  function updateCanvasCursor(point) {
    const canvas = dom.passportCropCanvas;
    if (!canvas) {
      return;
    }
    const handle = hitTestCropHandle(point);
    const cursorByHandle = {
      nw: "nwse-resize",
      se: "nwse-resize",
      ne: "nesw-resize",
      sw: "nesw-resize",
      n: "ns-resize",
      s: "ns-resize",
      e: "ew-resize",
      w: "ew-resize",
    };
    canvas.style.cursor = cursorByHandle[handle] || (isPointInsideCrop(point) ? "move" : "default");
  }

  return {
    closeCropModal,
    handleCanvasKeydown,
    handleCanvasPointerDown,
    handleCanvasPointerMove,
    handleCanvasPointerUp,
    handleResize,
    handleZoomInput,
    openCropModal,
    resetCropRect,
    saveCrop,
  };
}

export function cropHandlePoints(rect) {
  const x1 = rect.x;
  const y1 = rect.y;
  const x2 = rect.x + rect.width;
  const y2 = rect.y + rect.height;
  const midX = rect.x + (rect.width / 2);
  const midY = rect.y + (rect.height / 2);
  return [
    { mode: "nw", x: x1, y: y1 },
    { mode: "n", x: midX, y: y1 },
    { mode: "ne", x: x2, y: y1 },
    { mode: "e", x: x2, y: midY },
    { mode: "se", x: x2, y: y2 },
    { mode: "s", x: midX, y: y2 },
    { mode: "sw", x: x1, y: y2 },
    { mode: "w", x: x1, y: midY },
  ];
}

export function updateCropRectForInteraction(mode, startRect, dx, dy, imageWidth, imageHeight) {
  const rect = { ...startRect };
  const minSize = Math.min(PASSPORT_CROP_MIN_IMAGE_SIZE, imageWidth, imageHeight);
  if (mode === "move") {
    return normalizeCropRect({
      ...rect,
      x: Math.min(Math.max(0, rect.x + dx), imageWidth - rect.width),
      y: Math.min(Math.max(0, rect.y + dy), imageHeight - rect.height),
    }, imageWidth, imageHeight);
  }

  let left = rect.x;
  let top = rect.y;
  let right = rect.x + rect.width;
  let bottom = rect.y + rect.height;

  if (mode.includes("w")) {
    left = Math.min(right - minSize, Math.max(0, rect.x + dx));
  }
  if (mode.includes("e")) {
    right = Math.max(left + minSize, Math.min(imageWidth, rect.x + rect.width + dx));
  }
  if (mode.includes("n")) {
    top = Math.min(bottom - minSize, Math.max(0, rect.y + dy));
  }
  if (mode.includes("s")) {
    bottom = Math.max(top + minSize, Math.min(imageHeight, rect.y + rect.height + dy));
  }

  return normalizeCropRect({
    x: left,
    y: top,
    width: right - left,
    height: bottom - top,
  }, imageWidth, imageHeight);
}
