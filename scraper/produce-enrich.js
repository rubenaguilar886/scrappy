/**
 * produce-enrich.js
 * Flujo de enriquecimiento:
 *   1. datosperu.org → nombre gerente/rep. legal, fecha constitución
 *   2. LinkedIn via Google site: search → perfil del gerente
 *   3. Fallback: Google → WA / tel / móvil en texto
 *   4. Fallback: website orgánico → raspar contacto
 */

const { chromium } = require("playwright");

const RE_WA       = /wa\.me\/(?:51)?(\d{9})/gi;
const RE_EMAIL    = /[\w.+-]+@[\w.-]+\.[a-z]{2,}/gi;
const RE_TEL_HREF = /href=["']tel:([+\d\s\-()]+)["']/gi;

function parsePeruvianPhone(raw) {
  const digits = raw.replace(/\D/g, "");
  const clean  = digits.startsWith("51") ? digits.slice(2) : digits;
  if (clean.startsWith("9") && clean.length === 9) return "+51" + clean;
  if (clean.length === 7) return "01" + clean;
  return null;
}

function mobileFromText(text) {
  if (!text) return null;
  const m = text.match(/\b(9\d{2}[\s\-]?\d{3}[\s\-]?\d{3})\b/);
  if (!m) return null;
  const d = m[1].replace(/\D/g, "");
  return (d.length === 9 && d.startsWith("9")) ? "+51" + d : null;
}

function fixedFromText(text) {
  if (!text) return null;
  const m = text.match(/\(01\)\s*(\d{7})\b/);
  return m ? "(01) " + m[1].slice(0, 3) + "-" + m[1].slice(3) : null;
}

function emailFromHtml(html) {
  if (!html) return null;
  RE_EMAIL.lastIndex = 0;
  const m = RE_EMAIL.exec(html);
  if (!m) return null;
  const e = m[0];
  if (e.includes("example") || e.includes("noreply") || e.includes("domain") || e.includes("google")) return null;
  return e;
}

async function getBodyText(page) {
  return page.evaluate(function() {
    return document.body ? document.body.innerText : "";
  }).catch(function() { return ""; });
}

/**
 * Extrae contacto generico de cualquier pagina ya cargada.
 */
async function extractContactFromPage(page) {
  const html     = await page.content().catch(function() { return ""; });
  const bodyText = await getBodyText(page);
  const result   = { phone: null, email: null, whatsapp: null };

  RE_WA.lastIndex = 0;
  const wa = RE_WA.exec(html);
  if (wa) { result.whatsapp = "+51" + wa[1]; result.phone = result.whatsapp; }

  RE_TEL_HREF.lastIndex = 0;
  const tel = RE_TEL_HREF.exec(html);
  if (tel && !result.phone) { const p = parsePeruvianPhone(tel[1]); if (p) result.phone = p; }

  if (!result.phone) result.phone = mobileFromText(bodyText);
  if (!result.phone) result.phone = fixedFromText(bodyText);
  if (!result.email) result.email = emailFromHtml(html);

  return result;
}

/**
 * Extrae el primer website organico (sin redes sociales ni directorios) de Google.
 */
async function extractWebsite(page) {
  const EXCLUDE = [
    "google.", "youtube.", "facebook.", "instagram.", "wikipedia.", "twitter.",
    "linkedin.", "tiktok.", "paginasamarillas.", "kompass.", "datosperu.",
  ];
  try {
    const cites = await page.locator("cite").allInnerTexts();
    for (const cite of cites) {
      const c = cite.trim().toLowerCase();
      if (!c) continue;
      if (EXCLUDE.some(function(d) { return c.includes(d); })) continue;
      const url = c.startsWith("http") ? c : "https://" + c;
      return url.split(" ")[0];
    }
  } catch {}
  return null;
}

// ─── PASO 1: datosperu.org ────────────────────────────────────────────────────

/**
 * Consulta datosperu.org por RUC y extrae:
 *   - Estado SUNAT (ACTIVO, BAJA, etc.)
 *   - Condición de domicilio (HABIDO, NO HABIDO)
 *   - Nombre del gerente / representante legal
 *   - Fecha de inscripción
 *
 * Usa extracción DOM directa (más robusta que parsear bodyText)
 * con fallback a regex sobre innerText.
 */
async function lookupDatosPeru(page, ruc) {
  var result = { gerente: null, fechaConstitucion: null, sunatEstado: null, sunatCondicion: null };
  if (!ruc) return result;

  var url = "https://www.datosperu.org/ruc/" + ruc;
  try {
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 20000 });
    await page.waitForTimeout(1500);

    var extracted = await page.evaluate(function() {
      var r = { gerente: null, fechaConstitucion: null, sunatEstado: null, sunatCondicion: null };
      var bodyText = document.body ? document.body.innerText : "";
      if (!bodyText || bodyText.length < 50) return r;

      // ── Estado y Condición SUNAT ───────────────────────────────────────
      var estadoM = bodyText.match(/Estado\s*(?:del\s*Contribuyente)?\s*[:\n]+\s*(ACTIVO|BAJA[^\n]*|INHABILITADO[^\n]*|SUSPENSION[^\n]*)/i);
      if (estadoM) r.sunatEstado = estadoM[1].trim().toUpperCase();

      var condM = bodyText.match(/Condici[oó]n\s*(?:de\s*Domicilio)?\s*[:\n]+\s*(HABIDO|NO HABIDO[^\n]*)/i);
      if (condM) r.sunatCondicion = condM[1].trim().toUpperCase();

      // ── Fecha de Inscripción ───────────────────────────────────────────
      var fechaM = bodyText.match(/(?:Fecha\s*(?:de\s*)?Inscripci[oó]n|Inicio\s*Actividades)\s*[:\n]+\s*(\d{2}\/\d{2}\/\d{4})/i);
      if (fechaM) r.fechaConstitucion = fechaM[1];

      // ── Gerente / Representante Legal — DOM directo ────────────────────
      // datosperu muestra tabla con cols NOMBRE | CARGO | DESDE
      // El nombre tiene un badge "N empresas" como elemento hijo — hay que ignorarlo
      var cargos = ["GERENTE GENERAL", "GERENTE", "TITULAR", "REPRESENTANTE LEGAL", "SOCIO GERENTE", "ADMINISTRADOR"];
      var tables = document.querySelectorAll("table");

      for (var t = 0; t < tables.length && !r.gerente; t++) {
        var rows = tables[t].querySelectorAll("tr");
        for (var ri = 0; ri < rows.length && !r.gerente; ri++) {
          var cells = rows[ri].querySelectorAll("td, th");
          if (cells.length < 2) continue;
          var cargoText = (cells[1].textContent || "").trim().toUpperCase();
          var cargoOk = cargos.some(function(c) { return cargoText.indexOf(c) !== -1; });
          if (!cargoOk) continue;

          // Extraer nombre: priorizar el <a> dentro de la celda (evita el badge)
          var nameLink = cells[0].querySelector("a");
          if (nameLink && nameLink.textContent.trim().length > 3) {
            r.gerente = nameLink.textContent.trim();
          } else {
            // Recorrer nodos hijos, tomar solo TextNode y <a>, ignorar spans de badge
            var nodes = cells[0].childNodes;
            var parts = [];
            for (var ni = 0; ni < nodes.length; ni++) {
              var node = nodes[ni];
              if (node.nodeType === 3 && node.textContent.trim()) {
                parts.push(node.textContent.trim());
              } else if (node.nodeName === "A" && node.textContent.trim()) {
                parts.push(node.textContent.trim());
              }
            }
            r.gerente = parts.filter(Boolean).join(" ").trim() || null;
          }
        }
      }

      // ── Fallback: bodyText con búsqueda hacia atrás desde el cargo ────
      if (!r.gerente) {
        var lines = bodyText.split("\n").map(function(l) { return l.trim(); }).filter(Boolean);
        for (var i = 0; i < lines.length && !r.gerente; i++) {
          var lineUp = lines[i].toUpperCase();
          var cargoFound = cargos.some(function(c) { return lineUp === c || lineUp.indexOf(c) === 0; });
          if (!cargoFound) continue;
          // Buscar nombre en líneas anteriores (hasta 3), saltando badges "N empresas"
          for (var back = 1; back <= 3; back++) {
            var candidate = lines[i - back];
            if (!candidate) continue;
            if (/^\d+\s+empresa/i.test(candidate)) continue; // badge "5 empresas"
            if (/^(NOMBRE|CARGO|DESDE|FECHA|REPRESENTANTE|ALGUNOS|EJECUTIVO|DIRECTOR)/i.test(candidate)) continue;
            if (/^[A-ZÁÉÍÓÚÑ][A-ZÁÉÍÓÚÑA-Za-záéíóúñ\s\.]{4,80}$/.test(candidate)) {
              r.gerente = candidate;
              break;
            }
          }
        }
      }

      return r;
    }).catch(function() { return {}; });

    if (extracted.gerente)           result.gerente           = toTitleCase(extracted.gerente);
    if (extracted.fechaConstitucion) result.fechaConstitucion = extracted.fechaConstitucion;
    if (extracted.sunatEstado)       result.sunatEstado       = extracted.sunatEstado;
    if (extracted.sunatCondicion)    result.sunatCondicion    = extracted.sunatCondicion;

  } catch (e) {}
  return result;
}

