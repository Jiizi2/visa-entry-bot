(function () {
  const root = window.NusukAutofill = window.NusukAutofill || {};

  function normalizeDateToIso(rawValue) {
    const value = String(rawValue || "").trim();
    let match = value.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})$/);
    if (match) {
      return toIsoDate(match[1], match[2], match[3]);
    }
    match = value.match(/^(\d{1,2})[-/](\d{1,2})[-/](\d{4})$/);
    if (match) {
      return toIsoDate(match[3], match[2], match[1]);
    }
    return "";
  }

  function toIsoDate(yearValue, monthValue, dayValue) {
    const year = Number(yearValue);
    const month = Number(monthValue);
    const day = Number(dayValue);
    const date = new Date(Date.UTC(year, month - 1, day));
    if (
      !Number.isInteger(year)
      || !Number.isInteger(month)
      || !Number.isInteger(day)
      || date.getUTCFullYear() !== year
      || date.getUTCMonth() !== month - 1
      || date.getUTCDate() !== day
    ) {
      return "";
    }
    return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  }

  function isoDateParts(isoDate) {
    const match = String(isoDate || "").match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (!match) {
      return null;
    }
    return {
      year: Number(match[1]),
      month: Number(match[2]),
      day: Number(match[3]),
    };
  }

  function isoDateCandidates(isoDate) {
    const parts = isoDateParts(isoDate);
    if (!parts) {
      return [String(isoDate || "")];
    }
    return [
      `${parts.year}-${String(parts.month).padStart(2, "0")}-${String(parts.day).padStart(2, "0")}`,
      `${parts.year}-${parts.month}-${parts.day}`,
    ];
  }

  function isoToSlashDate(isoDate) {
    const parts = isoDateParts(isoDate);
    if (!parts) {
      return "";
    }
    return `${parts.year}/${String(parts.month).padStart(2, "0")}/${String(parts.day).padStart(2, "0")}`;
  }

  function isoToDisplayDMY(isoDate) {
    const parts = isoDateParts(isoDate);
    if (!parts) {
      return "";
    }
    return `${String(parts.day).padStart(2, "0")}/${String(parts.month).padStart(2, "0")}/${parts.year}`;
  }

  function isPickedDateMatch(value, targetParts) {
    if (!targetParts) {
      return false;
    }
    const text = String(value || "").replace(/\s+/g, "");
    const namedText = String(value || "").toLowerCase().replace(/[\s,./-]+/g, "");
    const y = String(targetParts.year);
    const m = String(targetParts.month);
    const d = String(targetParts.day);
    const mm = String(targetParts.month).padStart(2, "0");
    const dd = String(targetParts.day).padStart(2, "0");
    const candidates = [
      `${y}-${m}-${d}`,
      `${y}-${mm}-${dd}`,
      `${y}/${m}/${d}`,
      `${y}/${mm}/${dd}`,
      `${d}-${m}-${y}`,
      `${dd}-${mm}-${y}`,
      `${d}/${m}/${y}`,
      `${dd}/${mm}/${y}`,
    ];
    const monthNames = [
      ["jan", "january"],
      ["feb", "february"],
      ["mar", "march"],
      ["apr", "april"],
      ["may", "may"],
      ["jun", "june"],
      ["jul", "july"],
      ["aug", "august"],
      ["sep", "september"],
      ["oct", "october"],
      ["nov", "november"],
      ["dec", "december"],
    ][targetParts.month - 1] || [];
    const namedCandidates = monthNames.flatMap((month) => [
      `${d}${month}${y}`,
      `${dd}${month}${y}`,
      `${month}${d}${y}`,
      `${month}${dd}${y}`,
    ]);
    return candidates.some((candidate) => text.includes(candidate))
      || namedCandidates.some((candidate) => namedText.includes(candidate));
  }

  function monthNameToIndex(value) {
    const map = {
      january: 0, jan: 0,
      february: 1, feb: 1,
      march: 2, mar: 2,
      april: 3, apr: 3,
      may: 4,
      june: 5, jun: 5,
      july: 6, jul: 6,
      august: 7, aug: 7,
      september: 8, sep: 8,
      october: 9, oct: 9,
      november: 10, nov: 10,
      december: 11, dec: 11,
    };
    const key = String(value || "").trim().toLowerCase();
    return Object.prototype.hasOwnProperty.call(map, key) ? map[key] : -1;
  }

  root.dateUtils = Object.freeze({
    normalizeDateToIso,
    isoDateParts,
    isoDateCandidates,
    isoToSlashDate,
    isoToDisplayDMY,
    isPickedDateMatch,
    monthNameToIndex,
  });
})();
