// ═══════════════════════════════════════════════════════════════════════
//  SCRAPPY — View system + Business Discovery
//  (este bloque va ANTES del código original de búsqueda)
// ═══════════════════════════════════════════════════════════════════════

const BD_KEY = 'scrappy_bd';
let bdCurrentStep = 1;
const BD_TOTAL = 3;

// ── Sesión — el servidor ya no comparte una sola búsqueda global entre
// todos los usuarios; cada navegador (identificado por este ID) tiene su
// propio job. Así, si alguien más está usando Scrappy (o el MVP móvil) al
// mismo tiempo, ninguna búsqueda bloquea a la otra.
function getOrCreateSessionId() {
  const key = 'scrappy-session-id';
  try {
    const existing = localStorage.getItem(key);
    if (existing) return existing;
    const fresh = 'sid-' + Date.now() + '-' + Math.random().toString(36).slice(2, 10);
    localStorage.setItem(key, fresh);
    return fresh;
  } catch (_) {
    return 'sid-nostorage-' + Math.random().toString(36).slice(2, 10);
  }
}
const SCRAPPY_SESSION_ID = getOrCreateSessionId();

function sessionFetch(url, opts) {
  opts = opts || {};
  opts.headers = Object.assign({}, opts.headers, { 'X-Scrappy-Session': SCRAPPY_SESSION_ID });
  return fetch(url, opts);
}

// ── View system ──────────────────────────────────────────────────────
function showView(id) {
  document.querySelectorAll('.view').forEach(v => {
    v.classList.remove('active');
    v.style.display = 'none';
  });
  const el = document.getElementById(id);
  if (el) {
    el.classList.add('active');
    el.style.display = 'block';
  }
  const btn = document.getElementById('btn-mi-negocio');
  if (btn) btn.style.display = (id === 'view-search') ? 'block' : 'none';
}

// ── sessionStorage: última búsqueda (sobrevive a F5, se borra al cerrar
// la pestaña — no es historial permanente, solo recuerda la más reciente) ──
const SEARCH_RESULTS_KEY = 'scrappy_last_search_results';

function saveSearchResults(businesses) {
  try { sessionStorage.setItem(SEARCH_RESULTS_KEY, JSON.stringify(businesses)); }
  catch (e) {}
}

function loadSearchResults() {
  try { return JSON.parse(sessionStorage.getItem(SEARCH_RESULTS_KEY)) || null; }
  catch (e) { return null; }
}

function clearSearchResults() {
  try { sessionStorage.removeItem(SEARCH_RESULTS_KEY); }
  catch (e) {}
}

// ── localStorage ─────────────────────────────────────────────────────
function loadBD() {
  try { return JSON.parse(localStorage.getItem(BD_KEY)) || null; }
  catch(e) { return null; }
}

function saveBD(data) {
  try { localStorage.setItem(BD_KEY, JSON.stringify(data)); }
  catch(e) {}
}

function getBDValues() {
  return {
    oferta:        (document.getElementById('bd-q1')?.value || '').trim(),
    resultado:     (document.getElementById('bd-q2')?.value || '').trim(),
    clientes:      (document.getElementById('bd-q3')?.value || '').trim(),
    exclusiones:   (document.getElementById('bd-q4')?.value || '').trim(),
    diferenciador: (document.getElementById('bd-q5')?.value || '').trim(),
    casoExito:     (document.getElementById('bd-q6')?.value || '').trim(),
  };
}

function fillBDForm(data) {
  if (!data) return;
  const map = {
    'bd-q1': data.oferta,
    'bd-q2': data.resultado,
    'bd-q3': data.clientes,
    'bd-q4': data.exclusiones,
    'bd-q5': data.diferenciador,
    'bd-q6': data.casoExito,
  };
  for (const [id, val] of Object.entries(map)) {
    const el = document.getElementById(id);
    if (el && val) el.value = val;
  }
}

// ── Progress indicator ────────────────────────────────────────────────
function updateBDProgress(step) {
  // Dots
  document.querySelectorAll('.bd-prog-step').forEach((dot, i) => {
    const n = i + 1;
    dot.classList.remove('active', 'done');
    if (n < step)      dot.classList.add('done');
    else if (n === step) dot.classList.add('active');
  });

  // Steps
  document.querySelectorAll('.bd-step').forEach((s, i) => {
    const isActive = i + 1 === step;
    s.classList.toggle('active', isActive);
    s.style.display = isActive ? 'block' : 'none';
  });

  // Back button
  const back = document.getElementById('bd-back');
  if (back) back.classList.toggle('visible', step > 1);

  // Next button label
  const next = document.getElementById('bd-next');
  if (next) next.textContent = step === BD_TOTAL ? 'Ver Market Fit →' : 'Siguiente →';
}

// ── Validation ────────────────────────────────────────────────────────
const BD_REQUIRED = {
  1: ['bd-q1', 'bd-q2'],
  2: ['bd-q3', 'bd-q4'],
  3: [],                  // paso 3 es todo opcional
};

function validateBDStep(step) {
  let ok = true;
  (BD_REQUIRED[step] || []).forEach(id => {
    const el  = document.getElementById(id);
    const field = document.getElementById('bd-field-' + id);
    if (!el?.value?.trim()) {
      field?.classList.add('bd-error');
      el?.focus();
      setTimeout(() => field?.classList.remove('bd-error'), 2500);
      ok = false;
    }
  });
  return ok;
}

// ── Market Fit ────────────────────────────────────────────────────────

function extractSearchTerms(data) {
  // Combine the most relevant fields
  const sources = [data.clientes, data.casoExito, data.oferta]
    .filter(Boolean).join('\n');

  // Split on common delimiters
  let raw = sources
    .replace(/[,;•\/]/g, '\n')
    .replace(/\s+(?:y|o|and|or)\s+/gi, '\n')
    .split('\n')
    .map(s => s.replace(/^[-•\s\d.()]+/, '').replace(/[.!?:]+$/, '').trim())
    .filter(s => s.length >= 4 && s.length <= 55);

  // Filter out sentence fragments and pure stopwords
  const stopRx = /^(negocios?|empresas?|clientes?|que |no |sin |con |de |en |la |el |los |las |un |una |pero |además|también|ej:|por |al |a |y |o |si |esto|para |hasta|ahora|tenemos|tienen|tiene|todo|todos|más|muy|entre|otros|igual|ya |1\.|2\.|3\.|también|presupuesto|interno|cambios|constantes)/i;

  const seen = new Set();
  return raw
    .filter(s => !stopRx.test(s))
    .filter(s => !/^\d+$/.test(s))
    .map(s => s.charAt(0).toUpperCase() + s.slice(1))
    .filter(s => {
      const k = s.toLowerCase();
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    })
    .slice(0, 12);
}

function getMFTerms() {
  return Array.from(document.querySelectorAll('#mf-terms .mf-term[data-term]'))
    .map(el => el.dataset.term)
    .filter(Boolean);
}

function renderMarketFit() {
  const data = loadBD();
  const wrap = document.getElementById('mf-content');
  if (!wrap || !data) return;

  // Show loading state immediately
  wrap.innerHTML = `
    <div class="mf-page">
      <span class="mf-kicker">Market Fit</span>
      <h2 class="mf-title">Analizando tu negocio...</h2>
      <p class="mf-subtitle">Claude está identificando tus clientes ideales.</p>
      <div class="mf-loading">
        <div class="mf-spinner"></div>
        <span>Generando términos de búsqueda con IA...</span>
      </div>
    </div>
  `;

  // Call the server
  fetch('/api/market-fit', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  })
  .then(r => r.json())
  .then(result => {
    if (result.error) throw new Error(result.error);
    const terms = result.searchTerms || extractSearchTerms(data);
    const insight = result.insight || null;
    const topPriority = result.topPriority || null;
    renderMFResult(wrap, data, terms, insight, topPriority);
  })
  .catch(err => {
    console.warn('API market-fit falló, usando extracción local:', err.message);
    const terms = extractSearchTerms(data);
    renderMFResult(wrap, data, terms, null, null, err.message);
  });
}

function renderMFResult(wrap, data, terms, insight, topPriority, apiError) {
  const termTags = terms.map(t =>
    `<div class="mf-term" data-term="${escHtml(t)}">
      <span>${escHtml(t)}</span>
      <button class="mf-term-del" title="Quitar">✕</button>
    </div>`
  ).join('');

  const insightBlock = insight ? `
    <div class="mf-insight">
      <span class="mf-insight-icon">💡</span>
      <div>
        <strong>Perfil ideal</strong>
        <p>${escHtml(insight)}</p>
        ${topPriority ? `<span class="mf-top-priority">🎯 Prioridad: ${escHtml(topPriority)}</span>` : ''}
      </div>
    </div>` : '';

  const errorBadge = apiError ? `
    <div class="mf-api-warn">⚠️ API no disponible — usando extracción local. Configura tu API key en <code>.env</code>.</div>` : '';

  wrap.innerHTML = `
    <div class="mf-page">
      <span class="mf-kicker">Market Fit</span>
      <h2 class="mf-title">Estos son tus clientes objetivo</h2>
      <p class="mf-subtitle">Úsalos directamente en el buscador — uno por búsqueda o todos de una vez.</p>

      ${errorBadge}
      ${insightBlock}

      <div class="mf-card">
        <div class="mf-card-header">
          <span class="mf-card-label">${insight ? '✨ Generado con IA' : 'Tipos de negocio'}</span>
          <button id="mf-copy-all" class="mf-copy-all-btn">📋 Copiar todos</button>
        </div>
        <div class="mf-terms" id="mf-terms">
          ${termTags || '<p class="mf-empty">No se detectaron tipos — agrégalos manualmente.</p>'}
        </div>
        <div class="mf-add-row">
          <input type="text" id="mf-add-input" class="mf-add-input" placeholder="Agregar tipo de negocio...">
          <button id="mf-add-btn" class="mf-add-btn">+ Agregar</button>
        </div>
      </div>

      <div class="mf-actions">
        <button id="mf-back-btn" class="mf-back-btn">← Editar respuestas</button>
        <button id="mf-search-btn" class="mf-search-btn">Ir al buscador →</button>
      </div>
    </div>
  `;

  wrap.addEventListener('click', e => {
    if (e.target.classList.contains('mf-term-del')) e.target.closest('.mf-term').remove();
  });

  document.getElementById('mf-copy-all')?.addEventListener('click', () => {
    const t = getMFTerms();
    navigator.clipboard.writeText(t.join('\n')).then(() => {
      const btn = document.getElementById('mf-copy-all');
      if (btn) { btn.textContent = '✓ Copiado'; setTimeout(() => { btn.textContent = '📋 Copiar todos'; }, 2000); }
    });
  });

  function addTerm(val) {
    val = (val || '').trim();
    if (!val) return;
    const tag = document.createElement('div');
    tag.className = 'mf-term';
    tag.dataset.term = val;
    tag.innerHTML = `<span>${escHtml(val)}</span><button class="mf-term-del" title="Quitar">✕</button>`;
    document.getElementById('mf-terms')?.appendChild(tag);
  }

  document.getElementById('mf-add-btn')?.addEventListener('click', () => {
    const input = document.getElementById('mf-add-input');
    addTerm(input.value); input.value = '';
  });
  document.getElementById('mf-add-input')?.addEventListener('keydown', e => {
    if (e.key === 'Enter') { addTerm(e.target.value); e.target.value = ''; }
  });

  document.getElementById('mf-back-btn')?.addEventListener('click', () => {
    bdCurrentStep = BD_TOTAL;
    updateBDProgress(bdCurrentStep);
    showView('view-bd');
  });

  document.getElementById('mf-search-btn')?.addEventListener('click', () => {
    const t = getMFTerms();
    const queryEl = document.getElementById('query');
    if (queryEl && t.length) queryEl.value = t.join('\n');
    showView('view-search');
  });
}

