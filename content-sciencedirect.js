// ScienceDirect search-results annotator.
//
// Verified against a real result-list page (2026-09-13, `table_sciencedirect.html`, 23 rows).
// Each result's journal is `a.subtype-srctitle-link[href*="/science/journal/"]`, and that href
// embeds the journal's ISSN with the hyphen stripped (ScienceDirect convention, e.g.
// `/science/journal/25425293` -> ISSN 2542-5293) -- an exact key, not fuzzy title text. Falls
// back to title matching only if that ISSN extraction fails.
//
// NOTE on the original bug: `row.querySelector(".SubType, .srctitle, .subtype-srctitle-link")`
// matched `.SubType` (a wrapper div containing BOTH the journal link and the date, e.g.
// "Materials Today PhysicsAugust 2026" concatenated) because querySelector on a comma-list
// resolves by DOM order, not list preference -- every title lookup silently failed as a result.

const SELECTORS = {
  row: "li.ResultItem, .result-item-content, article.result-item",
  sourceLink: 'a.subtype-srctitle-link[href*="/science/journal/"], a[href*="/science/journal/"], a[href*="/journal/"]',
};

const ISSN_RE = /\/science\/journal\/([0-9Xx]{7,8})/;

const processed = new WeakSet();

function extractKey(row) {
  const link = row.querySelector(SELECTORS.sourceLink);
  if (!link) return null;
  const title = (link.textContent || "").trim();
  const m = link.href.match(ISSN_RE);
  const issn = m ? m[1] : null;
  if (!issn && !title) return null;
  return { issn, title };
}

function injectBadge(row, result) {
  if (row.querySelector(".sjm-badge")) return;
  const link = row.querySelector(SELECTORS.sourceLink);
  if (!link) return;
  const badge = sjmBuildBadge(result);
  badge.classList.add("sjm-badge--block");
  // The link sits inside `.SubType` alongside the date -- badge goes above that whole line,
  // matching the "above the journal name" placement used on Scopus.
  const subType = link.closest(".SubType") || link.parentElement;
  subType.parentElement.insertBefore(badge, subType);
}

async function scan() {
  const rows = Array.from(document.querySelectorAll(SELECTORS.row)).filter(
    (r) => !processed.has(r)
  );
  if (rows.length === 0) return;
  rows.forEach((r) => processed.add(r));
  await sjmAnnotateRows(rows, extractKey, injectBadge);
}

const observer = new MutationObserver(() => {
  clearTimeout(observer._t);
  observer._t = setTimeout(scan, 300);
});
observer.observe(document.body, { childList: true, subtree: true });

scan();

// Only warn on search-results pages; article and journal pages have no result rows by design
// (content-floating.js handles those).
setTimeout(() => {
  const expectsResults = /^\/search(?:[/?]|$)/i.test(location.pathname);
  if (expectsResults && document.querySelectorAll(SELECTORS.row).length === 0) {
    console.warn(
      "[Scimago Journal Metrics] No ScienceDirect result rows matched SELECTORS.row -- " +
        "the site's markup likely changed. See the comment at the top of content-sciencedirect.js."
    );
  }
}, 3000);
