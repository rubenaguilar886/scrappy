const { chromium } = require("playwright");
const { extractContactChannels, normalizeWebsiteUrl, mergeContactData, phoneToWhatsApp, countContactChannels, contactabilityScore, businessQualityScore, primaryContactChannel, extractContactsFromUrl, classifyUrl } = require("./contacts");
const { enrichBusinessesFromWebsites } = require("./website-deep");
const { computeReviewPower, computeReputationScore, computeOpportunityScore, computeOpportunityTier } = require("./classify");

// Un log real mostró page.goto tardando MAS de 15s incluso con
// concurrencia baja (2/3) — eso es contención de recursos real (CPU o
// red), no solo el bug de cerrar páginas antes de tiempo. Subir la
// concurrencia empeoraría esto, así que la dejamos baja.
const CONCURRENCY       = 2;
const PAGE_WAIT_MS      = 550;
const SCROLL_WAIT_MS    = 1000;
const QUICK_CONCURRENCY = 3;
const QUICK_WAIT_MS     = 150;

// Si un lote entero no termina en este tiempo, se descarta y se sigue —
// mejor entregar menos resultados que quedarse colgado para siempre.
// Subido de 35s: con concurrencia 5-6 páginas compitiendo por recursos en
// Railway, una extracción legítima (no bloqueada) puede tardar bastante
// más que en una compu local sin competencia.
const BATCH_TIMEOUT_MS = 60000;

const TIMEOUT_SENTINEL = Symbol("batch-timeout");

