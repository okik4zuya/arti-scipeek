// Shared helpers for the per-site content scripts (content-scopus.js,
// content-sciencedirect.js). Each site script is responsible for finding
// result rows and extracting {issn, eissn, title} from its own markup, then
// calls sjmLookupBatch() and sjmBuildBadge() from here to do the rest.

let sjmOffscreenReady = null;

function sjmEnsureOffscreen() {
  if (!sjmOffscreenReady) {
    sjmOffscreenReady = new Promise((resolve) => {
      chrome.runtime.sendMessage({ type: "sjm-ensure-offscreen" }, () => resolve());
    });
  }
  return sjmOffscreenReady;
}

async function sjmLookupBatch(entries) {
  await sjmEnsureOffscreen();
  return new Promise((resolve) => {
    chrome.runtime.sendMessage({ type: "sjm-lookup-batch", entries }, (response) => {
      if (chrome.runtime.lastError || !response) {
        resolve(entries.map(() => null));
        return;
      }
      resolve(response.results);
    });
  });
}

function sjmBuildBadge(result) {
  if (!result) {
    const wrap = document.createElement("span");
    wrap.className = "sjm-badge sjm-badge--empty";
    wrap.title = "Not found in the bundled Scimago snapshot";
    wrap.textContent = "—";
    return wrap;
  }

  const quartile = result.sjr_best_quartile || "?";
  const sjr = result.sjr != null ? Number(result.sjr).toFixed(3) : "?";
  const hIndex = result.h_index != null ? result.h_index : "?";

  const wrap = document.createElement("a");
  wrap.className = `sjm-badge sjm-badge--${(quartile || "").toLowerCase()}`;
  wrap.href = `https://www.scimagojr.com/journalsearch.php?q=${result.sourceid}&tip=sid`;
  wrap.target = "_blank";
  wrap.rel = "noopener noreferrer";
  wrap.title = "Open on Scimago";

  const quartileEl = document.createElement("span");
  quartileEl.className = "sjm-badge__quartile";
  quartileEl.textContent = quartile;
  wrap.appendChild(quartileEl);

  const sjrEl = document.createElement("span");
  sjrEl.className = "sjm-badge__text";
  sjrEl.textContent = `SJR ${sjr}`;
  wrap.appendChild(sjrEl);

  const hEl = document.createElement("span");
  hEl.className = "sjm-badge__text";
  hEl.textContent = `H ${hIndex}`;
  wrap.appendChild(hEl);

  return wrap;
}

// Google Scholar (both search results and profile pages) never expose a
// stable id or ISSN to key off -- the venue name has to be pulled out of a
// text blob that also contains volume/issue/page numbers and the year, e.g.
// "IOP conference series: earth and environmental science 105 (1), 012059,
// 2018" or "Energy & Environmental Science, 2016". This strips the trailing
// year, then trailing "vol (issue), pages" / "vol (issue)" / "vol" numeric
// tails, leaving just the venue name for offscreen.js's title lookup.
function sjmStripVenueTail(raw) {
  if (!raw) return null;
  let s = raw.replace(/ /g, " ").trim();
  s = s.replace(/,?\s*\d{4}[a-z]?\s*$/i, "");
  s = s.replace(/\s+\d+\s*(?:\(\d+\))?\s*,\s*[\d–\-]+\s*$/, "");
  s = s.replace(/\s+\d+\s*(?:\(\d+\))?\s*$/, "");
  s = s.replace(/[,\s]+$/, "").trim();
  return s || null;
}

// Batches per-row lookups (one runtime message for N rows) and applies each
// result via `applyResult(row, result)`, so a site script just supplies rows
// + a key extractor + a renderer.
async function sjmAnnotateRows(rows, extractKey, applyResult) {
  const pending = rows
    .map((row) => ({ row, key: extractKey(row) }))
    .filter(({ key }) => key && (key.sourceid != null || key.issn || key.eissn || key.title));

  if (pending.length === 0) return;

  const results = await sjmLookupBatch(pending.map((p) => p.key));
  pending.forEach(({ row }, i) => applyResult(row, results[i]));
}
