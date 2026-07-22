const {
  parseContactsFromScan,
  mergeContactData,
  normalizeWebsiteUrl,
  extractContactsFromUrl,
} = require("./contacts");

// ─── Tiempos ────────────────────────────────────────────────────────────────
const WEB_TIMEOUT_MS   = 10000; // timeout de navegación
const WAIT_QUICK_MS    =   400; // espera mínima tras domcontentloaded
const WAIT_FULL_MS     =   900; // espera si el quick scan no encontró nada
const WEB_CONCURRENCY  =     8; // webs en paralelo

// Subpáginas a intentar, en orden de mayor probabilidad de tener contacto
const CONTACT_PATHS = [
  "/contacto",
  "/contact",
  "/contactenos",
  "/contact-us",
  "/nosotros",
  "/about",
];

// ─── Helpers ─────────────────────────────────────────────────────────────────

function needsDeepScan(business) {
  if (!normalizeWebsiteUrl(business.website)) return false;
  // Ya tiene email Y (instagram o whatsapp real) → no vale la pena visitar más
  if (business.email && (business.instagram || (business.whatsapp && !business.whatsappInferred))) {
    return false;
  }
  return true;
}

/** Lo que todavía necesitamos conseguir de este negocio */
function missingFields(business) {
  return {
    email:     !business.email,
    instagram: !business.instagram,
    phone:     !business.phone,
    whatsapp:  !business.whatsapp,
  };
}

/** ¿Ya tenemos suficiente para dejar de buscar? */
function isGoodEnough(contacts, missing) {
  const gotEmail     = !missing.email     || contacts.email;
  const gotSocial    = !missing.instagram || contacts.instagram || contacts.whatsapp;
  return gotEmail && gotSocial;
}

function mergeScanResults(results) {
  return results.reduce(
    (acc, cur) => mergeContactData(acc, cur || {}, acc.phone),
    { phone: null, email: null, instagram: null, whatsapp: null,
      whatsappInferred: false, facebook: null, website: null }
  );
}

// ─── Scan de una sola página ──────────────────────────────────────────────────

/**
 * Escanea una página y devuelve contactos encontrados + metadatos.
 * Retorna null si la página no cargó.
 */
async function scanPage(page, url, { waitMs = WAIT_QUICK_MS, scroll = false } = {}) {
  try {
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: WEB_TIMEOUT_MS });
  } catch {
    return null;
  }

  await page.waitForTimeout(waitMs);

  if (scroll) {
    try {
      await page.evaluate(async () => {
        window.scrollTo(0, document.body.scrollHeight / 2);
        await new Promise((r) => setTimeout(r, 250));
        window.scrollTo(0, document.body.scrollHeight);
      });
      await page.waitForTimeout(300);
    } catch { /* ignore */ }
  }

  try {
    const scanned = await page.evaluate(() => {
      const anchors = Array.from(document.querySelectorAll("a[href]")).map((a) => ({
        href: a.href,
        aria: a.getAttribute("aria-label") || "",
        text: (a.innerText || "").trim(),
      }));
      const jsonLd = [];
      document.querySelectorAll('script[type="application/ld+json"]').forEach((s) => {
        try { jsonLd.push(JSON.parse(s.textContent)); } catch { /* ignore */ }
      });

      // Detectar formulario de contacto
      const hasContactForm = !!document.querySelector(
        'form input[type="email"], form textarea, ' +
        'form input[name*="contact"], form input[name*="email"], ' +
        'form input[name*="phone"], form input[name*="message"], ' +
        'form input[name*="nombre"], form input[name*="name"]'
      );

      return {
        anchors,
        jsonLd,
        text: document.body?.innerText?.slice(0, 60000) || "",
        html: document.documentElement?.outerHTML?.slice(0, 200000) || "",
        hasContactForm,
      };
    });

    return {
      contacts:       parseContactsFromScan(scanned, null, url),
      hasContactForm: Boolean(scanned.hasContactForm),
    };
  } catch {
    return null;
  }
}

// ─── Scan profundo de un negocio ──────────────────────────────────────────────

