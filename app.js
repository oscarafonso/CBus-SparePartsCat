const $ = (id) => document.getElementById(id);

// Canonicalize svg identifiers across Windows (case-insensitive) and Linux servers (case-sensitive)
function canonSvgBase(seg) {
  const s = String(seg || '');
  // Only normalize the 'pai_' prefix case; keep the rest untouched (codes are typically uppercase like 5A...)
  return s.match(/^pai_/i) ? ('pai_' + s.slice(4)) : s;
}

function canonSvgUrl(url) {
  const s = String(url || '');
  // Normalize only the filename prefix 'pai_' (case-insensitive) inside assets/svgs/ URLs
  return s.replace(/(assets\/svgs\/)pai_/i, '$1pai_');
}

function normPartNo(s) {
  return String(s || '').replace(/[\s\-_]/g, '').toUpperCase();
}


const state = {
  config: null,
  searchMeta: null, // loaded from assets/search-index.json (codeDesc for breadcrumbs)
  selected: null,
  cart: [],
  path: [],
  // mapping hotspotN -> {partNo, desc, qty}
  map: new Map(),
  bomRows: [],
};

/*// ===== Order request TXT formatting (aligned, like client-area samples) =====
const COL_PN = 12;
const COL_DESC = 40;
const COL_PRICE = 10;
const COL_QTY = 4;

function pad(str, w, right = false) {
  str = String(str ?? '');

  if (str.length > w) {
    // deixa espaço para ellipsis
    str = str.slice(0, w - 1) + '…';
  }

  return right ? str.padStart(w) : str.padEnd(w);
}

function row(pn, desc, price, qty) {
  return (
    pad(pn, COL_PN) +
    pad(desc, COL_DESC) +
    pad(price, COL_PRICE) +
    pad(qty, COL_QTY, true)
  );
}*/




