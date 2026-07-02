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
          width: 150px;
          background: rgba(15, 23, 42, 0.9);
          backdrop-filter: blur(12px);
          -webkit-backdrop-filter: blur(12px);
          color: #f8fafc;
          border-radius: 12px;
          padding: 12px 14px;
          box-shadow: 0 12px 30px rgba(0, 0, 0, 0.25), inset 0 1px 0 rgba(255, 255, 255, 0.1);
          border: 1px solid rgba(255, 255, 255, 0.06);
          font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
          z-index: 999999;
          cursor: grab;
          user-select: none;
          display: flex;
          flex-direction: column;
          gap: 8px;
          transition: transform 0.2s cubic-bezier(0.4, 0, 0.2, 1), box-shadow 0.2s ease, border-color 0.2s ease;
        }
        .entrymate-widget:hover {
          transform: translateY(-3px) scale(1.02);
          box-shadow: 0 16px 36px rgba(0, 0, 0, 0.35), 0 0 16px rgba(37, 99, 235, 0.3);
          border-color: rgba(255, 255, 255, 0.15);
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
          color: rgba(255, 255, 255, 0.5);
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
          color: #38bdf8;
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
          color: #ffffff;
        }
        .entrymate-widget-status-dot {
          width: 8px;
          height: 8px;
          border-radius: 50%;
          background: #64748b;
          display: inline-block;
          box-shadow: 0 0 4px rgba(0,0,0,0.5);
          transition: all 0.3s ease;
        }
        .entrymate-widget-status-dot.running { 
          background: #10b981; 
          box-shadow: 0 0 8px #10b981, 0 0 16px rgba(16, 185, 129, 0.4); 
          animation: entrymate-pulse 1.8s infinite ease-in-out; 
        }
        .entrymate-widget-status-dot.paused { 
          background: #f59e0b; 
          box-shadow: 0 0 8px #f59e0b; 
        }
        .entrymate-widget-status-dot.idle { 
          background: #3b82f6; 
          box-shadow: 0 0 8px #3b82f6; 
        }
        .entrymate-widget-status-dot.completed { 
          background: #10b981; 
          box-shadow: 0 0 8px #10b981; 
        }
        .entrymate-widget-status-dot.error { 
          background: #ef4444; 
          box-shadow: 0 0 8px #ef4444; 
        }

        @keyframes entrymate-pulse {
          0% { transform: scale(1); opacity: 1; }
          50% { transform: scale(1.25); opacity: 0.6; }
          100% { transform: scale(1); opacity: 1; }
        }

        .entrymate-widget-progress-track {
          width: 100%;
          height: 5px;
          background: rgba(255, 255, 255, 0.12);
          border-radius: 99px;
          overflow: hidden;
          margin-top: 2px;
        }
        .entrymate-widget-progress-bar {
          height: 100%;
          background: linear-gradient(90deg, #2563eb, #10b981);
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
            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" style="color: #38bdf8; display: inline-block; vertical-align: middle;"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>
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
