import {
  normalizeOcrMode,
  ocrModeLabel,
} from "../../shared/ocr.js";
import {
  ocrStatusDescriptor as ocrStatusDescriptorForState,
  renderImportPageView,
  renderMiniStatus,
  renderOcrModeSelectorView,
} from "./render.js";

export function createImportViewController({
  dom,
  state,
  hasAnyScanResult,
  hasScanResultForSelectedDir,
  updateActionAvailability,
  updateOcrMode,
  inputElementClass = globalThis.HTMLInputElement,
}) {
  function renderImportPage() {
    renderImportPageView({
      dom,
      state,
      hasAnyScanResult,
      hasScanResultForSelectedDir,
    });
  }

  function renderOcrModeSelector() {
    renderOcrModeSelectorView({ dom, state });
  }

  function handleOcrModeChange(event) {
    const target = event.target;
    const isInput = inputElementClass
      ? target instanceof inputElementClass
      : Boolean(target && "checked" in target);
    if (state.isScanning || !isInput || !target.checked) {
      renderOcrModeSelector();
      return;
    }

    const nextMode = normalizeOcrMode(target.value);
    updateOcrMode(nextMode);
    state.statusHeadline = `Mode OCR: ${ocrModeLabel(nextMode)}`;
    state.statusDetail = "Mode akan dipakai saat scan berikutnya dimulai.";

    renderOcrModeSelector();
    renderMiniStatus(dom.systemOcrStatus, ocrStatusDescriptor());
    updateActionAvailability();
  }

  function ocrStatusDescriptor() {
    return ocrStatusDescriptorForState({
      state,
      hasAnyScanResult,
      hasScanResultForSelectedDir,
    });
  }

  return {
    handleOcrModeChange,
    ocrStatusDescriptor,
    renderImportPage,
    renderOcrModeSelector,
  };
}
