/**
 * sunat-validate.js
 * Valida RUCs contra SUNAT usando Playwright.
 * Navega al formulario, ingresa el RUC, hace clic en Buscar y parsea los resultados.
 */

const { chromium } = require("playwright");

const SUNAT_BASE = "https://e-consultaruc.sunat.gob.pe/cl-ti-itmrconsruc/jcrS00Alias";

/**
 * Consulta el estado de UN RUC en el portal de SUNAT.
 * @param {import('playwright').Page} page
 * @param {string} ruc
 * @returns {Promise<{ estado: string, condicion: string } | null>}
 */
async function fetchRucStatus(page, ruc) {
  try {
    // 1. Cargar el formulario de busqueda
    await page.goto(SUNAT_BASE, { waitUntil: "domcontentloaded", timeout: 20000 });

    // 2. Ingresar el RUC y hacer clic en Buscar (dispara reCAPTCHA v3 + POST)
    await page.waitForSelector("#txtRuc", { timeout: 10000 });
    await page.fill("#txtRuc", ruc);
    await Promise.all([
      page.waitForNavigation({ waitUntil: "domcontentloaded", timeout: 30000 }).catch(() => {}),
      page.click("#btnAceptar"),
    ]);
    await page.waitForTimeout(2000);

    // 3. Extraer texto plano del body y parsear con regex
    // El bodyText tiene el formato exacto:
    //   "Estado del Contribuyente:\n\nBAJA DE OFICIO\n..."
    //   "Condicion del Contribuyente:\n\nNO HABIDO\n..."
    const bodyText = await page.evaluate(function() {
      return document.body ? document.body.innerText : "";
    }).catch(() => "");

    if (!bodyText || bodyText.length < 100) return null;

    let estado    = null;
    let condicion = null;

    var estadoMatch = bodyText.match(/Estado del Contribuyente:\s*\n+\s*([^\n]+)/i);
    if (estadoMatch) estado = estadoMatch[1].trim().toUpperCase();

    var condMatch = bodyText.match(/Condici[oó]n del Contribuyente:\s*\n+\s*([^\n]+)/i);
    if (condMatch) condicion = condMatch[1].trim().toUpperCase();

    if (!estado && !condicion) return null;
    return {
      estado:    estado    || "DESCONOCIDO",
      condicion: condicion || "DESCONOCIDO",
    };

  } catch (err) {
    console.error("[SUNAT] fetchRucStatus error:", ruc, err.message);
    return null;
  }
}

/**
 * Filtra una lista de businesses validando cada RUC contra SUNAT.
 */
async function validateBusinesses(businesses, opts) {
  var concurrency = (opts && opts.concurrency) || 2;
  var delayMs     = (opts && opts.delayMs)     || 800;
  var headless    = (opts && opts.headless !== undefined) ? opts.headless : true;
  var onProgress  = (opts && opts.onProgress)  || null;

  var valid     = [];
  var discarded = [];
  var skipped   = [];

  var total = businesses.length;
  var done  = 0;

  if (onProgress) onProgress({
    stage: "sunat_validando",
    message: "Validando " + total + " RUCs contra SUNAT...",
    total: total, current: 0,
  });

  var browser = await chromium.launch({
    headless: headless,
    args: [
      "--disable-blink-features=AutomationControlled",
      "--no-sandbox",
      "--disable-setuid-sandbox",
    ],
  });

  for (var i = 0; i < businesses.length; i += concurrency) {
    var batch = businesses.slice(i, i + concurrency);

    await Promise.all(batch.map(async function(biz, idx) {
      if (idx > 0) await sleep(idx * 400);

      var ruc = (biz.ruc || "").trim();
      if (!ruc) {
        biz.sunatEstado    = "SIN_RUC";
        biz.sunatCondicion = "-";
        skipped.push(biz);
        return;
      }

      var context = await browser.newContext({
        locale: "es-PE",
        userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
      });
      var page = await context.newPage();

      try {
        var result = await fetchRucStatus(page, ruc);

        if (!result) {
          biz.sunatEstado    = "NO_VALIDADO";
          biz.sunatCondicion = "-";
          skipped.push(biz);
        } else {
          biz.sunatEstado    = result.estado;
          biz.sunatCondicion = result.condicion;

          if (result.estado === "ACTIVO" && result.condicion === "HABIDO") {
            valid.push(biz);
          } else {
            discarded.push(biz);
          }
        }
      } finally {
        await context.close();
      }
    }));

    done = Math.min(i + concurrency, total);
    if (onProgress) onProgress({
      stage: "sunat_validando",
      message: "SUNAT: " + done + "/" + total + " validados...",
      total: total, current: done,
    });

    if (i + concurrency < businesses.length) await sleep(delayMs);
  }

  await browser.close();

  var msg = "SUNAT: " + valid.length + " activas/habidas - " +
            discarded.length + " descartadas - " +
            skipped.length + " sin confirmar";

  if (onProgress) onProgress({
    stage: "sunat_done",
    message: msg,
    total: total, valid: valid.length, discarded: discarded.length, skipped: skipped.length,
  });

  console.log("[SUNAT]", msg);
  if (discarded.length > 0) {
    console.log("[SUNAT] Descartadas:", discarded.slice(0, 5).map(function(b) {
      return b.ruc + " " + b.name + " -> " + b.sunatEstado + "/" + b.sunatCondicion;
    }));
  }

  return { valid: valid, discarded: discarded, skipped: skipped };
}

function sleep(ms) { return new Promise(function(r) { setTimeout(r, ms); }); }

module.exports = { validateBusinesses: validateBusinesses, fetchRucStatus: fetchRucStatus };
