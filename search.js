const $ = (id) => document.getElementById(id);

let INDEX = null; // { entries: [...] }
let READY = false;

function escapeRegExp(s) {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function setHeaderVisible(on) {
  const h = document.getElementById('resultsHeader');
  if (!h) return;
  h.hidden = !on;
}

function normPart(s) {
  return String(s || '').replace(/[\s\-_]/g, '').toUpperCase();
}
function normDesc(s) {
  return String(s || '').toLowerCase().replace(/\s+/g, ' ').trim();
}

function tokenize(q) {
  return String(q || '').trim().split(/\s+/).filter(Boolean);
}

function isDigitsOnly(t) {
  return /^\d+$/.test(t);
}
function lettersCount(t) {
  const m = String(t).match(/[a-zA-Z]/g);
  return m ? m.length : 0;
}

function validateTokens(tokens) {
  // Rules:
  // Single term:
  //  - any token: len >= 3 (digits / letters / alphanumeric)
  // Multiple terms:
  //  - digits-only tokens: len >= 5
  //  - tokens containing letters (or mixed): len >= 2 chars
  const multi = tokens.length >= 2;

  const valid = [];
  const ignored = [];

  for (const t of tokens) {
    if (!t) continue;

    if (!multi) {
      // single term: allow >= 3 chars regardless of type
      if (t.length >= 3) valid.push(t);
      else ignored.push({ t, why: 'min. 3 chars (single term)' });
      continue;
    }

    // multi-term rules
    if (isDigitsOnly(t)) {
      if (t.length >= 5) valid.push(t);
      else ignored.push({ t, why: 'min. 5 digits' });
    } else {
      if (t.length >= 2) valid.push(t);
      else ignored.push({ t, why: 'min. 2 chars (multi-term)' });
    }
  }

  return { valid, ignored };
}


function tokenMatchesEntry(entry, token) {
  // AND per token: matches if present in partNoN OR descN
  const p = entry.partNoN || '';
  const d = entry.descN || '';

  if (isDigitsOnly(token)) {
    return p.includes(token) || d.includes(token);
  }

  const tDesc = token.toLowerCase();
  const tPart = normPart(token);
  return d.includes(tDesc) || p.includes(tPart);
}

function fieldMatches(entry, token, field) {
  const p = entry.partNoN || '';
  const d = entry.descN || '';

  if (field === 'partNo') {
    if (isDigitsOnly(token)) return p.includes(token);
    return p.includes(normPart(token));
  } else {
    if (isDigitsOnly(token)) return d.includes(token);
    return d.includes(token.toLowerCase());
  }
}

// Build merged highlight intervals and return DOM fragment
function buildHighlightedFragment(text, tokens, caseInsensitive = true) {
  const s = String(text || '');
  if (!s || !tokens.length) return document.createTextNode(s);

  const intervals = [];
  for (const t of tokens) {
    if (!t) continue;
    const re = new RegExp(escapeRegExp(t), caseInsensitive ? 'gi' : 'g');
    let m;
    while ((m = re.exec(s)) !== null) {
      if (m[0].length === 0) { re.lastIndex++; continue; }
      intervals.push([m.index, m.index + m[0].length]);
    }
  }

  if (!intervals.length) return document.createTextNode(s);

  intervals.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const merged = [];
  for (const it of intervals) {
    if (!merged.length) { merged.push(it); continue; }
    const last = merged[merged.length - 1];
    if (it[0] <= last[1]) last[1] = Math.max(last[1], it[1]);
    else merged.push(it);
  }

  const frag = document.createDocumentFragment();
  let i = 0;
  for (const [a, b] of merged) {
    if (i < a) frag.appendChild(document.createTextNode(s.slice(i, a)));
    const strong = document.createElement('strong');
    strong.textContent = s.slice(a, b);
    frag.appendChild(strong);
    i = b;
  }
  if (i < s.length) frag.appendChild(document.createTextNode(s.slice(i)));
  return frag;
}

function thumbUrlFor(svgBase) {
  return `assets/thumbs/thumb_${svgBase}.jpg`;
}

function renderEmpty(msg) {
  setHeaderVisible(false);
  const host = $('results');
  host.innerHTML = '';

  // Keep UI silent when msg is empty
  if (!msg) return;

  const d = document.createElement('div');
  d.className = 'listEmpty';
  d.textContent = msg;
  host.appendChild(d);
}

function setStatus(msg) {
  const el = $('searchStatus');
  if (!el) return;
  el.textContent = msg || '';
  el.style.display = msg ? '' : 'none'; // hide when empty (more discreet)
}

function buildHits(validTokens) {
  const entries = INDEX?.entries || [];
  const hits = [];

  for (const e of entries) {
    // AND across valid tokens
    let ok = true;
    for (const t of validTokens) {
      if (!tokenMatchesEntry(e, t)) { ok = false; break; }
    }
    if (!ok) continue;

    // tokens that matched each field
    const partTokens = validTokens.filter(t => fieldMatches(e, t, 'partNo'));
    const descTokens = validTokens.filter(t => fieldMatches(e, t, 'desc'));

    // if both matched, create 2 independent result rows
    if (partTokens.length) {
      hits.push({
        svgBase: e.svgBase,
        code: e.code,
        matchField: 'partNo',
        previewText: e.partNo,
        highlightTokens: partTokens,
        partNo: e.partNo,
        desc: e.desc,
        qty: e.qty ?? null,
      });
    }
    if (descTokens.length) {
      hits.push({
        svgBase: e.svgBase,
        code: e.code,
        matchField: 'desc',
        previewText: e.desc,
        highlightTokens: descTokens,
        partNo: e.partNo,
        desc: e.desc,
        qty: e.qty ?? null,
      });
    }
  }

  // sort: partNo hits first, then code, then partNo
  hits.sort((a, b) => {
    if (a.matchField !== b.matchField) return a.matchField === 'partNo' ? -1 : 1;
    const c = String(a.code).localeCompare(String(b.code));
    if (c !== 0) return c;
    return String(a.partNo).localeCompare(String(b.partNo));
  });

  return hits;
}

function renderHits(hits) {
  if (!hits.length) {
    renderEmpty('No results.');
    return;
  }

  setHeaderVisible(true);
  const host = $('results');
  host.innerHTML = '';

  for (const h of hits) {
    const row = document.createElement('button');
    row.type = 'button';
    row.className = 'listRow searchRow';

    // col 1: thumb
    const thumb = document.createElement('img');
    thumb.className = 'searchThumb';
    thumb.alt = h.svgBase;
    thumb.src = thumbUrlFor(h.svgBase);
    thumb.onerror = () => { thumb.onerror = null; thumb.src = 'assets/thumbs/thumb_default.jpg'; };

    // col 2: code
    const code = document.createElement('div');
    code.className = 'searchCode';
    code.textContent = h.code;

    // col 3: preview (highlight all matches)
    const prev = document.createElement('div');
    prev.className = 'searchPreview';
    const caseInsensitive = (h.matchField === 'desc');
    prev.appendChild(buildHighlightedFragment(h.previewText, h.highlightTokens, caseInsensitive));

    row.append(thumb, code, prev);

    row.addEventListener('click', () => {
      const payload = {
        svgBase: h.svgBase,
        partNo: h.partNo,
        desc: h.desc,
        qty: h.qty,
      };
      try { sessionStorage.setItem('searchJump', JSON.stringify(payload)); } catch {}

      window.location.href = `index.html#/${encodeURIComponent(h.svgBase)}`;
    });

    host.appendChild(row);
  }
}

let tmr = null;
function runSearch() {
  if (!READY) return;

  const q = $('q').value;
  const tokens = tokenize(q);

  if (!tokens.length) {
    setStatus('');
    renderEmpty('');
    return;
  }

  const { valid, ignored } = validateTokens(tokens);

  if (!valid.length) {
    setStatus('');
    renderEmpty('Search terms are too short.');
    return;
  }

  const hits = buildHits(valid);

  // status: optional ignored tokens + results count
  const ignoredMsg = ignored.length
    ? ('Ignored: ' + ignored.map(x => `'${x.t}'`).join(', ') + ' · ')
    : '';

  setStatus(ignoredMsg + `${hits.length} results`);
  renderHits(hits);
}

async function loadIndex() {
  setStatus('Loading index…');
  renderEmpty('Loading…');

  const res = await fetch('assets/search-index.json', { cache: 'no-store' });
  if (!res.ok) throw new Error('Failed to load assets/search-index.json');
  INDEX = await res.json();

  READY = true;
  setStatus('');
  renderEmpty('');
}

function bindUI() {
  $('q').addEventListener('input', () => {
    clearTimeout(tmr);
    tmr = setTimeout(runSearch, 80);
  });

  $('btnClear').addEventListener('click', () => {
    $('q').value = '';
    $('q').focus();
    // Keep silent + clean
    setStatus('');
    renderEmpty('');
  });

  $('q').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      runSearch();
    }
  });
}

(async function main() {
  bindUI();
  try {
    await loadIndex();
  } catch (e) {
    READY = false;
    setStatus('Failed to load index.');
    renderEmpty('Index file not found: assets/search-index.json');
  }
})();