async function scrapeWebsiteDeep(page, website, existingContacts = {}) {
  const normalized = normalizeWebsiteUrl(website);
  if (!normalized) return { websiteStatus: "missing" };

  // 1. Detectar si la URL misma ya es una red social
  const fromUrl = extractContactsFromUrl(normalized);
  if (fromUrl.instagram || fromUrl.facebook) {
    return { ...mergeContactData({ website: normalized }, fromUrl, null), websiteStatus: "online", hasContactForm: false };
  }

  const missing  = missingFields(existingContacts);
  const collected = [];
  let websiteOnline  = false;
  let hasContactForm = false;

  // 2. Scan rápido del home (sin scroll, espera mínima)
  const quickResult = await scanPage(page, normalized, { waitMs: WAIT_QUICK_MS, scroll: false });
  if (quickResult) {
    websiteOnline = true;
    hasContactForm = hasContactForm || quickResult.hasContactForm;
    collected.push(quickResult.contacts);
  }

  let merged = mergeScanResults(collected);
  merged.website = normalized;

  if (websiteOnline && isGoodEnough(merged, missing)) {
    return { ...merged, websiteStatus: "online", hasContactForm };
  }

  // 3. Scan completo del home (con scroll, espera mayor)
  if (!websiteOnline || !isGoodEnough(merged, missing)) {
    const fullResult = await scanPage(page, normalized, { waitMs: WAIT_FULL_MS, scroll: true });
    if (fullResult) {
      websiteOnline  = true;
      hasContactForm = hasContactForm || fullResult.hasContactForm;
      collected.push(fullResult.contacts);
    }

    merged = mergeScanResults(collected);
    merged.website = normalized;

    if (isGoodEnough(merged, missing)) {
      return { ...merged, websiteStatus: websiteOnline ? "online" : "offline", hasContactForm };
    }
  }

  // 4. Visitar subpáginas de contacto solo si falta email o Instagram
  const origin = (() => { try { return new URL(normalized).origin; } catch { return null; } })();

  if (origin) {
    for (const path of CONTACT_PATHS) {
      if (isGoodEnough(merged, missing)) break;
      if (merged.email && merged.whatsapp) break;

      const subUrl = `${origin}${path}`;
      if (subUrl === normalized) continue;

      const subResult = await scanPage(page, subUrl, { waitMs: WAIT_QUICK_MS, scroll: false });
      if (subResult) {
        websiteOnline  = true;
        hasContactForm = hasContactForm || subResult.hasContactForm;
        collected.push(subResult.contacts);

        merged = mergeScanResults(collected);
        merged.website = normalized;

        // Parar si esta subpágina aportó datos útiles
        const { contacts: sub } = subResult;
        if (sub && (sub.email || sub.instagram || sub.whatsapp)) break;
      }
    }
  }

  merged.website = normalized;
  return { ...merged, websiteStatus: websiteOnline ? "online" : "offline", hasContactForm };
}

// ─── Enriquecimiento en paralelo ──────────────────────────────────────────────

async function enrichBusinessesFromWebsites(businesses, context, onProgress) {
  const targets = businesses
    .map((b, index) => ({ business: b, index }))
    .filter(({ business }) => needsDeepScan(business));

  if (!targets.length) {
    onProgress?.({ stage: "deep", message: "Modo profundo: todos los negocios ya tienen datos completos." });
    return businesses;
  }

  const enriched = [...businesses];
  const total    = targets.length;
  let foundEmail = 0, foundInstagram = 0, foundWhatsapp = 0, scannedOk = 0;

  onProgress?.({
    stage: "deep",
    message: `Modo profundo: ${total} sitios a revisar (${businesses.length - total} ya completos)...`,
    total, current: 0,
  });

  for (let i = 0; i < targets.length; i += WEB_CONCURRENCY) {
    const batch = targets.slice(i, i + WEB_CONCURRENCY);
    const pages = await Promise.all(batch.map(() => context.newPage()));

    const batchResults = await Promise.all(
      batch.map(async ({ business }, idx) => {
        try {
          const found = await scrapeWebsiteDeep(
            pages[idx],
            business.website,
            {
              email:     business.email,
              instagram: business.instagram,
              whatsapp:  business.whatsapp,
            }
          );
          if (!found) return { ...business, deepScanned: true };

          scannedOk++;
          if (found.email)     foundEmail++;
          if (found.instagram) foundInstagram++;
          if (found.whatsapp)  foundWhatsapp++;

          const contacts = mergeContactData(
            {
              phone: business.phone, email: business.email,
              instagram: business.instagram, whatsapp: business.whatsapp,
              whatsappInferred: business.whatsappInferred, facebook: business.facebook,
              website: normalizeWebsiteUrl(business.website),
            },
            found,
            business.phone
          );

          return {
            ...business, ...contacts,
            website:        contacts.website || normalizeWebsiteUrl(business.website),
            websiteStatus:  found.websiteStatus  || "online",
            hasContactForm: found.hasContactForm  ?? false,
            deepScanned:    true,
          };
        } catch {
          return { ...business, deepScanned: true, websiteStatus: "offline", hasContactForm: false };
        }
      })
    );

    await Promise.all(pages.map((p) => p.close().catch(() => {})));

    batch.forEach(({ index }, bi) => { enriched[index] = batchResults[bi]; });

    onProgress?.({
      stage: "deep",
      message:
        `Modo profundo: ${Math.min(i + WEB_CONCURRENCY, total)}/${total} webs · ` +
        `${foundEmail} emails · ${foundInstagram} Instagram · ${foundWhatsapp} WA`,
      total, current: Math.min(i + WEB_CONCURRENCY, total),
    });
  }

  onProgress?.({
    stage: "deep",
    message:
      `Modo profundo listo: ${scannedOk}/${total} webs · ` +
      `${foundEmail} emails · ${foundInstagram} Instagram · ${foundWhatsapp} WhatsApp`,
  });

  return enriched;
}

module.exports = { enrichBusinessesFromWebsites, needsDeepScan, scrapeWebsiteDeep };
