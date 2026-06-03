(function () {
  const root = window.NusukAutofill = window.NusukAutofill || {};
  const {
    UPLOAD_MIN_TARGET_BYTES,
    UPLOAD_MAX_BYTES,
  } = root.constants || {};
  const {
    isAbsoluteFilePath,
    stripExtension,
  } = root.pathUtils || {};
  const { createUploadInputs } = root.uploadInputs || {};
  const { createUploadFileStore } = root.uploadFileStore || {};
  if (!isAbsoluteFilePath || !stripExtension || !createUploadInputs || !createUploadFileStore) {
    throw new Error("NusukAutofill upload dependencies were not loaded.");
  }

  function createUploadManager({
    state,
    appendLog,
    checkpoint,
    waitForSelector,
    isResidencyText,
  }) {
    const { waitForFileInputForStep } = createUploadInputs({
      state,
      waitForSelector,
      isResidencyText,
    });
    const {
      registerUploadFiles,
      getUploadState,
      resolveUploadFilePath,
      resolveSelectedUploadFile,
      buildUploadFailureMessage,
    } = createUploadFileStore({ state });

    function isFileInputAlreadyUsing(input, file) {
      if (!(input instanceof HTMLInputElement) || !input.files?.length || !file) {
        return false;
      }
      if (input.files.length !== 1) {
        return false;
      }
      const current = input.files[0];
      return current.name === file.name && current.size === file.size && current.lastModified === file.lastModified;
    }

    async function prepareFileForWebsiteUpload(file, runId = state.runToken) {
      if (!shouldNormalizeUploadFile(file)) {
        if (file instanceof File && (file.size > UPLOAD_MAX_BYTES || file.size < UPLOAD_MIN_TARGET_BYTES)) {
          throw new Error(`File ${file.name} di luar batas upload Nusuk dan bukan gambar yang bisa dikompres: ${formatBytesAsKb(file.size)}.`);
        }
        return file;
      }
      if (isUploadFileWithinBounds(file) && !shouldConvertImageFormatToJpeg(file)) {
        return file;
      }
      try {
        await checkpoint(runId);
        appendLog("info", `Menyesuaikan ukuran file ${file.name} ke batas upload Nusuk...`);
        const compressed = await normalizeImageFileToJpeg(file);
        await checkpoint(runId);
        return compressed?.size ? compressed : file;
      } catch (error) {
        appendLog("warning", `Normalisasi file dilewati: ${error instanceof Error ? error.message : String(error)}`);
        if (file.size > UPLOAD_MAX_BYTES || file.size < UPLOAD_MIN_TARGET_BYTES) {
          throw new Error(`File ${file.name} di luar batas upload Nusuk setelah normalisasi: ${formatBytesAsKb(file.size)}.`);
        }
        return file;
      }
    }

    function shouldNormalizeUploadFile(file) {
      if (!(file instanceof File)) {
        return false;
      }
      const name = String(file.name || "").toLowerCase();
      const type = String(file.type || "").toLowerCase();
      return type.startsWith("image/") || /\.(png|jpe?g)$/i.test(name);
    }

    function shouldConvertImageFormatToJpeg(file) {
      if (!(file instanceof File)) {
        return false;
      }
      const name = String(file.name || "").toLowerCase();
      const type = String(file.type || "").toLowerCase();
      return type === "image/png" || /\.png$/i.test(name);
    }

    function isUploadFileWithinBounds(file) {
      return file instanceof File && file.size >= UPLOAD_MIN_TARGET_BYTES && file.size <= UPLOAD_MAX_BYTES;
    }

    async function normalizeImageFileToJpeg(file) {
      const bitmap = await createImageBitmap(file);
      try {
        const canvas = document.createElement("canvas");
        const context = canvas.getContext("2d", { alpha: false });
        if (!context) {
          return file;
        }
        const baseName = stripExtension(file.name) || "passport";
        const targetBytes = Math.round((UPLOAD_MIN_TARGET_BYTES + UPLOAD_MAX_BYTES) / 2);
        const estimatedScale = Math.sqrt(targetBytes / Math.max(1, file.size));
        const scaleCandidates = file.size > UPLOAD_MAX_BYTES
          ? uniqueNumbers([estimatedScale, estimatedScale * 0.9, estimatedScale * 0.78, 0.72, 0.58, 0.45, 0.32, 0.22], 0.08, 1)
          : uniqueNumbers([estimatedScale, estimatedScale * 1.12, estimatedScale * 1.3, 1.35, 1.7, 2.2, 3, 4], 1, 5);
        const qualityCandidates = file.size < UPLOAD_MIN_TARGET_BYTES
          ? [0.96, 0.92, 0.88]
          : [0.86, 0.78, 0.7, 0.62, 0.54];
        let bestBlob = null;
        let bestScore = Number.POSITIVE_INFINITY;
        for (const scale of scaleCandidates) {
          canvas.width = Math.max(1, Math.round(bitmap.width * scale));
          canvas.height = Math.max(1, Math.round(bitmap.height * scale));
          context.fillStyle = "#ffffff";
          context.fillRect(0, 0, canvas.width, canvas.height);
          context.imageSmoothingEnabled = true;
          context.imageSmoothingQuality = "high";
          context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);

          for (const quality of qualityCandidates) {
            const blob = await canvasToBlob(canvas, "image/jpeg", quality);
            if (!blob) {
              continue;
            }
            if (blob.size >= UPLOAD_MIN_TARGET_BYTES && blob.size <= UPLOAD_MAX_BYTES) {
              return fileFromBlob(blob, baseName, file);
            }
            const score = outOfRangeScore(blob.size, targetBytes);
            if (score < bestScore) {
              bestBlob = blob;
              bestScore = score;
            }
          }
        }
        if (!bestBlob) {
          throw new Error(`File tetap lebih besar dari batas upload setelah normalisasi: ${formatBytesAsKb(file.size)}`);
        }
        if (bestBlob.size < UPLOAD_MIN_TARGET_BYTES || bestBlob.size > UPLOAD_MAX_BYTES) {
          throw new Error(`File tetap di luar batas upload setelah normalisasi: ${formatBytesAsKb(bestBlob.size)}`);
        }
        return fileFromBlob(bestBlob, baseName, file);
      } finally {
        if (typeof bitmap.close === "function") {
          bitmap.close();
        }
      }
    }

    function uniqueNumbers(values, min, max) {
      const seen = new Set();
      return values
        .map((value) => Math.max(min, Math.min(max, Number(value) || min)))
        .map((value) => Math.round(value * 100) / 100)
        .filter((value) => {
          const key = String(value);
          if (seen.has(key)) {
            return false;
          }
          seen.add(key);
          return true;
        });
    }

    function outOfRangeScore(size, targetBytes) {
      if (size > UPLOAD_MAX_BYTES) {
        return (size - UPLOAD_MAX_BYTES) * 4;
      }
      if (size < UPLOAD_MIN_TARGET_BYTES) {
        return (UPLOAD_MIN_TARGET_BYTES - size) * 2;
      }
      return Math.abs(size - targetBytes);
    }

    function fileFromBlob(blob, baseName, sourceFile) {
      return new File([blob], `${baseName}.jpg`, {
        type: "image/jpeg",
        lastModified: sourceFile.lastModified || Date.now(),
      });
    }

    function canvasToBlob(canvas, type, quality) {
      return new Promise((resolve) => {
        canvas.toBlob((blob) => resolve(blob), type, quality);
      });
    }

    function formatBytesAsKb(bytes) {
      return `${Math.max(1, Math.round(Number(bytes || 0) / 1024))} KB`;
    }

    async function trySetFileInputWithDebugger(input, filePath, runId = state.runToken) {
      if (!(input instanceof HTMLInputElement) || !filePath) {
        return { ok: false, error: "input/path kosong" };
      }
      if (!isAbsoluteFilePath(filePath)) {
        return { ok: false, error: `path bukan absolut: ${filePath}` };
      }
      const token = `nusuk-debug-file-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      const selector = `input[type="file"][data-nusuk-debug-file="${token}"]`;
      input.setAttribute("data-nusuk-debug-file", token);
      try {
        await checkpoint(runId);
        const response = await sendRuntimeMessage({
          type: "NUSUK_DEBUGGER_SET_FILE",
          payload: {
            selector,
            filePath,
          },
        });
        await checkpoint(runId);
        if (!response?.ok) {
          return { ok: false, error: response?.error || "response debugger kosong" };
        }
        return { ok: true, error: "" };
      } catch (error) {
        return { ok: false, error: error instanceof Error ? error.message : String(error) };
      } finally {
        input.removeAttribute("data-nusuk-debug-file");
      }
    }

    function sendRuntimeMessage(message) {
      return new Promise((resolve, reject) => {
        chrome.runtime.sendMessage(message, (response) => {
          const error = chrome.runtime.lastError;
          if (error) {
            reject(new Error(error.message));
            return;
          }
          resolve(response);
        });
      });
    }

    function setFileInputFromFile(input, file) {
      if (!(input instanceof HTMLInputElement) || input.type !== "file") {
        throw new Error("Selector upload tidak mengarah ke input file.");
      }
      const dataTransfer = createFileDataTransfer();
      dataTransfer.items.add(file);
      const descriptor = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "files");
      if (descriptor?.set) {
        descriptor.set.call(input, dataTransfer.files);
      } else {
        input.files = dataTransfer.files;
      }
      if (!input.files?.length) {
        throw new Error("Browser menolak memasang file ke input upload.");
      }
      dispatchFileInputEvents(input);
    }

    function createFileDataTransfer() {
      if (typeof DataTransfer === "function") {
        try {
          return new DataTransfer();
        } catch {
          // Fall through to the clipboard-backed fallback below.
        }
      }
      const clipboardData = typeof ClipboardEvent === "function"
        ? new ClipboardEvent("").clipboardData
        : null;
      if (clipboardData?.items) {
        return clipboardData;
      }
      throw new Error("Browser tidak menyediakan DataTransfer untuk upload file.");
    }

    function dispatchFileInputEvents(input) {
      input.dispatchEvent(new Event("input", { bubbles: true, composed: true }));
      input.dispatchEvent(new Event("change", { bubbles: true, composed: true }));
      input.dispatchEvent(new Event("blur", { bubbles: true, composed: true }));
    }

    function notifyUploadWidget(input) {
      if (!(input instanceof HTMLInputElement)) {
        return;
      }
      dispatchFileInputEvents(input);
    }

    return {
      registerUploadFiles,
      getUploadState,
      waitForFileInputForStep,
      resolveUploadFilePath,
      resolveSelectedUploadFile,
      buildUploadFailureMessage,
      isFileInputAlreadyUsing,
      prepareFileForWebsiteUpload,
      formatBytesAsKb,
      trySetFileInputWithDebugger,
      setFileInputFromFile,
      notifyUploadWidget,
    };
  }

  root.uploadManager = Object.freeze({
    createUploadManager,
  });
})();
