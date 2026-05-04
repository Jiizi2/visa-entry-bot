(function () {
  const root = window.NusukAutofill = window.NusukAutofill || {};
  const { cssEscape } = root.domUtils || {};
  const { normalizeOption } = root.valueUtils || {};
  if (!cssEscape || !normalizeOption) {
    throw new Error("NusukAutofill form field dependencies were not loaded.");
  }

  function inputSearchText(input) {
    const attrs = ["formcontrolname", "name", "id", "placeholder", "aria-label", "type", "inputmode", "class"]
      .map((name) => input.getAttribute(name) || "")
      .join(" ");
    const labelText = input.id
      ? String(document.querySelector(`label[for='${cssEscape(input.id)}']`)?.textContent || "")
      : "";
    const scopeText = String(input.closest("label, .form-group, .field, ngx-intl-tel-input, div")?.textContent || "");
    return normalizeOption(`${attrs} ${labelText} ${scopeText}`);
  }

  function isWritableInput(node) {
    return (node instanceof HTMLInputElement || node instanceof HTMLTextAreaElement)
      && !node.disabled
      && !node.readOnly
      && !["hidden", "file", "checkbox", "radio", "button", "submit"].includes(String(node.type || "").toLowerCase());
  }

  root.formFieldUtils = Object.freeze({
    inputSearchText,
    isWritableInput,
  });
})();