function toast(msg) {
  const t = $('toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toast._tm);
  toast._tm = setTimeout(() => t.classList.remove('show'), 2400);
}

async function loadConfig() {
  const res = await fetch('data/catalog.json');
  state.config = await res.json();
  // Ensure root svg URL uses canonical 'pai_' prefix (Linux servers are case-sensitive)
  if (state.config && state.config.root_svg) {
    state.config.root_svg = canonSvgUrl(state.config.root_svg);
  }
}

async function loadSearchMeta() {
  // Lightweight metadata used for breadcrumbs when entering via Search (code -> description).
  // This avoids relying on Search page state and keeps behavior consistent online/offline.
  state.searchMeta = { codeDesc: {} };
  try {
    const res = await fetch('assets/search-index.json', { cache: 'no-store' });
    if (!res.ok) return;
    const j = await res.json();
    state.searchMeta.codeDesc = (j && j.codeDesc) ? j.codeDesc : {};
  } catch {
    // ignore; breadcrumbs will fall back to code-only
  }
}


function renderCrumbs() {
  const el = $('crumbs');
  el.innerHTML = '';

  const root = document.createElement('a');
  root.href = '#/';
  root.textContent = state.config.title || 'Catálogo';
  el.appendChild(root);

  // ✅ Só esconder o root "pai_*" se estiver no início
  const hasRootSeg = state.path.length && /^pai_/i.test(state.path[0]);
  const visiblePath = hasRootSeg ? state.path.slice(1) : state.path.slice();
  const offset = hasRootSeg ? 1 : 0;

  const SEP = ' | '; // definir o separador

  for (let i = 0; i < visiblePath.length; i++) {
    const sep = document.createElement('span');
    sep.textContent = '>';
    sep.style.opacity = '0.7';
    el.appendChild(sep);

    const pn = visiblePath[i];

    if (i === visiblePath.length - 1) {
      let desc = '';
      try { desc = sessionStorage.getItem(`pnDesc:${pn}`) || ''; } catch { }

      const s = document.createElement('span');
      s.className = 'current';
      s.textContent = desc ? pn + SEP + desc : pn;
      el.appendChild(s);
    } else {
      const a = document.createElement('a');

      // ✅ Link tem de usar o state.path completo (com root), por isso usamos offset
      a.href = '#/' + state.path.slice(0, i + 1 + offset).join('/');
      a.textContent = pn;

      el.appendChild(a);
    }
  }
}

function clearSelected() {
  $('selTitle').textContent = 'Please select a part or subassembly';
  $('selPn').textContent = '';
  $('selQty').textContent = '';
  $('selPrice').textContent = '';
  $('thumbWrap').innerHTML = '';
  $('btnAdd').disabled = true;
  $('btnOpenSub').disabled = true;
  state.selected = null;
}

function renderCartInto(bodyEl) {
  if (!bodyEl) return;
  bodyEl.innerHTML = '';

  if (!state.cart.length) {
    const d = document.createElement('div');
    d.style.color = '#6b7280';
    d.style.padding = '12px 0';
    d.textContent = 'Cart empty.';
    bodyEl.appendChild(d);
    return;
  }

  state.cart.forEach((row, idx) => {
    const r = document.createElement('div'); r.className = 'cartRow';

    const pn = document.createElement('div'); pn.className = 'pnCell'; pn.textContent = row.partNo;
    const desc = document.createElement('div'); desc.textContent = row.desc;
    const price = document.createElement('div'); price.className = 'priceCell'; price.textContent = row.price || 'TBA';

    const qty = document.createElement('input');
    qty.type = 'number';
    qty.min = '1';
    qty.value = String(row.qty);

    qty.addEventListener('change', () => {
      row.qty = Math.max(1, parseInt(qty.value || '1', 10));
      // sincroniza ambas as views
      renderCart();
    });

    const rm = document.createElement('button'); rm.className = 'rmBtn'; rm.textContent = '✕';
    rm.addEventListener('click', () => {
      state.cart.splice(idx, 1);
      renderCart();
    });

    r.append(pn, desc, price, qty, rm);
    bodyEl.appendChild(r);
  });
}

function renderCart() {
  renderCartInto($('cartBody'));       // carrinho pequeno
  renderCartInto($('cartBodyModal'));  // carrinho grande (modal)
}

function openOrderModal() {
  const m = $('orderModal');
  if (!m) return;
  m.hidden = false;
}

function closeOrderModal() {
  const m = $('orderModal');
  if (!m) return;
  m.hidden = true;
}

function setupUI() {
  function sendOrderRequest() {
    if (!state.cart.length) { toast('Your cart is empty!'); return; }

    const dt = new Date().toISOString().replace('T', ' ').slice(0, 19);

    let out = '';
    out += 'Order request\n';
    out += `Date/time: ${dt}\n\n`;

    out += 'Items:\n';
    out += 'P/N | Description | Price | Qty\n';
    out += '--------------------------------\n';

    for (const r of state.cart) {
      out += `${r.partNo} | ${r.desc} | ${r.price || 'TBA'} | ${r.qty}\n`;
    }

    // ===== guardar pedido no browser =====
    const ts = Date.now();
    try {
      const key = 'orderRequestsLocal';
      const arr = JSON.parse(localStorage.getItem(key) || '[]');

      arr.unshift({ id: ts, dt: dt, content: out });

      localStorage.setItem(key, JSON.stringify(arr.slice(0, 200)));
    } catch (e) { }

    // ===== download =====
    const blob = new Blob([out], { type: 'text/plain;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `order_request_${ts}.txt`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);

    // ===== enviar email (EmailJS) =====
    if (window.emailjs) {
      emailjs.send(
        "service_cbus",
        "template_tdwabib",
        {
          order_id: ts,
          date_time: dt,
          order_text: out
        }
      ).catch(err => console.warn("EmailJS failed", err));
    }

    toast("We've received your order request and will get back to you shortly.");
    state.cart = [];
    renderCart();
    closeOrderModal(); // ✅ depois de enviar, fecha o modal (faz sentido no fluxo)
  }
  $('qtyDown').addEventListener('click', () => $('qtyInput').value = String(Math.max(1, parseInt($('qtyInput').value || '1', 10) - 1)));
  $('qtyUp').addEventListener('click', () => $('qtyInput').value = String(Math.max(1, parseInt($('qtyInput').value || '1', 10) + 1)));
  $('qtyInput').addEventListener('change', () => $('qtyInput').value = String(Math.max(1, parseInt($('qtyInput').value || '1', 10))));
  $('btnSend').addEventListener('click', () => {
    if (!state.cart.length) { toast('Your cart is empty!'); return; }
    renderCart();       // garante sync
    openOrderModal();   // ✅ agora abre modal (não envia)
  });

  $('btnAdd').addEventListener('click', () => {
    if (!state.selected) return;
    const qty = Math.max(1, parseInt($('qtyInput').value || '1', 10));
    const existing = state.cart.find(x => x.partNo === state.selected.partNo);
    if (existing) existing.qty += qty;
    else state.cart.push({ partNo: state.selected.partNo, desc: state.selected.desc, price: state.selected.price, qty });
    renderCart(); toast('Adicionado ao carrinho.');
  });
  $('btnOpenSub').addEventListener('click', () => {
    if (!state.selected?.hasSub) return;

    // 👉 guardar descrição do subassembly que vais abrir
    try {
      sessionStorage.setItem(
        `pnDesc:${state.selected.partNo}`,
        state.selected.desc || ''
      );
    } catch { }

    const next = [...state.path, state.selected.partNo].join('/');
    window.location.hash = '#/' + next;
  });

  // modal: fechar
  $('btnModalClose')?.addEventListener('click', closeOrderModal);

  $('orderModal')?.addEventListener('click', (e) => {
    const t = e.target;
    if (t && t.dataset && t.dataset.close === '1') closeOrderModal();
  });

  // modal: send
  $('btnModalSend')?.addEventListener('click', sendOrderRequest);

  // tecla ESC fecha
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      const m = $('orderModal');
      if (m && !m.hidden) closeOrderModal();
    }
  });
}