function toTitleCase(str) {
  return str.toLowerCase().replace(/(?:^|\s)\S/g, function(a) { return a.toUpperCase(); });
}

// ─── PASO 2: LinkedIn via Google ──────────────────────────────────────────────

/**
 * Busca el perfil de LinkedIn del gerente via Google site: search.
 * Devuelve { linkedinUrl, snippet } o null.
 * NOTA: LinkedIn no expone email/tel en perfiles publicos.
 * El valor esta en identificar al decision-maker y contactarlo via LinkedIn.
 */
async function searchLinkedIn(page, gerente, empresa) {
  // Limpiar el nombre de la empresa (quitar "S.A.C", "S.R.L", etc.)
  var empresaClean = empresa.replace(/\b(S\.A\.C\.?|S\.A\.?|S\.R\.L\.?|E\.I\.R\.L\.?|SOCIEDAD|ANONIMA|CERRADA|LIMITADA)\b/gi, "").trim();
  empresaClean = empresaClean.replace(/\s{2,}/g, " ").trim();

  var query = 'site:linkedin.com/in "' + gerente + '" "' + empresaClean + '"';
  var url   = "https://www.google.com/search?q=" + encodeURIComponent(query) + "&hl=es&num=3";

  try {
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 20000 });
    await page.waitForTimeout(1200);

    // Buscar el primer resultado de LinkedIn en los links de Google
    var links = await page.locator("a[href]").all();
    for (var i = 0; i < links.length; i++) {
      var href = (await links[i].getAttribute("href").catch(function() { return ""; })) || "";
      var cleanHref = href;
      if (href.includes("/url?q=")) {
        try { cleanHref = decodeURIComponent(href.split("/url?q=")[1].split("&")[0]); } catch {}
      }
      if (cleanHref.includes("linkedin.com/in/") && cleanHref.startsWith("http")) {
        // Obtener el snippet del resultado para confirmar que coincide
        var snippet = "";
        try {
          var parent = await links[i].locator("..").locator("..").locator("..").innerText().catch(function() { return ""; });
          snippet = parent.slice(0, 200);
        } catch {}
        return { linkedinUrl: cleanHref, snippet: snippet };
      }
    }
  } catch {}
  return null;
}

