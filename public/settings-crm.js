/* ══════════════════════════════════════════
   CRM Leads table — Scrappy
   Dropdown de Etapa por fila. Si la nueva etapa implica contacto
   saliente (ver CONTACT_STAGES), pide confirmar el número usado antes
   de guardar. ¿Respondió?/Próxima acción/Notas no viven aquí — son
   100% manuales en Google Sheets.

   Envuelto en IIFE: convive con settings.js en la misma página — los
   <script> clásicos comparten un único scope global, así que sin esto
   "statusEl"/"_statusTimer"/"showStatus" chocan entre archivos y tiran
   SyntaxError al parsear (eso dejaba esta tabla pegada en "Cargando…").
══════════════════════════════════════════ */
(function () {

let STAGES = [];
let CONTACT_STAGES = [];
let LINES = ["Línea 1", "Línea 2"];
let SUGGESTED_LINE = LINES[0];
let leads = [];
let pending = null; // { phone, newStage, prevStage, selectedLine }

const bodyEl = document.getElementById("crm-body");
const statusEl = document.getElementById("crm-status");
const deleteAllBtn = document.getElementById("crm-delete-all-btn");
const tableWrapEl = document.getElementById("crm-table-wrap");

// ── Scroll horizontal arrastrable con el mouse (mismo patrón que el
// Buscador en app.js) — ignora clics sobre el <select> de Etapa y el
// botón de borrar para no interferir con esos controles. ──────────────
let dragStartX  = 0;
let dragScrollX = 0;
let isDragging  = false;

tableWrapEl?.addEventListener("mousedown", (e) => {
  if (e.target.closest("a, button, input, select")) return;
  isDragging  = true;
  dragStartX  = e.pageX;
  dragScrollX = tableWrapEl.scrollLeft;
  tableWrapEl.classList.add("dragging");
  e.preventDefault();
});

window.addEventListener("mousemove", (e) => {
  if (!isDragging) return;
  const delta = dragStartX - e.pageX;
  tableWrapEl.scrollLeft = dragScrollX + delta;
});

window.addEventListener("mouseup", () => {
  if (!isDragging) return;
  isDragging = false;
  tableWrapEl?.classList.remove("dragging");
});

async function init() {
  try {
    const [cfg, leadsRes] = await Promise.all([
      fetch("/api/crm/config").then((r) => r.json()),
      fetch("/api/crm/leads").then((r) => r.json()),
    ]);
    STAGES = cfg.stages || [];
    CONTACT_STAGES = cfg.contactStages || [];
    LINES = cfg.lines || LINES;
    SUGGESTED_LINE = cfg.suggestedLine || LINES[0];
    leads = leadsRes.leads || [];
    render();
  } catch (err) {
    bodyEl.innerHTML = `<tr><td colspan="10" class="crm-empty">Error cargando el CRM: ${escapeHtml(err.message)}</td></tr>`;
  }
}

function render() {
  if (!leads.length) {
    bodyEl.innerHTML = `<tr><td colspan="10" class="crm-empty">Todavía no hay leads — usa "📋 Copiar" en el modal Lead Intelligence para agregar el primero.</td></tr>`;
    return;
  }
  bodyEl.innerHTML = leads.map(rowHtml).join("");
  bindRowEvents();
}

function rowHtml(lead) {
  const options = STAGES.map(
    (s) => `<option value="${escapeAttr(s)}" ${s === lead.etapa ? "selected" : ""}>${escapeHtml(s)}</option>`
  ).join("");
  return `
    <tr data-phone="${escapeAttr(lead.phone)}">
      <td class="crm-negocio">${escapeHtml(lead.negocio || "—")}</td>
      <td>${escapeHtml(lead.rubro || "—")}</td>
      <td class="crm-muted">${escapeHtml(lead.telefono || "—")}</td>
      <td><select class="crm-etapa-select" data-prev="${escapeAttr(lead.etapa)}">${options}</select></td>
      <td class="crm-muted">${escapeHtml(lead.numeroUsado || "—")}</td>
      <td class="crm-muted">${escapeHtml(lead.primerContacto || "—")}</td>
      <td class="crm-muted">${escapeHtml(lead.ultimoContacto || "—")}</td>
      <td class="crm-muted">${lead.numContactos || 0}</td>
      <td class="crm-msg-cell" title="Clic para expandir">${escapeHtml(truncate(lead.mensajeEnviado, 60))}</td>
      <td class="crm-row-actions">
        <button type="button" class="crm-row-delete-btn" title="Borrar este lead (solo DB local, Sheets no se toca)">🗑️</button>
      </td>
    </tr>
  `;
}

function bindRowEvents() {
  bodyEl.querySelectorAll(".crm-etapa-select").forEach((sel) => {
    sel.addEventListener("change", onStageChange);
  });
  bodyEl.querySelectorAll(".crm-msg-cell").forEach((cell) => {
    cell.addEventListener("click", () => cell.classList.toggle("expanded"));
  });
  bodyEl.querySelectorAll(".crm-row-delete-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      const tr = btn.closest("tr");
      const phone = tr.dataset.phone;
      const lead = leads.find((l) => l.phone === phone);
      deleteLead(phone, lead?.negocio, tr);
    });
  });
}

// ── Borrar un lead — SOLO de la DB local, nunca de Sheets ────────────────
async function deleteLead(phone, negocio, tr) {
  if (!confirm(`¿Borrar "${negocio || "este lead"}" del CRM?\n\nSolo se borra de la base de datos local de Scrappy — la fila en Google Sheets no se toca.`)) {
    return;
  }
  try {
    const res = await fetch(`/api/crm/leads/${encodeURIComponent(phone)}`, { method: "DELETE" });
    const data = await res.json();
    if (!res.ok || !data.ok) throw new Error(data.error || "No se pudo borrar.");

    leads = leads.filter((l) => l.phone !== phone);
    tr?.remove();
    if (!leads.length) render();
    showStatus("✓ Lead borrado de la DB local", "ok");
  } catch (err) {
    showStatus("✗ " + err.message, "err");
  }
}

