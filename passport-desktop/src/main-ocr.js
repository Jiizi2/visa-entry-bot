export const OCR_MODE_VALUES = new Set(["speed", "balanced", "heavy"]);
export const OCR_MODE_LABELS = {
  speed: "Speed",
  balanced: "Balanced",
  heavy: "Heavy",
};
export const DEFAULT_OCR_MODE = "speed";

export function normalizeOcrMode(value) {
  const normalized = String(value ?? "").trim().toLowerCase();
  return OCR_MODE_VALUES.has(normalized) ? normalized : DEFAULT_OCR_MODE;
}

export function ocrModeLabel(value) {
  return OCR_MODE_LABELS[normalizeOcrMode(value)];
}

export function loadOcrMode() {
  return DEFAULT_OCR_MODE;
}
