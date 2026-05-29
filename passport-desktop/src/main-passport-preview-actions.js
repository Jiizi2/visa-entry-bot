import {
  createPassportPreviewController,
} from "./main-passport-preview.js";

export function createPassportPreviewActions({
  state,
  dom,
  requestFrame,
  activeMember,
  isMemberReviewConfirmed,
  loadPassportImageData,
  createController = createPassportPreviewController,
}) {
  let passportPreviewController = null;

  function initializePassportPreviewController() {
    passportPreviewController = createController({
      state,
      dom,
      requestFrame,
      activeMember,
      isMemberReviewConfirmed,
      loadPassportImageData,
    });
  }

  function renderPassportPreview() {
    passportPreviewController?.render();
  }

  function changePassportPreviewZoom(delta) {
    passportPreviewController?.changeZoom(delta);
  }

  function resetPassportPreviewZoom() {
    passportPreviewController?.resetZoom();
  }

  function resetPassportPreviewZoomState() {
    passportPreviewController?.resetZoomState();
  }

  function handlePassportPreviewWheel(event) {
    passportPreviewController?.handleWheel(event);
  }

  function handlePassportPreviewKeydown(event) {
    passportPreviewController?.handleKeydown(event);
  }

  function renderPassportPreviewZoomControls() {
    passportPreviewController?.renderZoomControls();
  }

  function isPassportPreviewImageReady() {
    return Boolean(passportPreviewController?.isImageReady());
  }

  return {
    changePassportPreviewZoom,
    handlePassportPreviewKeydown,
    handlePassportPreviewWheel,
    initializePassportPreviewController,
    isPassportPreviewImageReady,
    renderPassportPreview,
    renderPassportPreviewZoomControls,
    resetPassportPreviewZoom,
    resetPassportPreviewZoomState,
  };
}