function escHtml(str) {
  return str.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

// ── Init BD ───────────────────────────────────────────────────────────
function initBD() {
  const saved = loadBD();
  if (saved) fillBDForm(saved);

  document.getElementById('bd-back')?.addEventListener('click', () => {
    if (bdCurrentStep > 1) {
      bdCurrentStep--;
      updateBDProgress(bdCurrentStep);
    }
  });

  document.getElementById('bd-next')?.addEventListener('click', () => {
    if (!validateBDStep(bdCurrentStep)) return;

    saveBD(getBDValues());

    if (bdCurrentStep < BD_TOTAL) {
      bdCurrentStep++;
      updateBDProgress(bdCurrentStep);
    } else {
      // Completado → Market Fit
      saveBD(getBDValues());
      showView('view-mf');
      renderMarketFit();
    }
  });

  // Botón "Mi negocio" en header → volver a editar BD
  document.getElementById('btn-mi-negocio')?.addEventListener('click', () => {
    bdCurrentStep = 1;
    updateBDProgress(1);
    showView('view-bd');
  });

  updateBDProgress(1);
}

// ── Restaurar la última búsqueda desde sessionStorage (sobrevive a F5) ──
// OJO: esto NO se llama desde boot() (más abajo) porque showResults()
// depende de consts (resultsSection, resultsTitle, exportCsvBtn, etc.)
// que recién se declaran más adelante en este archivo — invocarlo antes
// de esa línea tira ReferenceError por el temporal dead zone del const.
// Por eso boot() solo deja la señal en _shouldRestoreSearch, y la
// restauración real se dispara al final del archivo (ver el cierre).
let _shouldRestoreSearch = false;
function restoreSearchResults() {
  const saved = loadSearchResults();
  if (saved && saved.length) showResults(saved);
}

// ── Bootstrap ─────────────────────────────────────────────────────────
(function boot() {
  const saved = loadBD();
  if (saved && (saved.oferta || saved.clientes)) {
    showView('view-search');
    _shouldRestoreSearch = true;
  } else {
    showView('view-bd');
  }
  initBD();
})();

// ═══════════════════════════════════════════════════════════════════════
//  FIN BLOQUE BUSINESS DISCOVERY — código original a continuación
// ═══════════════════════════════════════════════════════════════════════

// ── Source selector (dropdown) ────────────────────────────────────────
let activeSource = "googlemaps"; // "googlemaps" | "produce"

const sourceSelect = document.getElementById("source-select");
const gmForm       = document.getElementById("search-form");
const produceForm  = document.getElementById("produce-form");

function applySourceDisplay(source) {
  activeSource = source;
  const filterBar  = document.getElementById("filter-bar");
  const exportJson = document.getElementById("export-json");

  if (source === "googlemaps") {
    gmForm.style.display      = "";
    produceForm.style.display = "none";
    if (filterBar)  filterBar.style.display  = "";
    if (exportJson) exportJson.style.display = "";
  } else {
    gmForm.style.display      = "none";
    produceForm.style.display = "";
    if (filterBar)  filterBar.style.display  = "none";
    if (exportJson) exportJson.style.display = "none";
  }
}

if (sourceSelect) {
  sourceSelect.addEventListener("change", () => applySourceDisplay(sourceSelect.value));
}

// ── PRODUCE form submit ───────────────────────────────────────────────
document.getElementById("produce-form")?.addEventListener("submit", async (e) => {
  e.preventDefault();

  const ciiu          = document.getElementById("produce-ciiu").value.trim();
  const dep           = (document.getElementById("produce-dep").value || "LIMA").trim().toUpperCase();
  const sector        = document.getElementById("produce-sector").value || null;
  const max           = parseInt(document.getElementById("produce-max").value, 10) || 100;
  const enrich        = document.getElementById("produce-enrich").checked;
  const rucType       = document.getElementById("produce-ruc-type").value || null;

  const ciuuList = ciiu ? ciiu.split(",").map(s => s.trim()).filter(Boolean) : [];

  setLoading(true);
  hideError();
  emptyState?.classList.add("hidden");
  resultsSection?.classList.add("hidden");
  setProgressBar(3);

  try {
    const resp = await sessionFetch("/api/scrape-produce", {
      method:  "POST",
      headers: { "Content-Type": "application/json" },
      body:    JSON.stringify({ ciiu: ciuuList, departamento: dep, sector, maxResults: max, enrich, rucType }),
    });

    const data = await resp.json();
    if (!resp.ok) throw new Error(data.error || "No se pudo iniciar la búsqueda PRODUCE.");

    startPolling();
  } catch (err) {
    setLoading(false);
    showError(err.message);
  }
});

const form         = document.getElementById("search-form");
const searchBtn    = document.getElementById("search-btn");
const progress     = document.getElementById("progress");
const progressText = document.getElementById("progress-text");
const progressBar  = document.getElementById("progress-bar");
const resultsSection = document.getElementById("results-section");
const resultsTitle   = document.getElementById("results-title");
const resultsBody    = document.getElementById("results-body");
const contactSummary = document.getElementById("contact-summary");
const emptyState     = document.getElementById("empty-state");
const exportCsvBtn   = document.getElementById("export-csv");
const exportJsonBtn  = document.getElementById("export-json");
const comboHint      = document.getElementById("combo-hint");
const errorBox       = document.getElementById("error-box");
const errorText      = document.getElementById("error-text");

document.getElementById("error-close")?.addEventListener("click", () => {
  errorBox.classList.add("hidden");
});

function showError(msg) {
  errorText.textContent = msg;
  errorBox.classList.remove("hidden");
}
function hideError() {
  errorBox.classList.add("hidden");
}

let pollInterval    = null;
let allResults      = [];
let lastMetrics     = null;
let sortState       = { col: "contactabilityScore", dir: "desc" };

// ─── Filter state ─────────────────────────────────────────────────────────────
let audienceFilter    = "all";
let chainsOnly        = false;
let uniqueOnly        = false;
let tierFilter        = "all";   // "all" | "A" | "B" | "C" | "D"
let reviewPowerFilter = "all";   // "all" | "Very High" | "High" | "Medium" | "Low" | "No Data"
let reputationFilter  = "all";   // "all" | "Excelente" | "Buena" | "Regular" | "Sin datos"

// ─── Hint dinámico de combinaciones ─────────────────────────────────────────

function parseLines(value) {
  return String(value || "").split("\n").map(l => l.trim()).filter(Boolean);
}

function updateComboHint() {
  const queries   = parseLines(document.getElementById("query").value);
  const locations = parseLines(document.getElementById("location").value);
  const limit     = parseInt(document.getElementById("max-results").value) || 20;
  const combos    = Math.max(queries.length, 1) * Math.max(locations.length, 1);
  const estimated = combos * limit;

  if (combos === 1) {
    comboHint.textContent = `Máx. ${limit} resultados`;
  } else {
    comboHint.textContent =
      `${queries.length} búsq. × ${locations.length} ubicac. → hasta ~${estimated} resultados`;
    comboHint.style.color = "#f59e0b";
  }
}

["query", "location", "max-results"].forEach(id => {
  document.getElementById(id)?.addEventListener("input", updateComboHint);
});
updateComboHint();

// ─── Formulario ─────────────────────────────────────────────────────────────

form.addEventListener("submit", async (event) => {
  event.preventDefault();

  const query     = document.getElementById("query").value.trim();
  const location  = document.getElementById("location").value;
  const maxResults = document.getElementById("max-results").value;
  const deepScan  = document.getElementById("deep-scan").checked;

  if (!query) return;

  setLoading(true);
  hideError();
  emptyState.classList.add("hidden");
  resultsSection.classList.add("hidden");
  setProgressBar(3);

  try {
    const response = await sessionFetch("/api/scrape", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ query, location, maxResults, deepScan }),
    });

    const data = await response.json();

    if (!response.ok) {
      throw new Error(data.error || "No se pudo iniciar la búsqueda.");
    }

    startPolling();
  } catch (error) {
    setLoading(false);
    showError(error.message);
  }
});

// ─── Polling ─────────────────────────────────────────────────────────────────

function startPolling() {
  if (pollInterval) clearInterval(pollInterval);

  pollInterval = setInterval(async () => {
    try {
      const response = await sessionFetch("/api/status");
      const data = await response.json();

      if (data.progress?.message) {
        progressText.textContent = data.progress.message;
        setProgressBar(calcProgress(data.progress));
      }

      if (data.error) {
        clearInterval(pollInterval);
        setLoading(false);
        showError(data.error);
        return;
      }

      if (data.metrics) lastMetrics = data.metrics;

      if (!data.running && data.results) {
        clearInterval(pollInterval);
        setProgressBar(100);
        setTimeout(() => setLoading(false), 300);
        showResults(data.results);
        return;
      }

      if (!data.running && !data.results && !data.error) {
        clearInterval(pollInterval);
        setLoading(false);
        emptyState.classList.remove("hidden");
        clearSearchResults();
      }
    } catch {
      clearInterval(pollInterval);
      setLoading(false);
      alert("Se perdió la conexión con Scrappy.");
    }
  }, 1500);
}

/** Estima el % de avance a partir del objeto progress del servidor */
function calcProgress(p) {
  if (!p) return 5;
  const stage = p.stage;
  if (stage === "done" || stage === "metrics") return 98;

  const pct = p.total > 0 ? Math.round((p.current / p.total) * 100) : 0;

  if (stage === "loading" || stage === "scrolling" || stage === "starting") return 4;
  if (stage === "quickpass")      return  5 + Math.round(pct * 0.22);  //  5–27 %
  if (stage === "scraping")       return 27 + Math.round(pct * 0.33);  // 27–60 %
  if (stage === "deep")           return 60 + Math.round(pct * 0.35);  // 60–95 %
  if (stage === "search")         return  5 + Math.round(pct * 0.90);  //  5–95 %
  // PRODUCE stages
  if (stage === "reading")        return  5 + Math.round(pct * 0.10);  //  5–15 %
  if (stage === "csv_done")       return 15;
  if (stage === "sunat_validando") return 15 + Math.round(pct * 0.35); // 15–50 %
  if (stage === "sunat_done")     return 50;
  if (stage === "enrich")         return 50 + Math.round(pct * 0.45);  // 50–95 %
  if (stage === "enrich_done")    return 97;
  return 10;
}

function setProgressBar(pct) {
  progressBar.style.width = `${Math.min(100, Math.max(0, pct))}%`;
}

// ─── Loading state ────────────────────────────────────────────────────────────

function setLoading(isLoading) {
  searchBtn.disabled  = isLoading;
  searchBtn.textContent = isLoading ? "Buscando..." : "Buscar negocios";
  progress.classList.toggle("hidden", !isLoading);
  if (!isLoading) setProgressBar(0);
}

// ─── Resultados PRODUCE ───────────────────────────────────────────────────────

function showProduceResults(businesses) {
  allResults = businesses;

  const section = document.getElementById("results-section");
  const title   = document.getElementById("results-title");
  const filterBar = document.getElementById("filter-bar");

  title.textContent = `Directorio PRODUCE (${businesses.length} empresas)`;
  if (filterBar) filterBar.style.display = "none"; // filtros de Maps no aplican

  // Cambiar botón CSV para usar endpoint de PRODUCE
  if (exportCsvBtn) {
    exportCsvBtn.textContent = "Descargar CSV";
    exportCsvBtn.onclick = async (e) => {
      e.preventDefault();
      window.location.href = "/api/export/csv-produce?sid=" + encodeURIComponent(SCRAPPY_SESSION_ID);
    };
  }
  if (exportJsonBtn) exportJsonBtn.style.display = "none";

  // Renderizar tabla PRODUCE
  const thead = document.querySelector("#table-wrap table thead tr");
  const tbody = document.getElementById("results-body");
  if (!thead || !tbody) return;

  // Cabeceras específicas de PRODUCE
  thead.innerHTML = `
    <th>#</th>
    <th>Razón Social</th>
    <th>RUC</th>
    <th>CIIU</th>
    <th>Sector</th>
    <th>Distrito</th>
    <th>Gerente</th>
    <th>LinkedIn</th>
    <th>Teléfono</th>
    <th>WhatsApp</th>
    <th>Email</th>
    <th>Estado</th>
  `;

  tbody.innerHTML = "";
  businesses.forEach((b, i) => {
    const tr = document.createElement("tr");

    const statusBadge = b.enrichmentStatus === "encontrado"
      ? `<span style="color:#4ade80;font-size:.8rem">● encontrado</span>`
      : b.enrichmentStatus === "descartado"
      ? `<span style="color:#f87171;font-size:.8rem">✕ inactiva</span>`
      : b.enrichmentStatus === "sin_contacto"
      ? `<span style="color:#fb923c;font-size:.8rem">○ sin contacto</span>`
      : b.enrichmentStatus === "gerente_sin_contacto"
      ? `<span style="color:#fbbf24;font-size:.8rem">◐ gerente s/contacto</span>`
      : `<span style="color:#9ca3af;font-size:.8rem">· pendiente</span>`;

    const waLink = b.whatsapp
      ? `<a href="https://wa.me/${b.whatsapp.replace(/\D/g,'')}" target="_blank" style="color:#4ade80">WA</a>`
      : "-";

    const liLink = b.linkedinUrl
      ? `<a href="${escapeAttr(b.linkedinUrl)}" target="_blank" rel="noopener" style="color:#60a5fa">Ver perfil</a>`
      : "-";

    tr.innerHTML = `
      <td>${i + 1}</td>
      <td><strong>${escapeHtml(b.name)}</strong></td>
      <td style="font-size:.8rem;color:#9ca3af">${b.ruc || "-"}</td>
      <td>${b.ciuuCode || "-"}</td>
      <td>${escapeHtml(b.sector || "-")}</td>
      <td>${escapeHtml(b.distrito || "-")}</td>
      <td style="font-size:.85rem">${escapeHtml(b.gerente || "-")}</td>
      <td>${liLink}</td>
      <td>${escapeHtml(b.phone || "-")}</td>
      <td>${waLink}</td>
      <td>${escapeHtml(b.email || "-")}</td>
      <td>${statusBadge}</td>
    `;
    tbody.appendChild(tr);
  });

  section.classList.remove("hidden");
  setTimeout(() => section.scrollIntoView({ behavior: "smooth", block: "start" }), 100);
}

