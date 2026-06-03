(function () {
  const root = window.NusukAutofill = window.NusukAutofill || {};
  const { UPLOAD_SETTLE_DELAY_MS } = root.constants || {};
  const { interpolate, normalizeOption } = root.valueUtils || {};
  const { queryAll, findFirstVisible, isVisible } = root.domUtils || {};
  if (!interpolate || !normalizeOption || !queryAll || !findFirstVisible || !isVisible) {
    throw new Error("NusukAutofill step upload dependencies were not loaded.");
  }

  function createStepUploadActions({
    sleep,
    markActiveElement,
    appendLog,
    finishStep,
    upload,
  }) {
    async function handleSetFiles(step, context, selector, timeoutMs, skipWhenEmpty, runId) {
      appendLog("info", `Mencari field ${uploadKindLabel(step).toLowerCase()}...`);
      const fileInput = await upload.waitForFileInputForStep(step, selector, timeoutMs, runId);
      if (!fileInput) {
        appendLog("warning", `Upload field tidak muncul, dilewati: ${selector}`);
        finishStep(step, selector);
        return;
      }
      markActiveElement(fileInput);
      const input = fileInput instanceof HTMLInputElement ? fileInput : null;
      const rawValue = interpolate(step?.value || "", context).trim();
      if (!rawValue && skipWhenEmpty) {
        appendLog("warning", `Skipping empty upload field ${selector}`);
        finishStep(step, selector);
        return;
      }
      if (!rawValue) {
        throw new Error(`Upload path is empty for selector: ${selector}`);
      }

      const resolvedFilePath = upload.resolveUploadFilePath(rawValue, context);
      const uploadFile = await upload.resolveSelectedUploadFile(rawValue, context);
      if (!uploadFile) {
        if (isPassportUploadStep(step)) {
          const fileDescriptor = createFileDescriptorFromPath(rawValue, resolvedFilePath);
          appendLog("warning", "File passport tidak ada di cache pilihan panel; memakai path JSON lewat Chrome debugger.");
          await handlePassportDebuggerUpload({
            step,
            input,
            file: fileDescriptor,
            resolvedFilePath,
            selector,
            appendLog,
            finishStep,
            upload,
            sleep,
            runId,
          });
          return;
        }
        if (isVaccinationUploadStep(step) && String(resolvedFilePath || "").trim()) {
          const fileDescriptor = createFileDescriptorFromPath(rawValue, resolvedFilePath);
          appendLog("warning", "File vaksin tidak ada di cache pilihan panel; memakai file passport dari path JSON lewat Chrome debugger.");
          const debuggerUploaded = await tryOptionalDebuggerUpload({
            step,
            input,
            file: fileDescriptor,
            resolvedFilePath,
            selector,
            appendLog,
            finishStep,
            upload,
            sleep,
            runId,
          });
          if (debuggerUploaded) {
            return;
          }
          appendLog("warning", "Upload vaksin opsional dilewati setelah debugger tidak berhasil.");
          finishStep(step, selector);
          return;
        }
        if (step?.optional_selector) {
          appendLog("warning", `${uploadKindLabel(step)} opsional tidak punya file dari cache/path JSON, dilewati.`);
          finishStep(step, selector);
          return;
        }
        const message = upload.buildUploadFailureMessage(rawValue, resolvedFilePath, "File upload tidak tersedia di memori/cache extension.");
        appendLog("error", message);
        throw new Error(message);
      }
      if (upload.isFileInputAlreadyUsing(input, uploadFile)) {
        if (!isPassportUploadStep(step) || isPassportUploadAcceptedOnPage(uploadFile)) {
          appendLog("success", `File upload sudah sesuai: ${uploadFile.name}`);
          finishStep(step, selector);
          return;
        }
        appendLog("warning", "Input passport sudah berisi file, tetapi halaman belum memprosesnya. Memilih ulang lewat Chrome debugger.");
      }
      if (isPassportUploadStep(step)) {
        await handlePassportDebuggerUpload({
          step,
          input,
          file: uploadFile,
          resolvedFilePath,
          selector,
          appendLog,
          finishStep,
          upload,
          sleep,
          runId,
        });
        return;
      }
      if (isVaccinationUploadStep(step) && String(resolvedFilePath || "").trim()) {
        const debuggerUploaded = await tryOptionalDebuggerUpload({
          step,
          input,
          file: uploadFile,
          resolvedFilePath,
          selector,
          appendLog,
          finishStep,
          upload,
          sleep,
          runId,
        });
        if (debuggerUploaded) {
          return;
        }
      }
      appendLog("info", `Menyiapkan file upload ${uploadFile.name} (${upload.formatBytesAsKb(uploadFile.size)})`);
      const uploadFileForWebsite = await upload.prepareFileForWebsiteUpload(uploadFile, runId);
      if (uploadFileForWebsite !== uploadFile) {
        appendLog("info", `File disiapkan ulang: ${uploadFileForWebsite.name} (${upload.formatBytesAsKb(uploadFileForWebsite.size)})`);
      }
      appendLog("info", `Memilih file upload ${uploadFileForWebsite.name} (${upload.formatBytesAsKb(uploadFileForWebsite.size)})`);
      upload.setFileInputFromFile(input, uploadFileForWebsite);
      upload.notifyUploadWidget(input);
      await sleep(UPLOAD_SETTLE_DELAY_MS, runId);
      let selectedFileName = await verifyUploadSelection({
        step,
        input,
        file: uploadFileForWebsite,
        selector,
        appendLog,
        finishStep,
      });
      if (selectedFileName === true) {
        return;
      }
      if (!selectedFileName) {
        appendLog("warning", "Input upload belum menahan file; mencoba ulang lewat Chrome debugger.");
        const debuggerResult = await upload.trySetFileInputWithDebugger(input, resolvedFilePath, runId);
        if (debuggerResult?.ok) {
          upload.notifyUploadWidget(input);
          await sleep(UPLOAD_SETTLE_DELAY_MS, runId);
        } else {
          appendLog("warning", `Debugger upload tidak berhasil: ${debuggerResult?.error || "unknown error"}`);
          appendLog("warning", "Mencoba ulang upload langsung ke input.");
          upload.setFileInputFromFile(input, uploadFileForWebsite);
          upload.notifyUploadWidget(input);
          await sleep(UPLOAD_SETTLE_DELAY_MS, runId);
        }
        selectedFileName = await verifyUploadSelection({
          step,
          input,
          file: uploadFileForWebsite,
          selector,
          appendLog,
          finishStep,
        });
        if (selectedFileName === true) {
          return;
        }
      }
      if (!selectedFileName) {
        const uploadError = findVisibleUploadError(input);
        if (uploadError) {
          throw new Error(`Upload ditolak halaman: ${uploadError}`);
        }
        throw new Error("File gagal terpasang ke input upload.");
      }
      appendLog("success", `File terpasang di input: ${selectedFileName}`);
      finishStep(step, selector);
    }

    return {
      handleSetFiles,
    };
  }

  function createFileDescriptorFromPath(rawValue, resolvedFilePath) {
    return {
      name: basenameFromPath(resolvedFilePath || rawValue) || "passport",
      size: 0,
    };
  }

  async function handlePassportDebuggerUpload({
    step,
    input,
    file,
    resolvedFilePath,
    selector,
    appendLog,
    finishStep,
    upload,
    sleep,
    runId,
  }) {
    if (!String(resolvedFilePath || "").trim()) {
      throw new Error("Upload passport harus lewat Chrome debugger, tetapi path file kosong.");
    }
    appendLog("info", buildPassportDebuggerUploadLog(file, upload));
    const debuggerResult = await upload.trySetFileInputWithDebugger(input, resolvedFilePath, runId);
    if (!debuggerResult?.ok) {
      throw new Error(`Upload passport harus lewat Chrome debugger, tetapi gagal: ${debuggerResult?.error || "unknown error"}`);
    }
    upload.notifyUploadWidget(input);
    await sleep(UPLOAD_SETTLE_DELAY_MS, runId);

    const accepted = await waitForPassportUploadAccepted({
      input,
      file,
      sleep,
      runId,
    });
    if (accepted) {
      appendLog("success", `${uploadKindLabel(step)} diproses oleh halaman: ${file.name}`);
      finishStep(step, selector);
      return;
    }

    const uploadError = findVisibleUploadError(input);
    if (uploadError) {
      throw new Error(`Upload ditolak halaman: ${uploadError}`);
    }
    const selectedFileName = input?.files?.[0]?.name || "";
    const selectedDetail = selectedFileName
      ? `File sudah terpasang di input (${selectedFileName})`
      : "File passport belum terlihat terpasang di input";
    throw new Error(`${selectedDetail}, tetapi Nusuk belum memunculkan Proceed/Passport Details setelah upload debugger.`);
  }

  async function waitForPassportUploadAccepted({ input, file, sleep, runId }) {
    const deadline = Date.now() + 6000;
    while (Date.now() < deadline) {
      const uploadError = findVisibleUploadError(input);
      if (uploadError) {
        throw new Error(`Upload ditolak halaman: ${uploadError}`);
      }
      if (isPassportUploadAcceptedOnPage(file)) {
        return true;
      }
      await sleep(Math.max(250, Math.floor(UPLOAD_SETTLE_DELAY_MS / 2)), runId);
    }
    return false;
  }

  function buildPassportDebuggerUploadLog(file, upload) {
    const name = String(file?.name || "passport");
    const size = Number(file?.size || 0);
    if (size > 0) {
      return `Memilih file passport lewat Chrome debugger: ${name} (${upload.formatBytesAsKb(size)})`;
    }
    return `Memilih file passport lewat Chrome debugger: ${name}`;
  }

  async function tryOptionalDebuggerUpload(options) {
    try {
      await handleOptionalDebuggerUpload(options);
      return true;
    } catch (error) {
      options.appendLog("warning", `Upload ${uploadKindLabel(options.step).toLowerCase()} lewat debugger tidak berhasil: ${error instanceof Error ? error.message : String(error)}`);
      return false;
    }
  }

  async function handleOptionalDebuggerUpload({
    step,
    input,
    file,
    resolvedFilePath,
    selector,
    appendLog,
    finishStep,
    upload,
    sleep,
    runId,
  }) {
    if (!String(resolvedFilePath || "").trim()) {
      throw new Error("path file kosong");
    }
    appendLog("info", buildDebuggerUploadLog(step, file, upload));
    const debuggerResult = await upload.trySetFileInputWithDebugger(input, resolvedFilePath, runId);
    if (!debuggerResult?.ok) {
      throw new Error(debuggerResult?.error || "unknown error");
    }
    upload.notifyUploadWidget(input);
    await sleep(UPLOAD_SETTLE_DELAY_MS, runId);
    const selectedFileName = await verifyUploadSelection({
      step,
      input,
      file,
      selector,
      appendLog,
      finishStep,
    });
    if (selectedFileName === true) {
      return;
    }
    if (selectedFileName) {
      appendLog("success", `File terpasang di input ${uploadKindLabel(step).toLowerCase()}: ${selectedFileName}`);
      finishStep(step, selector);
      return;
    }
    const uploadError = findVisibleUploadError(input);
    if (uploadError) {
      throw new Error(`Upload ditolak halaman: ${uploadError}`);
    }
    appendLog("success", `${uploadKindLabel(step)} diproses oleh halaman: ${file.name}`);
    finishStep(step, selector);
  }

  function buildDebuggerUploadLog(step, file, upload) {
    const label = uploadKindLabel(step).toLowerCase();
    const name = String(file?.name || "passport");
    const size = Number(file?.size || 0);
    if (size > 0) {
      return `Memilih file ${label} lewat Chrome debugger: ${name} (${upload.formatBytesAsKb(size)})`;
    }
    return `Memilih file ${label} lewat Chrome debugger: ${name}`;
  }

  async function verifyUploadSelection({ step, input, file, selector, appendLog, finishStep }) {
    const selectedFileName = input?.files?.[0]?.name || "";
    if (selectedFileName && !isPassportUploadStep(step)) {
      return selectedFileName;
    }
    const uploadError = findVisibleUploadError(input);
    if (uploadError) {
      throw new Error(`Upload ditolak halaman: ${uploadError}`);
    }
    if (isKnownUploadProcessedByPage(step, file)) {
      appendLog("success", `${uploadKindLabel(step)} diproses oleh halaman: ${file.name}`);
      finishStep(step, selector);
      return true;
    }
    return "";
  }

  function isKnownUploadProcessedByPage(step, file) {
    if (isVaccinationUploadStep(step)) {
      return true;
    }
    if (!isPassportUploadStep(step)) {
      return false;
    }
    if (isPassportUploadAcceptedOnPage(file)) {
      return true;
    }
    return false;
  }

  function isPassportUploadAcceptedOnPage(file) {
    if (findFirstVisible([
      ".popup .popup-actions button:has-text('Proceed'):visible",
      ".popup button:has-text('Proceed'):visible",
      "p-dropdown[formcontrolname='passportTypeId'] .p-dropdown",
      "select[formcontrolname='passportTypeId']",
      "input[formcontrolname='issueCityName']",
    ].join(", "))) {
      return true;
    }
    const fileName = normalizeOption(file?.name || "");
    if (!fileName) {
      return false;
    }
    return queryAll([
      ".container__notes__upload__button",
      ".passport-upload-section",
      ".upload-container",
      ".upload-button",
      ".upload",
      ".upload-box",
      ".attachment",
      ".form-group",
    ].join(", ")).some((node) => isVisible(node) && normalizeOption(node.textContent || "").includes(fileName));
  }

  function findVisibleUploadError(input) {
    const searchRoot = uploadErrorSearchRoot(input);
    const scopedText = collectVisibleUploadErrorText(searchRoot) || collectKnownUploadErrorText(searchRoot);
    if (scopedText) {
      return scopedText;
    }
    return collectVisibleUploadErrorText(document.body, true) || collectKnownUploadErrorText(document.body);
  }

  function uploadErrorSearchRoot(input) {
    if (!(input instanceof HTMLElement)) {
      return document.body;
    }
    return input.closest(".passport-upload-section, .upload-container, .attachment, .form-group, .field, .upload-box, .upload-button, .upload, .container__notes__upload__button, form, .card")
      || document.body;
  }

  function collectVisibleUploadErrorText(rootNode, strictKnownTextOnly = false) {
    if (!(rootNode instanceof Element)) {
      return "";
    }
    const selector = [
      ".invalid-feedback",
      ".text-danger",
      ".error",
      ".error-message",
      ".validation-error",
      ".p-error",
      ".p-message-error",
      ".alert-danger",
      "[class*='error' i]",
      "[class*='invalid' i]",
    ].join(", ");
    const nodes = [];
    try {
      nodes.push(...Array.from(rootNode.querySelectorAll(selector)));
    } catch {
      return "";
    }
    for (const node of nodes) {
      if (!isVisible(node)) {
        continue;
      }
      const text = compactText(node.textContent || "");
      if (text && looksLikeUploadError(text, strictKnownTextOnly)) {
        return text;
      }
    }
    return "";
  }

  function collectKnownUploadErrorText(rootNode) {
    if (!(rootNode instanceof Element)) {
      return "";
    }
    const nodes = [];
    try {
      nodes.push(...Array.from(rootNode.querySelectorAll("*")));
    } catch {
      return "";
    }
    for (const node of nodes) {
      if (!isVisible(node)) {
        continue;
      }
      const text = compactText(node.textContent || "");
      if (text.length > 180 || !looksLikeUploadError(text, true)) {
        continue;
      }
      return text;
    }
    return "";
  }

  function looksLikeUploadError(text, strictKnownTextOnly) {
    const normalized = normalizeOption(text);
    if (!normalized) {
      return false;
    }
    if (isUploadRequirementHint(normalized)) {
      return false;
    }
    if (
      normalized.includes("allowed file size")
      || normalized.includes("file size")
      || normalized.includes("invalid file")
      || normalized.includes("file type")
      || normalized.includes("not allowed")
      || normalized.includes("kb to")
    ) {
      return true;
    }
    if (strictKnownTextOnly) {
      return false;
    }
    return normalized.includes("upload") && (
      normalized.includes("failed")
      || normalized.includes("invalid")
      || normalized.includes("maximum")
      || normalized.includes("minimum")
      || normalized.includes("required")
    );
  }

  function isUploadRequirementHint(normalized) {
    if (
      normalized.includes("allowed file size")
      && normalized.includes("{{min size}}")
      && normalized.includes("1024 kb")
    ) {
      return true;
    }
    const isFormatHint = normalized.includes("supported format")
      || normalized.includes("supported formats")
      || normalized.includes("accepted format")
      || normalized.includes("accepted formats");
    if (!isFormatHint) {
      return false;
    }
    return !(
      normalized.includes("allowed file size")
      || normalized.includes("invalid")
      || normalized.includes("not allowed")
      || normalized.includes("failed")
      || normalized.includes("error")
    );
  }

  function uploadKindLabel(step) {
    const uploadKind = String(step?.upload_kind || "").trim().toLowerCase();
    if (uploadKind === "vaccination") {
      return "Vaksin";
    }
    if (uploadKind === "passport") {
      return "Passport";
    }
    return "Upload";
  }

  function isPassportUploadStep(step) {
    return String(step?.upload_kind || "").trim().toLowerCase() === "passport";
  }

  function isVaccinationUploadStep(step) {
    return String(step?.upload_kind || "").trim().toLowerCase() === "vaccination";
  }

  function compactText(text) {
    return String(text || "").replace(/\s+/g, " ").trim();
  }

  function basenameFromPath(value) {
    return String(value || "").replace(/\\/g, "/").split("/").filter(Boolean).pop() || "";
  }

  root.stepUploadActions = Object.freeze({
    createStepUploadActions,
  });
})();
