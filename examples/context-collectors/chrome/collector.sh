#!/bin/sh
set -eu

# Example only: the built-in Chrome collector is preferred for normal capture.
osascript -l JavaScript <<'JXA'
const chrome = Application("Google Chrome");
const tab = chrome.windows.length > 0 ? chrome.windows[0].activeTab() : null;
const context = tab ? {
  browser: {
    url: tab.url(),
    title: tab.title(),
    source: "chrome-active-tab-example"
  }
} : {};
const result = {
  schemaVersion: 1,
  context,
  signals: tab ? ["chrome-active-tab-example"] : [],
  permissions: { automation: "used" },
  confidence: tab ? "high" : "low"
};
JSON.stringify(result);
JXA
