import { cloneJson } from "./main-utils.js";
import { MANIFEST_SAVE_DELAY_MS } from "./main-state.js";

export function createManifestPersistence({
  state,
  renderAll,
  saveManifest,
  windowRef = globalThis.window,
  defaultDelayMs = MANIFEST_SAVE_DELAY_MS,
}) {
  let manifestSaveTimer = null;
  let manifestSaveSequence = 0;

  function scheduleManifestSave(delayMs = defaultDelayMs) {
    if (!state.manifestPath || !state.manifest) {
      return;
    }

    manifestSaveSequence += 1;
    if (manifestSaveTimer !== null) {
      windowRef.clearTimeout(manifestSaveTimer);
    }

    const sequence = manifestSaveSequence;
    manifestSaveTimer = windowRef.setTimeout(() => {
      manifestSaveTimer = null;
      void persistManifestSnapshot(sequence);
    }, Math.max(0, Number(delayMs) || 0));
  }

  async function flushManifestSave() {
    if (!state.manifestPath || !state.manifest) {
      return;
    }

    if (manifestSaveTimer !== null) {
      windowRef.clearTimeout(manifestSaveTimer);
      manifestSaveTimer = null;
    }

    manifestSaveSequence += 1;
    await persistManifestSnapshot(manifestSaveSequence);
  }

  async function persistManifestSnapshot(sequence) {
    if (!state.manifestPath || !state.manifest) {
      return;
    }

    const snapshot = cloneJson(state.manifest);
    try {
      await saveManifest({
        manifestPath: state.manifestPath,
        manifestData: snapshot,
      });
    } catch (error) {
      if (sequence === manifestSaveSequence) {
        state.statusHeadline = "Gagal menyimpan review";
        state.statusDetail = String(error || "Manifest tidak berhasil disimpan.");
        renderAll();
      }
    }
  }

  return {
    scheduleManifestSave,
    flushManifestSave,
  };
}
