// Scopus search-results annotator.
//
// Verified against a real result-list page (2026-09-13, "table view", 10 rows). Each result's
// source is a `div[data-component="document-source"]` containing an
// `a[href*="/sourceid/<id>"]` link -- that numeric id IS the Scimago sourceid (Scimago is built
// on top of Scopus's own source ids), so lookup is an exact primary-key match, not fuzzy
// title/ISSN matching. If Scopus changes this markup in the future (e.g. switches away from
// table view, or drops the /sourceid/ link), a console.warn below names what broke.

const SELECTORS = {
  sourceContainer: 'div[data-component="document-source"]',
};

const SOURCEID_RE = /\/sourceid\/(\d+)/;

const processed = new WeakSet();

function extractKey(container) {
  const link = container.querySelector('a[href*="/sourceid/"]');
  if (!link) return null;
  const m = link.href.match(SOURCEID_RE);
  if (!m) return null;
  return { sourceid: Number(m[1]) };
}

function injectBadge(container, result) {
  if (container.parentElement?.querySelector(":scope > .sjm-badge")) return;
  const link = container.querySelector('a[href*="/sourceid/"]');
  if (!link) return;
  const badge = sjmBuildBadge(result);
  badge.classList.add("sjm-badge--block");
  // Placed as a block sibling *above* `container` (rather than inline inside
  // it, next to the title link) so it reads as a standalone line above the
  // journal name, matching how Scimago itself surfaces the quartile.
  container.parentElement.insertBefore(badge, container);
}

async function scan() {
  const containers = Array.from(document.querySelectorAll(SELECTORS.sourceContainer)).filter(
    (c) => !processed.has(c)
  );
  if (containers.length === 0) return;
  containers.forEach((c) => processed.add(c));
  await sjmAnnotateRows(containers, extractKey, injectBadge);
}

const observer = new MutationObserver(() => {
  clearTimeout(observer._t);
  observer._t = setTimeout(scan, 300);
});
observer.observe(document.body, { childList: true, subtree: true });

scan();

// One-shot delayed check so we don't warn before the SPA has rendered. Only on results/search
// pages: document and source pages legitimately have no result rows (content-floating.js handles
// those), and the query string is ignored because document pages also carry `origin=resultslist`.
setTimeout(() => {
  const expectsResults = /\/(?:results?|search)(?:[/.]|$)/i.test(location.pathname);
  if (expectsResults && document.querySelectorAll(SELECTORS.sourceContainer).length === 0) {
    console.warn(
      '[Scimago Journal Metrics] No Scopus results matched div[data-component="document-source"] -- ' +
        "Scopus's markup likely changed. See the comment at the top of content-scopus.js."
    );
  }
}, 3000);