// ─── Mostrar resultados ───────────────────────────────────────────────────────

function showResults(businesses) {
  if (!businesses.length) {
    emptyState.classList.remove("hidden");
    clearSearchResults();
    return;
  }

  // Guardar la búsqueda más reciente en sessionStorage — sobrevive a un
  // F5 pero no a cerrar la pestaña, y cada búsqueda nueva pisa la anterior.
  saveSearchResults(businesses);

  // PRODUCE results go to a separate renderer
  if (businesses[0] && businesses[0].source === "produce_directory") {
    showProduceResults(businesses);
    return;
  }

  // Restaurar botones de exportación al modo Google Maps
  if (exportCsvBtn) {
    exportCsvBtn.textContent = "Descargar CSV";
    exportCsvBtn.onclick = null; // elimina el override de PRODUCE
  }
  if (exportJsonBtn) exportJsonBtn.style.display = "";

  // Compute audience + chain detection client-side as fallback
  // (server does this too, but frontend ensures data even if server is older)
  allResults = detectChainsClient(businesses);

  // Reset all filters on new search
  audienceFilter = "all"; chainsOnly = false; uniqueOnly = false;
  tierFilter = "all"; reviewPowerFilter = "all"; reputationFilter = "all";

  ["filter-audience", "filter-tier", "filter-review-power", "filter-reputation"].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.value = "all";
  });
  const chainsCb = document.getElementById("filter-chains-only");
  const uniqueCb = document.getElementById("filter-unique-only");
  if (chainsCb) chainsCb.checked = false;
  if (uniqueCb) uniqueCb.checked = false;

  renderTable(sortedResults());
  resultsSection.classList.remove("hidden");

  // Scroll suave hasta los resultados
  setTimeout(() => {
    resultsSection.scrollIntoView({ behavior: "smooth", block: "start" });
  }, 100);
}

// ─── Business Quality Score (0-100) fallback en frontend ────────────────────
function computeQualityScore(b) {
  let score = 0;
  if      (b.rating >= 4.5) score += 40;
  else if (b.rating >= 4.0) score += 28;
  else if (b.rating >= 3.5) score += 15;
  else if (b.rating > 0)    score += 5;
  if      (b.reviewsCount >= 200) score += 30;
  else if (b.reviewsCount >= 100) score += 22;
  else if (b.reviewsCount >= 50)  score += 15;
  else if (b.reviewsCount >= 10)  score += 5;
  if (b.website)   score += 15;
  if (b.instagram) score += 10;
  if (b.facebook)  score += 5;
  return Math.min(score, 100);
}

function qualityBadge(business) {
  const score = business.businessQualityScore ?? computeQualityScore(business);
  let cls, stars;
  if      (score >= 80) { cls = "quality-5"; stars = "★★★"; }
  else if (score >= 60) { cls = "quality-4"; stars = "★★"; }
  else if (score >= 40) { cls = "quality-3"; stars = "★"; }
  else if (score >= 20) { cls = "quality-2"; stars = "▲"; }
  else                  { cls = "quality-1"; stars = "·"; }
  return `<span class="quality-badge ${cls}">${score} ${stars}</span>`;
}

// ─── Contactability Score (0-5) fallback en frontend ────────────────────────
function computeScore(b) {
  let pts = 0;
  if (b.phone)     pts += 20;
  if (b.whatsapp)  pts += b.whatsappInferred ? 5 : 30;
  if (b.email)     pts += 20;
  if (b.instagram) pts += 20;
  if (b.website)   pts += 15;
  if (b.facebook)  pts += 10;


  if (pts === 0)  return 0;
  if (pts <= 20)  return 1;
  if (pts <= 45)  return 2;
  if (pts <= 70)  return 3;
  if (pts <= 95)  return 4;
  return 5;
}

// ─── Labels del score 0-5 ────────────────────────────────────────────────────
const SCORE_META = [
  { label: "Sin contacto", dots: "○○○○○" },
  { label: "Mínimo",       dots: "●○○○○" },
  { label: "Básico",       dots: "●●○○○" },
  { label: "Activo",       dots: "●●●○○" },
  { label: "Bueno",        dots: "●●●●○" },
  { label: "Completo",  dots: "●●●●●" },
];

function scoreBadge(score, business) {
  // Usar el valor del backend si existe; si no, calcularlo desde los campos
  const s = (score != null && score !== undefined)
    ? score
    : (business ? computeScore(business) : 0);
  const meta = SCORE_META[s] || SCORE_META[0];
  return `<span class="score-badge score-${s}">
    <span class="score-dots">${meta.dots}</span>
    ${s} ${meta.label}
  </span>`;
}

function renderTable(businesses) {
  // Restaurar headers de Google Maps (pueden haber sido sobrescritos por PRODUCE)
  const thead = document.querySelector("#table-wrap table thead tr");
  if (thead) {
    thead.innerHTML = `
      <th>#</th>
      <th class="th-intel" title="Lead Intelligence"></th>
      <th class="sortable" data-col="name">Nombre <span class="sort-icon"></span></th>
      <th class="sortable" data-col="category">Categoría <span class="sort-icon"></span></th>
      <th>Teléfono</th>
      <th>WhatsApp</th>
      <th>Email</th>
      <th>Instagram</th>
      <th>Web</th>
      <th class="sortable" data-col="rating">Rating <span class="sort-icon"></span></th>
      <th class="sortable" data-col="reviewsCount">Reseñas <span class="sort-icon"></span></th>
      <th class="sortable" data-col="businessQualityScore">Calidad <span class="sort-icon"></span></th>
      <th class="sortable" data-col="contactabilityScore">Contactabilidad <span class="sort-icon"></span></th>
      <th class="sortable" data-col="primaryContactChannel">Canal principal <span class="sort-icon"></span></th>
      <th class="sortable" data-col="reviewPower">Review Power <span class="sort-icon"></span></th>
      <th class="sortable" data-col="reputationScore">Reputación <span class="sort-icon"></span></th>
      <th class="sortable" data-col="opportunityScore">Opp. Score <span class="sort-icon"></span></th>
      <th class="sortable" data-col="opportunityTier">Opp. Tier <span class="sort-icon"></span></th>
      <th class="sortable" data-col="audience">Audience <span class="sort-icon"></span></th>
      <th class="sortable" data-col="businessGroup">Grupo <span class="sort-icon"></span></th>
      <th class="sortable" data-col="locationsCount">Sucursales <span class="sort-icon"></span></th>
      <th>Dirección</th>
      <th>Ubicación</th>
      <th>Búsqueda</th>
    `;
    // Re-registrar listeners de ordenamiento en los nuevos th
    thead.querySelectorAll("th.sortable").forEach(th => {
      th.addEventListener("click", () => {
        const col = th.dataset.col;
        if (sortState.col === col) {
          sortState.dir = sortState.dir === "desc" ? "asc" : "desc";
        } else {
          sortState.col = col;
          sortState.dir = "desc";
        }
        renderTable(sortedResults());
      });
    });
  }

  const total = allResults.length;
  const shown = businesses.length;
  resultsTitle.textContent = shown === total
    ? `Resultados (${total} leads)`
    : `Resultados (${shown} de ${total} leads)`;

  // Update export button label to reflect what will be exported
  const label = shown === total
    ? "Descargar CSV"
    : `Descargar CSV (${shown})`;
  if (exportCsvBtn) exportCsvBtn.textContent = label;

  resultsBody.innerHTML = "";

  businesses.forEach((business, index) => {
    const row = document.createElement("tr");

    const rating = business.rating ? `⭐ ${business.rating}` : "-";
    const reviews = business.reviewsCount ? business.reviewsCount.toLocaleString("es-PE") : "-";

    const categoryText = business.category
      ? `<span class="category-chip" title="${escapeAttr(business.category)}">${escapeHtml(business.category)}</span>`
      : `<span class="category-chip">-</span>`;

    row.innerHTML = `
      <td>${index + 1}</td>
      <td class="td-intel"><button class="intel-btn" title="Lead Intelligence">🔍</button></td>
      <td><strong>${escapeHtml(business.name)}</strong></td>
      <td>${categoryText}</td>
      <td>${escapeHtml(business.phone || "-")}</td>
      <td>${whatsappCell(business)}</td>
      <td>${emailCell(business.email)}</td>
      <td>${instagramCell(business.instagram)}</td>
      <td>${websiteCell(business)}</td>
      <td>${rating}</td>
      <td>${reviews}</td>
      <td>${qualityBadge(business)}</td>
      <td>${scoreBadge(business.contactabilityScore, business)}</td>
      <td>${primaryChannelBadge(business)}</td>
      <td>${reviewPowerCell(business)}</td>
      <td>${reputationCell(business)}</td>
      <td class="num-cell">${business.opportunityScore ?? computeOpportunityScore(business)}</td>
      <td>${opportunityTierCell(business)}</td>
      <td>${audienceCell(business.audience ?? computeAudience(business))}</td>
      <td>${escapeHtml(business.businessGroup || business.name || "-")}</td>
      <td>${chainCell(business)}</td>
      <td>${escapeHtml(business.address || "-")}</td>
      <td>${escapeHtml(business.searchLocation || "-")}</td>
      <td>${escapeHtml(business.searchQuery || "-")}</td>
    `;

    row.querySelector(".intel-btn").addEventListener("click", () => openLeadIntel(business));
    resultsBody.appendChild(row);
  });

  renderAlcancePanel(businesses);
  updateSortIcons();
  requestAnimationFrame(syncMirrorWidth);
}

// ─── Panel Alcance % ─────────────────────────────────────────────────────────