// ─── PASO 3 & 4: Google fallback ─────────────────────────────────────────────

async function googleSearch(page, query) {
  var url = "https://www.google.com/search?q=" + encodeURIComponent(query) + "&hl=es&gl=PE&num=8";
  try {
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 25000 });
    await page.waitForTimeout(1200);
    return {
      html:     await page.content().catch(function() { return ""; }),
      bodyText: await getBodyText(page),
    };
  } catch {
    return { html: "", bodyText: "" };
  }
}

async function scrapeWebsite(page, siteUrl) {
  try {
    await page.goto(siteUrl, { waitUntil: "domcontentloaded", timeout: 15000 });
    await page.waitForTimeout(1000);
    // Intentar pagina de contacto
    var contactLink = await page.locator(
      "a[href*='contact'], a[href*='contacto'], a:has-text('Contacto'), a:has-text('Contact')"
    ).first().getAttribute("href").catch(function() { return null; });
    if (contactLink && contactLink.length > 1 && !contactLink.startsWith("mailto:")) {
      var contactUrl;
      try { contactUrl = contactLink.startsWith("http") ? contactLink : new URL(contactLink, siteUrl).href; } catch {}
      if (contactUrl && contactUrl !== siteUrl) {
        await page.goto(contactUrl, { waitUntil: "domcontentloaded", timeout: 12000 }).catch(function() {});
        await page.waitForTimeout(800);
      }
    }
    return await extractContactFromPage(page);
  } catch { return {}; }
}