function withTimeout(promise, ms) {
  let timer;
  const timeout = new Promise((resolve) => {
    timer = setTimeout(() => resolve(TIMEOUT_SENTINEL), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

/** Cuántas URLs recolectar en la Fase 1 (siempre > maxResults). */
function getOverfetchCount(maxResults) {
  const mult = maxResults <= 20 ? 2.0 : maxResults <= 50 ? 1.7 : 1.5;
  return Math.min(Math.ceil(maxResults * mult), 120);
}

// Ya NO hacemos un "quick scan" previo que visita cada candidato dos veces
// (una vez liviano, otra vez completo) — eso duplicaba el trabajo total.
// Ahora vamos directo a la extracción completa sobre los primeros
// candidatos recolectados (en el orden de relevancia que ya trae Google
// Maps), con un margen chico para compensar extracciones fallidas.
function getExtractBuffer(maxResults) {
  return Math.ceil(maxResults * 1.3);
}

/**
 * Pre-score rápido para ordenar candidatos antes del Full Extract.
 * +20 teléfono · +30 web · +10 rating≥4.5 · +10 reviews≥50 · +20 categoría exacta
 */
function calculatePreScore(business, searchQuery) {
  let score = 0;
  if (business.phone)            score += 20;
  if (business.website)          score += 30;
  if (business.rating >= 4.5)    score += 10;
  if (business.reviewsCount >= 50) score += 10;

  if (business.category && searchQuery) {
    const words = searchQuery.toLowerCase().split(/[\s,+]+/).filter(w => w.length > 2);
    const cat   = business.category.toLowerCase();
    if (words.some(w => cat.includes(w))) score += 20;
  }
  return score;
}

function parseOptions(options) {
  if (typeof options === "function") {
    return { onProgress: options, deepScan: false };
  }

  return {
    onProgress: options?.onProgress,
    deepScan: options?.deepScan ?? false,
  };
}

function cleanLabelText(text, label) {
  let cleaned = text.trim();
  const prefixes = [
    label,
    `${label}:`,
    "Address:",
    "Phone:",
    "Dirección:",
    "Teléfono:",
  ];
  for (const prefix of prefixes) {
    if (cleaned.toLowerCase().startsWith(prefix.toLowerCase())) {
      cleaned = cleaned.slice(prefix.length).trim();
    }
  }
  return cleaned;
}

function extractCoords(url) {
  const match = url.match(/@(-?\d+\.\d+),(-?\d+\.\d+)/);
  if (match) {
    return { latitude: parseFloat(match[1]), longitude: parseFloat(match[2]) };
  }
  return { latitude: null, longitude: null };
}

function dedupeKey(business) {
  if (business.googleMapsUrl) return business.googleMapsUrl;
  return `${(business.name || "").toLowerCase()}|${(business.address || "").toLowerCase()}`;
}

function dedupeBusinesses(businesses) {
  const seen = new Set();
  return businesses.filter((business) => {
    const key = dedupeKey(business);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

async function setupFastRouting(context) {
  await context.route("**/*", (route) => {
    const type = route.request().resourceType();
    const url = route.request().url();
    if (["image", "media", "font"].includes(type)) {
      route.abort();
      return;
    }
    if (url.includes("google-analytics") || url.includes("googletagmanager")) {
      route.abort();
      return;
    }
    route.continue();
  });
}

function reclassifyWebsite(business) {
  const raw = business.website;
  if (!raw) return business;

  const classified = classifyUrl(raw);
  if (classified.type === "website" || classified.type === "unknown") {
    return business;
  }

  const updates = { website: null };
  if (classified.type === "instagram" && !business.instagram) {
    updates.instagram = classified.value;
  } else if (classified.type === "whatsapp" && !business.whatsapp) {
    updates.whatsapp = classified.value;
    updates.whatsappInferred = false;
  } else if (classified.type === "facebook" && !business.facebook) {
    updates.facebook = classified.value;
  } else if (classified.type === "phone" && !business.phone) {
    updates.phone = classified.value;
  } else if (classified.type === "email" && !business.email) {
    updates.email = classified.value;
  } else if (classified.type === "delivery") {
    // El botón "Sitio web" de Maps apuntaba a una app de delivery
    // (Rappi, PedidosYa, etc.), no a una web propia del negocio. Se
    // guarda como dato informativo, pero NO cuenta como "tiene web".
    updates.deliveryApp = classified.value;
  }

  return { ...business, ...updates };
}

function finalizeBusinessContacts(business) {
  let updated = reclassifyWebsite(business);

  const website = normalizeWebsiteUrl(updated.website);
  updated = { ...updated, website };

  const fromUrl = extractContactsFromUrl(website);
  updated = {
    ...updated,
    ...mergeContactData(updated, fromUrl, updated.phone),
  };

  if (updated.phone && !updated.whatsapp) {
    const inferred = phoneToWhatsApp(updated.phone);
    if (inferred) {
      updated.whatsapp = inferred;
      updated.whatsappInferred = true;
    }
  }

  updated.contactChannels       = countContactChannels(updated);
  updated.contactabilityScore   = contactabilityScore(updated);
  updated.businessQualityScore  = businessQualityScore(updated);
  updated.primaryContactChannel = primaryContactChannel(updated);

  // Lead scoring signals
  updated.reviewPower      = computeReviewPower(updated);
  updated.reputationScore  = computeReputationScore(updated);
  updated.opportunityScore = computeOpportunityScore(updated);
  updated.opportunityTier  = computeOpportunityTier(updated);

  // Defaults para campos que solo se conocen tras deep scan
  if (updated.websiteStatus === undefined) {
    updated.websiteStatus = updated.website ? "online" : "missing";
  }
  if (updated.hasContactForm === undefined) {
    updated.hasContactForm = false;
  }

  return updated;
}

async function acceptCookies(page) {
  const selectors = [
    'button:has-text("Aceptar todo")',
    'button:has-text("Accept all")',
    'button:has-text("Aceptar")',
    'form[action*="consent"] button',
  ];

  for (const selector of selectors) {
    try {
      const btn = page.locator(selector).first();
      if (await btn.isVisible({ timeout: 1500 })) {
        await btn.click();
        await page.waitForTimeout(500);
        return;
      }
    } catch {
      continue;
    }
  }
}

async function scrollResults(page, maxResults) {
  const feedSelector = 'div[role="feed"]';

  try {
    await page.waitForSelector(feedSelector, { timeout: 10000 });
  } catch {
    return;
  }

  const feed = page.locator(feedSelector);
  let previousCount = 0;
  let staleRounds = 0;

  while (staleRounds < 5) {
    const items = page.locator(`${feedSelector} a[href*="/maps/place/"]`);
    const currentCount = await items.count();

    if (currentCount >= maxResults) break;

    if (currentCount === previousCount) {
      staleRounds += 1;
    } else {
      staleRounds = 0;
      previousCount = currentCount;
    }

    await feed.evaluate((el) => {
      el.scrollTop = el.scrollHeight;
    });
    await page.waitForTimeout(SCROLL_WAIT_MS);
  }
}

async function collectPlaceUrls(page, maxResults) {
  const links = page.locator('a[href*="/maps/place/"]');
  const count = await links.count();
  const urls = [];
  const seen = new Set();

  for (let i = 0; i < count; i += 1) {
    const href = await links.nth(i).getAttribute("href");
    if (!href || !href.includes("/maps/place/")) continue;

    const cleanUrl = href.split("?")[0];
    if (seen.has(cleanUrl)) continue;

    seen.add(cleanUrl);
    urls.push(
      href.startsWith("http") ? href : `https://www.google.com${href}`
    );

    if (urls.length >= maxResults) break;
  }

  return urls;
}

async function getText(page, selector) {
  try {
    const el = page.locator(selector).first();
    if (await el.isVisible({ timeout: 1500 })) {
      const text = await el.innerText();
      return text ? text.trim() : null;
    }
  } catch {
    return null;
  }
  return null;
}

async function getInfoByLabel(page, label) {
  let selectors = [
    `button[data-tooltip="${label}"]`,
    `[aria-label*="${label}"]`,
  ];

  if (label === "Dirección" || label === "Address") {
    selectors = [
      'button[data-item-id="address"]',
      '[data-item-id="address"]',
      ...selectors,
    ];
  } else if (label === "Teléfono" || label === "Phone") {
    selectors = [
      'button[data-item-id^="phone"]',
      '[data-item-id^="phone"]',
      'a[href^="tel:"]',
      ...selectors,
    ];
  }

  for (const selector of selectors) {
    try {
      const el = page.locator(selector).first();
      if (await el.isVisible({ timeout: 800 })) {
        const href = await el.getAttribute("href");
        if (href && href.startsWith("tel:")) {
          return href.replace(/^tel:/i, "").split("?")[0].trim();
        }

        const aria = await el.getAttribute("aria-label");
        const text = aria || (await el.innerText());
        if (text) {
          const cleaned = cleanLabelText(text, label);
          if (cleaned) return cleaned;
        }
      }
    } catch {
      continue;
    }
  }

  return null;
}

async function getPhone(page) {
  let phone = await getInfoByLabel(page, "Teléfono");
  if (!phone) phone = await getInfoByLabel(page, "Phone");

  if (!phone) {
    try {
      const telLink = page.locator('a[href^="tel:"]').first();
      if (await telLink.isVisible({ timeout: 800 })) {
        const href = await telLink.getAttribute("href");
        phone = href?.replace(/^tel:/i, "").split("?")[0].trim() || null;
      }
    } catch {
      return null;
    }
  }

  return phone;
}

async function getWebsite(page) {
  try {
    const link = page.locator('a[data-item-id="authority"]').first();
    if (await link.isVisible({ timeout: 1000 })) {
      const href = await link.getAttribute("href");
      return normalizeWebsiteUrl(href);
    }
  } catch {
    return null;
  }
  return null;
}

/**
 * Parses a Spanish/English number string with dots or commas as thousand separators.
 * "4,8" → 4.8   "1.234" → 1234   "1,234" → 1234   "4.8" → 4.8
 */
function parseSpanishNumber(raw, isDecimal = false) {
  if (!raw) return null;
  const s = raw.trim();
  if (isDecimal) {
    // Rating: "4,8" or "4.8" — single separator char is decimal
    return parseFloat(s.replace(",", "."));
  }
  // Review count: remove dots/commas used as thousands separators
  return parseInt(s.replace(/[.,\s]/g, ""), 10);
}

async function getRating(page) {
  try {
    // Wait ONLY for the star-rating element.
    // Do NOT include span[aria-hidden] here — it appears immediately on every page
    // and would cause the evaluate to run before the reviews count has loaded.
    try {
      await page.waitForSelector(
        'div[role="img"][aria-label*="estrellas"], div[role="img"][aria-label*="stars"]',
        { timeout: 2500 }
      );
    } catch { /* element not found in time — try anyway */ }

    // Extra 400ms: reviews count often loads slightly after the star element
    await page.waitForTimeout(400);

    const fromEval = await page.evaluate(() => {
      let rating = null, reviewsCount = null;

      // ── A: iterate ALL role="img" aria-labels — find one that has reviews too ─
      // Google Maps: "Valoración de 4,9 estrellas, basándose en 179 reseñas..."
      for (const imgEl of document.querySelectorAll('div[role="img"][aria-label]')) {
        const lbl = imgEl.getAttribute("aria-label") || "";
        if (!lbl.match(/estrellas?|stars?/i)) continue;
        if (!rating) {
          const rm = lbl.match(/(\d[,.]?\d?)\s*(?:estrellas?|stars?)/i);
          if (rm) rating = rm[1];
        }
        if (!reviewsCount) {
          const rv = lbl.match(/\b([\d.,]+)\s*(?:reseñas|reviews|opiniones)\b/i);
          if (rv) reviewsCount = rv[1];
        }
        if (rating && reviewsCount) break;
      }

      // ── B: aria-hidden span with format "4,8" or "4.8" ──────────────────────
      if (!rating) {
        for (const sp of document.querySelectorAll('span[aria-hidden="true"]')) {
          const t = sp.textContent.trim();
          if (/^\d[,.]\d$/.test(t)) { rating = t; break; }
        }
      }

      // ── C: button whose ENTIRE aria-label is "<N> reseñas/reviews" ───────────
      // Anchored (^...$) to prevent false positives like "Ver 8 opiniones de empleados"
      if (!reviewsCount) {
        for (const btn of document.querySelectorAll("button[aria-label]")) {
          const lbl = (btn.getAttribute("aria-label") || "").trim();
          const m = lbl.match(/^([\d.,]+)\s*(?:reseñas|reviews|opiniones)$/i);
          if (m) { reviewsCount = m[1]; break; }
        }
      }

      // ── D: visible text span "179 reseñas" (whole content, anchored) ─────────
      if (!reviewsCount) {
        for (const sp of document.querySelectorAll("span")) {
          const t = sp.textContent.trim();
          const m = t.match(/^\(?([\d.,]+)\)?\s*(?:reseñas|reviews|opiniones)$/i);
          if (m) { reviewsCount = m[1]; break; }
        }
      }

      return { rating, reviewsCount };
    });

    // Parse raw strings → numbers
    let rating = fromEval.rating ? parseSpanishNumber(fromEval.rating, true) : null;
    const reviewsCount = fromEval.reviewsCount
      ? parseSpanishNumber(fromEval.reviewsCount, false)
      : null;

    // Validate: Google Maps only goes 1.0–5.0
    if (rating !== null && (isNaN(rating) || rating < 1 || rating > 5)) {
      rating = null;
    }

    return {
      rating:       rating ?? null,
      reviewsCount: (reviewsCount && !isNaN(reviewsCount) && reviewsCount > 0)
                    ? reviewsCount : null,
    };
  } catch { /* fall through */ }

  return { rating: null, reviewsCount: null };
}

async function getCategory(page) {
  try {
    const el = page.locator("button.DkEaL").first();
    if (await el.isVisible({ timeout: 1000 })) {
      return (await el.innerText()).trim();
    }
  } catch {
    return null;
  }
  return null;
}

async function getHours(page) {
  try {
    const el = page.locator('[aria-label*="Horario"], [aria-label*="Hours"]').first();
    if (await el.isVisible({ timeout: 1000 })) {
      return await el.getAttribute("aria-label");
    }
  } catch {
    return null;
  }
  return null;
}

async function extractBusinessFromPage(page, url, searchQuery) {
  const name = await getText(page, "h1");
  if (!name) return null;

  let address = await getInfoByLabel(page, "Dirección");
  if (!address) address = await getInfoByLabel(page, "Address");

  const phone = await getPhone(page);
  const websiteFromMaps = await getWebsite(page);
  const contacts = await extractContactChannels(page, phone, websiteFromMaps);
  const { rating, reviewsCount } = await getRating(page);
  const category = await getCategory(page);
  const hours = await getHours(page);
  const { latitude, longitude } = extractCoords(url);

  return {
    name,
    address,
    phone: contacts.phone || phone,
    website: contacts.website || websiteFromMaps,
    email: contacts.email,
    instagram: contacts.instagram,
    whatsapp: contacts.whatsapp,
    whatsappInferred: contacts.whatsappInferred,
    facebook: contacts.facebook,
    contactChannels: contacts.contactChannels,
    rating,
    reviewsCount,
    category,
    hours,
    googleMapsUrl: url.split("?")[0],
    latitude,
    longitude,
    deliveryApp: null,
    source: "google_maps",
    searchQuery,
    searchLocation: "",
    websiteStatus:        null,
    hasContactForm:       false,
    primaryContactChannel: null,
    deepScanned:          false,
    scrapedAt:            new Date().toISOString(),
  };
}

async function scrapePlace(page, url, searchQuery) {
  try {
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 25000 });
    // Google Maps es una SPA pesada — domcontentloaded solo garantiza el
    // HTML crudo, el contenido real lo pinta JS después. Esperamos a que
    // el h1 realmente aparezca (con margen generoso) en vez de una pausa
    // fija corta que puede ganarle la carrera al render bajo carga.
    await page.waitForSelector("h1", { timeout: 8000 }).catch(() => {});
    await page.waitForTimeout(PAGE_WAIT_MS);
    const result = await extractBusinessFromPage(page, url, searchQuery);
    if (!result) await diagnoseFailure(page, url);
    return result;
  } catch (e) {
    if (!diagnosedThisRun) {
      diagnosedThisRun = true;
      console.log(`[diagnostico-bloqueo][full-extract] goto/extraccion fallo para url=${url} → error="${e.message}"`);
    }
    return null;
  }
}

function isBrowserDeadError(e) {
  const msg = (e && e.message) || "";
  return msg.includes("has been closed") || msg.includes("Target closed") || msg.includes("Browser closed");
}

async function scrapePlacesParallel(context, urls, searchQuery, onProgress) {
  const businesses = [];
  const total = urls.length;

  for (let i = 0; i < urls.length; i += CONCURRENCY) {
    const batch = urls.slice(i, i + CONCURRENCY);

    let pages;
    try {
      pages = await Promise.all(batch.map(() => context.newPage()));
    } catch (e) {
      // El navegador ya murió (memoria) — no hay como seguir. Entregamos
      // lo que se alcanzó a recolectar en vez de fallar toda la búsqueda.
      if (isBrowserDeadError(e)) {
        console.log(`[navegador-muerto] full-extract se detuvo en ${i}/${total} — entregando ${businesses.length} negocios recolectados.`);
        break;
      }
      throw e;
    }

    const raced = await withTimeout(
      Promise.all(batch.map((url, idx) => scrapePlace(pages[idx], url, searchQuery))),
      BATCH_TIMEOUT_MS
    );
    const timedOut = raced === TIMEOUT_SENTINEL;
    const batchResults = timedOut ? batch.map(() => null) : raced;

    // Si de verdad terminaron a tiempo, cerramos sus páginas. Si hubo
    // timeout, NO las tocamos — cerrarlas de golpe interrumpe a medias
    // extracciones que quizás iban a terminar bien solas; las dejamos
    // seguir en segundo plano y se limpian con browser.close() al final.
    if (!timedOut) {
      await Promise.all(pages.map((page) => page.close().catch(() => {})));
    }

    businesses.push(...batchResults.filter(Boolean));

    onProgress?.({
      stage: "scraping",
      message: `Google Maps: ${Math.min(i + CONCURRENCY, total)} de ${total}...`,
      total,
      current: Math.min(i + CONCURRENCY, total),
    });
  }

  return businesses;
}

/**
 * Navega a una URL con hasta 2 intentos.
 * Si el primer intento falla por timeout, espera 4 s y reintenta.
 */
async function gotoWithRetry(page, url, onProgress) {
  try {
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60000 });
  } catch {
    onProgress?.({ stage: "loading", message: "Google Maps tardó en responder, reintentando..." });
    await new Promise(r => setTimeout(r, 4000));
    try {
      await page.goto(url, { waitUntil: "domcontentloaded", timeout: 75000 });
    } catch {
      throw new Error(
        "Google Maps no respondió. Espera unos segundos y vuelve a intentarlo. " +
        "Si tienes varias búsquedas activas, reduce la cantidad de ubicaciones."
      );
    }
  }
}

// Diagnóstico: solo se loguea la PRIMERA vez por corrida para no inundar
// los logs de Railway — basta una muestra para saber si es un bloqueo real.
let diagnosedThisRun = false;

async function diagnoseFailure(page, url) {
  if (diagnosedThisRun) return;
  diagnosedThisRun = true;
  try {
    const title = await page.title().catch(() => "(sin título)");
    const bodyText = await page.evaluate(() => document.body?.innerText?.slice(0, 300) || "").catch(() => "");
    const blockedHints = ["unusual traffic", "captcha", "recaptcha", "tráfico inusual", "verifica que no eres un robot", "/sorry/"];
    const currentUrl = page.url();
    const looksBlocked = blockedHints.some(h =>
      title.toLowerCase().includes(h) || bodyText.toLowerCase().includes(h) || currentUrl.includes("/sorry/")
    );
    console.log(
      `[diagnostico-bloqueo] url=${url} → currentUrl=${currentUrl} title="${title}" looksBlocked=${looksBlocked}\n` +
      `  bodyPreview="${bodyText.replace(/\n/g, " ").slice(0, 200)}"`
    );
  } catch (e) {
    console.log(`[diagnostico-bloqueo] no se pudo diagnosticar: ${e.message}`);
  }
}

/** Visita una ficha de Maps muy rápido: solo extrae lo necesario para el pre-score. */
async function quickScrapePlace(page, url, searchQuery) {
  try {
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30000 });
    await page.waitForSelector("h1", { timeout: 6000 }).catch(() => {});
    await page.waitForTimeout(QUICK_WAIT_MS);

    const name = await getText(page, "h1");
    if (!name) {
      await diagnoseFailure(page, url);
      return null;
    }

    const [phone, website, ratingData, category] = await Promise.all([
      getPhone(page),
      getWebsite(page),
      getRating(page),
      getCategory(page),
    ]);

    return {
      url,
      name,
      phone:        phone || null,
      website:      website || null,
      rating:       ratingData.rating,
      reviewsCount: ratingData.reviewsCount,
      category:     category || null,
    };
  } catch (e) {
    if (!diagnosedThisRun) {
      diagnosedThisRun = true;
      console.log(`[diagnostico-bloqueo] goto/extraccion fallo para url=${url} → error="${e.message}"`);
    }
    return null;
  }
}

async function quickScrapeParallel(context, urls, searchQuery, onProgress) {
  const results = [];
  const total   = urls.length;

  for (let i = 0; i < urls.length; i += QUICK_CONCURRENCY) {
    const batch = urls.slice(i, i + QUICK_CONCURRENCY);

    let pages;
    try {
      pages = await Promise.all(batch.map(() => context.newPage()));
    } catch (e) {
      if (isBrowserDeadError(e)) {
        console.log(`[navegador-muerto] quick-scan se detuvo en ${i}/${total} — entregando ${results.length} candidatos recolectados.`);
        break;
      }
      throw e;
    }

    const raced = await withTimeout(
      Promise.all(batch.map((url, idx) => quickScrapePlace(pages[idx], url, searchQuery))),
      BATCH_TIMEOUT_MS
    );
    const timedOut = raced === TIMEOUT_SENTINEL;
    const batchResults = timedOut ? batch.map(() => null) : raced;

    if (!timedOut) {
      await Promise.all(pages.map(p => p.close().catch(() => {})));
    }
    results.push(...batchResults);

    onProgress?.({
      stage: "quickpass",
      message: `Quick scan: ${Math.min(i + QUICK_CONCURRENCY, total)}/${total} candidatos evaluados...`,
      total,
      current: Math.min(i + QUICK_CONCURRENCY, total),
    });
  }

  return results;
}

async function createBrowserContext() {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    locale: "es-PE",
    viewport: { width: 1400, height: 900 },
    userAgent:
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
  });

  await setupFastRouting(context);
  return { browser, context };
}

