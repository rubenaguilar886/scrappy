/* ══════════════════════════════════════════
   Settings page — Scrappy
   Carga y guarda tone-config.json via API

   Envuelto en IIFE: ahora convive con settings-crm.js en la misma
   página (index.html) — los <script> clásicos comparten un único
   scope global, así que sin esto "statusEl"/"_statusTimer"/"showStatus"
   chocan entre archivos y tiran SyntaxError al parsear.
══════════════════════════════════════════ */
(function () {

// Esto controla SOLO el mensaje 2 (presentación de producto) — el mensaje 1
// (calificar si es el dueño/encargado) es una plantilla fija sin IA, no se
// edita aquí. Debe reflejar lo mismo que tone-config.json en el servidor.
const DEFAULT_SYSTEM_PROMPT =
  "# SYSTEM PROMPT — OUTREACH ENGINE (MENSAJE 2 — PRESENTACION DE PRODUCTO)\n\n" +
  "Este mensaje se manda DESPUES de que el prospecto ya confirmo ser el dueno o encargado del negocio en el mensaje 1 — no lo vuelvas a preguntar, no lo repitas, no vuelvas a mencionar el rating ni las resenas (eso ya se uso).\n\n" +
  "Tu trabajo aqui SI es presentar el producto ya elegido para este negocio (viene en los datos de entrada, con su nombre, precio y para que sirve) y generar interes en agendar una llamada — de forma natural y directa, sin sonar a plantilla de ventas ni a copy corporativo.\n\n" +
  "Estructura en 2-3 lineas cortas:\n" +
  "1. Conecta brevemente con que ya confirmo ser la persona correcta, y menciona el producto y para que sirve en una frase natural.\n" +
  "2. Menciona el precio de forma directa, sin rodeos ni disculpas por el monto.\n" +
  "3. Cierra con una invitacion simple a agendar una llamada corta o resolver dudas — no una pregunta de calificacion, eso ya se hizo en el mensaje 1.\n\n" +
  "Reglas estrictas:\n" +
  "- Menciona el nombre del producto y el precio tal cual vienen en los datos de entrada — nunca inventes ni redondees un precio distinto.\n" +
  "- Tono casual pero directo, espanol neutro peruano, como un mensaje real de WhatsApp, no como un email corporativo.\n" +
  "- Maximo 3 lineas cortas.\n" +
  "- No repitas el hook de resenas/rating del mensaje 1.\n" +
  "- No agregues firma ni cierre formal.\n\n" +
  "Datos de entrada: {nombre_negocio}, {categoria}, {nombre_producto}, {precio}, {para_que_sirve}";

const systemEl  = document.getElementById("f-system-prompt");
const extraEl   = document.getElementById("f-extra");
const saveBtn   = document.getElementById("btn-save");
const resetBtn  = document.getElementById("btn-reset-prompt");
const statusEl  = document.getElementById("save-status");

// ── Load config on page ready ────────────────────────────────────────
async function loadConfig() {
  try {
    const res  = await fetch("/api/tone-config");
    const cfg  = await res.json();
    systemEl.value = cfg.systemPrompt      || DEFAULT_SYSTEM_PROMPT;
    extraEl.value  = cfg.extraInstructions || "";
  } catch (_) {
    systemEl.value = DEFAULT_SYSTEM_PROMPT;
    extraEl.value  = "";
    showStatus("No se pudo cargar la configuración.", "err");
  }
}

// ── Save ─────────────────────────────────────────────────────────────
document.getElementById("tone-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  saveBtn.disabled = true;
  saveBtn.textContent = "Guardando…";
  clearStatus();

  try {
    const res = await fetch("/api/tone-config", {
      method:  "POST",
      headers: { "Content-Type": "application/json" },
      body:    JSON.stringify({
        systemPrompt:      systemEl.value.trim(),
        extraInstructions: extraEl.value.trim(),
      }),
    });
    const data = await res.json();
    if (data.ok) {
      showStatus("✓ Guardado", "ok");
    } else {
      showStatus(data.error || "Error al guardar.", "err");
    }
  } catch (_) {
    showStatus("Error de red.", "err");
  } finally {
    saveBtn.disabled = false;
    saveBtn.textContent = "Guardar cambios";
  }
});

// ── Reset prompt to default ───────────────────────────────────────────
resetBtn.addEventListener("click", () => {
  if (!confirm("¿Restaurar el system prompt al valor por defecto? Se perderán tus cambios actuales.")) return;
  systemEl.value = DEFAULT_SYSTEM_PROMPT;
  showStatus("Prompt restaurado — guarda para aplicar.", "");
});

// ── Status helpers ────────────────────────────────────────────────────
let _statusTimer;
function showStatus(msg, type) {
  clearTimeout(_statusTimer);
  statusEl.textContent = msg;
  statusEl.className   = "st-save-status " + (type || "");
  if (type === "ok") {
    _statusTimer = setTimeout(clearStatus, 3000);
  }
}
function clearStatus() {
  statusEl.textContent = "";
  statusEl.className   = "st-save-status";
}

// Se dispara la primera vez que el router activa esta sección (lazy),
// no al cargar la página — ver router.js.
window.initMensajesView = loadConfig;

})();
