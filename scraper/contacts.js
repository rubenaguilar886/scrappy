const EMAIL_REGEX = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;
const INSTAGRAM_REGEX = /(?:https?:\/\/)?(?:www\.)?instagram\.com\/([a-zA-Z0-9._]{2,30})/gi;
const WHATSAPP_REGEX = /(?:https?:\/\/)?(?:wa\.me\/(\d+)|api\.whatsapp\.com\/send\/?\?phone=(\d+))/gi;

const SKIP_INSTAGRAM_PATHS = new Set([
  "p",
  "reel",
  "reels",
  "stories",
  "explore",
  "accounts",
  "about",
  "legal",
  "developer",
  "directory",
]);

const JUNK_EMAIL_DOMAINS = [
  "example.com",
  "sentry.io",
  "google.com",
  "wixpress.com",
  "facebook.com",
  "instagram.com",
  "schema.org",
  "w3.org",
  "gravatar.com",
];

function unwrapGoogleUrl(url) {
  if (!url) return null;

  try {
    const parsed = new URL(url);
    if (
      (parsed.hostname.includes("google.com") ||
        parsed.hostname.includes("google.com.pe")) &&
      parsed.searchParams.has("q")
    ) {
      return parsed.searchParams.get("q");
    }
    return url;
  } catch {
    return url;
  }
}

function normalizeWebsiteUrl(url) {
  const unwrapped = unwrapGoogleUrl(url);
  if (!unwrapped) return null;

  try {
    const parsed = new URL(unwrapped);
    return parsed.href;
  } catch {
    return unwrapped;
  }
}

