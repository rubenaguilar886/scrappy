/**
 * sunat-validate.js
 * Valida RUCs contra SUNAT usando Playwright.
 * Navega al formulario, ingresa el RUC, hace clic en Buscar y parsea los resultados.
 *
 * Tambien resuelve la "Fecha de Inicio de Actividades" (antiguedad real del
 * negocio, verificada por SUNAT) — util como senal de "etapa del negocio"
 * mucho mas confiable que el numero de resenas de Google Maps.
 *
 * Cuando no se conoce el RUC (el caso normal para leads de Google Maps —
 * solo el scraper de "produce" trae RUC de forma directa), se busca primero
 * por razon social. Esa busqueda es AMBIGUA a proposito de forma defensiva:
 * un nombre generico como "salon de belleza" trae decenas de resultados sin
 * relacion real con el negocio buscado. Si no hay un match unico y confiable,
 * se marca como "no encontrado" en vez de adivinar — mejor un dato faltante
 * que un dato mal informado alimentando los filtros.
 */

const { chromium } = require("playwright");

const SUNAT_BASE = "https://e-consultaruc.sunat.gob.pe/cl-ti-itmrconsruc/jcrS00Alias";

// Sufijos societarios comunes en Peru — se quitan para comparar nombres,
// ya que el nombre comercial de Maps casi nunca los incluye.
const LEGAL_SUFFIXES = [
  "SOCIEDAD ANONIMA CERRADA", "SOCIEDAD ANONIMA ABIERTA", "SOCIEDAD ANONIMA",
  "SOCIEDAD COMERCIAL DE RESPONSABILIDAD LIMITADA",
  "EMPRESA INDIVIDUAL DE RESPONSABILIDAD LIMITADA",
  "S.A.C.", "S.A.A.", "S.A.", "S.R.L.", "S.C.R.L.", "E.I.R.L.", "S.C.",
];

function normalizeForMatch(str) {
  if (!str) return "";
  let s = str
    .toUpperCase()
    .normalize("NFD").replace(/[̀-ͯ]/g, "") // quita tildes
    .replace(/[.,]/g, " ");
  for (const suf of LEGAL_SUFFIXES) {
    s = s.replace(new RegExp("\\b" + suf.replace(/\./g, "\\.?") + "\\b", "g"), " ");
  }
  return s.replace(/\s+/g, " ").trim();
}

/** true si dos nombres normalizados se refieren probablemente al mismo negocio. */
function namesLikelyMatch(a, b) {
  const na = normalizeForMatch(a);
  const nb = normalizeForMatch(b);
  if (!na || !nb) return false;
  return na === nb || na.includes(nb) || nb.includes(na);
}

function parseFechaInicio(bodyText) {
  const m = bodyText.match(/Fecha de Inicio de Actividades:\s*\n+\s*([^\n]+)/i);
  return m ? m[1].trim() : null;
}

/** Convierte "dd/mm/yyyy" a años transcurridos (float, 1 decimal), o null si no se puede parsear. */
function computeBusinessAgeYears(fechaInicioStr) {
  if (!fechaInicioStr) return null;
  const m = fechaInicioStr.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (!m) return null;
  const [, dd, mm, yyyy] = m;
  const start = new Date(Number(yyyy), Number(mm) - 1, Number(dd));
  if (isNaN(start.getTime())) return null;
  const years = (Date.now() - start.getTime()) / (1000 * 60 * 60 * 24 * 365.25);
  return years < 0 ? null : Math.round(years * 10) / 10;
}

/** Parsea el cuerpo de la pagina de detalle de un RUC (estado, condicion, fecha de inicio). */
function parseRucDetail(bodyText) {
  if (!bodyText || bodyText.length < 100) return null;

  let estado = null;
  let condicion = null;

  const estadoMatch = bodyText.match(/Estado del Contribuyente:\s*\n+\s*([^\n]+)/i);
  if (estadoMatch) estado = estadoMatch[1].trim().toUpperCase();

  const condMatch = bodyText.match(/Condici[oó]n del Contribuyente:\s*\n+\s*([^\n]+)/i);
  if (condMatch) condicion = condMatch[1].trim().toUpperCase();

  if (!estado && !condicion) return null;

  const fechaInicio = parseFechaInicio(bodyText);

  return {
    estado: estado || "DESCONOCIDO",
    condicion: condicion || "DESCONOCIDO",
    fechaInicio,
    businessAgeYears: computeBusinessAgeYears(fechaInicio),
  };
}

