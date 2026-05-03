chrome.action.onClicked.addListener((tab) => {
  if (!tab?.id) {
    return;
  }

  chrome.tabs.sendMessage(tab.id, { type: "NUSUK_OPEN_PANEL" }, () => {
    void chrome.runtime.lastError;
  });
});