function normalizeInstagram(urlOrHandle) {
  if (!urlOrHandle) return null;

  const value = String(urlOrHandle).trim();

  if (value.startsWith("@")) {
    const handle = value.slice(1).split("/")[0].split("?")[0];
    return handle && !SKIP_INSTAGRAM_PATHS.has(handle.toLowerCase())
      ? `@${handle}`
      : null;
  }

  try {
    const parsed = new URL(value.startsWith("http") ? value : `https://${value}`);
    if (!parsed.hostname.includes("instagram.com")) return null;

    const segment = parsed.pathname.replace(/^\//, "").split("/")[0];
    if (!segment || SKIP_INSTAGRAM_PATHS.has(segment.toLowerCase())) {
      return null;
    }

    return `@${segment}`;
  } catch {
    const match = value.match(/instagram\.com\/([a-zA-Z0-9._]{2,30})/i);
    if (match && !SKIP_INSTAGRAM_PATHS.has(match[1].toLowerCase())) {
      return `@${match[1]}`;
    }
    return null;
  }
}

function normalizeWhatsApp(url) {
  if (!url) return null;

  const value = String(url);

  const waMeMatch = value.match(/wa\.me\/(\d+)/i);
  if (waMeMatch) return `https://wa.me/${waMeMatch[1]}`;

  const phoneMatch = value.match(/phone=(\d+)/i);
  if (phoneMatch) return `https://wa.me/${phoneMatch[1]}`;

  const sendMatch = value.match(/send\/?\?phone=(\d+)/i);
  if (sendMatch) return `https://wa.me/${sendMatch[1]}`;

  return value.toLowerCase().includes("whatsapp") ? value : null;
}

function phoneToWhatsApp(phone) {
  if (!phone) return null;

  const digits = phone.replace(/\D/g, "");
  if (!digits) return null;

  if (/^51(9\d{8})$/.test(digits)) {
    return `https://wa.me/${digits}`;
  }

  if (/^9\d{8}$/.test(digits)) {
    return `https://wa.me/51${digits}`;
  }

  const embeddedMobile = digits.match(/9\d{8}/);
  if (embeddedMobile) {
    return `https://wa.me/51${embeddedMobile[0]}`;
  }

  if (digits.startsWith("51") && digits.length >= 11) {
    const candidate = digits.slice(0, 11);
    if (/^51(9\d{8})$/.test(candidate)) {
      return `https://wa.me/${candidate}`;
    }
  }

  return null;
}

function normalizeTiktok(url) {
  if (!url) return null;

  const lower = url.toLowerCase();
  if (!lower.includes("tiktok.com") && !lower.includes("vm.tiktok.com")) {
    return null;
  }

  try {
    const parsed = new URL(url);
    const segment = parsed.pathname.replace(/^\//, "").split("/")[0];
    if (!segment) return url.split("?")[0];
    return `@${segment.replace(/^@/, "")}`;
  } catch {
    const match = url.match(/tiktok\.com\/@?([a-zA-Z0-9._]{2,40})/i);
    return match ? `@${match[1]}` : url.split("?")[0];
  }
}

function normalizeFacebook(url) {
  if (!url) return null;

  const lower = url.toLowerCase();
  if (
    !lower.includes("facebook.com") &&
    !lower.includes("fb.com") &&
    !lower.includes("fb.me")
  ) {
    return null;
  }

  if (
    lower.includes("/sharer") ||
    lower.includes("/share") ||
    lower.includes("/plugins")
  ) {
    return null;
  }

  return url.split("?")[0];
}

function isUsefulWebsite(url) {
  if (!url) return false;

  const lower = url.toLowerCase();
  const blockedHosts = [
    "google.com",
    "google.com.pe",
    "g.page",
    "goo.gl",
    "maps.app.goo.gl",
    "instagram.com",
    "facebook.com",
    "fb.com",
    "wa.me",
    "whatsapp.com",
    "linktr.ee",
    "bit.ly",
  ];

  return !blockedHosts.some((host) => lower.includes(host));
}

// Muchos negocios (sobre todo restaurantes) ponen en el botón "Sitio web"
// de Google Maps un link a una app de delivery en vez de una web propia.
// Eso NO es una web real — es exactamente el tipo de negocio que Scrappy
// debería mostrar como "sin web". Si no filtramos esto, se cuentan como
// "tiene web" y desaparecen del pool de leads vendibles.
const DELIVERY_HOSTS = [
  "rappi.com",
  "pedidosya.com",
  "glovoapp.com",
  "ubereats.com",
  "didi-food.com",
  "justo.pe",
  "yaguara.pe",
];

function isDeliveryPlatformUrl(url) {
  if (!url) return false;
  const lower = url.toLowerCase();
  return DELIVERY_HOSTS.some((host) => lower.includes(host));
}

function pickBestEmail(candidates) {
  const filtered = [...new Set(candidates)].filter((email) => {
    const lower = email.toLowerCase();
    if (lower.endsWith(".png") || lower.endsWith(".jpg") || lower.endsWith(".webp")) {
      return false;
    }
    return !JUNK_EMAIL_DOMAINS.some((domain) => lower.includes(`@${domain}`));
  });

  const preferred = filtered.find((email) =>
    /^(info|contacto|ventas|hola|admin|hello|contact)@/i.test(email)
  );

  return preferred || filtered[0] || null;
}

function deobfuscateHtml(html) {
  return html
    .replace(/&#64;/g, "@")
    .replace(/&#46;/g, ".")
    .replace(/\[at\]/gi, "@")
    .replace(/\(at\)/gi, "@")
    .replace(/\s+at\s+/gi, "@")
    .replace(/\[dot\]/gi, ".")
    .replace(/\(dot\)/gi, ".")
    .replace(/\s+dot\s+/gi, ".");
}

function extractEmailsFromHtml(html) {
  const cleaned = deobfuscateHtml(html);
  const matches = cleaned.match(EMAIL_REGEX) || [];
  return pickBestEmail(matches);
}

function extractInstagramFromHtml(html) {
  const handles = [];
  let match;

  INSTAGRAM_REGEX.lastIndex = 0;
  while ((match = INSTAGRAM_REGEX.exec(html)) !== null) {
    const handle = normalizeInstagram(`https://instagram.com/${match[1]}`);
    if (handle) handles.push(handle);
  }

  return handles[0] || null;
}

function extractWhatsAppFromHtml(html) {
  let match;
  WHATSAPP_REGEX.lastIndex = 0;

  while ((match = WHATSAPP_REGEX.exec(html)) !== null) {
    const number = match[1] || match[2];
    if (number) return `https://wa.me/${number}`;
  }

  return null;
}

function classifyUrl(url) {
  if (!url) return { type: "unknown" };

  const lower = url.toLowerCase().trim();

  if (lower.startsWith("tel:")) {
    const phone = url.replace(/^tel:/i, "").split("?")[0].trim();
    return { type: "phone", value: phone };
  }

  if (lower.startsWith("mailto:")) {
    const email = url.replace(/^mailto:/i, "").split("?")[0];
    return { type: "email", value: email };
  }

  const ig = normalizeInstagram(url);
  if (ig) return { type: "instagram", value: ig };

  const wa = normalizeWhatsApp(url);
  if (wa) return { type: "whatsapp", value: wa };

  const fb = normalizeFacebook(url);
  if (fb) return { type: "facebook", value: fb };

  if (isDeliveryPlatformUrl(url)) return { type: "delivery", value: url.split("?")[0] };

  if (isUsefulWebsite(url)) return { type: "website", value: normalizeWebsiteUrl(url) };

  return { type: "unknown" };
}

function extractContactsFromUrl(url) {
  if (!url) return {};

  const normalized = normalizeWebsiteUrl(url);
  const classified = classifyUrl(normalized || url);

  const result = {
    instagram: null,
    facebook: null,
    whatsapp: null,
    phone: null,
    email: null,
    website: null,
  };

  if (classified.type !== "unknown") {
    result[classified.type] = classified.value;
  }

  return result;
}

function extractFromJsonLd(items) {
  const result = {
    email: null,
    instagram: null,
    whatsapp: null,
    facebook: null,
    website: null,
    phone: null,
  };

  const visit = (node) => {
    if (!node || typeof node !== "object") return;

    if (Array.isArray(node)) {
      node.forEach(visit);
      return;
    }

    if (node.email && !result.email) {
      result.email = String(node.email).replace(/^mailto:/i, "").split("?")[0];
    }

    if (node.telephone && !result.phone) {
      result.phone = String(node.telephone);
    }

    if (node.url && !result.website && isUsefulWebsite(node.url)) {
      result.website = normalizeWebsiteUrl(node.url);
    }

    const sameAs = node.sameAs;
    if (sameAs) {
      const links = Array.isArray(sameAs) ? sameAs : [sameAs];
      for (const link of links) {
        const href = String(link);
        result.instagram = result.instagram || normalizeInstagram(href);
        result.whatsapp = result.whatsapp || normalizeWhatsApp(href);
        result.facebook = result.facebook || normalizeFacebook(href);
        if (!result.website && isUsefulWebsite(href)) {
          result.website = normalizeWebsiteUrl(href);
        }
      }
    }

    Object.values(node).forEach(visit);
  };

  visit(items);
  return result;
}

function parseContactsFromHtml(html, phone = null, existingWebsite = null) {
  const scanned = {
    anchors: [],
    jsonLd: [],
    text: "",
    html: html || "",
  };

  return parseContactsFromScan(scanned, phone, existingWebsite);
}

function parseContactsFromScan(scanned, phone = null, existingWebsite = null) {
  let email = null;
  let instagram = null;
  let whatsapp = null;
  let facebook = null;
  let website = normalizeWebsiteUrl(existingWebsite) || null;
  let extractedPhone = phone;

  const html = scanned.html || "";
  const text = scanned.text || "";

  if (website) {
    const fromUrl = extractContactsFromUrl(website);
    instagram = instagram || fromUrl.instagram;
    facebook = facebook || fromUrl.facebook;
    whatsapp = whatsapp || fromUrl.whatsapp;
    if (fromUrl.website) website = fromUrl.website;
  }

  for (const block of scanned.jsonLd || []) {
    const fromJson = extractFromJsonLd(block);
    email = email || fromJson.email;
    instagram = instagram || fromJson.instagram;
    whatsapp = whatsapp || fromJson.whatsapp;
    facebook = facebook || fromJson.facebook;
    website = website || fromJson.website;
    extractedPhone = extractedPhone || fromJson.phone;
  }

  for (const link of scanned.anchors || []) {
    const href = link.href || "";

    if (href.startsWith("tel:")) {
      extractedPhone =
        extractedPhone ||
        href.replace(/^tel:/i, "").split("?")[0].trim();
    }

    if (href.startsWith("mailto:")) {
      email = email || href.replace(/^mailto:/i, "").split("?")[0];
    }

    instagram = instagram || normalizeInstagram(href);
    whatsapp = whatsapp || normalizeWhatsApp(href);
    facebook = facebook || normalizeFacebook(href);

    if (!website && isUsefulWebsite(href)) {
      website = normalizeWebsiteUrl(href);
    }

    const combined = `${link.aria} ${link.text}`.toLowerCase();
    if (!instagram && combined.includes("instagram") && href.includes("http")) {
      instagram = normalizeInstagram(href);
    }
    if (!whatsapp && combined.includes("whatsapp")) {
      whatsapp = normalizeWhatsApp(href) || href;
    }
  }

  email = email || extractEmailsFromHtml(html);
  if (!email && text) {
    email = pickBestEmail((deobfuscateHtml(text).match(EMAIL_REGEX) || []));
  }

  instagram = instagram || extractInstagramFromHtml(html);
  whatsapp = whatsapp || extractWhatsAppFromHtml(html);

  if (!instagram && text) {
    const igMatch = text.match(/@([a-zA-Z0-9._]{2,30})/);
    if (igMatch && !igMatch[1].includes(".")) {
      instagram = `@${igMatch[1]}`;
    }
  }

  let whatsappInferred = false;
  if (!whatsapp && extractedPhone) {
    const inferred = phoneToWhatsApp(extractedPhone);
    if (inferred) {
      whatsapp = inferred;
      whatsappInferred = true;
    }
  }

  return {
    phone: extractedPhone,
    email,
    instagram,
    whatsapp,
    whatsappInferred,
    facebook,
    website,
    contactChannels: countContactChannels({
      phone: extractedPhone,
      whatsapp,
      email,
      instagram,
      website,
      facebook,
    }),
  };
}

function countContactChannels(channels) {
  return [
    channels.phone,
    channels.whatsapp,
    channels.email,
    channels.instagram,
    channels.website,
    channels.facebook,
  ].filter(Boolean).length;
}

/**
 * Puntaje de calidad del negocio (0–100).
 * Mide cuán establecido y activo es el negocio, independiente de contactabilidad.
 *   Rating    → hasta 40 pts
 *   Reseñas   → hasta 30 pts
 *   Presencia → hasta 30 pts (web 15 + instagram 10 + facebook 5)
 */
function businessQualityScore(b) {
  let score = 0;
  if      (b.rating >= 4.5) score += 40;
  else if (b.rating >= 4.0) score += 28;
  else if (b.rating >= 3.5) score += 15;
  else if (b.rating > 0)    score += 5;

  if      (b.reviewsCount >= 200) score += 30;
  else if (b.reviewsCount >= 100) score += 22;
  else if (b.reviewsCount >= 50)  score += 15;
  else if (b.reviewsCount >= 10)  score += 5;

  if (b.website)   score += 15;
  if (b.instagram) score += 10;
  if (b.facebook)  score += 5;

  return Math.min(score, 100);
}

/**
 * Puntaje aditivo de contactabilidad (0–5).
 * Cada canal suma puntos según su valor real para contactar al negocio.
 * El nivel final se determina por el total de puntos — NO hay jerarquía estricta.
 *
 * Puntos por canal:
 *   Teléfono          +20
 *   WhatsApp real      +30  (link explícito wa.me/...)
 *   WhatsApp inferido   +5  (deducido del número de celular)
 *   Email             +20
 *   Instagram         +20
 *   Sitio web         +15
 *   Facebook          +10
 *
 * Nivel 0:  0 pts  → sin ningún canal
 * Nivel 1: 1-20   → un canal básico (ej: solo teléfono)
 * Nivel 2: 21-45  → 2 canales básicos
 * Nivel 3: 46-70  → 3 canales o canales clave (ej: WA real + Instagram)
 * Nivel 4: 71-95  → 4+ canales (casi completo)
 * Nivel 5: 96+    → todos los canales principales
 */
function contactabilityScore(b) {
  let pts = 0;
  if (b.phone)     pts += 20;
  if (b.whatsapp)  pts += b.whatsappInferred ? 5 : 30;
  if (b.email)     pts += 20;
  if (b.instagram) pts += 20;
  if (b.website)   pts += 15;
  if (b.facebook)  pts += 10;

  if (pts === 0)  return 0;
  if (pts <= 20)  return 1;
  if (pts <= 45)  return 2;
  if (pts <= 70)  return 3;
  if (pts <= 95)  return 4;
  return 5;
}

function mergeContactData(base, extra, phone = null) {
  const mergedPhone = base.phone || extra.phone || phone;
  const merged = {
    phone: mergedPhone,
    email: base.email || extra.email,
    instagram: base.instagram || extra.instagram,
    whatsapp: base.whatsapp || extra.whatsapp,
    whatsappInferred: base.whatsappInferred || extra.whatsappInferred,
    facebook: base.facebook || extra.facebook,
    website: normalizeWebsiteUrl(base.website || extra.website),
  };

  if (!merged.whatsapp && mergedPhone) {
    const inferred = phoneToWhatsApp(mergedPhone);
    if (inferred) {
      merged.whatsapp = inferred;
      merged.whatsappInferred = true;
    }
  } else if (merged.whatsapp && !base.whatsapp && !extra.whatsapp) {
    merged.whatsappInferred = Boolean(base.whatsappInferred || extra.whatsappInferred);
  }

  merged.contactChannels = countContactChannels(merged);
  return merged;
}

async function extractContactChannels(page, phone, existingWebsite = null) {
  await scrollBusinessPanel(page);

  const scanned = await page.evaluate(() => {
    const root = document.body;

    const anchors = Array.from(root.querySelectorAll("a[href]")).map((anchor) => ({
      href: anchor.href,
      aria: anchor.getAttribute("aria-label") || "",
      text: (anchor.innerText || "").trim(),
    }));

    const jsonLd = [];
    document.querySelectorAll('script[type="application/ld+json"]').forEach((script) => {
      try {
        jsonLd.push(JSON.parse(script.textContent));
      } catch {
        // ignore malformed blocks
      }
    });

    return {
      anchors,
      jsonLd,
      text: root.innerText || "",
      html: document.documentElement?.outerHTML?.slice(0, 250000) || root.innerHTML || "",
    };
  });

  const result = parseContactsFromScan(scanned, phone, existingWebsite);

  if (!result.phone && scanned.text) {
    const mobileMatch = scanned.text.match(
      /(?:\+?51[\s-]*)?(9\d{2}[\s-]?\d{3}[\s-]?\d{3})/
    );
    if (mobileMatch) {
      result.phone = mobileMatch[0].trim();
    }
  }

  if (result.phone && !result.whatsapp) {
    const inferred = phoneToWhatsApp(result.phone);
    if (inferred) {
      result.whatsapp = inferred;
      result.whatsappInferred = true;
    }
  }

  result.contactChannels = countContactChannels(result);
  return result;
}

/**
 * Canal principal recomendado para contactar al negocio.
 * Prioridad: WhatsApp → Email → Instagram → Teléfono → Web
 */
function primaryContactChannel(b) {
  if (b.whatsapp)  return "whatsapp";
  if (b.email)     return "email";
  if (b.instagram) return "instagram";
  if (b.phone)     return "phone";
  if (b.website)   return "website";
  return null;
}

async function scrollBusinessPanel(page) {
  try {
    const panel = page.locator('div[role="main"]').first();
    if (await panel.isVisible({ timeout: 800 })) {
      await panel.evaluate((el) => {
        el.scrollTop = el.scrollHeight;
      });
      await page.waitForTimeout(250);
    }
  } catch {
    // optional enhancement
  }
}

module.exports = {
  extractContactChannels,
  parseContactsFromScan,
  parseContactsFromHtml,
  mergeContactData,
  countContactChannels,
  contactabilityScore,
  businessQualityScore,
  primaryContactChannel,
  normalizeInstagram,
  normalizeWhatsApp,
  normalizeFacebook,
  normalizeWebsiteUrl,
  unwrapGoogleUrl,
  phoneToWhatsApp,
  pickBestEmail,
  extractEmailsFromHtml,
  extractInstagramFromHtml,
  extractContactsFromUrl,
  classifyUrl,
  EMAIL_REGEX,
};
