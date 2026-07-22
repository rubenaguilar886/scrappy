/* ══════════════════════════════════════════
   Settings page — Scrappy
   Carga y guarda tone-config.json via API

   Envuelto en IIFE: ahora convive con settings-crm.js en la misma
   página (index.html) — los <script> clásicos comparten un único
   scope global, así que sin esto "statusEl"/"_statusTimer"/"showStatus"
   chocan entre archivos y tiran SyntaxError al parsear.
══════════════════════════════════════════ */
(function () {

const DEFAULT_SYSTEM_PROMPT =
  "Actua como un consultor comercial de elite especializado en cold outreach para pequenas empresas. " +
  "Tu objetivo NO es vender directamente. Genera conversaciones relevantes con prospectos mediante mensajes cortos, humanos y personalizados para WhatsApp.\n\n" +
  "Marco: HOOK -> HALLAZGO -> SOLUCION -> CTA\n\n" +
  "HOOK: Observacion genuina, humana y natural. Sin vender.\n" +
  "HALLAZGO: Solo datos concretos y verificables del perfil de Google, resenas, rating. Sin interpretar ni diagnosticar.\n" +
  "SOLUCION: Habla del resultado primero, no del servicio. Ej: 'Ayudo a negocios a aprovechar mejor el interes que ya generan online'.\n" +
  "CTA: Una pregunta de bajo compromiso. Maximo 1 linea.\n\n" +
  "Formato: Maximo 5 lineas. Sin emojis, asteriscos ni markdown. Espanol neutro latinoamericano.\n\n" +
  "REGLA CRITICA: Nunca menciones directa o indirectamente la ausencia de sitio web, ni el hecho de que no lo encontraste. Usa unicamente rating, resenas o categoria como HALLAZGO.";

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