/**
 * Consulta el estado de UN RUC en el portal de SUNAT.
 * @param {import('playwright').Page} page
 * @param {string} ruc
 * @returns {Promise<{ estado: string, condicion: string, fechaInicio: string|null, businessAgeYears: number|null } | null>}
 */
async function fetchRucStatus(page, ruc) {
  try {
    await page.goto(SUNAT_BASE, { waitUntil: "domcontentloaded", timeout: 20000 });

    await page.waitForSelector("#txtRuc", { timeout: 10000 });
    await page.fill("#txtRuc", ruc);
    await Promise.all([
      page.waitForNavigation({ waitUntil: "domcontentloaded", timeout: 30000 }).catch(() => {}),
      page.click("#btnAceptar"),
    ]);
    await page.waitForTimeout(2000);

    const bodyText = await page.evaluate(function() {
      return document.body ? document.body.innerText : "";
    }).catch(() => "");

    return parseRucDetail(bodyText);
  } catch (err) {
    console.error("[SUNAT] fetchRucStatus error:", ruc, err.message);
    return null;
  }
}

/**
 * Busca un negocio por razon social/nombre comercial cuando no se conoce el RUC.
 * Defensivo a proposito: solo devuelve un resultado si hay UN match confiable,
 * nunca "el primero de la lista" sobre un nombre generico.
 *
 * @param {import('playwright').Page} page
 * @param {string} name - nombre del negocio (tal cual viene de Google Maps)
 * @returns {Promise<{ ruc, estado, condicion, fechaInicio, businessAgeYears, matchConfidence: 'exact_single'|'narrowed'|'ambiguous'|'not_found' }>}
 */
async function searchRucByName(page, name) {
  const notFound = { ruc: null, estado: null, condicion: null, fechaInicio: null, businessAgeYears: null, matchConfidence: "not_found" };
  if (!name || !name.trim()) return notFound;

  try {
    await page.goto(SUNAT_BASE, { waitUntil: "domcontentloaded", timeout: 20000 });
    await page.waitForSelector("#btnPorRazonSocial", { timeout: 10000 });
    await page.click("#btnPorRazonSocial");
    await page.waitForSelector("#txtNombreRazonSocial", { timeout: 10000 });
    await page.fill("#txtNombreRazonSocial", name.trim());

    await Promise.all([
      page.waitForNavigation({ waitUntil: "domcontentloaded", timeout: 30000 }).catch(() => {}),
      page.click("#btnAceptar"),
    ]);
    await page.waitForTimeout(1500);

    let bodyText = await page.evaluate(() => document.body ? document.body.innerText : "").catch(() => "");

    // Caso 1: match unico exacto — SUNAT salta directo a la pagina de detalle.
    if (/N[uú]mero de RUC:/i.test(bodyText)) {
      const detail = parseRucDetail(bodyText);
      const rucMatch = bodyText.match(/N[uú]mero de RUC:\s*\n+\s*(\d{11})/i);
      if (detail) return { ruc: rucMatch ? rucMatch[1] : null, ...detail, matchConfidence: "exact_single" };
      return notFound;
    }

    // Caso 2: lista de candidatos ("Relacion de contribuyentes").
    if (!/Relaci[oó]n de contribuyentes/i.test(bodyText)) return notFound;

    const candidates = [];
    const blockRx = /RUC:\s*(\d{11})\s*\n+\s*([^\n]+)\n[\s\S]*?Estado:\s*([^\n]+)/g;
    let m;
    while ((m = blockRx.exec(bodyText)) !== null) {
      candidates.push({ ruc: m[1], razonSocial: m[2].trim(), estado: m[3].trim().toUpperCase() });
    }

    const matching = candidates.filter(c => namesLikelyMatch(name, c.razonSocial));
    if (matching.length === 0) return { ...notFound, matchConfidence: "not_found" };

    // Si hay varios matches de nombre, preferir los ACTIVOS antes de rendirse.
    let pick = matching;
    if (matching.length > 1) {
      const active = matching.filter(c => c.estado === "ACTIVO");
      if (active.length === 1) pick = active;
    }
    if (pick.length !== 1) {
      return { ...notFound, matchConfidence: "ambiguous" };
    }

    const chosen = pick[0];
    const link = await page.locator(`a.aRucs:has-text("${chosen.ruc}")`).first();
    await Promise.all([
      page.waitForNavigation({ waitUntil: "domcontentloaded", timeout: 30000 }).catch(() => {}),
      link.click(),
    ]);
    await page.waitForTimeout(1500);

    bodyText = await page.evaluate(() => document.body ? document.body.innerText : "").catch(() => "");
    const detail = parseRucDetail(bodyText);
    if (!detail) return { ...notFound, matchConfidence: "not_found" };

    return { ruc: chosen.ruc, ...detail, matchConfidence: matching.length > 1 ? "narrowed" : "exact_single" };
  } catch (err) {
    console.error("[SUNAT] searchRucByName error:", name, err.message);
    return notFound;
  }
}

