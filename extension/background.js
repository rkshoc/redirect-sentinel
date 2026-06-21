// MV3 service worker: open the dedicated audit page in a tab when the toolbar
// icon is clicked (the audit UI is a full page, not a cramped popup).
chrome.action.onClicked.addListener(() => {
  chrome.tabs.create({ url: chrome.runtime.getURL('audit.html') });
});

// First install → open the page so the user can set their site URL.
chrome.runtime.onInstalled.addListener((details) => {
  if (details.reason === 'install') {
    chrome.tabs.create({ url: chrome.runtime.getURL('audit.html') });
  }
});