function renderAlcancePanel(businesses) {
  const n = businesses.length;
  if (!n) { contactSummary.innerHTML = ""; return; }

  const counts = {
    phone:     businesses.filter(b => b.phone).length,
    website:   businesses.filter(b => b.website).length,
    email:     businesses.filter(b => b.email).length,
    instagram: businesses.filter(b => b.instagram).length,
    whatsapp:  businesses.filter(b => b.whatsapp).length,
    waReal:    businesses.filter(b => b.whatsapp && !b.whatsappInferred).length,
  };

  const channels = [
    { key: "phone",     label: "Teléfono",  color: "#fbbf24", count: counts.phone },
    { key: "website",   label: "Web",       color: "#fb923c", count: counts.website },
    { key: "email",     label: "Email",     color: "#60a5fa", count: counts.email },
    { key: "instagram", label: "Instagram", color: "#a78bfa", count: counts.instagram },
    { key: "whatsapp",  label: "WhatsApp",  color: "#34d399",
      count: counts.whatsapp,
      sub: counts.waReal < counts.whatsapp
        ? `${counts.waReal} reales`
        : null },
  ];

  const items = channels.map(({ label, color, count, sub }) => {
    const pct  = Math.round((count / n) * 100);
    const subTxt = sub ? `<span class="alcance-count">(${sub})</span>` : "";
    return `
      <div class="alcance-item">
        <span class="alcance-label">${label}</span>
        <span class="alcance-pct">${pct}% <span class="alcance-count">${count}/${n}</span> ${subTxt}</span>
        <div class="alcance-bar-wrap">
          <div class="alcance-bar-fill" style="width:${pct}%;background:${color}"></div>
        </div>
      </div>`;
  }).join("");

  // Distribución de scores 0-5
  const scoreDist = [0,1,2,3,4,5].map(s => {
    const cnt = businesses.filter(b => (b.contactabilityScore ?? computeScore(b)) === s).length;
    if (!cnt) return "";
    return `<span class="score-badge score-${s}">${cnt} × nivel ${s}</span>`;
  }).filter(Boolean).join(" ");

  const deepCount = businesses.filter(b => b.deepScanned).length;
  const deepNote  = deepCount
    ? `<span class="pipeline-stat">${deepCount} con modo profundo</span>`
    : "";

  // Panel de métricas del pipeline
  let pipelineHtml = "";
  if (lastMetrics && lastMetrics.urlsFound) {
    const m = lastMetrics;
    const discardRate = m.urlsFound > 0
      ? Math.round((m.urlsDiscarded / m.urlsFound) * 100)
      : 0;
    pipelineHtml = `
      <div class="pipeline-metrics">
        <strong>Pipeline:</strong>
        <span class="pipeline-stat"><span class="hi">${m.urlsFound}</span> URLs encontradas</span>
        <span class="pipeline-stat"><span class="hi">${m.yieldQuickPass}</span> pasaron Quick scan</span>
        <span class="pipeline-stat"><span class="hi">${m.urlsDiscarded}</span> descartadas (${discardRate}%)</span>
        <span class="pipeline-stat"><span class="hi">${m.yieldFullExtract}</span> extraídos completos</span>
        ${m.pctWeb     != null ? `<span class="pipeline-stat">Web <span class="hi">${m.pctWeb}%</span></span>` : ""}
        ${m.pctEmail   != null ? `<span class="pipeline-stat">Email <span class="hi">${m.pctEmail}%</span></span>` : ""}
        ${m.pctWhatsApp != null ? `<span class="pipeline-stat">WA <span class="hi">${m.pctWhatsApp}%</span></span>` : ""}
        ${deepNote}
      </div>`;
  }

  // Audience summary
  const audienceTags = ["Web Opportunity", "Google Business Opportunity", "Web + Google Business Opportunity"];
  const audienceSummary = audienceTags.map(tag => {
    const cnt = businesses.filter(b => (b.audience ?? computeAudience(b)).includes(tag)).length;
    if (!cnt) return "";
    const meta = AUDIENCE_META[tag] || { cls: "aud-other", icon: "·" };
    return `<span class="audience-badge ${meta.cls}">${meta.icon} ${tag} <strong>${cnt}</strong></span>`;
  }).filter(Boolean).join(" ");

  const chainCount   = businesses.filter(b => b.isChain).length;
  const uniqueGroups = new Set(businesses.map(b => b.businessGroup || b.name)).size;
  const chainSummary = chainCount
    ? `<span class="chain-badge" style="font-size:.72rem">⛓ ${chainCount} en cadenas · ${uniqueGroups} empresas únicas</span>`
    : "";

  contactSummary.innerHTML = `
    <div class="alcance-panel">
      <div style="width:100%;font-size:.8rem;font-weight:600;color:#94a3b8;margin-bottom:2px">
        Alcance de tu base (${n} leads)
      </div>
      ${items}
      <div class="score-dist" style="width:100%">
        <span class="score-dist-label">Contactabilidad:</span>
        ${scoreDist}
      </div>
      ${audienceSummary ? `<div style="width:100%;margin-top:6px;display:flex;flex-wrap:wrap;gap:4px"><span class="score-dist-label">Audiences:</span>${audienceSummary}${chainSummary ? ` ${chainSummary}` : ""}</div>` : ""}
    </div>
    ${pipelineHtml}`;
}

// ─── Columnas ordenables ─────────────────────────────────────────────────────

document.querySelectorAll("th.sortable").forEach(th => {
  th.addEventListener("click", () => {
    const col = th.dataset.col;
    if (sortState.col === col) {
      sortState.dir = sortState.dir === "desc" ? "asc" : "desc";
    } else {
      sortState.col = col;
      sortState.dir = "desc";
    }
    renderTable(sortedResults());
  });
});

