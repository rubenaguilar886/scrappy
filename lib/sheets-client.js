/**
 * sheets-client.js — cliente mínimo de Google Sheets (lectura/escritura)
 * vía cuenta de servicio, sin dependencias nuevas (mismo patrón JWT que
 * check-sheet.js, ahora con scope de escritura).
 *
 * Todas las funciones son best-effort: si algo falla (red, credenciales,
 * cuota), devuelven { ok:false, error } en vez de lanzar, para que el
 * caller nunca bloquee la escritura en la DB local por un fallo de Sheets.
 */

'use strict';

const crypto = require("crypto");
const https  = require("https");
const path   = require("path");
const fs     = require("fs");

const CREDS_PATH     = path.join(__dirname, "..", "google-credentials.json");
const SPREADSHEET_ID = process.env.SHEETS_SPREADSHEET_ID || "1ekEk6XkbSysgZeYZMpIdoWN008oUaBc40nUZPMEsfZc";
const SHEET_NAME_ENV = process.env.SHEETS_SHEET_NAME || "CRM Leads";
const FALLBACK_GID   = 1983350997; // mismo gid que check-sheet.js, por si el título cambió

console.log(`[sheets-client] boot — spreadsheet=${SPREADSHEET_ID} hoja="${SHEET_NAME_ENV}" credenciales=${fs.existsSync(CREDS_PATH) ? "encontradas" : "❌ NO ENCONTRADAS en " + CREDS_PATH}`);

// Columnas B..N de la hoja "CRM Leads" (A = "#" nunca se toca).
const COL = {
  negocio: "B", rubro: "C", telefono: "D", canal: "E",
  primerContacto: "F", ultimoContacto: "G", numContactos: "H",
  respondio: "I", etapa: "J", proximaAccion: "K", notas: "L",
  numeroUsado: "M", mensajeEnviado: "N",
};

let cachedToken = null;   // { token, expiresAt }
let cachedSheetName = null;

function b64url(str) {
  return Buffer.from(str).toString("base64url");
}

function loadCreds() {
  // En Railway (producción) las credenciales vienen como variable de entorno
  if (process.env.GOOGLE_CREDENTIALS_JSON) {
    return JSON.parse(process.env.GOOGLE_CREDENTIALS_JSON);
  }
  // Fallback a archivo local (desarrollo)
  const raw = fs.readFileSync(CREDS_PATH, "utf8");
  return JSON.parse(raw);
}

function makeJWT(creds, scope) {
  const header  = b64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const now     = Math.floor(Date.now() / 1000);
  const payload = b64url(JSON.stringify({
    iss: creds.client_email,
    scope,
    aud: "https://oauth2.googleapis.com/token",
    exp: now + 3600,
    iat: now,
  }));
  const toSign = `${header}.${payload}`;
  const sign   = crypto.createSign("RSA-SHA256");
  sign.update(toSign);
  const sig = sign.sign(creds.private_key, "base64url");
  return `${toSign}.${sig}`;
}

function httpRequest(method, url, { token, body } = {}) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const buf = body ? Buffer.from(JSON.stringify(body)) : null;
    const headers = { Authorization: "Bearer " + token };
    if (buf) {
      headers["Content-Type"] = "application/json";
      headers["Content-Length"] = buf.length;
    }
    const req = https.request(u, { method, headers }, (res) => {
      let data = "";
      res.on("data", (c) => (data += c));
      res.on("end", () => {
        let parsed;
        try { parsed = JSON.parse(data); } catch (_) { parsed = data; }
        resolve({ status: res.statusCode, body: parsed });
      });
    });
    req.on("error", reject);
    if (buf) req.write(buf);
    req.end();
  });
}

function postForm(url, formBody) {
  return new Promise((resolve, reject) => {
    const buf = Buffer.from(formBody);
    const req = https.request(url, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded", "Content-Length": buf.length },
    }, (res) => {
      let data = "";
      res.on("data", (c) => (data += c));
      res.on("end", () => {
        try { resolve({ status: res.statusCode, body: JSON.parse(data) }); }
        catch { resolve({ status: res.statusCode, body: data }); }
      });
    });
    req.on("error", reject);
    req.write(buf);
    req.end();
  });
}

