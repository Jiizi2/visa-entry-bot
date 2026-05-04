(function () {
  const root = window.NusukAutofill = window.NusukAutofill || {};
  const { normalizeOption } = root.valueUtils || {};
  const { queryAll, isVisible, isEnabled } = root.domUtils || {};
  if (!normalizeOption || !queryAll) {
    throw new Error("NusukAutofill attachment dependencies were not loaded.");
  }

  function findAttachmentFileInputByLabel(labelText) {
    const rootNode = findAttachmentRootByLabel(labelText);
    const input = rootNode?.querySelector("input[type='file']");
    return input instanceof HTMLInputElement ? input : null;
  }

  function findAttachmentRootByLabel(labelText) {
    const expected = normalizeOption(labelText);
    if (!expected) {
      return null;
    }
    for (const attachment of queryAll(".attachment, .form-group, .upload-box")) {
      const label = normalizeOption(attachment.querySelector("label")?.textContent || "");
      if (label && (label.includes(expected) || expected.includes(label))) {
        return attachment;
      }
    }
    for (const label of queryAll("label")) {
      const text = normalizeOption(label.textContent || "");
      if (!text.includes(expected)) {
        continue;
      }
      const rootNode = label.closest(".attachment") || label.closest(".form-group, .field, .form-field") || label.parentElement;
      if (rootNode instanceof HTMLElement) {
        return rootNode;
      }
    }
    return null;
  }

  function deleteLabeledAttachment(labelText) {
    const rootNode = findAttachmentRootByLabel(labelText);
    if (!rootNode) {
      return false;
    }
    const deleteButton = Array.from(rootNode.querySelectorAll("button, [role='button']"))
      .find((button) => normalizeOption(button.textContent || button.getAttribute("aria-label") || "").includes("delete"));
    if (!(deleteButton instanceof HTMLElement) || !isVisible(deleteButton) || !isEnabled(deleteButton)) {
      return false;
    }
    deleteButton.click();
    return true;
  }

  root.attachmentUtils = Object.freeze({
    findAttachmentFileInputByLabel,
    findAttachmentRootByLabel,
    deleteLabeledAttachment,
  });
})();
