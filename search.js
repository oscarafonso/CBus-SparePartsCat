const $ = (id) => document.getElementById(id);

let INDEX = null; // { entries: [...] }
let READY = false;

function escapeRegExp(s) {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
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
  // Regras:
  // 1 termo:
  //  - dígitos: len >= 5
  //  - contém letras: >= 3 letras
  // 2+ termos:
  //  - dígitos: len >= 5
  //  - contém letras: len >= 2 chars
  const multi = tokens.length >= 2;

  const valid = [];
  const ignored = [];

  for (const t of tokens) {
    if (isDigitsOnly(t)) {
      if (t.length >= 5) valid.push(t);
      else ignored.push({ t, why: 'mín. 5 dígitos' });
      continue;
    }

    // contém letras (ou misto)
    if (!multi) {
      if (lettersCount(t) >= 3) valid.push(t);
      else ignored.push({ t, why: 'mín. 3 letras (1 termo)' });
    } else {
      if (t.length >= 2) valid.push(t);
      else ignored.push({ t, why: 'mín. 2 chars (2+ termos)' });
    }
  }

  return { valid, ignored };
}

function tokenMatchesEntry(entry, token) {
  // AND por token: token bate se existir em partNoN OU descN
  const p = entry.partNoN || '';
  const d = entry.descN || '';

  if (isDigitsOnly(token)) {
    // números: permitir em part e/ou desc
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

// Junta todos os matches (de vários tokens) num conjunto de intervalos e cria fragment DOM
function buildHighlightedFragment(text, tokens, caseInsensitive = true) {
  const s = String(text || '');
  if (!s || !tokens.length) return document.createTextNode(s);

  const intervals = [];
  for (const t of tokens) {
    if (!t) continue;
    const re = new RegExp(escapeRegExp(t), caseInsensitive ? 'gi' : 'g');
    let m;
    while ((m = re.exec(s)) !== null) {
      // evitar loop em matches vazios
      if (m[0].length === 0) { re.lastIndex++; continue; }
      intervals.push([m.index, m.index + m[0].length]);
    }
  }

  if (!intervals.length) return document.createTextNode(s);

  // merge overlaps
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
  // thumbs: thumb_${svgBase}.jpg/png, fallback via onerror
  return `assets/thumbs/thumb_${svgBase}.jpg`;
}

function renderEmpty(msg) {
  const host = $('results');
  host.innerHTML = '';
  const d = document.createElement('div');
  d.className = 'listEmpty';
  d.textContent = msg;
  host.appendChild(d);
}

function setStatus(msg) {
  $('searchStatus').textContent = msg;
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

    // separar tokens que bateram por campo
    const partTokens = validTokens.filter(t => fieldMatches(e, t, 'partNo'));
    const descTokens = validTokens.filter(t => fieldMatches(e, t, 'desc'));

    // regra: se bateu nos dois, cria 2 linhas independentes
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

  // ordenar: partNo hits primeiro, depois code, depois partNo
  hits.sort((a, b) => {
    if (a.matchField !== b.matchField) return a.matchField === 'partNo' ? -1 : 1;
    const c = String(a.code).localeCompare(String(b.code));
    if (c !== 0) return c;
    return String(a.partNo).localeCompare(String(b.partNo));
  });

  return hits;
}

function renderHits(hits) {
  const host = $('results');
  host.innerHTML = '';

  if (!hits.length) {
    renderEmpty('Sem resultados.');
    return;
  }

  for (const h of hits) {
    const row = document.createElement('button');
    row.type = 'button';
    row.className = 'listRow searchRow';

    // coluna 1: thumb
    const thumb = document.createElement('img');
    thumb.className = 'searchThumb';
    thumb.alt = h.svgBase;
    thumb.src = thumbUrlFor(h.svgBase);
    thumb.onerror = () => { thumb.onerror = null; thumb.src = 'assets/thumbs/thumb_default.jpg'; };

    // coluna 2: code
    const code = document.createElement('div');
    code.className = 'searchCode';
    code.textContent = h.code;

    // coluna 3: preview (com todos os matches em bold)
    const prev = document.createElement('div');
    prev.className = 'searchPreview';
    const caseInsensitive = (h.matchField === 'desc'); // desc: case-insensitive
    prev.appendChild(buildHighlightedFragment(h.previewText, h.highlightTokens, caseInsensitive));

    row.append(thumb, code, prev);

    row.addEventListener('click', () => {
      // Guardar jump para o catálogo aplicar setSelected depois do SVG carregar
      const payload = {
        svgBase: h.svgBase,
        partNo: h.partNo,
        desc: h.desc,
        qty: h.qty,
      };
      try { sessionStorage.setItem('searchJump', JSON.stringify(payload)); } catch {}

      // Navegar para o SVG exacto onde o match ocorreu
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
    setStatus('Escreve para pesquisar.');
    renderEmpty('Escreve um termo para pesquisar.');
    return;
  }

  const { valid, ignored } = validateTokens(tokens);

  if (!valid.length) {
    setStatus('Pesquisa demasiado curta.');
    renderEmpty('Pesquisa demasiado curta. Ex.: 58977 (>=5 dígitos) ou nut (>=3 letras). Em 2+ termos, tokens com letras >=2 chars.');
    return;
  }

  // mensagem de ignored tokens
  if (ignored.length) {
    const msg = 'Ignorados: ' + ignored.map(x => `'${x.t}' (${x.why})`).join(', ');
    setStatus(msg);
  } else {
    setStatus(`OK: ${valid.join(' ')}`);
  }

  const hits = buildHits(valid);
  setStatus((ignored.length ? $('searchStatus').textContent + ' · ' : '') + `${hits.length} resultados`);
  renderHits(hits);
}

async function loadIndex() {
  setStatus('A carregar índice…');
  renderEmpty('A carregar…');

  const res = await fetch('assets/search-index.json', { cache: 'no-store' });
  if (!res.ok) throw new Error('Falha a carregar search-index.json');
  INDEX = await res.json();

  READY = true;
  setStatus('Índice carregado. Escreve para pesquisar.');
  renderEmpty('Escreve um termo para pesquisar.');
}

function bindUI() {
  $('q').addEventListener('input', () => {
    clearTimeout(tmr);
    tmr = setTimeout(runSearch, 80);
  });

  $('btnClear').addEventListener('click', () => {
    $('q').value = '';
    $('q').focus();
    setStatus('Escreve para pesquisar.');
    renderEmpty('Escreve um termo para pesquisar.');
  });

  // Enter força search imediato
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
    setStatus('Erro a carregar índice.');
    renderEmpty('Erro a carregar assets/search-index.json. Confirma que já geraste o índice e que está na pasta assets/.');
  }
})();