async function setSelected(partNo, desc, qty) {
  const tw = $('thumbWrap'); tw.innerHTML = '';
  const tryHead = async (url) => { try { const h = await fetch(url, { method: 'HEAD' }); return h.ok ? url : null; } catch { return null; } };
  const base = state.config.thumbs_dir || 'assets/thumbs/';
  const url =
    (await tryHead(`${base}thumb_${partNo}.jpg`)) ||
    (await tryHead(`${base}thumb_${partNo}.png`)) ||
    `${base}thumb_default.jpg`;

  const img = document.createElement('img');
  img.src = url;
  img.alt = partNo;
  tw.appendChild(img);

  state.selected = { partNo, desc, qty, price: 'TBA', hasSub: false };
  $('selTitle').textContent = desc || '(sem descrição)';
  $('selPn').textContent = `P/N: ${partNo}`;
  $('selQty').textContent = qty ? `Used quantity: ${qty}` : '';
  $('btnAdd').disabled = false;

  const sub = `assets/svgs/${partNo}.svg`;
  try { const head = await fetch(sub, { method: 'HEAD' }); state.selected.hasSub = head.ok; } catch { state.selected.hasSub = false; }
  $('btnOpenSub').disabled = !state.selected.hasSub;
}

/* ---- Robust mapping: hotspot bbox -> nearest partNo text in BOM table ---- */

function parseBOMTokens(doc) {
  // Read BOM table text tokens in document order.
  // Supports multiple BOM tables (repeated headers) and non-5A part numbers (e.g., 700xxxx, TBA).
  const nodes = Array.from(doc.querySelectorAll('text'))
    .map(t => (t.textContent || '').replace(/\s+/g, ' ').trim())
    .filter(Boolean);

  // Find all header occurrences: Pos. | Part No | Qty. | Description
  const headers = [];
  for (let i = 0; i < nodes.length; i++) {
    const a = nodes[i];
    const b = nodes[i + 1];
    const c = nodes[i + 2];
    const d = nodes[i + 3];
    // Variant where "Part" "No" are split
    const e = nodes[i + 4];

    const isPos = a === 'Pos.' || a.toLowerCase() === 'pos.' || a.toLowerCase() === 'pos';
    const isQty = (x) => x && (x === 'Qty.' || x.toLowerCase() === 'qty.' || x.toLowerCase() === 'qty');
    const isDesc = (x) => x && x.toLowerCase() === 'description';
    const isPartNo = (x) => x && x.toLowerCase() === 'part no';
    const isPart = (x) => x && x.toLowerCase() === 'part';
    const isNo = (x) => x && x.toLowerCase() === 'no';

    if (isPos && isPartNo(b) && isQty(c) && isDesc(d)) {
      headers.push({ idx: i, headerLen: 4 });
      continue;
    }
    if (isPos && isPart(b) && isNo(c) && isQty(d) && isDesc(e)) {
      headers.push({ idx: i, headerLen: 5 });
      continue;
    }
  }
  if (!headers.length) return [];

  const rowsByPos = new Map();

  for (const h of headers) {
    const tail = nodes.slice(h.idx + h.headerLen);

    // Find first plausible row: <pos:int> <partNo:any> <qty:int> <desc:any>
    let start = -1;
    for (let i = 0; i < tail.length - 3; i++) {
      const pos = tail[i];
      const partNo = tail[i + 1];
      const qty = tail[i + 2];
      const desc = tail[i + 3];
      if (/^\d+$/.test(pos) && /^\d+$/.test(qty) && partNo && desc) {
        start = i; break;
      }
      // stop if we hit another header
      if ((pos === 'Pos.' || (pos || '').toLowerCase() === 'pos.' || (pos || '').toLowerCase() === 'pos') && i > 0) break;
    }
    if (start < 0) continue;

    for (let i = start; i < tail.length - 3;) {
      const pos = tail[i];
      const partNoRaw = tail[i + 1];
      const qty = tail[i + 2];
      const desc = tail[i + 3];

      if (!/^\d+$/.test(pos) || !/^\d+$/.test(qty) || !partNoRaw || !desc) break;

      const partNo = partNoRaw.replace(/\s+/g, '');
      // Keep first occurrence per pos (tables are split, not duplicated)
      if (!rowsByPos.has(pos)) {
        rowsByPos.set(pos, { pos, partNo, qty, desc });
      }

      i += 4;

      // Stop if we appear to have left the table (e.g., hit another header/legend)
      if (i < tail.length) {
        const nxt = tail[i];
        if (!/^\d+$/.test(nxt)) break;
      }
    }
  }

  return Array.from(rowsByPos.values()).sort((a, b) => Number(a.pos) - Number(b.pos));
}