function applyFilters(businesses) {
  let result = businesses;

  if (audienceFilter === "none") {
    result = result.filter(b => !(b.audience ?? computeAudience(b)));
  } else if (audienceFilter !== "all") {
    result = result.filter(b => (b.audience ?? computeAudience(b)).includes(audienceFilter));
  }

  if (chainsOnly) {
    result = result.filter(b => b.isChain);
  }

  if (uniqueOnly) {
    const seen = new Set();
    result = result.filter(b => {
      const key = b.businessGroup || b.name;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }

  if (tierFilter !== "all") {
    result = result.filter(b =>
      (b.opportunityTier ?? computeOpportunityTier(b)) === tierFilter
    );
  }

  if (reviewPowerFilter !== "all") {
    result = result.filter(b =>
      (b.reviewPower ?? computeReviewPower(b)) === reviewPowerFilter
    );
  }

  if (reputationFilter !== "all") {
    result = result.filter(b =>
      (b.reputationScore ?? computeReputationScore(b)) === reputationFilter
    );
  }

  return result;
}

function sortedResults() {
  if (!allResults.length) return allResults;
  const { col, dir } = sortState;

  return applyFilters([...allResults].sort((a, b) => {
    let va, vb;
    if (col === "contactabilityScore") {
      va = a[col] ?? computeScore(a);
      vb = b[col] ?? computeScore(b);
    } else if (col === "businessQualityScore") {
      va = a[col] ?? computeQualityScore(a);
      vb = b[col] ?? computeQualityScore(b);
    } else {
      va = a[col] ?? (typeof a[col] === "number" ? -Infinity : "");
      vb = b[col] ?? (typeof b[col] === "number" ? -Infinity : "");
    }
    if (typeof va === "string") va = va.toLowerCase();
    if (typeof vb === "string") vb = vb.toLowerCase();
    if (va < vb) return dir === "asc" ? -1 : 1;
    if (va > vb) return dir === "asc" ? 1 : -1;
    return 0;
  }));
}

function updateSortIcons() {
  document.querySelectorAll("th.sortable").forEach(th => {
    th.classList.remove("sort-asc", "sort-desc");
    if (th.dataset.col === sortState.col) {
      th.classList.add(sortState.dir === "asc" ? "sort-asc" : "sort-desc");
    }
  });
}

// ─── Celdas de contacto ───────────────────────────────────────────────────────

function whatsappCell(business) {
  if (!business.whatsapp) return "-";
  const label = business.whatsapp.replace("https://wa.me/", "+");
  const link = `<a class="contact-link" href="${escapeAttr(business.whatsapp)}" target="_blank" rel="noopener">${escapeHtml(label)}</a>`;
  if (business.whatsappInferred) return `${link}<span class="contact-inferred">desde celular</span>`;
  return link;
}

function emailCell(email) {
  if (!email) return "-";
  return `<a class="contact-link" href="mailto:${escapeAttr(email)}">${escapeHtml(email)}</a>`;
}

function instagramCell(value) {
  if (!value) return "-";
  const handle = value.startsWith("@") ? value.slice(1) : value;
  const url = value.startsWith("http") ? value : `https://instagram.com/${handle}`;
  return `<a class="contact-link" href="${escapeAttr(url)}" target="_blank" rel="noopener">${escapeHtml(value.startsWith("@") ? value : `@${handle}`)}</a>`;
}


function websiteCell(business) {
  const url = business.website;
  if (!url) return "-";

  let label = url.replace(/^https?:\/\//, "").replace(/\/$/, "");
  if (label.length > 26) label = `${label.slice(0, 26)}…`;

  const effectiveStatus = business.websiteStatus ?? (url ? "online" : "missing");
  const statusDot = effectiveStatus === "online"
    ? `<span class="web-status web-online" title="Online"></span>`
    : effectiveStatus === "offline"
    ? `<span class="web-status web-offline" title="No responde"></span>`
    : "";

  const formTag = business.hasContactForm
    ? `<span class="web-form-tag" title="Tiene formulario de contacto">+form</span>`
    : "";

  return `<a class="contact-link" href="${escapeAttr(url)}" target="_blank" rel="noopener">${escapeHtml(label)}</a>${statusDot}${formTag}`;
}

const CHANNEL_META = {
  whatsapp:  { icon: "💬", label: "WhatsApp",  cls: "channel-whatsapp"  },
  email:     { icon: "✉️",  label: "Email",     cls: "channel-email"     },
  instagram: { icon: "📷", label: "Instagram", cls: "channel-instagram" },
  phone:     { icon: "📞", label: "Teléfono",  cls: "channel-phone"     },
  website:   { icon: "🌐", label: "Web",       cls: "channel-website"   },
};

function computePrimaryChannel(b) {
  if (b.whatsapp)  return "whatsapp";
  if (b.email)     return "email";
  if (b.instagram) return "instagram";
  if (b.phone)     return "phone";
  if (b.website)   return "website";
  return null;
}

function primaryChannelBadge(business) {
  const channel = business.primaryContactChannel ?? computePrimaryChannel(business);
  if (!channel) return "-";
  const meta = CHANNEL_META[channel] || { icon: "·", label: channel, cls: "channel-website" };
  return `<span class="channel-badge ${meta.cls}">${meta.icon} ${meta.label}</span>`;
}

// ─── Audience Classification (frontend fallback — mirrors classify.js) ────────

function computeAudience(b) {
  const score = typeof b.contactabilityScore === "number"
    ? b.contactabilityScore
    : computeScore(b);

  if (!b.website && score > 1)  return "Web Opportunity";
  if (b.website  && score <= 1) return "Google Business Opportunity";
  if (!b.website && score <= 1) return "Web + Google Business Opportunity";
  return "";
}

function computeReviewPower(b) {
  const r = b.reviewsCount;
  if (r === null || r === undefined || r === 0) return "No Data";
  if (r <= 20)  return "Low";
  if (r <= 100) return "Medium";
  if (r <= 300) return "High";
  return "Very High";
}

function computeReputationScore(b) {
  const { rating, reviewsCount } = b;
  if (!rating || reviewsCount === null || reviewsCount === undefined) return "Sin datos";
  if (rating >= 4.5 && reviewsCount > 100) return "Excelente";
  if (rating >= 4.0 && reviewsCount > 20)  return "Buena";
  return "Regular";
}

function computeOpportunityScore(b) {
  let s = 0;
  if (!b.website)                   s += 40;
  if ((b.reviewsCount || 0) > 100)  s += 20;
  if (b.instagram)                   s += 15;
  if ((b.rating || 0) >= 4.5)       s += 10;
  if (b.whatsapp)                    s += 10;
  if (b.email)                       s +=  5;
  return Math.min(s, 100);
}

function computeOpportunityTier(b) {
  const score = typeof b.opportunityScore === "number"
    ? b.opportunityScore
    : computeOpportunityScore(b);
  if (score >= 80) return "A";
  if (score >= 60) return "B";
  if (score >= 40) return "C";
  return "D";
}

// ─── Chain Detection (frontend fallback — union-find on full array) ───────────

function normalizeUrl(url) {
  if (!url) return null;
  return url.toLowerCase().replace(/^https?:\/\//, "").replace(/^www\./, "").replace(/\/$/, "").trim();
}
function normalizePhone(p) {
  if (!p) return null;
  const digits = p.replace(/\D/g, "");
  return digits.length >= 7 ? digits : null;
}

function detectChainsClient(businesses) {
  const n = businesses.length;
  const parent = Array.from({ length: n }, (_, i) => i);
  function find(x) { if (parent[x] !== x) parent[x] = find(parent[x]); return parent[x]; }
  function union(x, y) { const px = find(x), py = find(y); if (px !== py) parent[px] = py; }

  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      const bi = businesses[i], bj = businesses[j];
      const wi = normalizeUrl(bi.website),   wj = normalizeUrl(bj.website);
      const pi = normalizePhone(bi.phone),   pj = normalizePhone(bj.phone);
      if ((wi && wj && wi === wj) || (pi && pj && pi === pj)) union(i, j);
    }
  }

  const groupMap = new Map();
  for (let i = 0; i < n; i++) {
    const root = find(i);
    if (!groupMap.has(root)) groupMap.set(root, []);
    groupMap.get(root).push(i);
  }

  function commonPrefix(names) {
    if (names.length === 1) return names[0];
    const words = names.map(nm => nm.split(/\s+/));
    const first = words[0];
    const common = [];
    for (let i = 0; i < first.length; i++) {
      if (words.every(arr => arr[i] && arr[i].toLowerCase() === first[i].toLowerCase())) common.push(first[i]);
      else break;
    }
    return common.length ? common.join(" ") : names.reduce((a, b) => a.length <= b.length ? a : b);
  }

  return businesses.map((b, i) => {
    const root  = find(i);
    const group = groupMap.get(root);
    const isChain = group.length > 1;
    const oppScore = b.opportunityScore ?? computeOpportunityScore(b);
    return {
      ...b,
      audience:        b.audience        ?? computeAudience(b),
      businessGroup:   b.businessGroup   ?? (isChain ? commonPrefix(group.map(idx => businesses[idx].name)) : b.name),
      locationsCount:  b.locationsCount  ?? group.length,
      isChain:         b.isChain         ?? isChain,
      reviewPower:     b.reviewPower     ?? computeReviewPower(b),
      reputationScore: b.reputationScore ?? computeReputationScore(b),
      opportunityScore: oppScore,
      opportunityTier: b.opportunityTier ?? computeOpportunityTier({ ...b, opportunityScore: oppScore }),
    };
  });
}

// ─── Audience & Chain renderers ───────────────────────────────────────────────

const AUDIENCE_META = {
  "Web Opportunity":               { cls: "aud-web",     icon: "🌐" },
  "Google Business Opportunity":   { cls: "aud-gbiz",    icon: "📍" },
  "Web + Google Business Opportunity": { cls: "aud-both", icon: "⭐" },
};

function audienceCell(audience) {
  if (!audience) return `<span class="aud-none">—</span>`;
  return audience.split("; ").map(tag => {
    const meta = AUDIENCE_META[tag] || { cls: "aud-other", icon: "·" };
    return `<span class="audience-badge ${meta.cls}" title="${tag}">${meta.icon} ${tag}</span>`;
  }).join(" ");
}

function chainCell(business) {
  const count = business.locationsCount ?? 1;
  if (!business.isChain) return `<span class="chain-single" title="Empresa única">1</span>`;
  return `<span class="chain-badge" title="${count} sucursales">⛓ ${count}</span>`;
}

// ─── Lead Scoring Renderers ───────────────────────────────────────────────────

const REVIEW_POWER_META = {
  "Very High": { cls: "rp-veryhigh", icon: "🔥" },
  "High":      { cls: "rp-high",     icon: "📈" },
  "Medium":    { cls: "rp-medium",   icon: "📊" },
  "Low":       { cls: "rp-low",      icon: "📉" },
  "No Data":   { cls: "rp-nodata",   icon: "—"  },
};

function reviewPowerCell(business) {
  const rp   = business.reviewPower ?? computeReviewPower(business);
  const meta = REVIEW_POWER_META[rp] || REVIEW_POWER_META["No Data"];
  return `<span class="rp-badge ${meta.cls}">${meta.icon} ${rp}</span>`;
}

const REPUTATION_META = {
  "Excelente": { cls: "rep-excelente", icon: "🌟" },
  "Buena":     { cls: "rep-buena",     icon: "👍" },
  "Regular":   { cls: "rep-regular",   icon: "🔸" },
  "Sin datos": { cls: "rep-nodata",    icon: "—"  },
};

function reputationCell(business) {
  const rep  = business.reputationScore ?? computeReputationScore(business);
  const meta = REPUTATION_META[rep] || REPUTATION_META["Sin datos"];
  return `<span class="rep-badge ${meta.cls}">${meta.icon} ${rep}</span>`;
}

const TIER_META = {
  A: { cls: "tier-a", label: "🏆 A" },
  B: { cls: "tier-b", label: "⭐ B" },
  C: { cls: "tier-c", label: "📊 C" },
  D: { cls: "tier-d", label: "📉 D" },
};

function opportunityTierCell(business) {
  const score = business.opportunityScore ?? computeOpportunityScore(business);
  const tier  = business.opportunityTier  ?? computeOpportunityTier({ ...business, opportunityScore: score });
  const meta  = TIER_META[tier] || TIER_META.D;
  return `<span class="tier-badge ${meta.cls}" title="Opp. Score: ${score}">${meta.label} <small>${score}</small></span>`;
}

function escapeHtml(text) {
  const div = document.createElement("div");
  div.textContent = text;
  return div.innerHTML;
}

function escapeAttr(text) {
  return String(text)
    .replace(/&/g, "&amp;").replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

// ─── Exportar (client-side, respeta filtros activos) ─────────────────────────

/**
 * Convierte un business en una fila plana para CSV/Excel.
 * Usa los mismos fallbacks del frontend para garantizar que nunca
 * haya un campo vacío cuando la información sí existe.
 */
function buildExportRow(b) {
  const score     = b.contactabilityScore  ?? computeScore(b);
  const quality   = b.businessQualityScore ?? computeQualityScore(b);
  const channel   = b.primaryContactChannel ?? computePrimaryChannel(b) ?? "";
  const audience  = b.audience ?? computeAudience(b);
  const group     = b.businessGroup || b.name || "";
  const locations = b.locationsCount ?? 1;
  const date      = b.scrapedAt ? new Date(b.scrapedAt).toLocaleString("es-PE") : "";

  return {
    Nombre:                  b.name || "",
    Dirección:               b.address || "",
    Teléfono:                b.phone || "",
    WhatsApp:                b.whatsapp || "",
    "WhatsApp inferido":     b.whatsappInferred ? "Sí" : "",
    Email:                   b.email || "",
    Instagram:               b.instagram || "",
    Facebook:                b.facebook || "",
    "Sitio Web":             b.website || "",
    "Contactabilidad (0-5)": score,
    "Calidad (0-100)":       quality,
    "Canal principal":       channel,
    Calificación:            b.rating ?? "",
    Reseñas:                 b.reviewsCount ?? "",
    Categoría:               b.category || "",
    "Review Power":          b.reviewPower     ?? computeReviewPower(b),
    "Reputation Score":      b.reputationScore ?? computeReputationScore(b),
    "Opportunity Score":     b.opportunityScore ?? computeOpportunityScore(b),
    "Opportunity Tier":      b.opportunityTier  ?? computeOpportunityTier({ ...b, opportunityScore: b.opportunityScore ?? computeOpportunityScore(b) }),
    Audience:                audience,
    Opportunity:             audience || "-",
    "Grupo empresarial":     group,
    "Locations Count":       locations,
    "Es cadena":             b.isChain ? "Sí" : "No",
    "Web status":            b.websiteStatus || "",
    "Formulario contacto":   b.hasContactForm ? "Sí" : "",
    Horario:                 b.hours || "",
    Ubicación:               b.searchLocation || "",
    Búsqueda:                b.searchQuery || "",
    "URL Google Maps":       b.googleMapsUrl || "",
    "Fecha Scraping":        date,
  };
}

function toCsvString(businesses) {
  if (!businesses.length) return "";
  const rows    = businesses.map(buildExportRow);
  const headers = Object.keys(rows[0]);
  const escape  = v => {
    const t = String(v ?? "");
    return (t.includes(",") || t.includes('"') || t.includes("\n"))
      ? `"${t.replace(/"/g, '""')}"` : t;
  };
  return "\uFEFF" + [
    headers.join(","),
    ...rows.map(r => headers.map(h => escape(r[h])).join(",")),
  ].join("\n");
}

function downloadBlob(content, filename, mime) {
  const blob = new Blob([content], { type: mime });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement("a");
  a.href = url; a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function exportTimestamp() {
  return new Date().toISOString().slice(0, 10);
}

exportCsvBtn.addEventListener("click", () => {
  const data = sortedResults();
  if (!data.length) return;
  downloadBlob(toCsvString(data), `scrappy_${exportTimestamp()}.csv`, "text/csv;charset=utf-8");
});

exportJsonBtn.addEventListener("click", () => {
  const data = sortedResults();
  if (!data.length) return;
  downloadBlob(JSON.stringify(data, null, 2), `scrappy_${exportTimestamp()}.json`, "application/json");
});

// ─── Filter bar listeners ─────────────────────────────────────────────────────

// ─── Filter bar — dropdown listeners ─────────────────────────────────────────

function wireSelect(id, setter) {
  document.getElementById(id)?.addEventListener("change", e => {
    setter(e.target.value);
    renderTable(sortedResults());
  });
}

wireSelect("filter-audience",     v => { audienceFilter    = v; });
wireSelect("filter-tier",         v => { tierFilter        = v; });
wireSelect("filter-review-power", v => { reviewPowerFilter = v; });
wireSelect("filter-reputation",   v => { reputationFilter  = v; });

document.getElementById("filter-chains-only")?.addEventListener("change", e => {
  chainsOnly = e.target.checked;
  renderTable(sortedResults());
});

document.getElementById("filter-unique-only")?.addEventListener("change", e => {
  uniqueOnly = e.target.checked;
  renderTable(sortedResults());
});

// ─── Scroll horizontal: arrastrar + barra espejo arriba ──────────────────────

const tableWrap     = document.getElementById("table-wrap");
const mirrorWrap    = document.getElementById("scroll-mirror-wrap");
const mirrorInner   = document.getElementById("scroll-mirror-inner");

/** Sincroniza el ancho del espejo con la tabla real */
function syncMirrorWidth() {
  const tableEl = tableWrap.querySelector("table");
  if (!tableEl) return;
  mirrorInner.style.width = tableEl.scrollWidth + "px";
}

/** Sincronización bidireccional de scroll */
let syncingFromMirror = false;
let syncingFromTable  = false;

mirrorWrap.addEventListener("scroll", () => {
  if (syncingFromTable) return;
  syncingFromMirror = true;
  tableWrap.scrollLeft = mirrorWrap.scrollLeft;
  syncingFromMirror = false;
});

tableWrap.addEventListener("scroll", () => {
  if (syncingFromMirror) return;
  syncingFromTable = true;
  mirrorWrap.scrollLeft = tableWrap.scrollLeft;
  syncingFromTable = false;
});

/** Drag-to-scroll con el mouse */
let dragStartX   = 0;
let dragScrollX  = 0;
let isDragging   = false;

tableWrap.addEventListener("mousedown", (e) => {
  // No interferir con clics en links o botones
  if (e.target.closest("a, button, input, select")) return;
  isDragging  = true;
  dragStartX  = e.pageX;
  dragScrollX = tableWrap.scrollLeft;
  tableWrap.classList.add("dragging");
  e.preventDefault();
});

window.addEventListener("mousemove", (e) => {
  if (!isDragging) return;
  const delta = dragStartX - e.pageX;
  tableWrap.scrollLeft = dragScrollX + delta;
});

window.addEventListener("mouseup", () => {
  if (!isDragging) return;
  isDragging = false;
  tableWrap.classList.remove("dragging");
});

// Sincronizar al cargar/redimensionar la ventana
window.addEventListener("resize", syncMirrorWidth);

// ═══════════════════════════════════════════════════════════════════════════════
// LEAD INTELLIGENCE
// ═══════════════════════════════════════════════════════════════════════════════

const liModal    = document.getElementById("li-modal");
const liBackdrop = document.getElementById("li-backdrop");
const liCloseBtn = document.getElementById("li-close-btn");
const liCopyBtn  = document.getElementById("li-copy-btn");
const liRegenBtn = document.getElementById("li-regen-btn");
const liSyncEl   = document.getElementById("li-sync-status");

let liCurrentBiz = null; // negocio mostrado actualmente en el modal

liBackdrop?.addEventListener("click", closeLeadIntel);
liCloseBtn?.addEventListener("click",  closeLeadIntel);
document.addEventListener("keydown", e => { if (e.key === "Escape") closeLeadIntel(); });

liCopyBtn?.addEventListener("click", () => {
  const text = document.getElementById("li-outreach")?.textContent || "";
  navigator.clipboard.writeText(text).then(() => {
    liCopyBtn.textContent = "✅ Copiado";
    setTimeout(() => { liCopyBtn.textContent = "📋 Copiar"; }, 2000);
  });

  if (!liCurrentBiz) return;
  fetch('/api/crm/leads/copy', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ business: liCurrentBiz, message: text }),
  })
  .then(r => r.json())
  .then(result => {
    if (!result.ok) {
      if (result.reason === 'no-phone') showLiSync('No se guardó en el CRM: el negocio no tiene teléfono.', 'warn');
      return;
    }
    const etapaMsg = result.etapaChanged
      ? `Etapa → "${result.lead.etapa}"`
      : `Etapa sin cambios ("${result.lead.etapa}")`;
    showLiSync(
      (result.sheetSynced ? '✓ Guardado en CRM y Sheets — ' : '⚠ Guardado en CRM (Sheets no sincronizó) — ') + etapaMsg,
      result.sheetSynced ? 'ok' : 'warn'
    );
  })
  .catch(() => showLiSync('No se pudo guardar en el CRM.', 'err'));
});

liRegenBtn?.addEventListener("click", () => {
  if (!liCurrentBiz) return;
  generateOutreach(liCurrentBiz, true);
});

function showLiSync(msg, type) {
  if (!liSyncEl) return;
  liSyncEl.textContent = msg;
  liSyncEl.hidden = false;
  liSyncEl.className = "li-sync-status " + (type || "");
}

function generateOutreach(biz, regenerate) {
  const outreachEl = document.getElementById("li-outreach");
  const copyBtn    = document.getElementById("li-copy-btn");
  outreachEl.textContent = regenerate ? "✨ Regenerando mensaje..." : "✨ Generando mensaje personalizado...";
  if (copyBtn)    copyBtn.disabled = true;
  if (liRegenBtn) liRegenBtn.disabled = true;
  if (liSyncEl)   liSyncEl.hidden = true;

  return fetch('/api/outreach', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ business: biz, bd: loadBD(), regenerate: Boolean(regenerate) }),
  })
  .then(r => r.json())
  .then(result => {
    outreachEl.textContent = result.error
      ? buildSuggestedNarrative(biz)   // fallback to template
      : result.message;
    if (copyBtn) copyBtn.disabled = false;
  })
  .catch(() => {
    outreachEl.textContent = buildSuggestedNarrative(biz);
    if (copyBtn) copyBtn.disabled = false;
  })
  .finally(() => {
    if (liRegenBtn) liRegenBtn.disabled = false;
  });
}

