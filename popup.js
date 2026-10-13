const manifest = chrome.runtime.getManifest();
document.getElementById("version").textContent = `v${manifest.version}`;

// Every host the extension injects into, taken from the manifest so the popup never drifts from it.
// Patterns look like "*://*.nature.com/*" or "*://scholar.google.co.id/scholar*".
const HOSTS = [
  ...new Set(
    (manifest.content_scripts || [])
      .flatMap((cs) => cs.matches || [])
      .map((m) => (/^\*:\/\/(?:\*\.)?([^/]+)\//.exec(m) || [])[1])
      .filter(Boolean)
  ),
];

const LABELS = {
  "scopus.com": "Scopus",
  "sciencedirect.com": "ScienceDirect",
  "link.springer.com": "Springer",
  "nature.com": "Nature",
  "pubs.acs.org": "ACS",
  "pubs.rsc.org": "RSC",
  "rsc.org": "RSC",
  "tandfonline.com": "Taylor & Francis",
  "onlinelibrary.wiley.com": "Wiley",
  "mdpi.com": "MDPI",
  "iopscience.iop.org": "IOP",
  "ieeexplore.ieee.org": "IEEE Xplore",
  "journals.sagepub.com": "SAGE",
  "academic.oup.com": "Oxford Academic",
  "frontiersin.org": "Frontiers",
  "science.org": "Science",
  "pubs.aip.org": "AIP",
  "journals.aps.org": "APS",
  "cambridge.org": "Cambridge",
  "degruyter.com": "De Gruyter",
  "degruyterbrill.com": "De Gruyter",
  "journals.plos.org": "PLOS",
  "cell.com": "Cell Press",
};

function matchHost(host) {
  return HOSTS.find((h) => host === h || host.endsWith(`.${h}`));
}

function labelFor(host, matched) {
  if (host.startsWith("scholar.google.")) return "Google Scholar";
  return LABELS[matched] || matched.replace(/^www\./, "");
}

chrome.tabs.query({ active: true, currentWindow: true }, ([tab]) => {
  const statusEl = document.getElementById("status");
  let host;
  try {
    host = tab && tab.url ? new URL(tab.url).hostname : null;
  } catch {
    host = null;
  }

  const matched = host && matchHost(host);
  if (matched) {
    statusEl.textContent = `Active on ${labelFor(host, matched)}`;
    statusEl.className = "sjm-popup__status is-active";
  } else {
    statusEl.textContent = "Not active on this page";
    statusEl.className = "sjm-popup__status is-inactive";
  }
});
