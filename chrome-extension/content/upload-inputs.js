(function () {
  const root = window.NusukAutofill = window.NusukAutofill || {};
  const {
    cssEscape,
    queryAll,
  } = root.domUtils || {};
  const { normalizeOption } = root.valueUtils || {};
  const { findAttachmentFileInputByLabel } = root.attachmentUtils || {};
  if (!cssEscape || !queryAll || !normalizeOption || !findAttachmentFileInputByLabel) {
    throw new Error("NusukAutofill upload input dependencies were not loaded.");
  }

  function createUploadInputs({
    state,
    waitForSelector,
    isResidencyText,
  }) {
    async function waitForFileInputForStep(step, selector, timeoutMs, runId = state.runToken) {
      const uploadKind = String(step?.upload_kind || "").trim().toLowerCase();
      if (uploadKind === "vaccination") {
        const vaccinationInput = chooseBestFileInput(uploadKind, null);
        if (vaccinationInput) {
          return vaccinationInput;
        }
      }
      try {
        const direct = await waitForSelector(selector, { timeoutMs, state: "attached" }, runId);
        const input = coerceFileInput(direct);
        const preferred = chooseBestFileInput(uploadKind, input);
        if (preferred) {
          return preferred;
        }
        if (uploadKind === "vaccination") {
          return null;
        }
        return input || direct;
      } catch (error) {
        if (!step?.optional_selector) {
          throw error;
        }
        return chooseBestFileInput(uploadKind, null);
      }
    }

    function coerceFileInput(node) {
      if (node instanceof HTMLInputElement && node.type === "file") {
        return node;
      }
      const nested = node?.querySelector?.("input[type='file']");
      return nested instanceof HTMLInputElement ? nested : null;
    }

    function chooseBestFileInput(uploadKind, preferredInput) {
      const inputs = queryAll("input[type='file']").filter((input) => input instanceof HTMLInputElement);
      if (!inputs.length) {
        return preferredInput || null;
      }
      if (uploadKind === "vaccination") {
        const labeled = findAttachmentFileInputByLabel("Vaccination Certificate") || findAttachmentFileInputByLabel("Vaccination");
        if (labeled && !isForbiddenVaccinationFileInput(labeled)) {
          return labeled;
        }
        const scored = inputs
          .filter((input) => !isForbiddenVaccinationFileInput(input))
          .map((input) => ({ input, score: scoreFileInput(input, uploadKind) }))
          .sort((left, right) => right.score - left.score);
        return scored[0]?.score > 0 ? scored[0].input : null;
      }
      const scored = inputs
        .map((input) => ({ input, score: scoreFileInput(input, uploadKind) }))
        .sort((left, right) => right.score - left.score);
      if (scored[0]?.score > 0) {
        return scored[0].input;
      }
      if (preferredInput) {
        return preferredInput;
      }
      return inputs[0];
    }

    function isForbiddenVaccinationFileInput(input) {
      const text = fileInputSearchText(input);
      return isResidencyText(text)
        || text.includes("personal picture")
        || text.includes("profile picture")
        || text.includes("personal photo")
        || text.includes("profile photo");
    }

    function scoreFileInput(input, uploadKind) {
      const text = fileInputSearchText(input);
      const imageAcceptScore = inputAcceptsPassportImage(input) ? 4 : 0;
      if (uploadKind === "vaccination") {
        const healthScore = scoreTextTokens(text, ["vaccination", "vaccin", "vaccine", "immun", "health"]);
        return healthScore ? healthScore + imageAcceptScore : 0;
      }
      if (uploadKind === "passport") {
        return scoreTextTokens(text, ["passport", "travel document", "document", "container__notes__upload", "choose file", "upload button"]) + imageAcceptScore;
      }
      return 0;
    }

    function fileInputSearchText(input) {
      const attrs = ["formcontrolname", "name", "id", "accept", "aria-label", "placeholder", "class"]
        .map((name) => input.getAttribute(name) || "")
        .join(" ");
      const scope = input.closest(".attachment, label, .form-group, .field, .upload-box, .upload-button, .upload, .container__notes__upload__button, div");
      const scopeAttrs = scope instanceof HTMLElement
        ? ["class", "id", "aria-label"].map((name) => scope.getAttribute(name) || "").join(" ")
        : "";
      const labelText = input.id
        ? String(document.querySelector(`label[for='${cssEscape(input.id)}']`)?.textContent || "")
        : "";
      const ancestorLabels = collectAncestorLabelTexts(input).join(" ");
      const scopeText = String(scope?.textContent || "");
      return normalizeOption(`${attrs} ${scopeAttrs} ${labelText} ${ancestorLabels} ${scopeText}`);
    }

    function collectAncestorLabelTexts(node) {
      const labels = [];
      let current = node instanceof Element ? node.parentElement : null;
      for (let depth = 0; current && depth < 6; depth += 1) {
        for (const child of Array.from(current.children || [])) {
          if (child instanceof HTMLLabelElement) {
            const text = String(child.textContent || "").trim();
            if (text && !labels.includes(text)) {
              labels.push(text);
            }
          }
        }
        current = current.parentElement;
      }
      return labels;
    }

    function inputAcceptsPassportImage(input) {
      const accept = normalizeOption(input.getAttribute("accept") || "");
      return /\bpng\b/.test(accept) || /\bjpg\b/.test(accept) || /\bjpeg\b/.test(accept) || /\bpdf\b/.test(accept) || accept.includes("image");
    }

    function scoreTextTokens(text, tokens) {
      return tokens.reduce((score, token, index) => text.includes(token) ? score + tokens.length - index : score, 0);
    }

    return {
      waitForFileInputForStep,
    };
  }

  root.uploadInputs = Object.freeze({
    createUploadInputs,
  });
})();
