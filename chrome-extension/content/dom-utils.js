(function () {
  const root = window.NusukAutofill = window.NusukAutofill || {};
  const { normalizeOption } = root.valueUtils || {};
  if (!normalizeOption) {
    throw new Error("NusukAutofill value utils were not loaded.");
  }

  function cssEscape(value) {
    if (window.CSS?.escape) {
      return window.CSS.escape(String(value || ""));
    }
    return String(value || "").replace(/\\/g, "\\\\").replace(/'/g, "\\'");
  }

  async function clickElement(element) {
    if (!element) {
      throw new Error("Cannot click a missing element.");
    }
    if (element instanceof HTMLElement) {
      element.scrollIntoView({ block: "center", inline: "nearest" });
      element.focus?.();
      for (const type of ["pointerdown", "mousedown", "pointerup", "mouseup"]) {
        element.dispatchEvent(new MouseEvent(type, {
          bubbles: true,
          cancelable: true,
          composed: true,
          view: window,
        }));
      }
    }
    try {
      element.click();
    } catch {
      element.dispatchEvent(new MouseEvent("click", {
        bubbles: true,
        cancelable: true,
        composed: true,
        view: window,
      }));
    }
  }

  function setInputValue(element, value) {
    const prototype = Object.getPrototypeOf(element);
    const descriptor = prototype ? Object.getOwnPropertyDescriptor(prototype, "value") : null;
    if (descriptor?.set) {
      descriptor.set.call(element, value);
    } else {
      element.value = value;
    }
    element.dispatchEvent(new Event("input", { bubbles: true }));
    element.dispatchEvent(new Event("change", { bubbles: true }));
  }

  function dispatchBlur(element) {
    element.dispatchEvent(new Event("blur", { bubbles: true }));
  }

  function queryAll(selector) {
    const results = [];
    for (const part of splitSelectorList(selector)) {
      const parsed = parseSelectorPart(part);
      if (!parsed.css) {
        continue;
      }
      let nodes = [];
      try {
        nodes = Array.from(document.querySelectorAll(parsed.css));
      } catch {
        continue;
      }
      for (const node of nodes) {
        if (parsed.visible && !isVisible(node)) {
          continue;
        }
        if (parsed.hasText && !String(node.textContent || "").includes(parsed.hasText)) {
          continue;
        }
        if (!results.includes(node)) {
          results.push(node);
        }
      }
    }
    return results;
  }

  function findFirstVisible(selector) {
    return queryAll(selector).find((node) => isVisible(node)) || null;
  }

  function findByText(selector, text) {
    const normalizedTarget = normalizeOption(text);
    return queryAll(selector).find((node) => normalizeOption(node.textContent || "").includes(normalizedTarget)) || null;
  }

  function splitSelectorList(selector) {
    return String(selector || "")
      .split(/\s*,\s*/)
      .map((item) => item.trim())
      .filter(Boolean);
  }

  function parseSelectorPart(part) {
    let css = String(part || "").trim();
    let hasText = "";
    const hasTextMatch = css.match(/:has-text\((['"])(.*?)\1\)/i);
    if (hasTextMatch) {
      hasText = hasTextMatch[2] || "";
      css = css.replace(hasTextMatch[0], "");
    }
    const visible = /:visible\b/i.test(css);
    css = css.replace(/:visible\b/gi, "").trim();
    return { css, hasText, visible };
  }

  function isVisible(node) {
    if (!(node instanceof HTMLElement)) {
      return false;
    }
    const style = window.getComputedStyle(node);
    const rect = node.getBoundingClientRect();
    return style.display !== "none" && style.visibility !== "hidden" && rect.width > 0 && rect.height > 0;
  }

  function isEnabled(node) {
    if (!(node instanceof HTMLElement)) {
      return false;
    }
    if ("disabled" in node && node.disabled) {
      return false;
    }
    if (node.getAttribute("disabled") !== null) {
      return false;
    }
    if (String(node.getAttribute("aria-disabled") || "").toLowerCase() === "true") {
      return false;
    }
    const className = String(node.className || "").toLowerCase();
    if (className.includes("disabled") || className.includes("p-disabled")) {
      return false;
    }
    return true;
  }

  root.domUtils = Object.freeze({
    cssEscape,
    clickElement,
    setInputValue,
    dispatchBlur,
    queryAll,
    findFirstVisible,
    findByText,
    isVisible,
    isEnabled,
  });
})();