function collectPartTextBoxes(doc) {
  const rePN = /^5A/i;
  const out = [];
  for (const t of Array.from(doc.querySelectorAll('text'))) {
    const s = (t.textContent || '').trim().replace(/\s+/g, '');
    if (!rePN.test(s)) continue;
    try {
      const bb = t.getBBox();
      out.push({ partNo: s, bb, el: t, cy: bb.y + bb.height / 2 });
    } catch { }
  }
  return out;
}

function collectHotspots(doc) {
  const out = [];
  for (const el of Array.from(doc.querySelectorAll('[id^="hotspot."]'))) {
    const m = String(el.id).match(/^hotspot\.(\d+)$/);
    if (!m) continue;
    const n = parseInt(m[1], 10);
    if (Number.isNaN(n)) continue;
    try {
      const bb = el.getBBox();
      out.push({ n, id: el.id, bb, cy: bb.y + bb.height / 2, cx: bb.x + bb.width / 2 });
    } catch { }
  }
  return out;
}

function dist(a, b) { return Math.abs(a - b); }

function buildMapFromGeometry(doc) {
  state.bomRows = parseBOMTokens(doc);
  state.rowsByPos = new Map(state.bomRows.map(r => [Number(r.pos), r]));

  const partBoxes = collectPartTextBoxes(doc);
  const hotspots = collectHotspots(doc);

  const map = new Map();

  // 1) Prefer deterministic mapping by "Pos." when possible: hotspot.N -> BOM pos (N+1)
  let posHits = 0;
  for (const h of hotspots) {
    const row = state.bomRows.find(r => r.pos === String(h.n + 1));
    if (row) { map.set(h.n, row); posHits++; }
  }
  if (hotspots.length && (posHits / hotspots.length) >= 0.75) {
    state.map = map;
    toast(`map ok (pos): ${map.size} hotspots`);
    return;
  }

  // 2) Otherwise fall back to geometry matching to nearest Part No text box
  map.clear();
  // For each hotspot: choose closest partNo text by vertical proximity, with mild x constraint
  for (const h of hotspots) {
    let best = null;
    let bestScore = Infinity;
    for (const p of partBoxes) {
      const dy = dist(h.cy, p.cy);
      const pcx = p.bb.x + p.bb.width / 2;
      const dx = Math.abs(pcx - h.cx);
      const score = dy * 1.0 + dx * 0.35;
      if (score < bestScore) { bestScore = score; best = p; }
    }
    if (best) {
      const row = state.bomRows.find(r => r.partNo === best.partNo) || null;
      if (row) map.set(h.n, row);
    }
  }

  // 3) Final fallback: try pos mapping even if coverage was low
  const uniqPN = new Set(Array.from(map.values()).map(r => r.partNo));
  if (map.size === 0 || uniqPN.size < Math.max(1, Math.floor(state.bomRows.length * 0.6))) {
    map.clear();
    for (const h of hotspots) {
      const row = state.bomRows.find(r => r.pos === String(h.n + 1));
      if (row) map.set(h.n, row);
    }
  }

  state.map = map;
  toast(`map ok: ${map.size} hotspots`);
}

