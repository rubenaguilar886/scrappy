/**
 * check-sheet.js  — diagnóstico de columnas en Google Sheets
 * Uso: node check-sheet.js
 * No requiere ningún paquete extra — solo módulos nativos de Node.
 */

'use strict';

const crypto  = require('crypto');
const https   = require('https');
const path    = require('path');
const fs      = require('fs');

// ── Config ────────────────────────────────────────────────────────────
const CREDS_PATH      = path.join(__dirname, 'google-credentials.json');
const SPREADSHEET_ID  = '1ekEk6XkbSysgZeYZMpIdoWN008oUaBc40nUZPMEsfZc';
const TARGET_GID      = 1983350997;   // gid del link

// ── Helpers ───────────────────────────────────────────────────────────
function b64url(str) {
  return Buffer.from(str).toString('base64url');
}

function makeJWT(creds, scope) {
  const header  = b64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const now     = Math.floor(Date.now() / 1000);
  const payload = b64url(JSON.stringify({
    iss: creds.client_email,
    scope,
    aud: 'https://oauth2.googleapis.com/token',
    exp: now + 3600,
    iat: now,
  }));
  const toSign  = `${header}.${payload}`;
  const sign    = crypto.createSign('RSA-SHA256');
  sign.update(toSign);
  const sig = sign.sign(creds.private_key, 'base64url');
  return `${toSign}.${sig}`;
}

function post(url, body) {
  return new Promise((resolve, reject) => {
    const buf  = Buffer.from(body);
    const opts = {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Content-Length': buf.length },
    };
    const req = https.request(url, opts, res => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        try { resolve({ status: res.statusCode, body: JSON.parse(data) }); }
        catch { resolve({ status: res.statusCode, body: data }); }
      });
    });
    req.on('error', reject);
    req.write(buf);
    req.end();
  });
}

function get(url, token) {
  return new Promise((resolve, reject) => {
    const opts = { headers: { Authorization: 'Bearer ' + token } };
    https.get(url, opts, res => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        try { resolve({ status: res.statusCode, body: JSON.parse(data) }); }
        catch { resolve({ status: res.statusCode, body: data }); }
      });
    }).on('error', reject);
  });
}

// ── Main ──────────────────────────────────────────────────────────────
async function main() {
  // 1. Cargar credenciales
  let creds;
  try {
    creds = JSON.parse(fs.readFileSync(CREDS_PATH, 'utf8'));
  } catch {
    console.error('❌  No se encontró google-credentials.json en', CREDS_PATH);
    process.exit(1);
  }
  console.log('✓  Credenciales cargadas — cuenta:', creds.client_email);

  // 2. Obtener access token
  const jwt = makeJWT(creds, 'https://www.googleapis.com/auth/spreadsheets.readonly');
  const tokenRes = await post(
    'https://oauth2.googleapis.com/token',
    `grant_type=urn%3Aietf%3Aparams%3Aoauth%3Agrant-type%3Ajwt-bearer&assertion=${jwt}`
  );
  if (tokenRes.status !== 200 || !tokenRes.body.access_token) {
    console.error('❌  Error al obtener token:', JSON.stringify(tokenRes.body, null, 2));
    process.exit(1);
  }
  const token = tokenRes.body.access_token;
  console.log('✓  Access token obtenido\n');

  // 3. Leer metadata para encontrar el nombre del tab por gid
  const metaUrl = `https://sheets.googleapis.com/v4/spreadsheets/${SPREADSHEET_ID}?fields=sheets.properties`;
  const metaRes = await get(metaUrl, token);
  if (metaRes.status !== 200) {
    console.error('❌  Error al leer metadata:', JSON.stringify(metaRes.body, null, 2));
    process.exit(1);
  }

  const sheets      = metaRes.body.sheets || [];
  const targetSheet = sheets.find(s => s.properties.sheetId === TARGET_GID);
  if (!targetSheet) {
    console.log('⚠️  Tabs disponibles:');
    sheets.forEach(s => console.log(`   gid=${s.properties.sheetId}  →  "${s.properties.title}"`));
    process.exit(1);
  }
  const sheetName = targetSheet.properties.title;
  console.log(`✓  Tab encontrado: "${sheetName}" (gid ${TARGET_GID})\n`);

  // 4. Leer primera fila (headers)
  const range    = encodeURIComponent(`'${sheetName}'!1:1`);
  const dataUrl  = `https://sheets.googleapis.com/v4/spreadsheets/${SPREADSHEET_ID}/values/${range}`;
  const dataRes  = await get(dataUrl, token);
  if (dataRes.status !== 200) {
    console.error('❌  Error al leer fila de headers:', JSON.stringify(dataRes.body, null, 2));
    process.exit(1);
  }

  const rows = dataRes.body.values || [];
  if (!rows.length || !rows[0].length) {
    console.log('⚠️  La primera fila está vacía — la hoja no tiene headers todavía.');
    process.exit(0);
  }

  const headers = rows[0];
  console.log('══════════════════════════════════════════');
  console.log(`  COLUMNAS ACTUALES (${headers.length} columnas)`);
  console.log('══════════════════════════════════════════');
  headers.forEach((h, i) => console.log(`  ${String(i + 1).padStart(2, '0')}  ${h}`));
  console.log('══════════════════════════════════════════');

  // 5. Leer también primera fila de datos para ver ejemplos
  const dataRow2Url = `https://sheets.googleapis.com/v4/spreadsheets/${SPREADSHEET_ID}/values/${encodeURIComponent(`'${sheetName}'!2:2`)}`;
  const row2Res     = await get(dataRow2Url, token);
  const row2        = (row2Res.body.values || [[]])[0];
  if (row2.length) {
    console.log('\n  EJEMPLO (fila 2):');
    headers.forEach((h, i) => console.log(`  ${String(i + 1).padStart(2, '0')}  ${h}: ${row2[i] ?? '(vacío)'}`));
  }
}

main().catch(err => { console.error('Error inesperado:', err); process.exit(1); });