async function getAccessToken() {
  if (cachedToken && cachedToken.expiresAt > Date.now() + 60000) {
    return cachedToken.token;
  }
  const creds = loadCreds();
  const jwt = makeJWT(creds, "https://www.googleapis.com/auth/spreadsheets");
  const res = await postForm(
    "https://oauth2.googleapis.com/token",
    `grant_type=urn%3Aietf%3Aparams%3Aoauth%3Agrant-type%3Ajwt-bearer&assertion=${jwt}`
  );
  if (res.status !== 200 || !res.body.access_token) {
    throw new Error("No se pudo obtener access_token de Google: " + JSON.stringify(res.body));
  }
  cachedToken = { token: res.body.access_token, expiresAt: Date.now() + (res.body.expires_in || 3600) * 1000 };
  return cachedToken.token;
}

async function resolveSheetName() {
  if (cachedSheetName) return cachedSheetName;
  const token = await getAccessToken();
  const metaUrl = `https://sheets.googleapis.com/v4/spreadsheets/${SPREADSHEET_ID}?fields=sheets.properties`;
  const res = await httpRequest("GET", metaUrl, { token });
  if (res.status !== 200) throw new Error("No se pudo leer metadata del spreadsheet: " + JSON.stringify(res.body));
  const sheets = res.body.sheets || [];
  let target = sheets.find((s) => s.properties.title === SHEET_NAME_ENV);
  if (!target) target = sheets.find((s) => s.properties.sheetId === FALLBACK_GID);
  if (!target) throw new Error(`No se encontró la hoja "${SHEET_NAME_ENV}" ni el gid de respaldo.`);
  cachedSheetName = target.properties.title;
  return cachedSheetName;
}

async function getValues(range) {
  const token = await getAccessToken();
  const sheetName = await resolveSheetName();
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${SPREADSHEET_ID}/values/${encodeURIComponent(`'${sheetName}'!${range}`)}`;
  const res = await httpRequest("GET", url, { token });
  if (res.status !== 200) throw new Error("Error leyendo rango " + range + ": " + JSON.stringify(res.body));
  return res.body.values || [];
}

async function batchUpdateValues(entries) {
  // entries: [{ range: "B5:E5", values: [[...]] }, ...]  (range SIN nombre de hoja)
  const token = await getAccessToken();
  const sheetName = await resolveSheetName();
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${SPREADSHEET_ID}/values:batchUpdate`;
  const body = {
    valueInputOption: "USER_ENTERED",
    data: entries.map((e) => ({ range: `'${sheetName}'!${e.range}`, values: e.values })),
  };
  const res = await httpRequest("POST", url, { token, body });
  if (res.status !== 200) throw new Error("Error en batchUpdate: " + JSON.stringify(res.body));
  return res.body;
}

// ── Próxima fila vacía — SOLO mira la columna B (Negocio). ───────────────
// A propósito no usamos values.append con rango abierto: su auto-detección
// de "tabla" cuenta cualquier celda de la fila (incluyendo J/K, que tienen
// fórmula/dropdown precargados en las filas preparadas manualmente) como
// "ocupada", lo que además desalinea la columna de inicio de la escritura.
// Mirar solo B evita ambos problemas.
async function findNextEmptyRow() {
  const colB = await getValues("B2:B5000");
  for (let i = 0; i < colB.length; i++) {
    if (!colB[i][0] || !String(colB[i][0]).trim()) return i + 2; // +2: fila 1 = headers
  }
  return colB.length + 2;
}

// ── Escribe un lead nuevo en la próxima fila vacía, con rango EXPLÍCITO
// (fila y columna) — nada de auto-detección de Google que pueda desviarse.
// values13 sigue el orden B..N (13 columnas), pero la escritura se parte
// en B..J y L..N, SALTÁNDOSE la K (Próxima acción) por completo — esa
// celda ya trae una fórmula precargada y nunca debe tocarse, ni con "".
async function writeNewLeadRow(values13) {
  const row = await findNextEmptyRow();
  const valuesBJ = values13.slice(0, 9);   // B,C,D,E,F,G,H,I,J
  const valuesLN = values13.slice(10, 13); // L,M,N (se salta el índice 9 = K)
  await batchUpdateValues([
    { range: `A${row}`, values: [[row - 1]] },        // "#" — continúa la numeración consecutiva (fila 2 = 1)
    { range: `B${row}:J${row}`, values: [valuesBJ] },
    { range: `L${row}:N${row}`, values: [valuesLN] },
  ]);
  return row;
}