function buildHotspotToPosMap(doc) {
  const svg = doc.documentElement;

  // --- helpers (screen-space, robust to transforms) ---
  const rectOf = (el) => { try { return el.getBoundingClientRect(); } catch { return null; } };
  const centerY = (r) => (r.top + r.bottom) / 2;
  const centerX = (r) => (r.left + r.right) / 2;
  const txt = (el) => (el.textContent || '').replace(/\s+/g, ' ').trim();
  const low = (s) => (s || '').toLowerCase();

  function median(arr) {
    const a = arr.slice().sort((x, y) => x - y);
    const m = Math.floor(a.length / 2);
    return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2;
  }

  // --- 1) Detect ALL BOM tables by repeated headers on the same row ---
  const texts = Array.from(doc.querySelectorAll('text'));
  const posHeaders = texts.filter(t => {
    const s = txt(t);
    return s === 'Pos.' || low(s) === 'pos.' || low(s) === 'pos';
  });

  function findNearestOnSameRow(baseRect, labelSet) {
    let best = null, bestScore = Infinity;
    for (const t of texts) {
      const s = low(txt(t));
      if (!labelSet.has(s)) continue;
      const r = rectOf(t);
      if (!r) continue;
      if (Math.abs(centerY(r) - centerY(baseRect)) > 8) continue;
      if (r.left <= baseRect.right - 5) continue;
      const score = r.left - baseRect.right;
      if (score < bestScore) {
        bestScore = score;
        best = { el: t, rect: r, s };
      }
    }
    return best;
  }

  const tables = [];
  for (const cand of posHeaders) {
    const rPos = rectOf(cand);
    if (!rPos) continue;

    const part = findNearestOnSameRow(rPos, new Set(['part no', 'partno']));
    const qty = findNearestOnSameRow(rPos, new Set(['qty.', 'qty']));
    const desc = findNearestOnSameRow(rPos, new Set(['description']));
    // accept only full header match
    if (!part || !qty || !desc) continue;

    const posColX = centerX(rPos);
    const yStart = rPos.bottom + 4;
    const tolX = Math.max(18, rPos.width * 1.2);

    // Collect POS cells for this table
    const posCells = [];
    for (const t of texts) {
      const s = txt(t);
      if (!/^\d+$/.test(s)) continue;
      const r = rectOf(t);
      if (!r) continue;
      const cx = centerX(r);
      const cy = centerY(r);
      if (Math.abs(cx - posColX) > tolX) continue;
      if (cy <= yStart) continue;
      posCells.push({ pos: Number(s), cy });
    }
    if (!posCells.length) continue;

    posCells.sort((a, b) => a.cy - b.cy || a.pos - b.pos);
    // keep first occurrence per pos within a table
    const seen = new Set();
    const rows = [];
    for (const c of posCells) {
      if (seen.has(c.pos)) continue;
      seen.add(c.pos);
      rows.push(c);
    }

    const deltas = [];
    for (let i = 1; i < rows.length; i++) {
      const d = rows[i].cy - rows[i - 1].cy;
      if (d > 2) deltas.push(d);
    }
    const rowH = deltas.length ? median(deltas) : 14;

    tables.push({
      posColX,
      yStart,
      rowH,
      rows,
      y0: rows[0].cy - rowH,
      y1: rows[rows.length - 1].cy + rowH,
      closestPosByY: (y) => {
        let best = null, bestDy = Infinity;
        for (const r of rows) {
          const dy = Math.abs(y - r.cy);
          if (dy < bestDy) { bestDy = dy; best = r.pos; }
        }
        return bestDy <= rowH * 0.65 ? best : null;
      }
    });
  }

  if (!tables.length) return new Map();

  // --- 2) Parse hotspot path sub-rectangles from its "d" attribute (SVG coords) ---
  function bboxesFromPathD(d) {
    const parts = String(d || '').split('M').slice(1);
    const bbs = [];
    for (const part of parts) {
      const seg = 'M' + part;
      const nums = (seg.match(/[-+]?(?:\d*\.\d+|\d+)/g) || []).map(Number);
      if (nums.length < 4) continue;
      const xs = [], ys = [];
      for (let i = 0; i < nums.length; i += 2) {
        xs.push(nums[i]);
        if (i + 1 < nums.length) ys.push(nums[i + 1]);
      }
      if (!xs.length || !ys.length) continue;
      const x0 = Math.min(...xs), x1 = Math.max(...xs);
      const y0 = Math.min(...ys), y1 = Math.max(...ys);
      bbs.push({ x0, y0, x1, y1, w: (x1 - x0), h: (y1 - y0), cx: (x0 + x1) / 2, cy: (y0 + y1) / 2 });
    }
    return bbs;
  }

  function svgPointToScreen(xSvg, ySvg) {
    try {
      const p = svg.createSVGPoint();
      p.x = xSvg; p.y = ySvg;
      const m = svg.getScreenCTM();
      if (!m) return null;
      const sp = p.matrixTransform(m);
      return { x: sp.x, y: sp.y };
    } catch { return null; }
  }

  // --- 3) Build hotspotN -> pos mapping using the "BOM band" inside each hotspot ---
  const map = new Map();
  const hotspots = Array.from(doc.querySelectorAll('g[id^="hotspot."]'));

  // thresholds relative to typical row height (pick from median table rowH)
  const globalRowH = median(tables.map(t => t.rowH));
  const thinMax = Math.max(6, globalRowH * 0.9);
  const wideMin = Math.max(30, globalRowH * 3.5);

  for (const g of hotspots) {
    const id = g.id || '';
    const n = Number(id.split('.')[1]);
    if (!Number.isFinite(n)) continue;

    const p = g.querySelector('path');
    if (!p) continue;
    const bbs = bboxesFromPathD(p.getAttribute('d') || '');
    if (!bbs.length) continue;

    let bestPos = null;
    let bestScore = Infinity;

    for (const bb of bbs) {
      if (bb.h > thinMax) continue;
      if (bb.w < wideMin) continue;

      const sp = svgPointToScreen(bb.cx, bb.cy);
      if (!sp) continue;

      // choose best matching table by X distance
      let bestTable = null, bestDx = Infinity;
      for (const t of tables) {
        const dx = Math.abs(sp.x - t.posColX);
        if (dx < bestDx) {
          bestDx = dx; bestTable = t;
        }
      }
      if (!bestTable) continue;
      if (sp.y < bestTable.y0 - bestTable.rowH || sp.y > bestTable.y1 + bestTable.rowH) continue;

      const pos = bestTable.closestPosByY(sp.y);
      if (pos == null) continue;

      // score: prefer closer X to pos column, closer Y to row, thinner bands
      const yRow = bestTable.rows.find(r => r.pos === pos)?.cy ?? sp.y;
      const score = bestDx * 0.4 + Math.abs(sp.y - yRow) + bb.h * 3 - bb.w * 0.02;
      if (score < bestScore) {
        bestScore = score;
        bestPos = pos;
      }
    }

    if (bestPos != null) map.set(n, bestPos);
  }

  return map;
}