async function searchGoogleMaps(
  query,
  location = "",
  maxResults = 20,
  options = {}
) {
  diagnosedThisRun = false; // un diagnóstico fresco por cada búsqueda nueva
  const { onProgress, deepScan = false } = parseOptions(options);
  const fullQuery  = `${query} ${location}`.trim();
  const searchUrl  = `https://www.google.com/maps/search/${encodeURIComponent(fullQuery)}`;
  const overfetch  = getOverfetchCount(maxResults);

  const metrics = {
    urlsFound: 0, urlsDiscarded: 0,
    yieldQuickPass: 0, yieldFullExtract: 0,
  };

  const { browser, context } = await createBrowserContext();
  const page = await context.newPage();

  // Si quien llama nos pasó un "abortHandle" (server.js lo usa para el
  // timeout duro de 6 min), le dejamos la referencia al navegador para
  // poder cerrarlo a la fuerza desde afuera. Sin esto, cuando el timeout
  // de arriba "gana" el race, esta función sigue corriendo en segundo
  // plano indefinidamente — un navegador fantasma consumiendo CPU/memoria
  // que compite con la SIGUIENTE búsqueda que el usuario lance.
  if (options.abortHandle) options.abortHandle.browser = browser;

  try {
    // ── FASE 1: Scroll y colecta de URLs (overfetch) ───────────────────────
    onProgress?.({ stage: "loading", message: "Abriendo Google Maps..." });
    await gotoWithRetry(page, searchUrl, onProgress);
    await page.waitForTimeout(1500);
    await acceptCookies(page);

    onProgress?.({
      stage: "scrolling",
      message: `Buscando candidatos (hasta ${overfetch})...`,
    });
    await scrollResults(page, overfetch);

    const allUrls = await collectPlaceUrls(page, overfetch);
    await page.close();

    metrics.urlsFound = allUrls.length;
    if (!allUrls.length) {
      onProgress?.({ stage: "metrics", metrics });
      return [];
    }

    // ── FASE 2: Full extract directo (sin quick-scan previo) ───────────────
    // Antes visitábamos cada candidato dos veces (quick-scan + full extract).
    // Ahora vamos directo a la extracción completa sobre los primeros
    // candidatos recolectados — casi la mitad del trabajo total, a costa de
    // perder el pre-orden por teléfono/web/rating (salen en el orden que
    // Google Maps ya los entrega, que suele ser por relevancia/cercanía).
    const extractBuffer = Math.min(getExtractBuffer(maxResults), allUrls.length);
    const topUrls = allUrls.slice(0, extractBuffer);

    metrics.urlsDiscarded  = allUrls.length - topUrls.length;
    metrics.yieldQuickPass = topUrls.length;

    onProgress?.({
      stage: "scraping",
      message: `Extrayendo datos completos de ${topUrls.length} de ${allUrls.length} candidatos...`,
      total: topUrls.length,
      current: 0,
    });

    let businesses = await scrapePlacesParallel(context, topUrls, fullQuery, onProgress);
    businesses = businesses.slice(0, maxResults).map(finalizeBusinessContacts);

    metrics.yieldFullExtract = businesses.length;

    // ── Diagnóstico de embudo: para saber en qué etapa se pierde todo ──────
    // rawCandidates  = lo que Google Maps mostró en el scroll (fase 1)
    // intentados     = cuántos de esos se intentó extraer completo
    // extraidosOk    = cuántos de esos intentos SÍ devolvieron datos
    // conWebReal     = de los extraídos ok, cuántos tienen web real
    // sinWebReal     = de los extraídos ok, cuántos NO (leads vendibles)
    const conWebReal = businesses.filter(b => b.website).length;
    const sinWebReal = businesses.length - conWebReal;
    console.log(
      `[embudo] rawCandidates=${allUrls.length} intentados=${topUrls.length} ` +
      `extraidosOk=${businesses.length} (${Math.round(businesses.length / topUrls.length * 100)}%) ` +
      `conWebReal=${conWebReal} sinWebReal=${sinWebReal} rubro="${query}" ciudad="${location}"`
    );

    // ── FASE 5: Deep scan (solo si tiene web y le faltan datos) ───────────
    if (deepScan && businesses.length) {
      businesses = await enrichBusinessesFromWebsites(businesses, context, onProgress);
    }

    businesses = businesses
      .map(finalizeBusinessContacts)
      .map(b => ({ ...b, searchLocation: location }));

    // Métricas finales
    const n = businesses.length || 1;
    onProgress?.({
      stage: "metrics",
      metrics: {
        ...metrics,
        pctWhatsApp: Math.round(businesses.filter(b => b.whatsapp).length / n * 100),
        pctEmail:    Math.round(businesses.filter(b => b.email).length    / n * 100),
        pctWeb:      Math.round(businesses.filter(b => b.website).length  / n * 100),
      },
    });

    return businesses;
  } finally {
    await browser.close().catch(() => {}); // ya puede estar muerto — no bloquear la respuesta por eso
  }
}

