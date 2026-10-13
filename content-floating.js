// Edge-docked journal-metrics tab (like Unpaywall's) for publisher article and journal home pages.
//
// Unlike the per-site search-result scripts, this one never needs to know where the journal name
// sits in the page: it reads the journal key from <head> metadata (Highwire `citation_*` / PRISM
// tags, which nearly every publisher emits for Google Scholar) and mounts a fixed-position tab
// inside a Shadow DOM, so host-page CSS cannot touch it.
//
// Verified against real pages (2026-10-13): nature.com article (citation_issn = eISSN) and
// nature.com / link.springer.com journal home (itemprop="issn" / <dt>ISSN</dt>). Every other host in
// manifest.json is UNVERIFIED -- JOURNAL_PATHS below are guesses from general knowledge. A page with
// no usable key simply shows nothing, so a wrong guess is harmless. Fix by checking the page's meta
// tags in DevTools (see memory/memories/page-expansion-plan.md, Phase 0).
//
// Wrapped in an IIFE because the shared content-script world also holds content-sciencedirect.js's
// top-level `const`s on sciencedirect.com.

(function () {
  "use strict";

  const HOST_ID = "sjm-floating-host";
  const STORE_KEY = "sjm-float";

  // Path patterns (per host suffix) that mark a journal home page. Article pages are detected by
  // meta tags instead and need no entry here.
  const JOURNAL_PATHS = [
    [/sciencedirect\.com$/, /^\/(?:science\/)?journal\//],
    [/link\.springer\.com$/, /^\/journal\/\d+/],
    [/onlinelibrary\.wiley\.com$/, /^\/journal\//],
    [/pubs\.acs\.org$/, /^\/journal\//],
    [/pubs\.rsc\.org$/, /^\/en\/journals\//],
    [/tandfonline\.com$/, /^\/(?:journals|toc|loi)\//],
    [/mdpi\.com$/, /^\/journal\//],
    [/iopscience\.iop\.org$/, /^\/journal\//],
    [/journals\.sagepub\.com$/, /^\/(?:home|loi|toc)\//],
    [/frontiersin\.org$/, /^\/journals\//],
    [/science\.org$/, /^\/(?:journal|toc|loi)\//],
    [/cambridge\.org$/, /^\/core\/journals\//],
    [/degruyter(?:brill)?\.com$/, /^\/journal\/key\//],
    [/cell\.com$/, /\/home$/],
  ];

  const URL_ISSN_RE = /\/journal\/(\d{4}-?\d{3}[\dXx])(?:[/?#]|$)/;
  const TEXT_ISSN_RE = /(?:e-?ISSN|ISSN)\b[^0-9]{0,40}(\d{4}-\d{3}[\dXx])/gi;

  function normIssn(s) {
    const m = /(\d{4})-?(\d{3}[\dXx])/.exec(s || "");
    return m ? `${m[1]}-${m[2]}`.toUpperCase() : null;
  }

  function uniq(list) {
    return Array.from(new Set(list.filter(Boolean)));
  }

  function readMeta() {
    const map = new Map();
    document.querySelectorAll("meta[name], meta[property]").forEach((m) => {
      const name = (m.getAttribute("name") || m.getAttribute("property") || "").toLowerCase();
      const content = (m.getAttribute("content") || "").trim();
      if (!name || !content) return;
      if (!map.has(name)) map.set(name, []);
      map.get(name).push(content);
    });
    return map;
  }

  function firstMeta(map, ...names) {
    for (const n of names) {
      const v = map.get(n);
      if (v && v.length) return v[0];
    }
    return null;
  }

  // Journal-name candidates from a page-title-like string: the whole string, each part split on
  // " | " / " - " separators, and each with a trailing "Home"/"Publications"/"Journal" label removed.
  function titleVariants(s) {
    if (!s) return [];
    const out = [];
    const add = (v) => {
      v = (v || "").replace(/\s+/g, " ").trim();
      if (v.length >= 3) out.push(v);
    };
    add(s);
    for (const part of s.split(/\s+[|–—-]\s+/)) {
      add(part);
      add(part.replace(/\s+(?:home|homepage|journal home|journal|publications?)$/i, ""));
    }
    return out;
  }

  // schema.org JSON-LD: collect any `issn` and Periodical/Journal `name` found anywhere in the graph.
  function readJsonLd() {
    const issns = [];
    const names = [];
    const walk = (node) => {
      if (!node || typeof node !== "object") return;
      if (Array.isArray(node)) return node.forEach(walk);
      const type = [].concat(node["@type"] || []).join(" ");
      if (node.issn) [].concat(node.issn).forEach((v) => issns.push(normIssn(String(v))));
      if (/Periodical|Journal/i.test(type) && typeof node.name === "string") names.push(node.name);
      Object.values(node).forEach(walk);
    };
    document.querySelectorAll('script[type="application/ld+json"]').forEach((s) => {
      try {
        walk(JSON.parse(s.textContent));
      } catch (_) {}
    });
    return { issns: uniq(issns), names: uniq(names) };
  }

  function isJournalPath() {
    const host = location.hostname;
    return JOURNAL_PATHS.some(([h, p]) => h.test(host) && p.test(location.pathname));
  }

  function scanTextIssns(limit) {
    const root = document.querySelector("main") || document.body;
    const text = (root && root.innerText ? root.innerText : "").slice(0, limit);
    const found = [];
    TEXT_ISSN_RE.lastIndex = 0;
    let m;
    while ((m = TEXT_ISSN_RE.exec(text)) && found.length < 4) found.push(m[1]);
    return found;
  }

  // Scopus exposes the Scimago sourceid directly: in the URL on source pages
  // (/sourceid/<id>) and in the journal link on document pages (/pages/publications/<n>).
  function scopusKeys() {
    if (!/(^|\.)scopus\.com$/.test(location.hostname)) return null;
    const fromHref = (href) => (/source-?id[/=](\d+)/i.exec(href || "") || [])[1];
    let id = fromHref(location.pathname);
    if (id) return { kind: "journal", entries: [{ sourceid: Number(id) }] };
    if (!/^\/(?:pages\/publications\/|record\/)/.test(location.pathname)) return null;

    const link =
      document.querySelector('[data-component="document-source"] a[href*="ourceid"]') ||
      document.querySelector('a[href*="ourceid"]');
    id = link && fromHref(link.getAttribute("href"));
    // Document pages are client-rendered; the source id may only exist in embedded page state.
    if (!id) {
      for (const s of document.scripts) {
        const m = /["']source_?id["']\s*:\s*["']?(\d{6,})/i.exec((s.textContent || "").slice(0, 3000000));
        if (m) {
          id = m[1];
          break;
        }
      }
    }
    if (id) return { kind: "article", entries: [{ sourceid: Number(id) }] };

    // Next: ISSN printed in the document details.
    const issns = uniq(scanTextIssns(60000).map(normIssn));
    if (issns.length) return { kind: "article", entries: issns.map((issn) => ({ issn })) };

    // Last resort: the source name as plain text (not a link) in the same component the results
    // list uses; shown only on an exact Scimago title match.
    const nodes = document.querySelectorAll(
      '[data-component="document-source"], [data-testid*="source" i], [data-component*="source" i]'
    );
    const titles = [];
    // Document pages render "<Journal name><Document type><Open Access><Year>" as adjacent inline
    // text (no link): the text node just before the document-type label is the journal name.
    const DOC_TYPES = /^(?:Article|Review|Conference Paper|Book Chapter|Letter|Note|Editorial|Short Survey|Erratum|Data Paper|Book|Retracted)$/i;
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    const seen = [];
    for (let n = walker.nextNode(), i = 0; n && i < 4000; n = walker.nextNode(), i++) {
      const t = (n.nodeValue || "").trim();
      if (!t) continue;
      if (DOC_TYPES.test(t) && seen.length) {
        titles.push(...titleVariants(seen[seen.length - 1]));
        break;
      }
      seen.push(t);
      if (seen.length > 3) seen.shift();
    }
    nodes.forEach((n) => {
      const link = n.querySelector("a");
      titles.push(...titleVariants(((link || n).textContent || "").split("\n")[0]));
      titles.push(...titleVariants((n.innerText || "").split("\n")[0]));
    });
    const entries = uniq(titles).map((title) => ({ title }));
    return entries.length ? { kind: "article", entries, quiet: true } : null;
  }

  // Returns {kind, entries} where entries are lookup keys tried in order, or null when this page
  // is neither an article nor a recognisable journal home page.
  function extractKeys() {
    const scopus = scopusKeys();
    if (scopus) return scopus;
    if (/(^|\.)scopus\.com$/.test(location.hostname)) return null;
    const meta = readMeta();

    const metaIssns = uniq(
      [
        ...(meta.get("citation_issn") || []),
        ...(meta.get("citation_eissn") || []),
        ...(meta.get("prism.issn") || []),
        ...(meta.get("prism.eissn") || []),
      ].map(normIssn)
    );
    const metaTitle = firstMeta(meta, "citation_journal_title", "prism.publicationname");

    const isArticle =
      meta.has("citation_title") ||
      meta.has("citation_doi") ||
      meta.has("dc.title") ||
      meta.has("dc.identifier");
    if (isArticle) {
      const ld = readJsonLd();
      let issns = uniq([...metaIssns, ...ld.issns]);
      const titles = uniq([metaTitle, ...ld.names]);
      // Last resort when the page has bibliographic meta but no journal key at all: an ISSN printed
      // near the top of the page.
      if (issns.length === 0 && titles.length === 0) {
        issns = uniq(scanTextIssns(6000).map(normIssn));
      }
      const found = buildEntries("article", issns, titles);
      if (found) return found;
    }

    const itemprop = Array.from(document.querySelectorAll('[itemprop="issn"]')).map((el) =>
      normIssn(el.textContent)
    );
    const pathMatch = isJournalPath();
    if (!pathMatch && !itemprop.some(Boolean)) {
      // Unrecognised page (e.g. a journal home page whose URL pattern isn't in JOURNAL_PATHS): try
      // the heading as a journal name, but only show a badge on an exact Scimago title match.
      const guess = buildEntries("guess", [], [
        ...titleVariants((document.querySelector("h1") || {}).textContent),
        ...titleVariants(firstMeta(meta, "og:title")),
      ]);
      return guess && { ...guess, quiet: true };
    }

    const urlIssn = normIssn((URL_ISSN_RE.exec(location.pathname) || [])[1]);
    const ld = readJsonLd();
    let issns = uniq([...itemprop, urlIssn, ...ld.issns]);
    if (issns.length === 0 && pathMatch) issns = uniq(scanTextIssns(40000).map(normIssn));
    const titles = uniq([
      ...ld.names,
      ...titleVariants((document.querySelector("h1") || {}).textContent),
      ...titleVariants(firstMeta(meta, "og:title")),
      ...titleVariants(document.title),
    ]);
    return buildEntries("journal", issns, titles);
  }

  function buildEntries(kind, issns, titles) {
    const entries = [...issns.map((issn) => ({ issn })), ...uniq(titles).map((title) => ({ title }))];
    return entries.length ? { kind, entries } : null;
  }

  // Printed once per page when nothing was found, so a failing publisher can be diagnosed from the
  // console without opening DevTools on the page's <head>.
  function logNoKey() {
    const metaNames = Array.from(document.querySelectorAll("meta[name], meta[property]"))
      .map((m) => `${m.getAttribute("name") || m.getAttribute("property")}=${(m.content || "").slice(0, 60)}`)
      .filter((s) => /issn|journal|citation_|prism|dc\.|og:title|publisher/i.test(s));
    console.info("[ARTi SciPeek] no journal key found on", location.href, {
      journalPath: isJournalPath(),
      sourceLinks: Array.from(document.querySelectorAll('a[href*="ource"]'))
        .map((a) => a.getAttribute("href"))
        .filter((h) => /source/i.test((h || "").replace(/dgcid=\w+/i, "")))
        .slice(0, 12),
      issnText: scanTextIssns(60000),
      h1: ((document.querySelector("h1") || {}).textContent || "").trim().slice(0, 120),
      textSample: ((document.querySelector("main") || document.body).innerText || "")
        .replace(/\s+/g, " ")
        .slice(0, 500),
      sourceNodes: Array.from(document.querySelectorAll('[data-component*="ource" i], [data-testid*="ource" i]'))
        .slice(0, 4)
        .map((n) => n.outerHTML.slice(0, 400)),
      jsonLd: readJsonLd(),
      meta: metaNames,
    });
  }

  // ---- UI -----------------------------------------------------------------------------------

  const CSS = `
    :host { all: initial; display: block; }
    .root { position: fixed; right: 0; top: 40%; z-index: 2147483647;
      font: 13px/1.4 "Inter", system-ui, -apple-system, "Segoe UI", sans-serif; color: #1c1c1e; }
    .grab { cursor: grab; touch-action: none; user-select: none; }
    .grab:active { cursor: grabbing; }
    /* Outer radius R on the free (left) side only; the right side is flush with the viewport edge.
       Inner pill radius = R - inset (concentric corners), so the nested shapes read as one object. */
    .tab { display: flex; flex-direction: column; align-items: center; gap: 5px; width: 46px;
      border: 0; border-radius: 16px 0 0 16px; padding: 9px 5px 8px 5px; font-family: inherit;
      background: #eee; color: #333; cursor: pointer;
      box-shadow: inset 0 1px 0 rgba(255,255,255,.38), -3px 4px 14px rgba(0,0,0,.2), -1px 1px 2px rgba(0,0,0,.16);
      transition: width .18s ease, box-shadow .18s ease, filter .18s ease; }
    /* Grow leftwards while staying flush with the edge (a translate would leave a gap). */
    .tab:hover { width: 52px; filter: brightness(1.05);
      box-shadow: inset 0 1px 0 rgba(255,255,255,.38), -6px 6px 20px rgba(0,0,0,.26), -1px 1px 2px rgba(0,0,0,.18); }
    .tab .q { font-weight: 800; font-size: 17px; line-height: 1; letter-spacing: -.01em; }
    .tab .sjr { display: flex; flex-direction: column; align-items: center; width: 100%;
      padding: 4px 0 3px; border-radius: 11px; background: rgba(255,255,255,.22); }
    .tab .lbl { font-weight: 600; font-size: 8px; letter-spacing: .08em; opacity: .85; }
    .tab .val { font-weight: 700; font-size: 12px; line-height: 1.15; }
    .card { width: 232px; background: #fff; border-radius: 18px 0 0 18px; overflow: hidden;
      box-shadow: -8px 10px 32px rgba(0,0,0,.28), -1px 1px 4px rgba(0,0,0,.15); }
    .head { display: flex; align-items: center; gap: 8px; padding: 10px 10px 10px 12px; }
    .head .brand { flex: 1; font-weight: 600; font-size: 12px; opacity: .9; letter-spacing: .01em; }
    .chip { border-radius: 999px; padding: 3px 11px; font-weight: 800; font-size: 15px;
      background: rgba(255,255,255,.25); color: inherit; }
    .x { border: 0; background: rgba(255,255,255,.2); color: inherit; cursor: pointer; font-size: 15px;
      line-height: 1; width: 22px; height: 22px; border-radius: 50%; padding: 0; }
    .x:hover { background: rgba(255,255,255,.35); }
    .body { padding: 12px; }
    .stats { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
    .stat { background: #f4f5f7; border-radius: 12px; padding: 8px 10px; }
    .stat .v { font-weight: 800; font-size: 18px; line-height: 1.15; letter-spacing: -.01em; }
    .stat .k { font-size: 10px; font-weight: 600; letter-spacing: .06em; text-transform: uppercase; color: #6b7280; }
    .link { display: block; margin-top: 10px; padding: 8px 10px; border-radius: 10px; text-align: center;
      background: #1c1c1e; color: #fff; text-decoration: none; font-weight: 600; font-size: 12px; }
    .link:hover { background: #38383c; }
    .note { color: #6b7280; }
    /* Saturated gradient fills so the tab stands out on any page; the hue ramp
       green > amber > orange > red keeps the Q1-Q4 hierarchy. */
    .q1 { background: linear-gradient(160deg, #22c55e, #0f9d4b); color: #fff; }
    .q2 { background: linear-gradient(160deg, #fcd34d, #f2a900); color: #2b1d00; }
    .q3 { background: linear-gradient(160deg, #fb923c, #e8590c); color: #fff; }
    .q4 { background: linear-gradient(160deg, #f87171, #d62839); color: #fff; }
    .none { background: #fff; color: #888; font-weight: 500; }
  `;

  let hostEl = null;
  let rootEl = null;
  let current = null; // { result }
  let prefs = loadPrefs();

  function loadPrefs() {
    try {
      const p = JSON.parse(localStorage.getItem(STORE_KEY) || "{}");
      return { y: typeof p.y === "number" ? p.y : null, collapsed: p.collapsed !== false };
    } catch (_) {
      return { y: null, collapsed: true };
    }
  }

  function savePrefs() {
    try {
      localStorage.setItem(STORE_KEY, JSON.stringify(prefs));
    } catch (_) {}
  }

  function ensureHost() {
    if (hostEl && hostEl.isConnected) return;
    hostEl = document.createElement("div");
    hostEl.id = HOST_ID;
    const shadow = hostEl.attachShadow({ mode: "closed" });
    const style = document.createElement("style");
    style.textContent = CSS;
    rootEl = document.createElement("div");
    rootEl.className = "root";
    shadow.append(style, rootEl);
    (document.body || document.documentElement).appendChild(hostEl);
    // The top layer sits above every z-index, including other extensions' floating widgets (e.g.
    // Unpaywall's tab) that also use the maximum z-index and were appended to the DOM later.
    try {
      hostEl.popover = "manual";
      hostEl.showPopover();
    } catch (_) {}
    applyPosition();
    window.addEventListener("resize", applyPosition);
  }

  function removeHost() {
    if (hostEl) hostEl.remove();
    hostEl = null;
    rootEl = null;
  }

  function applyPosition() {
    if (!rootEl) return;
    // Docked to the right edge like Unpaywall's tab; only the vertical position is adjustable.
    if (prefs.y == null) {
      rootEl.style.top = "";
      return;
    }
    const h = rootEl.offsetHeight || 60;
    const y = Math.min(Math.max(0, prefs.y), Math.max(0, window.innerHeight - h));
    rootEl.style.top = `${y}px`;
  }

  // Makes `handle` drag the whole root up/down; calls onClick only for a press that did not move.
  function makeDraggable(handle, onClick) {
    handle.classList.add("grab");
    handle.addEventListener("pointerdown", (e) => {
      if (e.target.closest && e.target.closest("button.x")) return;
      const rect = rootEl.getBoundingClientRect();
      const dy = e.clientY - rect.top;
      const sy = e.clientY;
      let moved = false;
      handle.setPointerCapture(e.pointerId);
      const move = (ev) => {
        if (!moved && Math.abs(ev.clientY - sy) < 4) return;
        moved = true;
        prefs.y = ev.clientY - dy;
        applyPosition();
      };
      const up = () => {
        handle.removeEventListener("pointermove", move);
        handle.removeEventListener("pointerup", up);
        if (moved) {
          prefs.y = rootEl.getBoundingClientRect().top;
          savePrefs();
        } else if (onClick) {
          onClick();
        }
      };
      handle.addEventListener("pointermove", move);
      handle.addEventListener("pointerup", up);
    });
  }

  function el(tag, cls, text) {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }

  function setCollapsed(value) {
    prefs.collapsed = value;
    savePrefs();
    render();
  }

  function render() {
    if (!rootEl) return;
    rootEl.replaceChildren();
    const result = current && current.result;
    const quartile = result ? result.sjr_best_quartile || "?" : "—";
    const qClass = result ? (result.sjr_best_quartile || "").toLowerCase() : "none";

    if (prefs.collapsed) {
      const tab = el("button", `tab ${qClass}`);
      tab.type = "button";
      tab.title = result
        ? "ARTi SciPeek — click for details, drag to move up/down"
        : "Not found in the bundled Scimago snapshot";
      tab.appendChild(el("span", "q", quartile));
      if (result) {
        const sjr = el("span", "sjr");
        sjr.appendChild(el("span", "lbl", "SJR"));
        sjr.appendChild(el("span", "val", result.sjr != null ? Number(result.sjr).toFixed(2) : "?"));
        tab.appendChild(sjr);
      }
      makeDraggable(tab, () => setCollapsed(false));
      rootEl.appendChild(tab);
      applyPosition();
      return;
    }

    const card = el("div", "card");
    const head = el("div", `head ${qClass}`);
    head.appendChild(el("span", "chip", quartile));
    head.appendChild(el("span", "brand", "ARTi SciPeek"));
    const min = el("button", "x", "–");
    min.type = "button";
    min.title = "Collapse";
    min.addEventListener("click", () => setCollapsed(true));
    head.append(min);
    makeDraggable(head, null);
    card.appendChild(head);

    const body = el("div", "body");
    if (result) {
      const sjr = result.sjr != null ? Number(result.sjr).toFixed(3) : "?";
      const stat = (k, v) => {
        const s = el("div", "stat");
        s.append(el("div", "v", String(v)), el("div", "k", k));
        return s;
      };
      const stats = el("div", "stats");
      stats.append(stat("SJR", sjr), stat("H-index", result.h_index != null ? result.h_index : "?"));
      body.appendChild(stats);
      const link = el("a", "link", "Open on Scimago ↗");
      link.href = `https://www.scimagojr.com/journalsearch.php?q=${result.sourceid}&tip=sid`;
      link.target = "_blank";
      link.rel = "noopener noreferrer";
      body.appendChild(link);
    } else {
      body.appendChild(el("div", "note", "Journal not found in the bundled Scimago snapshot."));
    }
    card.appendChild(body);
    rootEl.appendChild(card);
    applyPosition();
  }

  // ---- Lifecycle ----------------------------------------------------------------------------

  let lastSignature = null;
  let running = false;
  let rerun = false;

  async function update() {
    if (running) {
      rerun = true;
      return;
    }
    running = true;
    try {
      const keys = extractKeys();
      const signature = keys ? JSON.stringify(keys.entries) : null;
      if (signature === lastSignature && (signature === null || (hostEl && hostEl.isConnected))) return;
      lastSignature = signature;
      if (!keys) {
        removeHost();
        return;
      }
      const results = await sjmLookupBatch(keys.entries);
      if (signature !== lastSignature) return; // page changed while the lookup was in flight
      current = { result: results.find(Boolean) || null };
      if (keys.quiet && !current.result) {
        removeHost();
        return;
      }
      ensureHost();
      render();
    } finally {
      running = false;
      if (rerun) {
        rerun = false;
        schedule();
      }
    }
  }

  let timer = null;
  function schedule() {
    clearTimeout(timer);
    timer = setTimeout(update, 400);
  }

  // Meta tags can arrive late (SPAs) and SPA navigation never reloads the content script, so watch
  // both <head> mutations and the URL.
  new MutationObserver(schedule).observe(document.head || document.documentElement, {
    childList: true,
    subtree: true,
  });
  // Some sites (bot-check interstitials, hydrating SPAs) replace <head> or <body> wholesale, which
  // the observer above would miss -- watch the root's direct children too.
  new MutationObserver(schedule).observe(document.documentElement, { childList: true });
  let lastHref = location.href;
  setInterval(() => {
    if (location.href !== lastHref) {
      lastHref = location.href;
      logged = false;
      schedule();
    }
  }, 1000);

  // Pages that render the journal info late (JS-rendered journal home pages, Cloudflare checks).
  [1500, 4000, 10000, 20000].forEach((ms) => setTimeout(update, ms));
  window.addEventListener("load", schedule);
  let logged = false;
  setTimeout(() => {
    if (!hostEl && !logged) {
      logged = true;
      logNoKey();
    }
  }, 12000);

  update();
})();
