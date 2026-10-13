document.getElementById("version").textContent = `v${chrome.runtime.getManifest().version}`;

const SUPPORTED = [
  { test: (h) => h.endsWith("scopus.com"), label: "Scopus" },
  { test: (h) => h.endsWith("sciencedirect.com"), label: "ScienceDirect" },
  { test: (h) => h.startsWith("scholar.google."), label: "Google Scholar" },
];

chrome.tabs.query({ active: true, currentWindow: true }, ([tab]) => {
  const statusEl = document.getElementById("status");
  let host;
  try {
    host = tab && tab.url ? new URL(tab.url).hostname : null;
  } catch {
    host = null;
  }

  const match = host && SUPPORTED.find((s) => s.test(host));
  if (match) {
    statusEl.textContent = `Active on ${match.label}`;
    statusEl.className = "sjm-popup__status is-active";
  } else {
    statusEl.textContent = "Not active on this page";
    statusEl.className = "sjm-popup__status is-inactive";
  }
});