// ─── Pipeline principal ───────────────────────────────────────────────────────

async function enrichOne(page, business) {
  var name     = business.name;
  var ruc      = business.ruc || "";
  var district = business.distrito || business.provincia || "";
  var location = district || "Lima";

  // ── Paso 1: datosperu.org → estado SUNAT, gerente, fecha ────────────
  var datos = await lookupDatosPeru(page, ruc);
  if (datos.sunatEstado)       business.sunatEstado       = datos.sunatEstado;
  if (datos.sunatCondicion)    business.sunatCondicion    = datos.sunatCondicion;
  if (datos.gerente)           business.gerente           = datos.gerente;
  if (datos.fechaConstitucion) business.fechaConstitucion = datos.fechaConstitucion;

  // Descartar empresas inactivas o no habidas (dato obtenido de datosperu)
  var isInactive =
    (datos.sunatEstado  && datos.sunatEstado.indexOf("BAJA") !== -1) ||
    (datos.sunatCondicion && datos.sunatCondicion.indexOf("NO HABIDO") !== -1);
  if (isInactive) {
    business.enrichmentStatus = "descartado";
    return;
  }

  // ── Paso 2: LinkedIn del gerente ─────────────────────────────────────
  if (datos.gerente) {
    var liResult = await searchLinkedIn(page, datos.gerente, name);
    if (liResult) {
      business.linkedinUrl       = liResult.linkedinUrl;
      business.enrichmentStatus  = "encontrado";
      business.enrichmentSource  = liResult.linkedinUrl;
      // LinkedIn no expone email/tel — el valor es el perfil en sí
    }
  }

  // ── Paso 3: Google → WA / tel / móvil ────────────────────────────────
  var gResult = await googleSearch(page, '"' + name + '" contacto ' + location);

  RE_WA.lastIndex = 0;
  var wa = RE_WA.exec(gResult.html);
  if (wa) {
    business.phone = business.whatsapp = "+51" + wa[1];
    business.enrichmentStatus = "encontrado";
    business.enrichmentSource = business.enrichmentSource || "google";
    business.website = business.website || await extractWebsite(page);
    return;
  }

  RE_TEL_HREF.lastIndex = 0;
  var tel = RE_TEL_HREF.exec(gResult.html);
  if (tel) {
    var p = parsePeruvianPhone(tel[1]);
    if (p) {
      business.phone = p;
      business.enrichmentStatus = "encontrado";
      business.enrichmentSource = business.enrichmentSource || "google";
      business.website = business.website || await extractWebsite(page);
      return;
    }
  }

  var mobile = mobileFromText(gResult.bodyText);
  if (mobile) {
    business.phone = mobile;
    business.enrichmentStatus = "encontrado";
    business.enrichmentSource = business.enrichmentSource || "google";
    business.website = business.website || await extractWebsite(page);
    return;
  }
  var fixed = fixedFromText(gResult.bodyText);
  if (fixed) {
    business.phone = fixed;
    business.enrichmentStatus = "encontrado";
    business.enrichmentSource = business.enrichmentSource || "google";
    business.website = business.website || await extractWebsite(page);
    return;
  }

  // ── Paso 4: Website orgánico → raspar contacto ───────────────────────
  var website = await extractWebsite(page);
  if (website) {
    business.website = website;
    var sc = await scrapeWebsite(page, website);
    if (sc.phone)    { business.phone    = sc.phone;    business.enrichmentStatus = "encontrado"; business.enrichmentSource = website; return; }
    if (sc.whatsapp) { business.whatsapp = sc.whatsapp; business.enrichmentStatus = "encontrado"; business.enrichmentSource = website; return; }
    if (sc.email)    { business.email    = sc.email;    business.enrichmentStatus = "encontrado"; business.enrichmentSource = website; return; }
    // Website encontrado aunque sin contacto directo
    business.enrichmentStatus = "encontrado";
    business.enrichmentSource = website;
    return;
  }

  // Si llegamos aqui: puede que tenga gerente/linkedin pero no telefono
  if (!business.enrichmentStatus) {
    business.enrichmentStatus = datos.gerente ? "gerente_sin_contacto" : "sin_contacto";
  }
}