// ── Borrar todos los leads — SOLO de la DB local, nunca de Sheets ────────
deleteAllBtn?.addEventListener("click", async () => {
  if (!leads.length) return;
  const typed = prompt(
    `Vas a borrar los ${leads.length} leads del CRM local (Sheets NO se toca).\n\nEscribe BORRAR para confirmar:`
  );
  if (typed !== "BORRAR") return;

  try {
    const res = await fetch("/api/crm/leads", { method: "DELETE" });
    const data = await res.json();
    if (!res.ok || !data.ok) throw new Error(data.error || "No se pudo borrar.");

    leads = [];
    render();
    showStatus(`✓ ${data.count ?? ""} leads borrados de la DB local`, "ok");
  } catch (err) {
    showStatus("✗ " + err.message, "err");
  }
});

function onStageChange(e) {
  const select = e.target;
  const tr = select.closest("tr");
  const phone = tr.dataset.phone;
  const prevStage = select.dataset.prev;
  const newStage = select.value;

  removeInlineRow();

  if (CONTACT_STAGES.includes(newStage)) {
    pending = { phone, newStage, prevStage, selectedLine: SUGGESTED_LINE };
    insertInlineRow(tr);
  } else {
    commitStage(phone, { etapa: newStage }, select, prevStage, tr);
  }
}

function insertInlineRow(tr) {
  const inlineTr = document.createElement("tr");
  inlineTr.className = "crm-inline-row";
  inlineTr.innerHTML = `
    <td colspan="10">
      <div class="crm-inline-bar">
        <span class="crm-inline-label">¿Qué número usaste?</span>
        ${LINES.map(
          (l) => `<button type="button" class="crm-line-btn ${l === pending.selectedLine ? "selected" : ""}" data-line="${escapeAttr(l)}">${escapeHtml(l)}${l === SUGGESTED_LINE ? '<span class="crm-suggested-tag">sugerida</span>' : ""}</button>`
        ).join("")}
        <span style="flex:1"></span>
        <button type="button" class="crm-inline-confirm">Confirmar</button>
        <button type="button" class="crm-inline-cancel">Cancelar</button>
      </div>
    </td>
  `;
  tr.after(inlineTr);

  inlineTr.querySelectorAll(".crm-line-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      pending.selectedLine = btn.dataset.line;
      inlineTr.querySelectorAll(".crm-line-btn").forEach((b) => b.classList.toggle("selected", b === btn));
    });
  });

  inlineTr.querySelector(".crm-inline-confirm").addEventListener("click", () => {
    const select = tr.querySelector(".crm-etapa-select");
    commitStage(pending.phone, { etapa: pending.newStage, numeroUsado: pending.selectedLine }, select, pending.prevStage, tr);
  });

  inlineTr.querySelector(".crm-inline-cancel").addEventListener("click", () => {
    const select = tr.querySelector(".crm-etapa-select");
    select.value = pending.prevStage;
    pending = null;
    removeInlineRow();
  });
}

function removeInlineRow() {
  const existing = bodyEl.querySelector(".crm-inline-row");
  if (existing) existing.remove();
}

async function commitStage(phone, payload, select, prevStage, tr) {
  select.disabled = true;
  try {
    const res = await fetch(`/api/crm/leads/${encodeURIComponent(phone)}/stage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const data = await res.json();
    if (!res.ok || !data.ok) throw new Error(data.error || "No se pudo actualizar.");

    const idx = leads.findIndex((l) => l.phone === phone);
    if (idx >= 0) leads[idx] = data.lead;
    select.dataset.prev = data.lead.etapa;
    updateRowCells(tr, data.lead);

    showStatus(
      data.sheetSynced
        ? "✓ Actualizado y sincronizado con Sheets"
        : "✓ Actualizado localmente — no se sincronizó con Sheets" + (data.sheetError ? ": " + data.sheetError : ""),
      data.sheetSynced ? "ok" : "warn"
    );

    if (payload.numeroUsado) refreshSuggestedLine();
  } catch (err) {
    select.value = prevStage;
    showStatus("✗ " + err.message, "err");
  } finally {
    select.disabled = false;
    pending = null;
    removeInlineRow();
  }
}

function updateRowCells(tr, lead) {
  tr.children[4].textContent = lead.numeroUsado || "—";
  tr.children[5].textContent = lead.primerContacto || "—";
  tr.children[6].textContent = lead.ultimoContacto || "—";
  tr.children[7].textContent = lead.numContactos || 0;
}

async function refreshSuggestedLine() {
  try {
    const cfg = await fetch("/api/crm/config").then((r) => r.json());
    SUGGESTED_LINE = cfg.suggestedLine || SUGGESTED_LINE;
  } catch (_) {}
}

function truncate(s, n) {
  s = s || "";
  return s.length > n ? s.slice(0, n) + "…" : s;
}

let _statusTimer;
function showStatus(msg, type) {
  clearTimeout(_statusTimer);
  statusEl.textContent = msg;
  statusEl.hidden = false;
  statusEl.className = "crm-toast " + (type || "");
  _statusTimer = setTimeout(() => { statusEl.hidden = true; }, 4000);
}

function escapeHtml(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}
function escapeAttr(s) { return escapeHtml(s); }

// Se dispara la primera vez que el router activa esta sección (lazy),
// no al cargar la página — ver router.js.
window.initCrmView = init;

})();
