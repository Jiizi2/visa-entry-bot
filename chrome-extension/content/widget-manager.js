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
          width: 140px;
          background: linear-gradient(135deg, #1e293b, #0f172a);
          color: #f8fafc;
          border-radius: 10px;
          padding: 10px 12px;
          box-shadow: 0 10px 25px -5px rgba(15, 23, 42, 0.5), 0 8px 10px -6px rgba(15, 23, 42, 0.4);
          border: 1px solid rgba(255, 255, 255, 0.1);
          font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
          z-index: 999999;
          cursor: grab;
          user-select: none;
          display: flex;
          flex-direction: column;
          gap: 6px;
          transition: transform 0.15s ease, box-shadow 0.15s ease, border-color 0.15s ease;
        }
        .entrymate-widget:hover {
          transform: translateY(-2px);
          box-shadow: 0 14px 30px -5px rgba(15, 23, 42, 0.6), 0 0 12px rgba(56, 189, 248, 0.25);
          border-color: rgba(56, 189, 248, 0.4);
        }
        .entrymate-widget:active {
          cursor: grabbing;
          transform: scale(0.97);
        }
        .entrymate-widget-header {
          display: flex;
          align-items: center;
          gap: 6px;
          font-size: 11px;
          font-weight: 800;
          color: #38bdf8;
          letter-spacing: 0.03em;
        }
        .entrymate-widget-body {
          display: flex;
          flex-direction: column;
          gap: 6px;
        }
        .entrymate-widget-progress-row {
          display: flex;
          align-items: center;
          gap: 6px;
          font-size: 13px;
          font-weight: 700;
        }
        .entrymate-widget-status-dot {
          width: 8px;
          height: 8px;
          border-radius: 50%;
          background: #94a3b8;
          display: inline-block;
        }
        .entrymate-widget-status-dot.running { background: #10b981; animation: entrymate-pulse 1.5s infinite; }
        .entrymate-widget-status-dot.paused { background: #f59e0b; }
        .entrymate-widget-status-dot.idle { background: #3b82f6; }
        .entrymate-widget-status-dot.completed { background: #10b981; }
        .entrymate-widget-status-dot.error { background: #ef4444; }

        @keyframes entrymate-pulse {
          0% { transform: scale(1); opacity: 1; }
          50% { transform: scale(1.3); opacity: 0.7; }
          100% { transform: scale(1); opacity: 1; }
        }

        .entrymate-widget-progress-track {
          width: 100%;
          height: 6px;
          background: rgba(255, 255, 255, 0.15);
          border-radius: 3px;
          overflow: hidden;
          margin-top: 2px;
        }
        .entrymate-widget-progress-bar {
          height: 100%;
          background: linear-gradient(90deg, #38bdf8, #0ea5e9);
          box-shadow: 0 0 6px #38bdf8;
          width: 0%;
          transition: width 0.2s ease;
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
          <span class="entrymate-widget-icon">📄</span>
          <span class="entrymate-widget-title">EntryMate</span>
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
