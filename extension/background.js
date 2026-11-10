// @ts-check
// Opens the side panel from the toolbar icon, and adds the right-click menu items.
// Content picked from the menu is handed to the panel through session storage.

import { readPage, readSelection } from "./src/extract.js";

chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });

chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({
      id: "read-selection",
      title: "Read selection aloud",
      contexts: ["selection"],
    });
    chrome.contextMenus.create({
      id: "read-page",
      title: "Read this page aloud",
      contexts: ["page", "frame"],
    });
  });
});

chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (!tab?.id) return;
  // Must happen straight away, while Chrome still counts this as a user action.
  chrome.sidePanel.open({ windowId: tab.windowId }).catch(() => {});
  const tabId = tab.id;
  const work =
    info.menuItemId === "read-selection"
      ? readSelection(tabId, info.frameId ?? 0, info.selectionText)
      : readPage(tabId);
  work.then((result) => chrome.storage.session.set({ pending: { result, at: Date.now() } }));
});
