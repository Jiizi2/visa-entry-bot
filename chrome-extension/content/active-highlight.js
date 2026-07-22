(function () {
  const root = window.NusukAutofill = window.NusukAutofill || {};
  const {
    HIGHLIGHT_STYLE_ID,
    ACTIVE_HIGHLIGHT_CLASS,
  } = root.constants || {};
  if (!HIGHLIGHT_STYLE_ID) {
    throw new Error("NusukAutofill constants were not loaded.");
  }

  function createActiveHighlight() {
    let activeHighlightElement = null;

    function ensureHighlightStyle() {
      if (document.getElementById(HIGHLIGHT_STYLE_ID)) {
        return;
      }
      const style = document.createElement("style");
      style.id = HIGHLIGHT_STYLE_ID;
      style.textContent = `
        .${ACTIVE_HIGHLIGHT_CLASS} {
          outline: 2px solid #d9a94f !important;
          outline-offset: 2px !important;
          box-shadow: 0 0 0 4px rgba(217, 169, 79, 0.22) !important;
          transition: outline 120ms ease, box-shadow 120ms ease !important;
        }
      `;
      document.head.appendChild(style);
    }

    function markActiveElement(element) {
      clearActiveHighlight();
      if (!(element instanceof HTMLElement)) {
        return;
      }
      activeHighlightElement = element;
      activeHighlightElement.classList.add(ACTIVE_HIGHLIGHT_CLASS);
    }

    function clearActiveHighlight() {
      if (activeHighlightElement instanceof HTMLElement) {
        activeHighlightElement.classList.remove(ACTIVE_HIGHLIGHT_CLASS);
      }
      activeHighlightElement = null;
    }

    return {
      ensureHighlightStyle,
      markActiveElement,
      clearActiveHighlight,
    };
  }

  root.activeHighlight = Object.freeze({
    createActiveHighlight,
  });
})();