async function searchMultipleGoogleMaps(
  queries,
  location = "",
  maxResultsPerQuery = 20,
  options = {}
) {
  const { onProgress, deepScan = false } = parseOptions(options);
  const allBusinesses = [];
  const seen = new Set();
  const totalQueries = queries.length;

  for (let i = 0; i < queries.length; i += 1) {
    const query = queries[i];
    const prefix = `[${i + 1}/${totalQueries}]`;

    onProgress?.({
      stage: "search",
      message: `${prefix} Buscando "${query}"...`,
      searchIndex: i + 1,
      searchTotal: totalQueries,
    });

    const results = await searchGoogleMaps(query, location, maxResultsPerQuery, {
      deepScan,
      onProgress: (progress) => {
        onProgress?.({
          ...progress,
          message: `${prefix} ${progress.message}`,
          searchIndex: i + 1,
          searchTotal: totalQueries,
        });
      },
    });

    for (const business of results) {
      const key = dedupeKey(business);
      if (!seen.has(key)) {
        seen.add(key);
        allBusinesses.push(business);
      }
    }

    onProgress?.({
      stage: "search",
      message: `${prefix} "${query}" → ${results.length} negocios (${allBusinesses.length} únicos en total)`,
      searchIndex: i + 1,
      searchTotal: totalQueries,
    });
  }

  return allBusinesses;
}

