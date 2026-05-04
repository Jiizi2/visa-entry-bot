(function () {
  const root = window.NusukAutofill = window.NusukAutofill || {};

  function createExecutionControl({ state }) {
    async function checkpoint(runId = state.runToken) {
      if (runId !== state.runToken) {
        throw createControlError("reset");
      }
      while (state.executionState === "paused") {
        await sleepRaw(150);
        if (runId !== state.runToken) {
          throw createControlError("reset");
        }
      }
      if (state.executionState === "idle" && state.currentRunPayload) {
        throw createControlError("reset");
      }
    }

    function createControlError(reason) {
      const error = new Error(`Execution interrupted: ${reason}`);
      error.name = "NusukControlError";
      error.controlReason = reason;
      return error;
    }

    function isControlError(error, reason) {
      return Boolean(error && typeof error === "object" && error.name === "NusukControlError" && (!reason || error.controlReason === reason));
    }

    function sleepRaw(ms) {
      return new Promise((resolve) => window.setTimeout(resolve, Math.max(0, Number(ms) || 0)));
    }

    async function sleep(ms, runId = state.runToken) {
      let remaining = Math.max(0, Number(ms) || 0);
      while (remaining > 0) {
        await checkpoint(runId);
        const chunk = Math.min(120, remaining);
        await sleepRaw(chunk);
        remaining -= chunk;
      }
    }

    return {
      checkpoint,
      createControlError,
      isControlError,
      sleepRaw,
      sleep,
    };
  }

  root.executionControl = Object.freeze({
    createExecutionControl,
  });
})();