function closeLeadIntel() {
  if (liModal) { liModal.hidden = true; document.body.style.overflow = ""; }
}

function openLeadIntel(biz) {
  if (!liModal) return;

  liCurrentBiz = biz;

  biz.audience         = biz.audience         ?? computeAudience(biz);
  biz.opportunityScore = biz.opportunityScore  ?? computeOpportunityScore(biz);
  biz.opportunityTier  = biz.opportunityTier   ?? computeOpportunityTier(biz);
  biz.reviewPower      = biz.reviewPower       ?? computeReviewPower(biz);
  biz.reputationScore  = biz.reputationScore   ?? computeReputationScore(biz);

  // Header
  document.getElementById("li-biz-name").textContent = biz.name || "";
  const metaParts = [];
  if (biz.category)      metaParts.push(biz.category);
  if (biz.searchLocation) metaParts.push(biz.searchLocation);
  document.getElementById("li-biz-meta").textContent = metaParts.join(" · ");

  // Section 1: Overview grid
  document.getElementById("li-overview").innerHTML = buildOverview(biz);

  // Section 2: Signals
  document.getElementById("li-signals").innerHTML = buildSignals(biz);

  // Section 3: Core Asset + Bottleneck (1-liners)
  document.getElementById("li-core-asset").textContent    = buildCoreAssetLine(biz);
  document.getElementById("li-bottleneck-line").textContent = buildBottleneckLine(biz);

  // Section 4: Suggested Narrative — LLM-powered with fallback, cacheado por teléfono
  generateOutreach(biz, false);

  liModal.hidden = false;
  document.body.style.overflow = "hidden";
  liModal.querySelector(".li-panel-body").scrollTop = 0;
}

// ─── Overview grid ────────────────────────────────────────────────────────────

function buildOverview(b) {
  const tier  = b.opportunityTier  || computeOpportunityTier(b);
  const score = b.opportunityScore ?? computeOpportunityScore(b);
  const rp    = b.reviewPower      || computeReviewPower(b);
  const rep   = b.reputationScore  || computeReputationScore(b);

  const items = [
    ["Categoría",       b.category        || "—"],
    ["Dirección",       b.address         || "—"],
    ["Rating",          b.rating          ? `⭐ ${b.rating}` : "—"],
    ["Reseñas",         b.reviewsCount    ? b.reviewsCount.toLocaleString("es-PE") : "—"],
    ["Review Power",    rp                || "—"],
    ["Reputación",      rep               || "—"],
    ["Opp. Score",      score !== null && score !== undefined ? `${score}/100` : "—"],
    ["Opp. Tier",       tier              || "—"],
    ["Website",         b.website         ? `<a href="${escapeAttr(b.website)}" target="_blank" rel="noopener">${escapeHtml(b.website)}</a>` : "—"],
    ["Instagram",       b.instagram       ? `<a href="${escapeAttr('https://instagram.com/'+b.instagram.replace(/^@/,''))}" target="_blank" rel="noopener">${escapeHtml(b.instagram)}</a>` : "—"],
    ["WhatsApp",        b.whatsapp        ? `<a href="https://wa.me/${b.whatsapp.replace(/\D/g,'')}" target="_blank" rel="noopener">${escapeHtml(b.whatsapp)}</a>` : "—"],
    ["Email",           b.email           ? `<a href="mailto:${escapeAttr(b.email)}">${escapeHtml(b.email)}</a>` : "—"],
    ["Sedes",           (b.locationsCount || 1).toString()],
    ["Es cadena",       b.isChain         ? "Sí" : "No"],
    ["Audience",        b.audience        || "—"],
    ["Scraped",         new Date().toLocaleDateString("es-PE")],
  ];

  return items.map(([label, val]) =>
    `<div class="li-ov-item">
       <span class="li-ov-label">${label}</span>
       <span class="li-ov-value">${val}</span>
     </div>`
  ).join("");
}

// ─── Hidden Signals ───────────────────────────────────────────────────────────

function buildSignals(b) {
  const signals = detectSignals(b);
  if (!signals.length) return `<span class="li-signal li-sig-neutral">Sin señales detectadas</span>`;
  return signals.map(s =>
    `<span class="li-signal li-sig-${s.type}">${s.icon} ${s.text}</span>`
  ).join("");
}

function detectSignals(b) {
  const signals = [];
  const r  = b.reviewsCount;
  const rt = b.rating;
  const ws = b.website_status || b.websiteStatus;

  if (r > 300)                       signals.push({ text: "Alto volumen de reseñas",       icon: "🔥", type: "positive"     });
  else if (r > 100)                  signals.push({ text: "Más de 100 reseñas",             icon: "📊", type: "positive"     });
  else if (r > 0 && r <= 20)         signals.push({ text: "Pocas reseñas",                  icon: "📉", type: "neutral"      });

  if (rt >= 4.5)                     signals.push({ text: `Rating superior a ${rt}⭐`,       icon: "⭐", type: "positive"     });
  else if (rt && rt < 4.0)           signals.push({ text: "Rating por mejorar",              icon: "⚠️", type: "warning"     });

  if (!b.website)                    signals.push({ text: "Sin sitio web",                  icon: "🌐", type: "opportunity"  });
  if (ws === "offline")              signals.push({ text: "Web caída o con errores",         icon: "🔴", type: "warning"     });
  if (ws === "online" && b.has_contact_form) signals.push({ text: "Tiene formulario de contacto", icon: "📝", type: "positive" });

  if (b.instagram)                   signals.push({ text: "Instagram activo",               icon: "📸", type: "positive"     });
  if (b.facebook)                    signals.push({ text: "Facebook presente",               icon: "👥", type: "info"        });

  const locs = b.locationsCount || 1;
  if (locs > 1)                      signals.push({ text: `Múltiples sedes (${locs})`,       icon: "📍", type: "info"        });

  if (b.whatsapp && !b.website && !b.email)
                                     signals.push({ text: "Dependencia de WhatsApp",         icon: "💬", type: "opportunity" });
  if (b.instagram && !b.website)     signals.push({ text: "Dependencia de Instagram",        icon: "📱", type: "opportunity" });
  if (!b.website && !b.email)        signals.push({ text: "Presencia digital incompleta",    icon: "🔴", type: "warning"     });
  if (b.website && !b.instagram && !b.email && !b.whatsapp)
                                     signals.push({ text: "Web sin canales de contacto",     icon: "⚠️", type: "warning"     });

  return signals;
}

function startsWithVowel(s) { return /^[aeiouáéíóúAEIOUÁÉÍÓÚ]/.test(s); }

// ═══════════════════════════════════════════════════════════════════════════════
// SIMPLIFIED LEAD INTELLIGENCE — Core Asset · Bottleneck · Suggested Narrative
// ═══════════════════════════════════════════════════════════════════════════════

function buildCoreAssetLine(b) {
  const r    = b.reviewsCount || 0;
  const rt   = b.rating       || 0;
  const locs = b.locationsCount || 1;
  const chain = b.isChain && locs > 1;

  if (r > 300 && rt >= 4.5)  return `${r.toLocaleString("es-PE")} reseñas con ${rt}⭐ en Google — reputación consolidada.`;
  if (r > 100 && rt >= 4.5)  return `${r.toLocaleString("es-PE")} reseñas y ${rt}⭐ — confianza real construida con tiempo.`;
  if (r > 50  && rt >= 4.0)  return `${r.toLocaleString("es-PE")} reseñas y ${rt}⭐ en Google — demanda activa validada.`;
  if (r > 20  && rt)         return `${r.toLocaleString("es-PE")} reseñas con ${rt}⭐ — negocio con clientes reales y reputación creciente.`;
  if (chain)                 return `${locs} sedes operativas bajo la misma marca — crecimiento demostrado.`;
  if (b.instagram && r > 0)  return `${r.toLocaleString("es-PE")} reseñas en Google más comunidad activa en Instagram.`;
  if (b.instagram)           return `Comunidad activa en Instagram — clientes que siguen y recomiendan el negocio.`;
  if (r > 0)                 return `${r.toLocaleString("es-PE")} reseñas en Google — presencia establecida y clientes satisfechos.`;
  if (rt)                    return `${rt}⭐ en Google — calificación que demuestra calidad de servicio.`;
  return "Presencia establecida en Google Maps con visibilidad orgánica local.";
}

function buildBottleneckLine(b) {
  const locs  = b.locationsCount || 1;
  const chain = b.isChain && locs > 1;

  if (!b.website && b.whatsapp && b.instagram) return "Todo el contacto pasa por WhatsApp e Instagram — sin un lugar centralizado donde reservar.";
  if (!b.website && b.whatsapp)                return "Las consultas y reservas dependen de que alguien responda WhatsApp en el momento.";
  if (!b.website && b.instagram)               return "La presencia depende de Instagram — sin lugar propio donde convertir visitas en clientes.";
  if (!b.website && !b.whatsapp && !b.instagram) return "Fuera de Google Maps, no hay forma directa de encontrarlos o contactarlos.";
  if (chain && !b.website)                     return `${locs} sedes sin presencia unificada — cada ubicación capta por separado.`;
  if (b.website && !b.email && !b.whatsapp)    return "El sitio web no tiene un punto de contacto directo para convertir visitas.";
  if (b.website && !b.instagram)               return "Sin presencia visual activa — difícil llegar a clientes que aún no los conocen.";
  return "La captación de clientes nuevos depende principalmente del boca a boca.";
}

function buildSuggestedNarrative(b) {
  const name  = b.name || "su negocio";
  const r     = b.reviewsCount;
  const rt    = b.rating;
  const locs  = b.locationsCount || 1;
  const chain = b.isChain && locs > 1;
  const cat   = (b.category || "negocio").toLowerCase();

  // ── ACTIVO ─────────────────────────────────────────────────────────────────
  let activo;
  if (r > 100 && rt >= 4.5)
    activo = `Tienen ${r.toLocaleString("es-PE")} reseñas y ${rt}⭐ en Google. Eso demuestra que hay clientes reales que confían en ustedes y los recomiendan.`;
  else if (r > 50 && rt)
    activo = `Tienen ${r.toLocaleString("es-PE")} reseñas y ${rt}⭐ en Google. Eso es una señal clara de un negocio con demanda real y clientes satisfechos.`;
  else if (r > 20 && rt)
    activo = `Vi que tienen ${r.toLocaleString("es-PE")} reseñas y ${rt}⭐ en Google — suficiente para saber que hay clientes que eligen y valoran ${name}.`;
  else if (chain)
    activo = `Tienen ${locs} sedes operativas${rt ? ` y ${rt}⭐ en Google` : ""} — eso habla de un negocio que sabe crecer.`;
  else if (b.instagram && r)
    activo = `Tienen ${r.toLocaleString("es-PE")} reseñas en Google y actividad constante en Instagram. Eso muestra un negocio presente y con clientes que los siguen.`;
  else if (r)
    activo = `Tienen ${r.toLocaleString("es-PE")} reseñas en Google${rt ? ` y ${rt}⭐` : ""}. Hay clientes reales que los eligen y se toman el tiempo de recomendarlos.`;
  else
    activo = `Vi el perfil de ${name} en Google — se nota que es un negocio establecido con presencia en la zona.`;

  // ── OPORTUNIDAD ────────────────────────────────────────────────────────────
  let oportunidad;
  if (!b.website && r > 50)
    oportunidad = `Lo que ocurre es que gran parte de esa reputación se queda en Google sin convertirse necesariamente en nuevas reservas. Cada mes hay personas que leen esas reseñas y quieren contactarlos, pero no encuentran un lugar claro donde hacerlo.`;
  else if (!b.website && b.instagram)
    oportunidad = `Lo que noté es que toda esa actividad pasa por Instagram y WhatsApp. Eso funciona, pero hay personas que los buscan y no siempre encuentran la forma directa de reservar o consultar.`;
  else if (!b.website && b.whatsapp)
    oportunidad = `Lo que noté es que las consultas y reservas dependen de que alguien esté disponible para responder por WhatsApp. Eso genera oportunidades perdidas fuera del horario o en momentos de alta demanda.`;
  else if (!b.website)
    oportunidad = `Lo que observé es que fuera de Google Maps no tienen un lugar donde los clientes puedan obtener información o iniciar una consulta directamente.`;
  else if (chain)
    oportunidad = `Lo que observé es que con ${locs} sedes, cada ubicación capta clientes de forma independiente, sin un punto central que muestre la dimensión real del negocio.`;
  else if (b.website && !b.instagram)
    oportunidad = `Lo que noté es que el sitio web existe pero no está acompañado de presencia visual activa, lo que dificulta llegar a clientes que aún no los conocen.`;
  else
    oportunidad = `Lo que observé es que hay potencial de captar más clientes nuevos de forma activa, más allá de quienes ya los conocen por recomendación.`;

  // ── OFERTA ─────────────────────────────────────────────────────────────────
  let oferta;
  if (!b.website && r > 30)
    oferta = `Justamente trabajo con negocios locales ayudándolos a aprovechar mejor ese tráfico mediante una página orientada a reservas y captación de clientes — usando la reputación que ya construyeron como punto de partida.`;
  else if (!b.website && b.whatsapp)
    oferta = `Justamente trabajo con ${cat}s locales ayudándolos a organizar mejor cómo reciben y convierten consultas — para que las oportunidades no se pierdan fuera del horario.`;
  else if (chain)
    oferta = `Justamente trabajo con negocios con varias sedes ayudándolos a unificar su presencia y que cada ubicación capture más clientes de forma consistente.`;
  else if (b.website && !b.instagram)
    oferta = `Justamente trabajo con negocios locales ayudándolos a generar más clientes nuevos a través de su presencia digital, conectando lo que ya tienen con canales que aún no están activos.`;
  else
    oferta = `Justamente trabajo con negocios locales como ${name} ayudándolos a convertir mejor su visibilidad en Google en consultas y clientes nuevos.`;

  // ── PREGUNTA ───────────────────────────────────────────────────────────────
  const pregunta = `¿Es algo que han evaluado o les interesaría explorar?`;

  return `Hola, estuve revisando ${name}.\n\n${activo}\n\n${oportunidad}\n\n${oferta}\n\n${pregunta}`;
}

