// ═══════════════════════════════════════════════════════════════════════
//  SCRAPPY — View system + Business Discovery
//  (este bloque va ANTES del código original de búsqueda)
// ═══════════════════════════════════════════════════════════════════════

const BD_KEY = 'scrappy_bd';
let bdCurrentStep = 1;
const BD_TOTAL = 3;

// ── View system ──────────────────────────────────────────────────────
function showView(id) {
  document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
  const el = document.getElementById(id);
  if (el) el.classList.add('active');

  // Mostrar/ocultar botón "Mi negocio"
  const btn = document.getElementById('btn-mi-negocio');
  if (btn) btn.style.display = (id === 'view-search') ? 'block' : 'none';
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
    s.classList.toggle('active', i + 1 === step);
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

// ── Market Fit render (stub — se expande en siguiente iteración) ──────
function renderMarketFit() {
  const data = loadBD();
  const wrap = document.getElementById('mf-content');
  if (!wrap || !data) return;

  const prompt = buildMarketFitPrompt(data);

  wrap.innerHTML = `
    <div style="max-width:780px;margin:0 auto;padding:40px 0 80px;">
      <span style="display:inline-block;font-size:11px;font-weight:700;letter-spacing:.1em;text-transform:uppercase;color:#7C3AED;font-family:'Sora',sans-serif;margin-bottom:12px;">Market Fit</span>
      <h2 style="font-size:1.5rem;font-weight:700;color:#F5F5F5;margin-bottom:6px;letter-spacing:-.02em;">Tu prompt de análisis estratégico</h2>
      <p style="font-size:.875rem;color:#6B7280;margin-bottom:28px;line-height:1.55;">Copia este prompt y pégalo en Claude, ChatGPT o el modelo que uses. Te dará los ICPs más prometedores, las industrias a priorizar y la narrativa comercial a usar.</p>

      <div style="background:#111111;border:1px solid #252525;border-radius:16px;overflow:hidden;">
        <div style="display:flex;align-items:center;justify-content:space-between;padding:16px 20px;border-bottom:1px solid #1A1A1A;">
          <span style="font-size:.7rem;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:#4B5563;">Prompt generado</span>
          <button id="mf-copy-btn" style="padding:7px 18px;background:rgba(124,58,237,.15);border:1px solid rgba(124,58,237,.3);color:#A78BFA;border-radius:8px;font-size:.78rem;font-weight:600;font-family:'Inter',sans-serif;cursor:pointer;transition:background .15s;">📋 Copiar</button>
        </div>
        <pre id="mf-prompt-text" style="font-family:'Inter',monospace;font-size:.82rem;line-height:1.7;color:#D1D5DB;padding:24px 20px;white-space:pre-wrap;word-break:break-word;margin:0;">${escHtml(prompt)}</pre>
      </div>

      <div style="display:flex;gap:12px;margin-top:24px;flex-wrap:wrap;">
        <button id="mf-back-btn" style="padding:12px 24px;background:none;border:1px solid #252525;color:#9CA3AF;border-radius:10px;font-size:.875rem;font-family:'Inter',sans-serif;cursor:pointer;transition:border-color .2s;">← Editar respuestas</button>
        <button id="mf-search-btn" style="padding:12px 28px;border:none;border-radius:10px;background:linear-gradient(90deg,#7C3AED 0%,#EC4899 58%,#F97316 100%);color:#fff;font-size:.9rem;font-weight:600;font-family:'Sora',sans-serif;cursor:pointer;transition:opacity .2s;">Ir al buscador →</button>
      </div>
    </div>
  `;

  document.getElementById('mf-copy-btn')?.addEventListener('click', () => {
    navigator.clipboard.writeText(prompt).then(() => {
      const btn = document.getElementById('mf-copy-btn');
      if (btn) { btn.textContent = '✓ Copiado'; setTimeout(() => { btn.textContent = '📋 Copiar'; }, 2000); }
    });
  });

  document.getElementById('mf-back-btn')?.addEventListener('click', () => {
    bdCurrentStep = BD_TOTAL;
    updateBDProgress(bdCurrentStep);
    showView('view-bd');
  });

  document.getElementById('mf-search-btn')?.addEventListener('click', () => {
    showView('view-search');
  });
}

function escHtml(str) {
  return str.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

function buildMarketFitPrompt(d) {
  return `Actúa como un estratega de ventas B2B especializado en negocios de servicios.

Te voy a dar información sobre mi negocio y quiero que hagas un análisis estratégico de Market Fit.

---
SOBRE MI NEGOCIO:

¿Qué ofrezco?
${d.oferta || '(no especificado)'}

¿Qué resultado concreto entrega?
${d.resultado || '(no especificado)'}

¿A quién le he vendido o intentado vender?
${d.clientes || '(no especificado)'}

¿A quién NO quiero venderle?
${d.exclusiones || '(no especificado)'}

¿Por qué elegiría alguien trabajar conmigo y no con otro?
${d.diferenciador || '(no especificado)'}

Caso de éxito o resultado concreto:
${d.casoExito || '(ninguno por ahora)'}
---

Basándote en esta información, respóndeme:

1. **ICPs más prometedores**: ¿Qué perfiles de cliente tienen mayor probabilidad de comprar? Describe 3 ICPs concretos con nombre de industria, tamaño, dolor principal y por qué encajan bien con mi oferta.

2. **Industrias a priorizar**: ¿En qué industrias debería enfocar mi prospección primero? ¿Y cuáles debería evitar por ahora?

3. **Activo comercial principal**: ¿Qué elemento de mi oferta debería explotar más en mi comunicación? (ej: velocidad de entrega, precio fijo, resultado específico, etc.)

4. **Narrativa comercial recomendada**: ¿Qué ángulo narrativo usarías para cada ICP? (ej: para fotógrafos hablar de portafolio; para fisioterapeutas hablar de confianza y reservas)

5. **Red flags**: ¿Qué señales en un prospecto indicarían que no es un buen fit?

Sé directo, específico y usa los datos que te di. No generalices.`;
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

// ── Bootstrap ─────────────────────────────────────────────────────────
(function boot() {
  const saved = loadBD();
  if (saved && (saved.oferta || saved.clientes)) {
    showView('view-search');
  } else {
    showView('view-bd');
  }
  initBD();
})();

// ═══════════════════════════════════════════════════════════════════════
//  FIN BLOQUE BUSINESS DISCOVERY — código original a continuación
// ═══════════════════════════════════════════════════════════════════════