function extractHotspotNFromAttr(attr) {
  const m = String(attr || '').match(/ShowHotSpot\(evt,\s*(?:'|&apos;)?(\d+)(?:'|&apos;)?\)/);
  if (!m) return null;
  const n = parseInt(m[1], 10);
  return Number.isNaN(n) ? null : n;
}
function findHotspotNOnAncestors(el) {
  let cur = el;
  while (cur && cur !== cur.ownerDocument) {
    if (cur && cur.id) {
      const ni = extractHotspotNFromId(cur.id);
      if (ni !== null) return ni;
    }
    if (cur.getAttribute) {
      const om = cur.getAttribute('onmouseover') || cur.getAttribute('onmousemove') || '';
      const n = extractHotspotNFromAttr(om);
      if (n !== null) return n;
    }
    cur = cur.parentNode;
  }
  return null;
}


function extractHotspotNFromId(id) {
  const m = String(id || '').match(/hotspot[._-](\d+)/i);
  if (!m) return null;
  const n = parseInt(m[1], 10);
  return Number.isNaN(n) ? null : n;
}

/**
 * Fallback: infer hotspot number from click position (works even when the event
 * target isn't inside the hotspot overlay / onmouseover isn't present).
 * Strategy: scan all hotspot groups and pick the smallest bounding rect that
 * contains the click point (client coords).
 */
function findHotspotNByPoint(doc, clientX, clientY) {
  const groups = Array.from(doc.querySelectorAll('g[id^="hotspot."], g[id^="hotspot_"], g[id^="hotspot-"]'));
  let best = null;
  let bestArea = Infinity;

  for (const g of groups) {
    const n = extractHotspotNFromId(g.id);
    if (n == null) continue;

    // Use boundingClientRect (screen coords) so we don't care about transforms/CTM.
    const r = g.getBoundingClientRect?.();
    if (!r) continue;

    if (clientX >= r.left && clientX <= r.right && clientY >= r.top && clientY <= r.bottom) {
      const area = Math.max(0, r.width) * Math.max(0, r.height);
      // prefer tighter hit (smallest area) to avoid selecting large container groups
      if (area > 0 && area < bestArea) {
        bestArea = area;
        best = n;
      }
    }
  }
  return best;
}


function wireBridge() {
  const obj = $('svgObj');
  const doc = obj.contentDocument;
  if (!doc) return;

  // 🔑 permitir teclado dentro do SVG
  try {
    doc.documentElement.setAttribute('tabindex', '0');
  } catch { }

  // 🔑 apanhar SPACE mesmo quando o foco está “lá dentro”
  doc.addEventListener('keydown', pan.onKeyDown, { passive: false, capture: true });
  doc.addEventListener('keyup', pan.onKeyUp, { passive: false, capture: true });

  // opcional: ao clicar no SVG, garante que o modo pan não fica preso
  doc.addEventListener('mousedown', () => pan.up(), true);

  if (!doc) return;

  doc.addEventListener('contextmenu', (e) => {
    if (window.spaceDown || window.dragging) e.preventDefault();
  }, true);

  doc.addEventListener('selectstart', (e) => {
    if (window.spaceDown || window.dragging) e.preventDefault();
  }, true);

  // build mapping from actual geometry
  state.map = buildMapFromGeometry(doc);

  // NEW: build hotspot -> POS mapping using callout numbers
  state.hotspotToPos = buildHotspotToPosMap(doc);



  doc.addEventListener('mouseover', (ev) => {
    const n = findHotspotNOnAncestors(ev.target);
    if (n !== null) state.lastHotspotN = n;
  }, true);

  doc.addEventListener('click', (ev) => {



    const directN = findHotspotNOnAncestors(ev.target);
    const pointN = (directN === null && (state.lastHotspotN == null)) ? findHotspotNByPoint(doc, ev.clientX, ev.clientY) : null;
    const n = (directN !== null) ? directN : ((state.lastHotspotN != null) ? state.lastHotspotN : pointN);
    if (n === null) return;

    const pos = state.hotspotToPos?.get(n);

    if (pos == null) return;

    const row = state.rowsByPos?.get(Number(pos));

    if (!row) return;

    setSelected(row.partNo, row.desc, row.qty);
  }, true);
}

function showSvgError(msg) {
  $('svgLoading').style.display = 'none';
  const b = $('svgErr');
  b.style.display = 'block';
  b.textContent = msg;
}