// ─── Contact Reason (kept for any legacy reference) ──────────────────────────

function buildContactReason(b) {
  const name = b.name || "Este negocio";
  const r    = b.reviewsCount;
  const rt   = b.rating;
  const cat  = (b.category || "negocio").toLowerCase();

  if (!b.website && r > 100 && b.instagram) {
    return `${name} tiene ${r.toLocaleString("es-PE")} reseñas${rt ? ` y ${rt}⭐` : ""} en Google más actividad constante en Instagram — esa combinación es una señal de demanda real. Hay clientes que los buscan y quieren reservar, pero el paso de 'encontrarlos' a 'contactarlos' no es del todo directo.`;
  }
  if (!b.website && r > 50 && b.whatsapp) {
    return `${name} tiene ${r.toLocaleString("es-PE")} reseñas en Google y atiende por WhatsApp — eso muestra un negocio activo con clientes reales. La oportunidad está en que una parte de esas búsquedas en Google se conviertan en reservas sin que el equipo tenga que responder cada consulta manualmente.`;
  }
  if (!b.website && b.whatsapp) {
    return `${name} atiende activamente por WhatsApp y tiene visibilidad en Google. Hay personas que los encuentran en Google y quieren contactar, pero el camino de 'vi su negocio' a 'reservé' pasa por que alguien esté disponible para responder en ese momento.`;
  }
  if (!b.website && !b.whatsapp && !b.instagram) {
    return `${name} aparece en Google Maps y tiene${r ? ` ${r.toLocaleString("es-PE")} reseñas` : " reseñas"} — hay personas buscando ${cat}s en la zona que los encuentran. La oportunidad está en que esa búsqueda pueda convertirse en una reserva directa, sin pasos intermedios.`;
  }
  if (b.website && !b.instagram && r > 50) {
    return `${name} tiene web y ${r.toLocaleString("es-PE")} reseñas en Google — una base sólida. Lo que se observa es que el crecimiento depende principalmente de quienes ya los conocen, y hay potencial de llegar a nuevos clientes de forma más activa.`;
  }
  if (b.website && !b.email && !b.whatsapp) {
    return `${name} tiene presencia web y visibilidad en Google. La oportunidad está en que quienes visitan el sitio encuentren una forma directa de preguntar o reservar — ese paso es el que convierte visitas en clientes.`;
  }
  const repPart = r && rt ? ` con ${r.toLocaleString("es-PE")} reseñas y ${rt}⭐` : r ? ` con ${r.toLocaleString("es-PE")} reseñas` : "";
  return `${name} tiene presencia establecida en Google${repPart} — los clientes los pueden encontrar y confían en ellos. Hay oportunidades de que esa confianza se traduzca en más clientes nuevos de forma consistente.`;
}

// ═══════════════════════════════════════════════════════════════════════════════
// DOMINANT ANGLE ENGINE
// ═══════════════════════════════════════════════════════════════════════════════

const OPS_CATEGORIES_KW = [
  "barber","barbería","barberia","veterina","vet ",
  "spa","tattoo","tatuaje","dental","dentist","psicol",
  "salon","salón","salon","gym","gimnasio","pilates","yoga",
  "masaj","massage","manicur","uña","peluquer","estétic","estetica",
  "fisioter","quiroprác","optometr","médic","doctor","clinic",
  "policlín","consultori","podolog","nutricion","nutrición",
];

function isOpsCategory(cat) {
  if (!cat) return false;
  const lc = cat.toLowerCase();
  return OPS_CATEGORIES_KW.some(kw => lc.includes(kw));
}

function computeDominantAngle(b) {
  const r    = b.reviewsCount || 0;
  const rt   = b.rating       || 0;
  const locs = b.locationsCount || 1;
  const chain = b.isChain && locs > 1;

  let repScore = 0, opsScore = 0, growthScore = 0;
  const repSig = [], opsSig = [], growthSig = [];

  // ── Reputation signals ──────────────────────────────────────────────────
  if (r  > 300)  { repScore += 35; repSig.push(`${r.toLocaleString("es-PE")} reseñas`); }
  else if (r > 100) { repScore += 28; repSig.push(`${r.toLocaleString("es-PE")} reseñas`); }
  else if (r >  50) { repScore += 18; repSig.push(`${r.toLocaleString("es-PE")} reseñas`); }
  if (rt >= 4.7) { repScore += 28; repSig.push(`Rating ${rt}⭐`); }
  else if (rt >= 4.5) { repScore += 18; repSig.push(`Rating ${rt}⭐`); }
  if (!b.website) { repScore += 15; repSig.push("Sin sitio web"); }
  if (b.instagram) { repScore += 10; repSig.push("Instagram activo"); }

  // ── Operations signals ──────────────────────────────────────────────────
  if (b.whatsapp)              { opsScore += 28; opsSig.push("WhatsApp activo"); }
  if (isOpsCategory(b.category)) { opsScore += 35; opsSig.push(`Categoría: ${b.category}`); }
  if (!b.website)              { opsScore += 15; opsSig.push("Sin sistema propio"); }
  if (!b.email)                { opsScore += 10; opsSig.push("Sin canal email"); }
  if (r > 20 && rt >= 4.0)     { opsScore += 10; opsSig.push("Negocio con demanda real"); }

  // ── Growth signals ──────────────────────────────────────────────────────
  if (chain)            { growthScore += 40; growthSig.push(`${locs} sedes activas`); }
  else if (locs > 1)    { growthScore += 25; growthSig.push(`${locs} ubicaciones`); }
  if (b.instagram)      { growthScore += 22; growthSig.push("Instagram activo"); }
  if (r > 100)          { growthScore += 18; growthSig.push(`${r.toLocaleString("es-PE")} reseñas`); }
  else if (r > 30)      { growthScore += 10; growthSig.push(`${r.toLocaleString("es-PE")} reseñas sólidas`); }
  if (rt >= 4.0 && r > 20) { growthScore += 10; growthSig.push(`Reputación ${rt}⭐`); }
  if (b.website && b.instagram) { growthScore += 10; growthSig.push("Presencia multicanal"); }

  const scores = [
    { angle: "Reputation", score: repScore,    signals: repSig    },
    { angle: "Operations", score: opsScore,    signals: opsSig    },
    { angle: "Growth",     score: growthScore, signals: growthSig },
  ].sort((a, b) => b.score - a.score);

  const top  = scores[0];
  const max  = 100;
  const conf = Math.min(100, Math.round((top.score / max) * 100));

  return { angle: top.angle, confidence: Math.max(conf, top.score > 0 ? 30 : 0),
           signals: top.signals, allScores: scores };
}

// ─── Dominant Angle UI ────────────────────────────────────────────────────────

const ANGLE_META = {
  Reputation: {
    icon:   "🏆",
    color:  "rep",
    tagline: "El negocio ya tiene confianza y demanda. La oportunidad es capitalizarla mejor.",
  },
  Operations: {
    icon:   "⚙️",
    color:  "ops",
    tagline: "La operación está creciendo más rápido que las herramientas.",
  },
  Growth: {
    icon:   "📈",
    color:  "grow",
    tagline: "El negocio está creciendo pero la infraestructura digital no acompaña.",
  },
};

function buildDominantAngleUI(da) {
  const meta = ANGLE_META[da.angle] || ANGLE_META.Reputation;
  const confBar = `<div class="da-conf-bar"><div class="da-conf-fill" style="width:${da.confidence}%"></div></div>`;
  const signalBadges = da.signals.length
    ? da.signals.map(s => `<span class="da-signal">${s}</span>`).join("")
    : `<span class="da-signal da-signal-empty">Sin señales suficientes</span>`;

  return `
    <div class="da-card da-${meta.color}">
      <div class="da-main">
        <div class="da-icon">${meta.icon}</div>
        <div class="da-info">
          <div class="da-angle-name">Sales Angle</div>
          <div class="da-tagline">El argumento comercial con mayor probabilidad de generar interés inicial en este negocio según las señales detectadas.</div>
          <span class="da-driver-tag">${da.angle} driver</span>
        </div>
        <div class="da-conf-block">
          <div class="da-conf-label">Confidence</div>
          <div class="da-conf-value">${da.confidence}%</div>
          ${confBar}
        </div>
      </div>
      <div class="da-why">
        <span class="da-why-label">Señales que respaldan este argumento:</span>
        <div class="da-signals">${signalBadges}</div>
      </div>
    </div>`;
}

// ─── Commercial Narrative ─────────────────────────────────────────────────────

