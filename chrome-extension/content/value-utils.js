(function () {
  const root = window.NusukAutofill = window.NusukAutofill || {};

  function interpolate(template, context) {
    return String(template || "").replace(/\{\{([^}]+)\}\}/g, (_full, exprRaw) => {
      const expr = String(exprRaw || "").trim();
      if (!expr) {
        return "";
      }
      if (expr === "index") {
        return String(context.index ?? "");
      }
      if (expr === "memberIndex") {
        return String(context.memberIndex ?? "");
      }
      if (expr === "totalMembers") {
        return String(context.totalMembers ?? "");
      }
      if (expr.startsWith("member.")) {
        return String(deepValue(context.member, expr.slice("member.".length)) ?? "");
      }
      return String(deepValue(context, expr) ?? "");
    });
  }

  function deepValue(node, rawPath) {
    const parts = String(rawPath || "").split(".").filter(Boolean);
    let current = node;
    for (const part of parts) {
      if (!current || typeof current !== "object" || !(part in current)) {
        return "";
      }
      current = current[part];
    }
    return current ?? "";
  }

  function pickFirstNonEmpty(...values) {
    for (const value of values) {
      const text = String(value ?? "").trim();
      if (text) {
        return text;
      }
    }
    return "";
  }

  function normalizeOption(value) {
    return String(value || "")
      .normalize("NFKD")
      .replace(/[\u0300-\u036f]/g, "")
      .trim()
      .toLowerCase()
      .replace(/[().,-]/g, " ")
      .replace(/\s+/g, " ");
  }

  root.valueUtils = Object.freeze({
    interpolate,
    deepValue,
    pickFirstNonEmpty,
    normalizeOption,
  });
})();