async function loadSvg(url) {
  const obj = $('svgObj');
  const loading = $('svgLoading');
  const err = $('svgErr');
  err.style.display = 'none';
  loading.style.display = 'block';

  zoomReset();

  return new Promise((resolve, reject) => {
    let done = false;
    const to = setTimeout(() => {
      if (done) return;
      showSvgError('SVG não carregou. (confirma localhost e pasta certa)');
      done = true; reject(new Error('timeout'));
    }, 12000);

    obj.addEventListener('load', () => {
      if (done) return;
      clearTimeout(to);
      loading.style.display = 'none';
      setTimeout(() => {
        try {
          wireBridge();

          // ✅ Apply pending selection from Search page (auto-select + full breadcrumb path)
          try {
            const raw = sessionStorage.getItem('searchJump');
            if (raw) {
              const j = JSON.parse(raw);

              const current = state.path?.length ? state.path[state.path.length - 1] : null;

              if (j && j.svgBase && current && canonSvgBase(j.svgBase) === canonSvgBase(current)) {

                // If Search provided a full path (root -> ... -> current), apply it and keep URL/history in sync
                if (Array.isArray(j.path) && j.path.length >= 2) {
                  const rootCode = j.path[0];
                  const rest = j.path.slice(1);

                  state.path = [canonSvgBase(`pai_${rootCode}`), ...rest.map(canonSvgBase)];

                  try {
                    history.replaceState(null, '', '#/' + state.path.join('/'));
                  } catch {
                    location.hash = '#/' + state.path.join('/');
                  }

                  // Fill breadcrumb descriptions from loaded codeDesc (best-effort)
                  try {
                    const map = state.searchMeta?.codeDesc || {};
                    for (const pn of state.path) {
                      const codeKey = pn.replace(/^pai_/i, '');
                      const desc = map[normPartNo(codeKey)] || (pn.match(/^pai_/i) ? 'Root assembly' : '');
                      if (desc) sessionStorage.setItem(`pnDesc:${pn}`, desc);
                    }
                  } catch { }

                  renderCrumbs();
                }

                setSelected(j.partNo, j.desc, j.qty);

                const q = parseInt(j.qty || '1', 10);
                if (!Number.isNaN(q) && q > 0) $('qtyInput').value = String(q);

                sessionStorage.removeItem('searchJump');
              }
            }
          } catch { }

        } catch (e) {
          toast('map falhou');
        }
        resolve();
      }, 80);
      done = true;
    }, { once: true });

    obj.addEventListener('error', () => {
      if (done) return;
      clearTimeout(to);
      showSvgError('Erro a carregar SVG.');
      done = true; reject(new Error('error'));
    }, { once: true });

    obj.data = url + (url.includes('?') ? '&' : '?') + 'v=' + Date.now();
  });
}