// ─── Batch orchestrator ───────────────────────────────────────────────────────

async function enrichBusinesses(businesses, opts) {
  opts = opts || {};
  var concurrency         = opts.concurrency !== undefined ? opts.concurrency : 2;
  var delayMs             = opts.delayMs     !== undefined ? opts.delayMs     : 2500;
  var headless            = opts.headless    !== undefined ? opts.headless    : true;
  var skipAlreadyEnriched = opts.skipAlreadyEnriched !== undefined ? opts.skipAlreadyEnriched : true;
  var onProgress          = opts.onProgress || null;

  var toProcess = skipAlreadyEnriched
    ? businesses.filter(function(b) { return !b.phone && !b.linkedinUrl; })
    : businesses;

  if (toProcess.length === 0) {
    if (onProgress) onProgress({ stage: "enrich", message: "Nada que enriquecer." });
    return businesses;
  }

  if (onProgress) onProgress({
    stage: "enrich",
    message: "Enriqueciendo " + toProcess.length + " leads...",
    total: toProcess.length, current: 0,
  });

  var browser = await chromium.launch({
    headless: headless,
    args: ["--disable-blink-features=AutomationControlled"],
  });

  var done = 0;

  for (var i = 0; i < toProcess.length; i += concurrency) {
    var batch = toProcess.slice(i, i + concurrency);

    await Promise.all(batch.map(async function(business, idx) {
      if (idx > 0) await new Promise(function(r) { setTimeout(r, idx * 1000); });

      var context = await browser.newContext({
        locale: "es-PE",
        userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
      });
      var page = await context.newPage();

      try {
        await enrichOne(page, business);
      } catch (err) {
        business.enrichmentStatus = "sin_contacto";
      } finally {
        await context.close();
      }

      done++;
      if (onProgress) onProgress({
        stage: "enrich",
        message: "Enriqueciendo... " + done + "/" + toProcess.length,
        total: toProcess.length, current: done,
      });

      await new Promise(function(r) { setTimeout(r, delayMs); });
    }));
  }

  await browser.close();

  var found = businesses.filter(function(b) {
    return b.enrichmentStatus === "encontrado" || b.enrichmentStatus === "gerente_sin_contacto";
  }).length;
  if (onProgress) onProgress({
    stage: "enrich_done",
    message: "Enriquecimiento completo: " + found + "/" + toProcess.length + " con datos",
    found: found, total: toProcess.length,
  });

  return businesses;
}

module.exports = { enrichBusinesses: enrichBusinesses };