// Cuántas búsquedas (combinación query+location) corren en paralelo.
// 2 es seguro para la mayoría de PCs sin arriesgar bloqueos de Google.
const COMBINATION_CONCURRENCY = 2;

async function searchCombinations(
  queries,
  locations,
  maxResultsPerQuery = 20,
  options = {}
) {
  const { onProgress, deepScan = false } = parseOptions(options);
  const allBusinesses = [];
  const seen = new Set();

  const combinations = [];
  for (const query of queries) {
    for (const location of locations) {
      combinations.push({ query, location });
    }
  }

  const total = combinations.length;
  let completed = 0;

  // Contadores globales de progreso para el modo paralelo
  const statusMap = new Map(); // index → último mensaje

  function reportProgress() {
    const running = [...statusMap.entries()]
      .map(([idx, msg]) => `[${idx + 1}] ${msg}`)
      .join(" | ");
    onProgress?.({
      stage: "search",
      message: `${completed}/${total} completadas · ${allBusinesses.length} leads únicos${running ? ` · Corriendo: ${running}` : ""}`,
      searchIndex: completed,
      searchTotal: total,
    });
  }

  // Ejecutar en lotes de COMBINATION_CONCURRENCY en paralelo
  for (let i = 0; i < combinations.length; i += COMBINATION_CONCURRENCY) {
    const batch = combinations.slice(i, i + COMBINATION_CONCURRENCY);

    const batchResults = await Promise.all(
      batch.map(async ({ query, location }, batchIdx) => {
        const globalIdx = i + batchIdx;

        // Escalonar el inicio para que no abran Maps al mismo milisegundo
        if (batchIdx > 0) await new Promise(r => setTimeout(r, batchIdx * 3000));

        statusMap.set(globalIdx, `"${query}" en ${location}...`);
        reportProgress();

        const results = await searchGoogleMaps(query, location, maxResultsPerQuery, {
          deepScan,
          onProgress: (progress) => {
            statusMap.set(globalIdx, progress.message || "");
            reportProgress();
          },
        });

        statusMap.delete(globalIdx);
        return { results, query, location };
      })
    );

    // Unir resultados del lote con deduplicación
    for (const { results, query, location } of batchResults) {
      completed++;
      let newInBatch = 0;
      for (const business of results) {
        const key = dedupeKey(business);
        if (!seen.has(key)) {
          seen.add(key);
          allBusinesses.push(business);
          newInBatch++;
        }
      }
      onProgress?.({
        stage: "search",
        message: `[${completed}/${total}] "${query}" en ${location} → ${results.length} negocios (${newInBatch} nuevos, ${allBusinesses.length} únicos totales)`,
        searchIndex: completed,
        searchTotal: total,
      });
    }
  }

  return allBusinesses;
}

module.exports = { searchGoogleMaps, searchMultipleGoogleMaps, searchCombinations, dedupeBusinesses };