async function route() {
  const hash = window.location.hash || '#/';
  const pathStr = hash.replace(/^#\//, '').trim();
  state.path = pathStr ? pathStr.split('/').filter(Boolean).map(canonSvgBase) : [];
  renderCrumbs();
  clearSelected();
  renderCart();

  const last = state.path.length ? canonSvgBase(state.path[state.path.length - 1]) : null;
  const url = last ? `assets/svgs/${last}.svg` : state.config.root_svg;
  await loadSvg(url);
}

async function main() {
  await loadConfig();
  await loadSearchMeta();
  setupUI();
  renderCrumbs();
  clearSelected();
  renderCart();

  window.addEventListener('hashchange', () => route().catch(() => { }));
  await route().catch(() => { });
}


main();

let zoom = 1;
const ZOOM_STEP = 0.25;
const ZOOM_MAX = 4;
const ZOOM_MIN = 1;

const viewport = document.getElementById('svgViewport');
const obj = document.getElementById('svgObj');
const panHint = document.getElementById('panHint');

function applyZoom() {
  const w = viewport.clientWidth;
  const h = viewport.clientHeight;

  // aumentar o object cria área de scroll real
  obj.style.width = (w * zoom) + "px";
  obj.style.height = (h * zoom) + "px";

  viewport.classList.toggle('canPan', zoom !== 1);

  // 🔑 garante coerência
  syncZoomState();
}

function zoomIn() {
  zoom = Math.min(ZOOM_MAX, +(zoom + ZOOM_STEP).toFixed(2));
  applyZoom();
}
function zoomOut() {
  zoom = Math.max(ZOOM_MIN, +(zoom - ZOOM_STEP).toFixed(2));
  if (zoom === 1) zoomReset();
  else applyZoom();
}

function zoomReset() {
  zoom = 1;
  obj.style.width = "100%";
  obj.style.height = "100%";
  viewport.scrollLeft = 0;
  viewport.scrollTop = 0;
  viewport.classList.remove('canPan');

  // 🔑 garante coerência
  syncZoomState();
}

function syncZoomState() {
  // Se zoom está activo, GARANTE object escalado + canPan
  if (zoom !== 1) {
    const w = viewport.clientWidth;
    const h = viewport.clientHeight;

    const wantW = (w * zoom) + "px";
    const wantH = (h * zoom) + "px";

    // se alguém te “desfez” o tamanho, repõe
    if (obj.style.width !== wantW) obj.style.width = wantW;
    if (obj.style.height !== wantH) obj.style.height = wantH;

    viewport.classList.add('canPan');

  } else {
    // zoom 1: garante estado limpo
    viewport.classList.remove('canPan');
    if (obj.style.width && obj.style.width !== "100%") obj.style.width = "100%";
    if (obj.style.height && obj.style.height !== "100%") obj.style.height = "100%";

  }
}

// LISTENERS DO WATCHDOG (aqui)
viewport.addEventListener('mouseenter', syncZoomState);
viewport.addEventListener('mousedown', syncZoomState, true);
window.addEventListener('focus', syncZoomState);
window.addEventListener('resize', () => {
  if (zoom !== 1) syncZoomState();
});
obj.addEventListener('load', () => {
  if (zoom !== 1) syncZoomState();
});

document.getElementById('btnZoomOut').addEventListener('click', zoomOut);
document.getElementById('btnZoomIn').addEventListener('click', zoomIn);
document.getElementById('btnZoomReset').addEventListener('click', zoomReset);

// Zoom com mousewheel quando o ponteiro está sobre o viewport do SVG
viewport.addEventListener('wheel', (e) => {
  // só quando o rato está mesmo no viewport (já está, porque o listener é no viewport)
  e.preventDefault();

  // deltaY > 0 = roda para baixo (zoom out), deltaY < 0 = roda para cima (zoom in)
  if (e.deltaY < 0) zoomIn();
  else zoomOut();
}, { passive: false });


window.addEventListener('resize', () => {
  if (zoom !== 1) applyZoom();
});

// quando trocares o data="" para um SVG novo, isto garante zoom consistente
obj.addEventListener('load', () => {
  if (zoom !== 1) applyZoom();
});

// ---- PAN controller (reutilizável) ----
const pan = (() => {
  const viewport = document.getElementById('svgViewport');

  let overlay = document.getElementById('panOverlay');
  if (!overlay) {
    overlay = document.createElement('div');
    overlay.id = 'panOverlay';
    overlay.className = 'panOverlay';
    viewport.appendChild(overlay);
  }

  let spaceDown = false;
  let dragging = false;
  let startX = 0, startY = 0;
  let startSL = 0, startST = 0;

  function syncPanState() {
    window.spaceDown = spaceDown;
    window.dragging = dragging;
  }

  function setCursor() {
    overlay.style.cursor = dragging ? 'grabbing' : (spaceDown ? 'grab' : '');
  }

  function down() {
    spaceDown = true;
    syncPanState();
    overlay.style.pointerEvents = 'auto';
    viewport.classList.add('isPanning');
    setCursor();
  }

  function up() {
    spaceDown = false;
    dragging = false;
    syncPanState();
    overlay.style.pointerEvents = 'none';
    viewport.classList.remove('isPanning');
    setCursor();
  }

  function onKeyDown(e) {
    if (e.code !== 'Space') return;
    if (!spaceDown) down();
    e.preventDefault();
  }

  function onKeyUp(e) {
    if (e.code !== 'Space') return;
    up();
    e.preventDefault();
  }

  // impedir o mini-menu / seleção do Edge enquanto pan
  overlay.addEventListener('contextmenu', (e) => e.preventDefault());
  viewport.addEventListener('contextmenu', (e) => {
    if (spaceDown || dragging) e.preventDefault();
  });
  document.addEventListener('selectstart', (e) => {
    if (spaceDown || dragging) e.preventDefault();
  }, true);

  // mouse drag (só quando spaceDown)
  overlay.addEventListener('mousedown', (e) => {
    if (!spaceDown || e.button !== 0) return;
    dragging = true;
    syncPanState();
    startX = e.clientX; startY = e.clientY;
    startSL = viewport.scrollLeft; startST = viewport.scrollTop;
    setCursor();
    e.preventDefault();
  });

  window.addEventListener('mousemove', (e) => {
    if (!dragging) return;
    viewport.scrollLeft = startSL - (e.clientX - startX);
    viewport.scrollTop = startST - (e.clientY - startY);
    e.preventDefault();
  }, { passive: false });

  window.addEventListener('mouseup', () => {
    if (!dragging) return;
    dragging = false;
    syncPanState();
    setCursor();
  });

  window.addEventListener('blur', up);
  document.addEventListener('visibilitychange', () => { if (document.hidden) up(); });

  // listeners no documento principal
  window.addEventListener('keydown', onKeyDown, { passive: false, capture: true });
  window.addEventListener('keyup', onKeyUp, { passive: false, capture: true });

  // estado inicial
  overlay.style.pointerEvents = 'none';
  syncPanState();
  setCursor();

  return { onKeyDown, onKeyUp, up };
})();