async function findRowByPhone(phoneNormalized) {
  const colD = await getValues("D2:D5000");
  for (let i = 0; i < colD.length; i++) {
    const cell = (colD[i][0] || "").replace(/\D/g, "");
    if (cell && cell === phoneNormalized) return i + 2; // +2: fila 1 = headers
  }
  return null;
}

// ── Espejo de "Copiar" — Negocio/Rubro/Teléfono/Canal/Etapa/Mensaje ──────
async function mirrorCopy(lead) {
  console.log(`[sheets-client] intentando mirrorCopy para lead ${lead.phone} (${lead.negocio})`);
  try {
    const row = await findRowByPhone(lead.phone);
    if (row) {
      console.log(`[sheets-client] mirrorCopy: fila existente #${row} — actualizando B:E, J, N`);
      await batchUpdateValues([
        { range: `B${row}:E${row}`, values: [[lead.negocio, lead.rubro, lead.telefono, lead.canal]] },
        { range: `J${row}`, values: [[lead.etapa]] },
        { range: `N${row}`, values: [[lead.mensajeEnviado]] },
      ]);
    } else {
      // B..N en orden: Negocio, Rubro, Telefono, Canal, 1erContacto, UltimoContacto,
      // NumContactos, Respondio, Etapa, ProximaAccion, Notas, NumeroUsado, MensajeEnviado
      const newRow = await writeNewLeadRow([
        lead.negocio, lead.rubro, lead.telefono, lead.canal,
        "", "", "", "", lead.etapa, "", "", "", lead.mensajeEnviado,
      ]);
      console.log(`[sheets-client] mirrorCopy: sin fila previa — escrita en fila #${newRow}`);
    }
    console.log(`[sheets-client] mirrorCopy OK para lead ${lead.phone}`);
    return { ok: true };
  } catch (err) {
    console.error("[sheets-client] mirrorCopy FALLÓ para lead", lead.phone, "-", err.message);
    return { ok: false, error: err.message };
  }
}

// ── Espejo de cambio de Etapa (con o sin contacto confirmado) ───────────
async function mirrorStage(lead, { contactUpdated } = {}) {
  console.log(`[sheets-client] intentando mirrorStage para lead ${lead.phone} (${lead.negocio}) → etapa="${lead.etapa}" contactUpdated=${Boolean(contactUpdated)}`);
  try {
    const row = await findRowByPhone(lead.phone);
    if (!row) {
      // No debería pasar (mirrorCopy corre primero), pero por robustez
      // escribimos la fila nueva con lo que tengamos.
      const newRow = await writeNewLeadRow([
        lead.negocio, lead.rubro, lead.telefono, lead.canal,
        lead.primerContacto, lead.ultimoContacto, lead.numContactos, "",
        lead.etapa, "", "", lead.numeroUsado, lead.mensajeEnviado,
      ]);
      console.log(`[sheets-client] mirrorStage: sin fila previa — escrita en fila #${newRow}`);
      return { ok: true };
    }
    if (contactUpdated) {
      await batchUpdateValues([
        { range: `F${row}:H${row}`, values: [[lead.primerContacto, lead.ultimoContacto, lead.numContactos]] },
        { range: `J${row}`, values: [[lead.etapa]] },
        { range: `M${row}`, values: [[lead.numeroUsado]] },
      ]);
    } else {
      await batchUpdateValues([{ range: `J${row}`, values: [[lead.etapa]] }]);
    }
    console.log(`[sheets-client] mirrorStage OK para lead ${lead.phone}`);
    return { ok: true };
  } catch (err) {
    console.error("[sheets-client] mirrorStage FALLÓ para lead", lead.phone, "-", err.message);
    return { ok: false, error: err.message };
  }
}

module.exports = { COL, getValues, batchUpdateValues, findRowByPhone, mirrorCopy, mirrorStage, resolveSheetName };
