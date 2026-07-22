/**
 * add-crm-sheet-columns.js — agrega los 2 headers nuevos a "CRM Leads"
 * si todavía no existen: M="Número usado", N="Mensaje enviado".
 *
 * Uso: node scripts/add-crm-sheet-columns.js
 * Es idempotente — si ya están, no hace nada. Correr una sola vez.
 */

'use strict';

const path = require("path");
const fs   = require("fs");

function loadEnv() {
  try {
    const envPath = path.join(__dirname, "..", ".env");
    const lines = fs.readFileSync(envPath, "utf8").split("\n");
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const idx = trimmed.indexOf("=");
      if (idx < 0) continue;
      const key = trimmed.slice(0, idx).trim();
      const val = trimmed.slice(idx + 1).trim().replace(/^["']|["']$/g, "");
      if (!process.env[key]) process.env[key] = val;
    }
  } catch (_) {}
}
loadEnv();

const sheetsClient = require("../lib/sheets-client");

async function main() {
  console.log("✓  Verificando headers de la hoja CRM Leads...");
  const headerRow = await sheetsClient.getValues("A1:N1");
  const headers = headerRow[0] || [];
  console.log("  Headers actuales (" + headers.length + "):", headers.join(" | "));

  const updates = [];
  if ((headers[12] || "").trim() !== "Número usado") {
    updates.push({ range: "M1", values: [["Número usado"]] });
  }
  if ((headers[13] || "").trim() !== "Mensaje enviado") {
    updates.push({ range: "N1", values: [["Mensaje enviado"]] });
  }

  if (!updates.length) {
    console.log("✓  Ya existen las 14 columnas — nada que hacer.");
    return;
  }

  for (const u of updates) {
    console.log("  → Escribiendo", u.range, "=", u.values[0][0]);
  }
  await sheetsClient.batchUpdateValues(updates);
  console.log("✓  Listo. Columnas M y N agregadas.");
}

main().catch((err) => {
  console.error("❌  Error:", err.message);
  process.exit(1);
});