function buildCommercialNarrative(b, da) {
  const r     = b.reviewsCount || 0;
  const rt    = b.rating       || 0;
  const locs  = b.locationsCount || 1;
  const chain = b.isChain && locs > 1;
  const cat   = (b.category || "negocio").toLowerCase();

  // ── Core Asset: what the business already built ──────────────────────────
  let coreAsset;
  if (r > 300 && rt >= 4.5)
    coreAsset = `${r.toLocaleString("es-PE")} reseñas con ${rt}⭐ — una reputación que pocos negocios locales logran`;
  else if (r > 100 && rt >= 4.5)
    coreAsset = `${r.toLocaleString("es-PE")} reseñas y ${rt}⭐ en Google — confianza real construida con tiempo`;
  else if (r > 50)
    coreAsset = `${r.toLocaleString("es-PE")} clientes que dejaron reseñas en Google — una señal de demanda activa`;
  else if (chain)
    coreAsset = `${locs} sedes operativas bajo la misma marca — un negocio que ya demostró que puede crecer`;
  else if (b.instagram && r > 20)
    coreAsset = `Comunidad en Instagram más ${r > 0 ? r.toLocaleString("es-PE") + " reseñas en Google" : "visibilidad en Google"} — presencia real en dos frentes`;
  else if (b.instagram)
    coreAsset = "Comunidad activa en Instagram — clientes que siguen y recomiendan el negocio";
  else if (b.whatsapp && r > 0)
    coreAsset = `${r.toLocaleString("es-PE")} reseñas en Google y WhatsApp activo — los clientes los conocen y saben cómo contactarlos`;
  else
    coreAsset = "Presencia establecida en Google Maps — los clientes los pueden encontrar y dejan reseñas";

  // ── Hidden Opportunity: untapped potential (not problems) ────────────────
  let hiddenOpp;
  if (r > 100 && !b.website && (b.whatsapp || b.instagram))
    hiddenOpp = `Cada mes hay personas que leen esas ${r.toLocaleString("es-PE")} reseñas y quieren reservar, pero no encuentran un lugar claro donde hacerlo — esa demanda no se está capturando`;
  else if (!b.website && b.whatsapp && !b.email)
    hiddenOpp = "Toda esa demanda llega por WhatsApp y depende de que alguien esté disponible para responder — muchas consultas se pierden fuera del horario o en horas pico";
  else if (!b.website && b.instagram)
    hiddenOpp = "La comunidad en Instagram genera interés, pero el paso de 'me interesa' a 'quiero reservar' no tiene un lugar claro donde ocurrir";
  else if (!b.website && !b.instagram && !b.whatsapp)
    hiddenOpp = "Hay personas en la zona buscando exactamente este tipo de servicio que no encuentran cómo contactarlos más allá de la ficha de Google";
  else if (chain && !b.website)
    hiddenOpp = `Con ${locs} sedes, hay clientes que buscan la más cercana online y no encuentran información centralizada — cada sede pierde visibilidad por separado`;
  else if (b.website && !b.email && !b.whatsapp)
    hiddenOpp = "Las personas que visitan el sitio web no tienen una forma directa de preguntar o reservar — el interés se genera pero no se convierte";
  else if (rt >= 4.5 && r > 30 && !b.instagram)
    hiddenOpp = `Un rating de ${rt}⭐ es una señal muy potente para atraer nuevos clientes, pero sin presencia visual activa muchas personas no llegan a descubrirlos`;
  else
    hiddenOpp = "La reputación que construyeron está atrayendo búsquedas, pero no hay un flujo claro que convierta esa visibilidad en nuevas reservas o consultas";

  // ── Business Outcome: what they actually get ────────────────────────────
  let outcome;
  if (da.angle === "Reputation" && r > 50)
    outcome = `Más reservas y consultas que llegan solas — la reputación ya está haciendo el trabajo, solo falta el lugar donde cerrar`;
  else if (da.angle === "Operations")
    outcome = `Menos tiempo respondiendo las mismas preguntas por WhatsApp y más tiempo atendiendo clientes que ya están listos para comprar`;
  else if (da.angle === "Growth" && chain)
    outcome = `Clientes que encuentran la sede más cercana fácilmente, y una marca que se percibe tan grande como realmente es`;
  else if (!b.website && r > 30)
    outcome = `Convertir una fracción de quienes ya buscan el negocio en Google en clientes nuevos de forma consistente, sin depender del boca a boca`;
  else if (b.instagram)
    outcome = `Que el interés generado en Instagram se traduzca en reservas reales, no solo en seguidores`;
  else
    outcome = `Más consultas entrantes de calidad — personas que ya buscan el servicio y están listas para contratar`;

  // ── Suggested Narrative (2-4 sentences, human language) ─────────────────
  const assetSnippet = r > 50
    ? `${r.toLocaleString("es-PE")} reseñas${rt >= 4.5 ? ` y ${rt}⭐` : ""} en Google`
    : chain ? `${locs} sedes operativas`
    : b.instagram ? "comunidad activa en Instagram"
    : "presencia real en Google";

  let narrative;
  if (da.angle === "Reputation")
    narrative = `${b.name || "Este negocio"} tiene ${assetSnippet} — eso significa que hay clientes reales que confían en ellos y los recomiendan. Lo que ocurre es que gran parte de esa reputación se queda en Google sin convertirse en reservas nuevas. La oportunidad está en darle a esa reputación un lugar donde trabajar.`;
  else if (da.angle === "Operations")
    narrative = `En un ${cat} con el volumen de ${b.name || "este negocio"}, la mayor parte del tiempo operativo se va en responder consultas y coordinar reservas manualmente. Cada minuto dedicado a eso es un minuto que no se está usando en atender al cliente frente a frente. La oportunidad está en recuperar ese tiempo sin perder clientes.`;
  else
    narrative = `${b.name || "Este negocio"} tiene ${assetSnippet} — una base sólida que pocos construyen. El siguiente paso natural es que esa presencia trabaje de forma más activa para atraer nuevos clientes, no solo para los que ya los conocen.`;

  // ── Reason to Act Now: why this conversation makes sense today ─────────
  let reasonNow;
  if (r > 100 && !b.website)
    reasonNow = `Con ${r.toLocaleString("es-PE")} reseñas activas, hay búsquedas pasando hoy. Cada día sin un lugar claro para reservar es demanda que se va a otro lado.`;
  else if (r > 50 && rt >= 4.5)
    reasonNow = `Un negocio con ${rt}⭐ y ${r.toLocaleString("es-PE")} reseñas ya superó la etapa más difícil: ganar confianza. El momento de crecer sobre esa base es ahora, antes de que la competencia lo haga primero.`;
  else if (chain && !b.website)
    reasonNow = `Con ${locs} sedes operando, la complejidad crece con cada nueva ubicación. Abordarlo ahora es más sencillo que hacerlo cuando el volumen sea el doble.`;
  else if (b.whatsapp && !b.website)
    reasonNow = `El crecimiento por WhatsApp tiene un techo natural: llega un punto donde el volumen de consultas supera la capacidad de respuesta. En muchos negocios ese punto ya llegó.`;
  else if (!b.website)
    reasonNow = `Las búsquedas locales de ${cat}s están creciendo. Los negocios que tengan un lugar claro donde recibir esas búsquedas se llevan a los clientes que los que no lo tienen pierden.`;
  else
    reasonNow = `El contexto digital para negocios locales está cambiando rápido. Los que optimizan su captación hoy tienen ventaja sobre los que lo hagan en seis meses.`;

  const rows = [
    ["💎 Core Asset",          coreAsset  ],
    ["🔍 Hidden Opportunity",  hiddenOpp  ],
    ["📈 Business Outcome",    outcome    ],
    ["⚡ Razón para actuar ahora", reasonNow],
  ];

  const cards = rows.map(([label, text]) =>
    `<div class="li-narr-card">
       <div class="li-narr-label">${label}</div>
       <div class="li-narr-text">${text}</div>
     </div>`
  ).join("");

  const summaryCard = `
    <div class="li-narr-summary">
      <div class="li-narr-label">📝 Suggested Narrative</div>
      <p class="li-narr-summary-text">${narrative}</p>
    </div>`;

  return `<div class="li-narrative-cards">${cards}</div>${summaryCard}`;
}

// ═══════════════════════════════════════════════════════════════════════════════
// OUTREACH ANGLES — 3 message variants
// ═══════════════════════════════════════════════════════════════════════════════

function buildReputationOutreach(b) {
  const name = b.name || "su negocio";
  const cat  = (b.category || "negocio").toLowerCase();
  const r    = b.reviewsCount;
  const rt   = b.rating;

  // 1. Reconocer el activo
  const assetLine = r && rt
    ? `${r.toLocaleString("es-PE")} reseñas con ${rt}⭐ en Google es algo que muy pocos ${cat}s logran mantener`
    : r ? `${r.toLocaleString("es-PE")} reseñas en Google muestran que hay clientes reales que confían en ${name}`
    : rt ? `Una calificación de ${rt}⭐ en Google muestra que los clientes de ${name} están genuinamente satisfechos`
    :      `La reputación de ${name} en Google muestra que hay clientes reales que los eligen y los recomiendan`;

  // 2. Observar la oportunidad (sin mencionar "canal propio" ni "web")
  const oppLine = !b.website && r > 50
    ? `Lo que me llamó la atención es que cada mes hay personas que leen esas reseñas y quieren reservar, pero no hay un lugar claro donde hacerlo — esa intención de compra se está yendo`
    : !b.website && b.instagram
    ? `Lo que observé es que toda esa confianza termina dependiendo de Instagram y WhatsApp para convertirse en clientes nuevos`
    : !b.website
    ? `Lo que noté es que esa reputación no tiene todavía un lugar donde convertirse en reservas o consultas directas`
    : `Lo que observé es que esa reputación está atrayendo búsquedas, pero el paso de 'me interesa' a 'quiero reservar' no está del todo claro`;

  // 3. Resultado potencial
  const outcomeLine = r > 100
    ? `Hay una oportunidad real de que una parte de quienes ya los buscan en Google se conviertan en clientes nuevos sin esfuerzo adicional de su parte`
    : `Hay clientes potenciales que los están buscando y que estarían listos para reservar si encontraran la forma de hacerlo`;

  return `Hola, estuve revisando el perfil de ${name} en Google y vi algo que me pareció interesante: ${assetLine}.

${oppLine}.

${outcomeLine}.

Tengo una idea puntual de cómo se vería eso para ${name}. ¿Tienen 20 minutos esta semana para verlo?`;
}

function buildOperationsOutreach(b) {
  const name = b.name || "su negocio";
  const cat  = (b.category || "negocio").toLowerCase();
  const r    = b.reviewsCount;
  const rt   = b.rating;

  // 1. Reconocer el activo
  const repContext = r && rt
    ? `con ${r.toLocaleString("es-PE")} reseñas y ${rt}⭐ en Google`
    : r ? `con ${r.toLocaleString("es-PE")} reseñas en Google`
    :     `que sus clientes valoran y recomiendan`;

  // 2. Observar la oportunidad (hablar de tiempo, no de tecnología)
  const oppLine = b.whatsapp && !b.website
    ? `Lo que noto en ${cat}s con ese nivel de demanda es que una parte importante del día se va respondiendo las mismas preguntas por WhatsApp: horarios, precios, disponibilidad. Eso es tiempo que podría estar en el cliente de frente`
    : b.whatsapp
    ? `Lo que suele pasar en negocios con ese volumen es que WhatsApp se convierte en el cuello de botella: las consultas llegan todo el día, a cualquier hora, y si no se responden rápido se pierden`
    : `Lo que suele ocurrir en ${cat}s con esa demanda es que la agenda se llena de coordinación y queda poco tiempo para la parte que realmente genera ingresos`;

  // 3. Resultado potencial
  const outcomeLine = `La oportunidad está en recuperar ese tiempo — que las consultas de rutina se resuelvan solas y el equipo pueda enfocarse en los clientes que ya están listos para reservar`;

  return `Hola, vi el perfil de ${name} ${repContext} — se nota que es un negocio que funciona bien y que sus clientes vuelven.

${oppLine}.

${outcomeLine}.

Tengo una propuesta concreta pensada para negocios como ${name}. ¿Tienen 20 minutos esta semana para revisarla?`;
}

function buildGrowthOutreach(b) {
  const name  = b.name || "su negocio";
  const cat   = (b.category || "negocio").toLowerCase();
  const r     = b.reviewsCount;
  const rt    = b.rating;
  const locs  = b.locationsCount || 1;
  const chain = b.isChain && locs > 1;

  // 1. Reconocer el activo
  const assetLine = chain
    ? `${locs} sedes bajo la misma marca es algo que requiere mucho trabajo para construir — y eso se nota`
    : b.instagram && r > 30
    ? `${r.toLocaleString("es-PE")} reseñas en Google más presencia activa en Instagram — esas dos cosas juntas son una señal de un negocio que genuinamente está creciendo`
    : r > 50
    ? `${r.toLocaleString("es-PE")} reseñas${rt ? ` con ${rt}⭐` : ""} en Google muestran un negocio con clientes reales y crecimiento sostenido`
    : `La presencia de ${name} en Google muestra un negocio que está construyendo reconocimiento en la zona`;

  const oppLine = chain
    ? `Lo que me llamó la atención es que con ${locs} sedes, cada una está generando su propio reconocimiento de forma independiente — hay potencial de que esa presencia funcione como un sistema unificado de captación`
    : r > 100
    ? `Lo que observé es que con ese volumen de búsquedas activas, hay personas que llegan a ${name} todos los meses listas para contratar — la oportunidad está en darles un camino claro para hacerlo`
    : b.instagram
    ? `Lo que noto es que la combinación de Google e Instagram que tienen crea una oportunidad real de estar presente en los dos momentos donde los clientes deciden: cuando buscan y cuando descubren`
    : `Lo que observé es que la presencia de ${name} en Google está atrayendo búsquedas reales — la oportunidad está en convertir una parte de esa visibilidad en clientes nuevos de forma consistente`;

  // 3. Resultado potencial
  const outcomeLine = chain
    ? `Hay margen para que cada sede genere sus propias reservas de forma más autónoma y el crecimiento no dependa de estar siempre disponible para responder consultas`
    : `La oportunidad concreta es que una parte de quienes ya los encuentran en Google se convierta en clientes nuevos sin esfuerzo adicional de su parte`;

  return `Hola, estuve revisando el perfil de ${name} en Google y noto que ${assetLine}. ${oppLine}. ${outcomeLine}. Tengo una idea puntual que creo que encajaria bien con la etapa en la que estan. Tienen 20 minutos esta semana para revisarla?`;
}

function buildAngleOutreach(b) {
  const da = computeDominantAngle(b);
  if (da.angle === "Reputation")  return buildReputationOutreach(b);
  if (da.angle === "Operations")  return buildOperationsOutreach(b);
  return buildGrowthOutreach(b);
}

// ── Disparo diferido de la restauración de búsqueda ──────────────────
// Recién acá es seguro: ya pasamos por todos los `const` de resultados
// (resultsSection, resultsTitle, resultsBody, exportCsvBtn, etc.) que
// showResults()/renderTable() necesitan.
if (_shouldRestoreSearch) restoreSearchResults();
