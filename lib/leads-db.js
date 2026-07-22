/**
 * leads-db.js — base de datos local de CRM Leads (fuente de verdad).
 *
 * Guarda en data/crm-leads.json, indexado por teléfono normalizado.
 * Los campos ¿Respondió?, Próxima acción y Notas NO se guardan aquí —
 * son 100% manuales en Google Sheets y ninguna función de este módulo
 * los toca.
 */

'use strict';

const fs = require("fs");
const path = require("path");
const { isValidStage, isContactStage } = require("./pipeline-stages");

const DB_PATH    = path.join(__dirname, "..", "data", "crm-leads.json");
const LINES_PATH = path.join(__dirname, "..", "data", "lines-config.json");

const DEFAULT_LINES = ["Línea 1", "Línea 2"];

function ensureDataDir() {
  const dir = path.dirname(DB_PATH);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function normalizePhone(raw) {
  const digits = String(raw || "").replace(/\D/g, "");
  return digits || null;
}

function nowISO() {
  return new Date().toISOString();
}

function todayEsPE() {
  return new Date().toLocaleDateString("es-PE");
}

function loadDB() {
  try {
    const raw = fs.readFileSync(DB_PATH, "utf8");
    const db = JSON.parse(raw);
    if (!db.meta) db.meta = { rotationCounter: 0 };
    if (!db.leads) db.leads = {};
    return db;
  } catch (_) {
    return { meta: { rotationCounter: 0 }, leads: {} };
  }
}

function saveDB(db) {
  ensureDataDir();
  fs.writeFileSync(DB_PATH, JSON.stringify(db, null, 2), "utf8");
}

function getLines() {
  try {
    const raw = JSON.parse(fs.readFileSync(LINES_PATH, "utf8"));
    if (Array.isArray(raw) && raw.length === 2) return raw;
  } catch (_) {}
  return DEFAULT_LINES;
}

function getLead(phoneRaw) {
  const phone = normalizePhone(phoneRaw);
  if (!phone) return null;
  const db = loadDB();
  return db.leads[phone] || null;
}

function listLeads() {
  const db = loadDB();
  return Object.values(db.leads).sort((a, b) =>
    new Date(b.updatedAt || 0) - new Date(a.updatedAt || 0)
  );
}

function getRotationSuggestion() {
  const db = loadDB();
  const lines = getLines();
  return lines[(db.meta.rotationCounter || 0) % lines.length];
}

// ── Copiar: crea o actualiza el lead con los datos del mensaje. ──────────
// Regla: Etapa pasa a "Copiado" SOLO si la etapa actual es "Nuevo" (o el
// lead todavía no existe, que se trata como si estuviera en "Nuevo").
// Si el lead ya avanzó (Toque 1, Interesado, etc.), volver a copiar NO
// toca la Etapa — solo refresca Negocio/Rubro/Teléfono/Canal/Mensaje.
function upsertOnCopy({ business, message }) {
  const phone = normalizePhone(business?.phone || business?.whatsapp);
  if (!phone) return { ok: false, reason: "no-phone" };

  const db = loadDB();
  const existing = db.leads[phone] || null;
  const etapaAnterior = existing ? existing.etapa : "Nuevo";
  const etapaNueva = etapaAnterior === "Nuevo" ? "Copiado" : etapaAnterior;

  const lead = {
    phone,
    negocio: business.name || existing?.negocio || "",
    rubro: business.category || existing?.rubro || "",
    telefono: business.phone || business.whatsapp || existing?.telefono || "",
    canal: "WhatsApp",
    mensajeEnviado: message || existing?.mensajeEnviado || "",
    etapa: etapaNueva,
    numeroUsado: existing?.numeroUsado || "",
    primerContacto: existing?.primerContacto || "",
    ultimoContacto: existing?.ultimoContacto || "",
    numContactos: existing?.numContactos || 0,
    createdAt: existing?.createdAt || nowISO(),
    updatedAt: nowISO(),
  };

  db.leads[phone] = lead;
  saveDB(db);

  return { ok: true, lead, etapaChanged: etapaNueva !== etapaAnterior };
}

// ── Cambio de Etapa desde la tabla CRM ────────────────────────────────────
// Si la nueva etapa implica contacto saliente (ver CONTACT_STAGES), exige
// numeroUsado y actualiza 1er/último contacto + N° contactos + rotación.
// Si no, solo cambia Etapa. Nunca toca ¿Respondió?/Próxima acción/Notas.
function setStage(phoneRaw, { etapa, numeroUsado } = {}) {
  const phone = normalizePhone(phoneRaw);
  if (!phone) return { ok: false, reason: "no-phone" };
  if (!isValidStage(etapa)) return { ok: false, reason: "invalid-stage" };

  const db = loadDB();
  const existing = db.leads[phone];
  if (!existing) return { ok: false, reason: "not-found" };

  if (isContactStage(etapa)) {
    if (!numeroUsado) return { ok: false, reason: "numero-usado-required" };
    if (!existing.primerContacto) existing.primerContacto = todayEsPE();
    else existing.ultimoContacto = todayEsPE();
    existing.numContactos = (existing.numContactos || 0) + 1;
    existing.numeroUsado = numeroUsado;
    db.meta.rotationCounter = (db.meta.rotationCounter || 0) + 1;
  }

  existing.etapa = etapa;
  existing.updatedAt = nowISO();
  db.leads[phone] = existing;
  saveDB(db);

  return { ok: true, lead: existing };
}

// ── Borrar un lead — SOLO de la DB local. Nunca toca Google Sheets. ──────
function deleteLead(phoneRaw) {
  const phone = normalizePhone(phoneRaw);
  if (!phone) return { ok: false, reason: "no-phone" };

  const db = loadDB();
  if (!db.leads[phone]) return { ok: false, reason: "not-found" };

  delete db.leads[phone];
  saveDB(db);
  return { ok: true };
}

// ── Borrar todos los leads — SOLO de la DB local. Nunca toca Sheets. ─────
function deleteAllLeads() {
  const db = loadDB();
  const count = Object.keys(db.leads).length;
  db.leads = {};
  saveDB(db);
  return { ok: true, count };
}

module.exports = {
  normalizePhone,
  getLead,
  listLeads,
  getLines,
  getRotationSuggestion,
  upsertOnCopy,
  setStage,
  deleteLead,
  deleteAllLeads,
};
