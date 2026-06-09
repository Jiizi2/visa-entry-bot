export type OcrMode = "speed" | "balanced" | "heavy";

export const OCR_MODE_VALUES: Set<string> = new Set(["speed", "balanced", "heavy"]);
export const OCR_MODE_LABELS: Record<OcrMode, string> = {
  speed: "Speed",
  balanced: "Balanced",
  heavy: "Heavy",
};
export const DEFAULT_OCR_MODE: OcrMode = "speed";

export function normalizeOcrMode(value: unknown): OcrMode {
  const normalized = String(value ?? "").trim().toLowerCase();
  return OCR_MODE_VALUES.has(normalized) ? (normalized as OcrMode) : DEFAULT_OCR_MODE;
}

export function ocrModeLabel(value: unknown): string {
  return OCR_MODE_LABELS[normalizeOcrMode(value)];
}

export function loadOcrMode(): OcrMode {
  return DEFAULT_OCR_MODE;
}
