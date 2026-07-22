/**
 * message-cache.js — caché de mensajes generados por el modal Lead
 * Intelligence, indexado por teléfono normalizado.
 *
 * Separado de leads-db.js a propósito: solo abrir el modal (sin hacer
 * clic en "Copiar") ya puede generar y cachear un mensaje, pero eso NO
 * debe crear un lead en el pipeline del CRM.
 */

'use strict';

const fs   = require("fs");
const path = require("path");
const { normalizePhone } = require("./leads-db");

const CACHE_PATH = path.join(__dirname, "..", "data", "message-cache.json");

function ensureDataDir() {
  const dir = path.dirname(CACHE_PATH);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function loadCache() {
  try {
    return JSON.parse(fs.readFileSync(CACHE_PATH, "utf8"));
  } catch (_) {
    return {};
  }
}

function saveCache(cache) {
  ensureDataDir();
  fs.writeFileSync(CACHE_PATH, JSON.stringify(cache, null, 2), "utf8");
}

function getCached(phoneRaw) {
  const phone = normalizePhone(phoneRaw);
  if (!phone) return null;
  const cache = loadCache();
  return cache[phone] || null;
}

function setCached(phoneRaw, message) {
  const phone = normalizePhone(phoneRaw);
  if (!phone) return;
  const cache = loadCache();
  cache[phone] = { message, generatedAt: new Date().toISOString() };
  saveCache(cache);
}

module.exports = { getCached, setCached };
