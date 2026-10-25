// Shared helpers for the per-site content scripts (content-scopus.js,
// content-sciencedirect.js). Each site script is responsible for finding
// result rows and extracting {issn, eissn, title} from its own markup, then
// calls sjmLookupBatch() and sjmBuildBadge() from here to do the rest.

let sjmOffscreenReady = null;

// After the extension is reloaded or updated, content scripts already injected into open tabs are
// orphaned: `chrome.runtime.id` becomes undefined and sendMessage throws "Extension context
// invalidated". Treat that as "no result" instead of an uncaught error; a page refresh re-injects.
function sjmContextAlive() {
  try {
    return !!(chrome.runtime && chrome.runtime.id);
  } catch (_) {
    return false;
  }
}

function sjmSend(message) {
  return new Promise((resolve) => {
    if (!sjmContextAlive()) {
      resolve(null);
      return;
    }
    try {
      chrome.runtime.sendMessage(message, (response) => {
        // Reading lastError marks it handled (otherwise Chrome logs "Unchecked runtime.lastError").
        resolve(chrome.runtime.lastError ? null : response || null);
      });
    } catch (_) {
      resolve(null);
    }
  });
}

function sjmEnsureOffscreen() {
  if (!sjmOffscreenReady) {
    sjmOffscreenReady = sjmSend({ type: "sjm-ensure-offscreen" });
  }
  return sjmOffscreenReady;
}

async function sjmLookupBatch(entries) {
  await sjmEnsureOffscreen();
  // each result is { scimago, sinta } or null
  const response = await sjmSend({ type: "sjm-lookup-batch", entries });
  return response && response.results ? response.results : entries.map(() => null);
}

// A lookup answers { scimago: row|null, sinta: row|null } (see offscreen.js). When a page offers
// several keys for one journal, take the first Scimago hit and the first SINTA hit among them.
function sjmMergeResults(results) {
  const scimago = (results.find((r) => r && r.scimago) || {}).scimago || null;
  const sinta = (results.find((r) => r && r.sinta) || {}).sinta || null;
  return scimago || sinta ? { scimago, sinta } : null;
}

function sjmSintaUrl(sinta) {
  return `https://sinta.kemdiktisaintek.go.id/journals/profile/${sinta.sinta_id}`;
}

// SINTA stores 0 as "no data" and the exporter turns that into NULL, so a missing value is hidden.
function sjmSintaImpact(sinta) {
  return sinta.impact != null ? Number(sinta.impact).toFixed(2) : null;
}

function sjmBuildBadge(result) {
  if (!result) {
    const wrap = document.createElement("span");
    wrap.className = "sjm-badge sjm-badge--empty";
    wrap.title = "Not found in the bundled Scimago or SINTA snapshots";
    wrap.textContent = "—";
    return wrap;
  }
  return result.scimago ? sjmScimagoBadge(result.scimago, result.sinta) : sjmSintaBadge(result.sinta);
}

// Journal known to SINTA only: same pill shape, navy instead of a quartile colour. The metrics link
// opens the SINTA profile; "Scopus ✓" is SINTA's own flag (no source id, so no link).
function sjmSintaBadge(sinta) {
  const wrap = document.createElement("span");
  wrap.className = "sjm-badge sjm-badge--split sjm-badge--sinta";

  const main = sjmBadgeLink(
    "sjm-badge__main",
    sjmSintaUrl(sinta),
    `Open on SINTA (national accreditation, level S${sinta.level})`
  );
  const levelEl = document.createElement("span");
  levelEl.className = "sjm-badge__quartile";
  levelEl.textContent = `SINTA ${sinta.level}`;
  main.appendChild(levelEl);

  const impact = sjmSintaImpact(sinta);
  const parts = [];
  if (impact) parts.push(`Impact ${impact}`);
  if (sinta.h5_index != null) parts.push(`H5 ${sinta.h5_index}`);
  parts.forEach((text) => {
    const el = document.createElement("span");
    el.className = "sjm-badge__text";
    el.textContent = text;
    main.appendChild(el);
  });
  wrap.appendChild(main);

  if (sinta.scopus) {
    const tag = document.createElement("span");
    tag.className = "sjm-badge__link sjm-badge__tag";
    tag.title = "Indexed in Scopus according to SINTA";
    tag.textContent = "Scopus ✓";
    wrap.appendChild(tag);
  }
  return wrap;
}

function sjmScimagoBadge(result, sinta) {
  const quartile = result.sjr_best_quartile || "?";
  const sjr = result.sjr != null ? Number(result.sjr).toFixed(3) : "?";
  const hIndex = result.h_index != null ? result.h_index : "?";

  // The pill is a <span> holding two sibling links (anchors cannot nest): the metrics open Scimago,
  // the trailing "Scopus" segment opens the journal's Scopus source page (Scimago sourceid == Scopus
  // source id).
  const wrap = document.createElement("span");
  wrap.className = `sjm-badge sjm-badge--split sjm-badge--${(quartile || "").toLowerCase()}`;

  const main = sjmBadgeLink(
    "sjm-badge__main",
    `https://www.scimagojr.com/journalsearch.php?q=${result.sourceid}&tip=sid`,
    "Open on Scimago"
  );

  const quartileEl = document.createElement("span");
  quartileEl.className = "sjm-badge__quartile";
  quartileEl.textContent = quartile;
  main.appendChild(quartileEl);

  const sjrEl = document.createElement("span");
  sjrEl.className = "sjm-badge__text";
  sjrEl.textContent = `SJR ${sjr}`;
  main.appendChild(sjrEl);

  const hEl = document.createElement("span");
  hEl.className = "sjm-badge__text";
  hEl.textContent = `H ${hIndex}`;
  main.appendChild(hEl);

  const scopus = sjmBadgeLink(
    "sjm-badge__link",
    `https://www.scopus.com/sourceid/${result.sourceid}`,
    "Journal page on Scopus"
  );
  scopus.textContent = "Scopus ↗";

  wrap.append(main, scopus);

  // Journal also accredited by SINTA: navy end cap, linking to the SINTA profile.
  if (sinta) {
    const cap = sjmBadgeLink(
      "sjm-badge__sinta",
      sjmSintaUrl(sinta),
      `Open on SINTA (national accreditation, level S${sinta.level})`
    );
    cap.textContent = `SINTA ${sinta.level}`;
    wrap.appendChild(cap);
  }
  return wrap;
}

function sjmBadgeLink(className, href, title) {
  const a = document.createElement("a");
  a.className = className;
  a.href = href;
  a.target = "_blank";
  a.rel = "noopener noreferrer";
  a.title = title;
  return a;
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
