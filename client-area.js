const $ = (id) => document.getElementById(id);

function escapeHtml(s){
  return String(s)
    .replaceAll("&","&amp;")
    .replaceAll("<","&lt;")
    .replaceAll(">","&gt;");
}

function parseDateTimeFromTxt(txt){
  // procura uma linha do tipo: "Date/time: 2026-01-18 12:34:56"
  const m = txt.match(/^\s*Date\/time:\s*(.+)\s*$/mi);
  return m ? m[1].trim() : "(sem data)";
}

function idFromFilename(file){
  // order_request_1700000000000.txt -> "1700000000000"
  const base = file.replace(/\.txt$/i, "");
  return base.startsWith("order_request_") ? base.slice("order_request_".length) : base;
}

async function fetchText(url){
  const res = await fetch(url, { cache: "no-store" });
  if(!res.ok) throw new Error(`fetch failed: ${url}`);
  return await res.text();
}

function renderOrdersSkeleton(){
  const host = $("ordersList");
  host.innerHTML = "";
}

function createOrderRow({ id, dateTime, file, onClick }){
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "listRow";
  btn.dataset.file = file;

  const top = document.createElement("div");
  top.className = "listTop";
  top.textContent = id;

  const bottom = document.createElement("div");
  bottom.className = "listSub";
  bottom.textContent = dateTime;

  btn.append(top, bottom);
  btn.addEventListener("click", onClick);

  return btn;
}

function setSelectedRow(host, file){
  const rows = host.querySelectorAll(".listRow");
  rows.forEach(r => r.classList.toggle("selected", r.dataset.file === file));
}

async function main(){
  // 1) ler manifesto
  const manifest = await fetchText("txt/index.json").then(JSON.parse);

  // 2) ORDERS: construir lista + preencher date/time lendo cada txt
  const ordersHost = $("ordersList");
  renderOrdersSkeleton();

  const orders = Array.isArray(manifest.orders) ? manifest.orders : [];
  if(!orders.length){
    ordersHost.innerHTML = `<div class="listEmpty">Sem pedidos.</div>`;
  }else{
    ordersHost.innerHTML = "";
  }

  // vamos buscar date/time dentro de cada ficheiro (para exemplo está ok)
  const enriched = [];
  for(const item of orders){
    const file = item.file;
    const url = `txt/${file}`;
    try{
      const txt = await fetchText(url);
      enriched.push({
        file,
        id: idFromFilename(file),
        dateTime: parseDateTimeFromTxt(txt),
        txt
      });
    }catch{
      enriched.push({
        file,
        id: idFromFilename(file),
        dateTime: "(erro a ler ficheiro)",
        txt: ""
      });
    }
  }

  // ordenar por id desc (assumindo timestamp)
  enriched.sort((a,b) => (b.id.localeCompare(a.id)));

  let current = null;

  const openOrder = async (file) => {
    const hit = enriched.find(x => x.file === file);
    if(!hit) return;

    current = file;
    setSelectedRow(ordersHost, file);

    // se já temos txt em memória, usa; senão fetch
    let txt = hit.txt;
    if(!txt){
      try{ txt = await fetchText(`txt/${file}`); }
      catch{ txt = "Erro a carregar o ficheiro."; }
    }

    $("txtViewer").textContent = txt;
  };

  for(const o of enriched){
    const row = createOrderRow({
      id: o.id,
      dateTime: o.dateTime,
      file: o.file,
      onClick: () => openOrder(o.file)
    });
    ordersHost.appendChild(row);
  }

  // abre o primeiro por defeito
  if(enriched.length){
    await openOrder(enriched[0].file);
  }

  // 3) CATALOGUES
  const catHost = $("cataloguesList");
  const cats = Array.isArray(manifest.catalogues) ? manifest.catalogues : [];
  catHost.innerHTML = "";

  if(!cats.length){
    catHost.innerHTML = `<div class="listEmpty">Sem catálogos.</div>`;
  }else{
    cats.forEach((c, idx) => {
      const a = document.createElement("a");
      a.className = "listRow linkRow" + (idx === 0 ? " selected" : "");
      a.href = c.href || "#";
      a.innerHTML = `
        <div class="listTop">${escapeHtml(c.title || `Catálogo ${idx+1}`)}</div>
        <div class="listSub">${escapeHtml(c.subtitle || "")}</div>
      `.trim();
      catHost.appendChild(a);
    });
  }
}

main().catch((e) => {
  console.error(e);
  const ordersHost = $("ordersList");
  if(ordersHost) ordersHost.innerHTML = `<div class="listEmpty">Erro a carregar client area.</div>`;
});
