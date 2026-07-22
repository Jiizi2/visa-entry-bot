(function () {
  const root = window.NusukAutofill = window.NusukAutofill || {};

  function createWidgetManager({ state }) {
    let widgetEl = null;
    let isDragging = false;
    let startX = 0;
    let startY = 0;
    let initialX = 0;
    let initialY = 0;
    let dragDistance = 0;

    const STYLE_ID = "entrymate-widget-styles";

    function injectStyles() {
      if (document.getElementById(STYLE_ID)) {
        return;
      }
      const style = document.createElement("style");
      style.id = STYLE_ID;
      style.textContent = `
        .entrymate-widget {
          position: fixed;
          bottom: 24px;
          right: 24px;
          width: 164px;
          background: rgba(26, 29, 30, 0.94);
          backdrop-filter: blur(12px);
          -webkit-backdrop-filter: blur(12px);
          color: #f9f9f9;
          border-radius: 14px;
          padding: 13px 14px;
          box-shadow: 0 14px 34px rgba(26, 29, 30, 0.28), inset 0 1px 0 rgba(247, 216, 131, 0.08);
          border: 1px solid rgba(247, 216, 131, 0.2);
          font-family: "Segoe UI Variable", "Segoe UI", -apple-system, BlinkMacSystemFont, sans-serif;
          z-index: 999999;
          cursor: grab;
          user-select: none;
          display: flex;
          flex-direction: column;
          gap: 9px;
          transition: transform 0.18s ease, box-shadow 0.18s ease, border-color 0.18s ease;
        }
        .entrymate-widget:hover {
          transform: translateY(-3px) scale(1.02);
          box-shadow: 0 18px 40px rgba(26, 29, 30, 0.36), 0 0 18px rgba(217, 169, 79, 0.18);
          border-color: rgba(247, 216, 131, 0.38);
        }
        .entrymate-widget:active {
          cursor: grabbing;
          transform: scale(0.98);
        }
        .entrymate-widget-header {
          display: flex;
          align-items: center;
          justify-content: space-between;
          font-size: 10px;
          font-weight: 700;
          color: rgba(249, 249, 249, 0.58);
          letter-spacing: 0.08em;
          text-transform: uppercase;
        }
        .entrymate-widget-brand {
          display: flex;
          align-items: center;
          gap: 6px;
        }
        .entrymate-widget-restore-hint {
          font-size: 9px;
          color: #f7d883;
          font-weight: 600;
          opacity: 0;
          transition: opacity 0.2s ease;
        }
        .entrymate-widget:hover .entrymate-widget-restore-hint {
          opacity: 1;
        }
        .entrymate-widget-body {
          display: flex;
          flex-direction: column;
          gap: 6px;
        }
        .entrymate-widget-progress-row {
          display: flex;
          align-items: center;
          gap: 8px;
          font-size: 13px;
          font-weight: 700;
          color: #f9f9f9;
        }
        .entrymate-widget-status-dot {
          width: 8px;
          height: 8px;
          border-radius: 50%;
          background: #707874;
          display: inline-block;
          box-shadow: 0 0 4px rgba(0,0,0,0.5);
          transition: all 0.3s ease;
        }
        .entrymate-widget-status-dot.running {
          background: #4f9a81;
          box-shadow: 0 0 8px #4f9a81, 0 0 16px rgba(79, 154, 129, 0.34);
          animation: entrymate-pulse 1.8s infinite ease-in-out;
        }
        .entrymate-widget-status-dot.paused {
          background: #d9a94f;
          box-shadow: 0 0 8px rgba(217, 169, 79, 0.68);
        }
        .entrymate-widget-status-dot.idle {
          background: #d9a94f;
          box-shadow: 0 0 8px rgba(217, 169, 79, 0.68);
        }
        .entrymate-widget-status-dot.completed {
          background: #4f9a81;
          box-shadow: 0 0 8px #4f9a81;
        }
        .entrymate-widget-status-dot.error {
          background: #c45b54;
          box-shadow: 0 0 8px #c45b54;
        }

        @keyframes entrymate-pulse {
          0% { transform: scale(1); opacity: 1; }
          50% { transform: scale(1.25); opacity: 0.6; }
          100% { transform: scale(1); opacity: 1; }
        }

        .entrymate-widget-progress-track {
          width: 100%;
          height: 5px;
          background: rgba(249, 249, 249, 0.13);
          border-radius: 99px;
          overflow: hidden;
          margin-top: 2px;
        }
        .entrymate-widget-progress-bar {
          height: 100%;
          background: linear-gradient(90deg, #d9a94f, #f7d883);
          border-radius: 99px;
          width: 0%;
          transition: width 0.2s ease-in-out;
        }
      `;
      document.head.append(style);
    }

    function showWidget() {
      console.log("[WidgetManager] Menampilkan widget melayang...");
      if (widgetEl) {
        console.log("[WidgetManager] Widget sudah tampil.");
        return;
      }
      injectStyles();

      widgetEl = document.createElement("div");
      widgetEl.className = "entrymate-widget";

      // Restore position if saved
      const savedPos = localStorage.getItem("entrymate_widget_position");
      if (savedPos) {
        try {
          const { x, y } = JSON.parse(savedPos);
          widgetEl.style.left = `${x}px`;
          widgetEl.style.top = `${y}px`;
          widgetEl.style.bottom = "auto";
          widgetEl.style.right = "auto";
        } catch (e) {}
      }

      widgetEl.innerHTML = `
        <div class="entrymate-widget-header">
          <div class="entrymate-widget-brand">
            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" style="color: #f7d883; display: inline-block; vertical-align: middle;"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>
            <span style="vertical-align: middle; margin-left: 3px;">EntryMate</span>
          </div>
          <span class="entrymate-widget-restore-hint">Buka ↗</span>
        </div>
        <div class="entrymate-widget-body">
          <div class="entrymate-widget-progress-row">
            <span class="entrymate-widget-status-dot idle"></span>
            <span class="entrymate-widget-progress-text">0/0 passport</span>
          </div>
          <div class="entrymate-widget-progress-track">
            <div class="entrymate-widget-progress-bar"></div>
          </div>
        </div>
      `;

      document.body.append(widgetEl);
      bindDragEvents();
      updateWidgetUI();
    }

    function hideWidget() {
      if (widgetEl) {
        widgetEl.remove();
        widgetEl = null;
      }
    }

    function updateWidgetUI() {
      if (!widgetEl) return;

      const members = Array.isArray(state.manifest?.members) ? state.manifest.members : [];
      const totalPassports = members.length;
      let currentPassport = 0;
      if (totalPassports > 0 && state.selectedMemberId) {
        const idx = members.findIndex(m => String(m.id) === String(state.selectedMemberId));
        if (idx !== -1) {
          currentPassport = idx + 1;
        }
      }

      const percent = totalPassports > 0 ? Math.round((currentPassport / totalPassports) * 100) : 0;
      const status = String(state.executionState || "idle").toLowerCase();

      console.log(`[WidgetManager] updateWidgetUI: passport=${currentPassport}/${totalPassports} (${percent}%), status=${status}`);

      // Update text & progress bar
      const textEl = widgetEl.querySelector(".entrymate-widget-progress-text");
      if (textEl) {
        textEl.textContent = `${currentPassport}/${totalPassports} passport`;
      }

      const barEl = widgetEl.querySelector(".entrymate-widget-progress-bar");
      if (barEl) barEl.style.width = `${percent}%`;

      const dotEl = widgetEl.querySelector(".entrymate-widget-status-dot");
      if (dotEl) {
        dotEl.className = `entrymate-widget-status-dot ${status}`;
      }
    }

    function bindDragEvents() {
      if (!widgetEl) return;

      widgetEl.addEventListener("mousedown", dragStart);
      document.addEventListener("mousemove", dragMove);
      document.addEventListener("mouseup", dragEnd);
    }

    function dragStart(e) {
      if (!widgetEl) return;
      isDragging = true;
      dragDistance = 0;
      startX = e.clientX;
      startY = e.clientY;

      const rect = widgetEl.getBoundingClientRect();
      initialX = rect.left;
      initialY = rect.top;
      
      e.preventDefault();
    }

    function dragMove(e) {
      if (!isDragging || !widgetEl) return;
      const dx = e.clientX - startX;
      const dy = e.clientY - startY;
      dragDistance += Math.abs(dx) + Math.abs(dy);

      let nextX = initialX + dx;
      let nextY = initialY + dy;

      // Bound within screen
      const rect = widgetEl.getBoundingClientRect();
      nextX = Math.max(0, Math.min(window.innerWidth - rect.width, nextX));
      nextY = Math.max(0, Math.min(window.innerHeight - rect.height, nextY));

      widgetEl.style.left = `${nextX}px`;
      widgetEl.style.top = `${nextY}px`;
      widgetEl.style.bottom = "auto";
      widgetEl.style.right = "auto";
    }

    function dragEnd(e) {
      if (!isDragging) return;
      isDragging = false;

      // Save position if dragged
      if (widgetEl && dragDistance > 5) {
        const rect = widgetEl.getBoundingClientRect();
        localStorage.setItem("entrymate_widget_position", JSON.stringify({
          x: rect.left,
          y: rect.top
        }));
      } else {
        // If not dragged (clicked), restore SidePanel
        restorePanel();
      }
    }

    function restorePanel() {
      console.log("[WidgetManager] Memulihkan panel samping...");
      hideWidget();
      if (chrome?.storage?.local) {
        chrome.storage.local.set({ entrymate_minimized: false });
      }
      if (chrome?.runtime?.sendMessage) {
        chrome.runtime.sendMessage({ type: "NUSUK_OPEN_PANEL" });
      }
    }

    return {
      showWidget,
      hideWidget,
      updateWidgetUI,
    };
  }

  root.widgetManager = Object.freeze({
    createWidgetManager,
  });
})();