/**
 * Resuelve la antiguedad/estado de un negocio: usa el RUC si ya se conoce
 * (ej. fuente "produce"), si no busca por nombre de forma defensiva.
 * Nunca adivina — si no hay un match confiable, deja los campos en null
 * y marca matchConfidence "not_found"/"ambiguous" para que el filtro de
 * "etapa del negocio" lo trate como dato faltante, no como dato malo.
 */
async function lookupBusinessAge(page, business) {
  const ruc = (business.ruc || "").trim();
  if (ruc) {
    const result = await fetchRucStatus(page, ruc);
    return result ? { ruc, ...result, matchConfidence: "ruc_known" } : { ruc, matchConfidence: "not_found" };
  }
  return searchRucByName(page, business.name || "");
}

/**
 * Enriquece una lista de businesses con antiguedad/estado SUNAT.
 * Mismo patron de concurrencia/progreso que validateBusinesses.
 */
async function enrichBusinessAge(businesses, opts) {
  const concurrency = (opts && opts.concurrency) || 2;
  const delayMs     = (opts && opts.delayMs)     || 800;
  const headless    = (opts && opts.headless !== undefined) ? opts.headless : true;
  const onProgress  = (opts && opts.onProgress)  || null;

  const total = businesses.length;
  let done = 0;

  if (onProgress) onProgress({ stage: "sunat_edad", message: `Resolviendo antigüedad de ${total} negocios...`, total, current: 0 });

  const browser = await chromium.launch({
    headless,
    args: ["--disable-blink-features=AutomationControlled", "--no-sandbox", "--disable-setuid-sandbox"],
  });

  for (let i = 0; i < businesses.length; i += concurrency) {
    const batch = businesses.slice(i, i + concurrency);

    await Promise.all(batch.map(async (biz, idx) => {
      if (idx > 0) await sleep(idx * 400);

      const context = await browser.newContext({
        locale: "es-PE",
        userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
      });
      const page = await context.newPage();

      try {
        const result = await lookupBusinessAge(page, biz);
        biz.sunatRuc              = result.ruc || null;
        biz.sunatEstado           = result.estado || null;
        biz.sunatCondicion        = result.condicion || null;
        biz.sunatFechaInicio      = result.fechaInicio || null;
        biz.businessAgeYears      = result.businessAgeYears ?? null;
        biz.sunatMatchConfidence  = result.matchConfidence;
      } finally {
        await context.close();
      }
    }));

    done = Math.min(i + concurrency, total);
    if (onProgress) onProgress({ stage: "sunat_edad", message: `Antigüedad: ${done}/${total}...`, total, current: done });

    if (i + concurrency < businesses.length) await sleep(delayMs);
  }

  await browser.close();

  const resolved = businesses.filter(b => b.businessAgeYears != null).length;
  console.log(`[SUNAT] Antigüedad resuelta para ${resolved}/${total} negocios.`);

  return businesses;
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
          biz.sunatEstado      = result.estado;
          biz.sunatCondicion   = result.condicion;
          biz.sunatFechaInicio = result.fechaInicio;
          biz.businessAgeYears = result.businessAgeYears;

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

module.exports = {
  validateBusinesses,
  fetchRucStatus,
  searchRucByName,
  lookupBusinessAge,
  enrichBusinessAge,
  computeBusinessAgeYears,
};
