const path = require("path");
const fs = require("fs");

// IMPORTANTE: .env se carga ANTES de requerir lib/sheets-client.js — ese
// módulo lee SHEETS_SPREADSHEET_ID/SHEETS_SHEET_NAME de process.env en su
// propio top-level (al momento del require), así que si esto corriera
// después, esas dos consts quedarían fijas en los valores por defecto sin
// importar lo que haya en .env.
function loadEnv() {
  try {
    const envPath = path.join(__dirname, ".env");
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
  } catch (e) {}
}
loadEnv();

const express = require("express");
const { searchGoogleMaps, searchCombinations } = require("./scraper/google-maps");
const { detectChains } = require("./scraper/classify");
const { readProduceCSV, toProduceSheetRow } = require("./scraper/produce-directory");
const { enrichBusinesses } = require("./scraper/produce-enrich");
const { validateBusinesses } = require("./scraper/sunat-validate");
const leadsDb = require("./lib/leads-db");
const sheetsClient = require("./lib/sheets-client");
const messageCache = require("./lib/message-cache");
const { STAGES, CONTACT_STAGES, isValidStage, isContactStage } = require("./lib/pipeline-stages");
const db = require("./lib/db");
const auth = require("./lib/auth");
const credits = require("./lib/credits");

db.initSchema();

async function callClaude(systemPrompt, userMessage) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey || apiKey.includes("PEGA_TU_KEY")) {
    throw new Error("API key no configurada. Edita el archivo .env y reinicia el servidor.");
  }
  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: "claude-sonnet-4-5",
      max_tokens: 1024,
      system: systemPrompt,
      messages: [{ role: "user", content: userMessage }],
    }),
  });
  if (!response.ok) {
    const err = await response.text();
    throw new Error("Anthropic API error " + response.status + ": " + err);
  }
  const data = await response.json();
  return data.content[0].text;
}

const app = express();
const PORT = process.env.PORT || 3847;
app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

// ── Jobs por sesión ──────────────────────────────────────────────────
// Antes había una sola variable global (currentJob) compartida por TODOS
// los usuarios — si alguien buscaba, nadie más podía hasta que terminara.
// Ahora cada sesión (identificada por un ID que genera el navegador y
// guarda en localStorage) tiene su propio job independiente.
const jobs = new Map(); // sessionId -> job
const JOB_MAX_AGE_MS = 2 * 60 * 60 * 1000; // 2h — limpieza de jobs viejos

function getSessionId(req) {
  // Header normal para fetch(); query param como fallback para links de
  // descarga directa (window.location.href) que no pueden mandar headers.
  const raw = req.headers["x-scrappy-session"] || req.query?.sid || "default-session";
  return raw.toString().slice(0, 80);
}

function getJob(sid) {
  return jobs.get(sid) || null;
}

function setJob(sid, job) {
  job._touchedAt = Date.now();
  jobs.set(sid, job);
  return job;
}

function cleanupOldJobs() {
  const now = Date.now();
  for (const [sid, job] of jobs.entries()) {
    if (!job.running && now - (job._touchedAt || 0) > JOB_MAX_AGE_MS) {
      jobs.delete(sid);
    }
  }
}
setInterval(cleanupOldJobs, 30 * 60 * 1000).unref();

function parseLines(value) {
  return String(value || "").split("\n").map((l) => l.trim()).filter(Boolean);
}

function toSheetRow(b) {
  const formattedDate = new Date(b.scrapedAt).toLocaleString("es-PE");
  return {
    Nombre: b.name || "",
    Direccion: b.address || "",
    Telefono: b.phone || "",
    WhatsApp: b.whatsapp || "",
    "WhatsApp inferido": b.whatsappInferred ? "Si" : "",
    Email: b.email || "",
    Instagram: b.instagram || "",
    Facebook: b.facebook || "",
    "Sitio Web": b.website || "",
    "Modo profundo": b.deepScanned ? "Si" : "",
    "Contactabilidad (0-5)": b.contactabilityScore ?? "",
    "Calidad (0-100)": b.businessQualityScore ?? "",
    "Canal principal": b.primaryContactChannel || "",
    "Canales contacto": b.contactChannels ?? "",
    Calificacion: b.rating ?? "",
    Resenas: b.reviewsCount ?? "",
    Categoria: b.category || "",
    "Web status": b.websiteStatus || "",
    "Formulario contacto": b.hasContactForm ? "Si" : "",
    Audience: b.audience || "",
    Opportunity: b.audience || "-",
    "Grupo empresarial": b.businessGroup || "",
    "Locations Count": b.locationsCount ?? 1,
    "Es cadena": b.isChain ? "Si" : "No",
    "Review Power": b.reviewPower || "",
    "Reputation Score": b.reputationScore || "",
    "Opportunity Score": b.opportunityScore ?? "",
    "Opportunity Tier": b.opportunityTier || "",
    Horario: b.hours || "",
    "URL Google Maps": b.googleMapsUrl || "",
    Latitud: b.latitude ?? "",
    Longitud: b.longitude ?? "",
    Ubicacion: b.searchLocation || "",
    Fuente: b.source || "",
    Busqueda: b.searchQuery || "",
    "Fecha Scraping": formattedDate,
  };
}

function toCsv(businesses) {
  if (!businesses.length) return "";
  const rows = businesses.map(toSheetRow);
  const headers = Object.keys(rows[0]);
  const escape = (v) => {
    const t = String(v ?? "");
    return (t.includes(",") || t.includes('"') || t.includes("\n"))
      ? '"' + t.replace(/"/g, '""') + '"' : t;
  };
  const lines = [headers.join(","), ...rows.map((r) => headers.map((h) => escape(r[h])).join(","))];
  return "﻿" + lines.join("\n");
}

// ── /api/debug/sunat ─────────────────────────────────────────────────
// Uso: GET /api/debug/sunat?ruc=20100497507
// Usa el mismo flujo que el validador: navega al formulario, ingresa el RUC,
// hace clic en Buscar y devuelve el HTML/tabla de resultados.
app.get("/api/debug/sunat", async (req, res) => {
  const ruc  = (req.query.ruc || "").trim();
  const raw  = req.query.raw === "1"; // ?raw=1 devuelve el HTML crudo
  if (!ruc) return res.status(400).json({ error: "Falta ?ruc=..." });
  const { chromium } = require("playwright");
  const SUNAT_BASE = "https://e-consultaruc.sunat.gob.pe/cl-ti-itmrconsruc/jcrS00Alias";
  try {
    const browser = await chromium.launch({
      headless: true,
      args: ["--disable-blink-features=AutomationControlled", "--no-sandbox"],
    });
    const context = await browser.newContext({
      locale: "es-PE",
      userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    });
    const page = await context.newPage();
    // Navegar al formulario y buscar via clic (igual que el validador)
    await page.goto(SUNAT_BASE, { waitUntil: "domcontentloaded", timeout: 20000 });
    await page.waitForSelector("#txtRuc", { timeout: 10000 });
    await page.fill("#txtRuc", ruc);
    await Promise.all([
      page.waitForNavigation({ waitUntil: "domcontentloaded", timeout: 30000 }).catch(() => {}),
      page.click("#btnAceptar"),
    ]);
    await page.waitForTimeout(2000);
    const html  = await page.content();
    const title = await page.title().catch(() => "");
    const currentUrl = page.url();
    // Texto completo del body (para buscar estado/condicion)
    const bodyText = await page.evaluate(() => document.body ? document.body.innerText : "").catch(() => "");
    // Extraer todas las filas de la tabla para debug
    const rows = await page.locator("tr").all();
    const tableData = [];
    for (const row of rows) {
      const text = (await row.innerText().catch(() => "")).trim();
      if (text) tableData.push(text);
    }
    // Buscar fragmentos HTML alrededor de palabras clave de estado
    const keywords = ["ACTIVO", "BAJA", "HABIDO", "Estado", "Condici"];
    const htmlSnippets = {};
    for (const kw of keywords) {
      const idx = html.indexOf(kw);
      if (idx >= 0) htmlSnippets[kw] = html.slice(Math.max(0, idx - 100), idx + 200);
    }
    await browser.close();
    if (raw) return res.send("<pre>" + html.replace(/</g, "&lt;") + "</pre>");
    res.json({ ruc, url: currentUrl, title, tableRows: tableData, bodyText: bodyText.slice(0, 2000), htmlSnippets, htmlLength: html.length });
  } catch (err) {
    res.json({ ruc, error: err.message });
  }
});

// ── /api/status ───────────────────────────────────────────────────────
app.get("/api/status", (req, res) => {
  const job = getJob(getSessionId(req));
  res.json({
    running:  job?.running  || false,
    progress: job?.progress || null,
    results:  job?.results  || null,
    error:    job?.error    || null,
    metrics:  job?.metrics  || null,
  });
});

// ── /api/reset ────────────────────────────────────────────────────────
// Cancela cualquier job atascado sin necesitar reiniciar el servidor.
// Solo afecta a la sesión que lo pide — no toca los jobs de otros usuarios.
app.post("/api/reset", (req, res) => {
  jobs.delete(getSessionId(req));
  res.json({ ok: true, message: "Job reseteado." });
});

// ── /api/scrape (Google Maps) ─────────────────────────────────────────
app.post("/api/scrape", async (req, res) => {
  const sid = getSessionId(req);
  if (getJob(sid)?.running) return res.status(409).json({ error: "Ya hay una busqueda en progreso." });

  const { query = "", location = "Lima, Peru", maxResults = 20, deepScan = true } = req.body || {};
  const queries = parseLines(query);
  const locations = parseLines(location);
  if (!queries.length)   return res.status(400).json({ error: "Escribe al menos una busqueda." });
  if (!locations.length) return res.status(400).json({ error: "Escribe al menos una ubicacion." });

  const limit = Math.min(Math.max(parseInt(maxResults, 10) || 20, 1), 100);
  const totalCombinations = queries.length * locations.length;

  const job = setJob(sid, {
    running: true,
    progress: {
      stage: "starting",
      message: totalCombinations === 1
        ? "Iniciando busqueda..."
        : "Iniciando " + totalCombinations + " combinaciones...",
    },
    results: null, error: null, metrics: null,
  });
  res.json({ ok: true, message: "Busqueda iniciada" });

  const aggMetrics = { urlsFound: 0, urlsDiscarded: 0, yieldQuickPass: 0, yieldFullExtract: 0 };
  const progressCallback = (progress) => {
    job.progress = progress;
    if (progress.stage === "metrics" && progress.metrics) {
      const m = progress.metrics;
      aggMetrics.urlsFound        += (m.urlsFound        || 0);
      aggMetrics.urlsDiscarded    += (m.urlsDiscarded    || 0);
      aggMetrics.yieldQuickPass   += (m.yieldQuickPass   || 0);
      aggMetrics.yieldFullExtract += (m.yieldFullExtract || 0);
      job.metrics = { ...aggMetrics };
    }
  };

  try {
    let results;
    if (queries.length === 1 && locations.length === 1) {
      results = await searchGoogleMaps(queries[0], locations[0], limit, { deepScan: Boolean(deepScan), onProgress: progressCallback });
    } else {
      results = await searchCombinations(queries, locations, limit, { deepScan: Boolean(deepScan), onProgress: progressCallback });
    }
    results.sort((a, b) => (b.contactabilityScore ?? 0) - (a.contactabilityScore ?? 0));
    results = detectChains(results);
    const n = results.length || 1;
    if (job.metrics) {
      job.metrics.pctWhatsApp = Math.round(results.filter(b => b.whatsapp).length / n * 100);
      job.metrics.pctEmail    = Math.round(results.filter(b => b.email).length    / n * 100);
      job.metrics.pctWeb      = Math.round(results.filter(b => b.website).length  / n * 100);
    }
    job.results = results;
    job.progress = { stage: "done", message: "Listo. " + results.length + " negocios unicos encontrados.", total: results.length, current: results.length };
  } catch (error) {
    const raw = error.message || "";
    let friendly = raw.length > 200 ? raw.slice(0, 200) + "..." : raw;
    if (raw.includes("Timeout") || raw.includes("timeout")) friendly = "Google Maps tardo demasiado. Espera y vuelve a intentar.";
    else if (raw.includes("net::ERR") || raw.includes("ERR_")) friendly = "Error de red. Verifica tu conexion e intenta de nuevo.";
    job.error = friendly;
    job.progress = { stage: "error", message: friendly };
  } finally {
    job.running = false;
  }
});

// ── /api/scrape-produce ───────────────────────────────────────────────
app.post("/api/scrape-produce", async (req, res) => {
  const sid = getSessionId(req);
  if (getJob(sid)?.running) return res.status(409).json({ error: "Ya hay una busqueda en progreso." });

  const {
    ciiu          = [],
    departamento  = "LIMA",
    provincia     = null,
    distrito      = null,
    sector        = null,
    maxResults    = 100,
    enrich        = true,
    rucType       = null,
    validateSunat = true,
  } = req.body || {};

  const ciuuList = Array.isArray(ciiu)
    ? ciiu.filter(Boolean)
    : String(ciiu).split(",").map(s => s.trim()).filter(Boolean);

  const job = setJob(sid, {
    running: true, source: "produce",
    progress: { stage: "starting", message: "Leyendo directorio PRODUCE..." },
    results: null, error: null, metrics: null,
  });
  res.json({ ok: true, message: "Busqueda PRODUCE iniciada" });

  try {
    // 1. Leer CSV
    const businesses = await readProduceCSV({
      ciiu:        ciuuList,
      departamento: departamento.toUpperCase(),
      provincia:   provincia ? provincia.toUpperCase() : null,
      distrito:    distrito  ? distrito.toUpperCase()  : null,
      sector:      sector    ? sector.toUpperCase()    : null,
      maxResults:  Math.min(Math.max(parseInt(maxResults, 10) || 100, 1), 500),
      rucType:     rucType   ? String(rucType) : null,
      onProgress:  (p) => { job.progress = p; },
    });

    if (!businesses.length) {
      job.results = [];
      job.progress = { stage: "done", message: "No se encontraron empresas con esos filtros." };
      job.running = false;
      return;
    }

    job.progress = { stage: "csv_done", message: businesses.length + " empresas cargadas del CSV.", total: businesses.length, current: businesses.length };

    // 2. Estado SUNAT — se obtiene de datosperu.org durante el enriquecimiento
    let toEnrich = businesses;
    let sunatMeta = null;

    // 3. Enriquecimiento de contacto (opcional)
    let results = toEnrich;
    if (enrich) {
      results = await enrichBusinesses(toEnrich, {
        concurrency: 3, delayMs: 1500, headless: true,
        onProgress: (p) => { job.progress = p; },
      });
    }

    const found     = results.filter(b => b.enrichmentStatus === "encontrado").length;
    const noContact = results.filter(b => b.enrichmentStatus === "sin_contacto").length;
    job.results  = results;
    job.metrics  = { total: results.length, found, noContact, sunat: sunatMeta };
    job.progress = {
      stage: "done",
      message: enrich
        ? "Listo. " + results.length + " empresas - " + found + " con contacto - " + noContact + " sin contacto."
        : "Listo. " + results.length + " empresas validadas del directorio PRODUCE.",
      total: results.length, current: results.length,
    };
  } catch (err) {
    job.error    = err.message || "Error inesperado";
    job.progress = { stage: "error", message: job.error };
  } finally {
    job.running = false;
  }
});

// ── /api/export/csv-produce ───────────────────────────────────────────
app.get("/api/export/csv-produce", (req, res) => {
  const job = getJob(getSessionId(req));
  if (!job?.results?.length || job.source !== "produce") {
    return res.status(404).json({ error: "No hay resultados PRODUCE para exportar." });
  }
  const rows = job.results.map(toProduceSheetRow);
  const headers = Object.keys(rows[0]);
  const escape = (v) => {
    const s = String(v ?? "");
    return (s.includes(",") || s.includes('"') || s.includes("\n")) ? '"' + s.replace(/"/g, '""') + '"' : s;
  };
  const csv = [headers.join(","), ...rows.map(r => headers.map(h => escape(r[h])).join(","))].join("\r\n");
  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader("Content-Disposition", 'attachment; filename="produce_' + Date.now() + '.csv"');
  res.send("﻿" + csv);
});

// ── /api/export/csv ───────────────────────────────────────────────────
app.get("/api/export/csv", (req, res) => {
  const job = getJob(getSessionId(req));
  if (!job?.results?.length) return res.status(404).json({ error: "No hay resultados para exportar." });
  const csv = toCsv(job.results);
  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader("Content-Disposition", 'attachment; filename="scrappy_' + Date.now() + '.csv"');
  res.send(csv);
});

// ── /api/export/json ──────────────────────────────────────────────────
app.get("/api/export/json", (req, res) => {
  const job = getJob(getSessionId(req));
  if (!job?.results?.length) return res.status(404).json({ error: "No hay resultados para exportar." });
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Content-Disposition", 'attachment; filename="scrappy_' + Date.now() + '.json"');
  res.send(JSON.stringify(job.results, null, 2));
});

// ── /api/market-fit ───────────────────────────────────────────────────
app.post("/api/market-fit", async (req, res) => {
  const { oferta, resultado, clientes, exclusiones, diferenciador, casoExito } = req.body || {};
  if (!oferta && !clientes) return res.status(400).json({ error: "Faltan datos de Business Discovery." });

  const system = "Eres un estratega de ventas B2B especializado en prospeccion para negocios de servicios locales. " +
    "Tu tarea es analizar la informacion de un negocio y devolver terminos de busqueda concretos para encontrar clientes potenciales en Google Maps. " +
    "Responde UNICAMENTE con un objeto JSON valido, sin markdown, sin explicaciones adicionales.";

  const user = "Analiza este negocio y devuelve terminos de busqueda para Google Maps:\n\n" +
    "OFERTA: " + (oferta || "no especificado") + "\n" +
    "RESULTADO PARA EL CLIENTE: " + (resultado || "no especificado") + "\n" +
    "CLIENTES ACTUALES/OBJETIVO: " + (clientes || "no especificado") + "\n" +
    "EXCLUSIONES: " + (exclusiones || "no especificado") + "\n" +
    "DIFERENCIADOR: " + (diferenciador || "no especificado") + "\n" +
    "CASO DE EXITO: " + (casoExito || "ninguno") + "\n\n" +
    'Devuelve este JSON exacto:\n{\n  "searchTerms": ["termino1", "termino2", ...],\n  "insight": "Una frase de 1-2 lineas sobre el perfil de cliente ideal",\n  "topPriority": "El tipo de negocio con mayor probabilidad de conversion"\n}\n\n' +
    'Los searchTerms deben ser terminos que alguien buscaria en Google Maps (ej: "estudio de tatuajes", "fotografo freelance"). Entre 6 y 12 terminos. Sin explicaciones.';

  try {
    const raw = await callClaude(system, user);
    const jsonMatch = raw.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error("Respuesta no es JSON valido");
    res.json(JSON.parse(jsonMatch[0]));
  } catch (err) {
    console.error("market-fit error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── tone-config helpers ───────────────────────────────────────────────
const TONE_CONFIG_PATH = path.join(__dirname, "tone-config.json");

const DEFAULT_TONE_CONFIG = {
  systemPrompt:
    "Actua como un consultor comercial de elite especializado en cold outreach para pequenas empresas. " +
    "Tu objetivo NO es vender directamente. Genera conversaciones relevantes con prospectos mediante mensajes cortos, humanos y personalizados para WhatsApp.\n\n" +
    "Marco: HOOK -> HALLAZGO -> SOLUCION -> CTA\n\n" +
    "HOOK: Observacion genuina, humana y natural. Sin vender.\n" +
    "HALLAZGO: Solo datos concretos y verificables del perfil de Google, resenas, rating. Sin interpretar ni diagnosticar.\n" +
    "SOLUCION: Habla del resultado primero, no del servicio. Ej: 'Ayudo a negocios a aprovechar mejor el interes que ya generan online'.\n" +
    "CTA: Una pregunta de bajo compromiso. Maximo 1 linea.\n\n" +
    "Formato: Maximo 5 lineas. Sin emojis, asteriscos ni markdown. Espanol neutro latinoamericano.\n\n" +
    "REGLA CRITICA: Nunca menciones directa o indirectamente la ausencia de sitio web, ni el hecho de que no lo encontraste. Usa unicamente rating, resenas o categoria como HALLAZGO.",
  extraInstructions: "",
};

// Se aplica siempre en generación, sin importar lo que haya guardado en
// tone-config.json — evita que un prompt personalizado en /settings
// termine mencionando la ausencia de sitio web.
const REGLA_CRITICA_TEXT =
  "REGLA CRITICA: Nunca menciones directa o indirectamente la ausencia de sitio web, ni el hecho de que no lo encontraste. Usa unicamente rating, resenas o categoria como HALLAZGO.";

function withReglaCritica(systemPrompt) {
  if (systemPrompt.includes("REGLA CRITICA")) return systemPrompt;
  return systemPrompt.trim() + "\n\n" + REGLA_CRITICA_TEXT;
}

function loadToneConfig() {
  try {
    const raw = fs.readFileSync(TONE_CONFIG_PATH, "utf8");
    const cfg = JSON.parse(raw);
    return {
      systemPrompt:      withReglaCritica(cfg.systemPrompt || DEFAULT_TONE_CONFIG.systemPrompt),
      extraInstructions: cfg.extraInstructions || "",
    };
  } catch (_) {
    return DEFAULT_TONE_CONFIG;
  }
}

// ── SPA: todas las secciones del sidebar sirven el mismo index.html ────
// El cambio de sección real ocurre en el cliente (router.js) sin recargar;
// estas rutas solo permiten refrescar/compartir la URL directamente.
app.get(
  ["/settings", "/settings/crm", "/settings/plantillas", "/settings/integraciones"],
  (_req, res) => {
    res.sendFile(path.join(__dirname, "public", "index.html"));
  }
);

// ── /api/tone-config ──────────────────────────────────────────────────
app.get("/api/tone-config", (_req, res) => {
  res.json(loadToneConfig());
});

app.post("/api/tone-config", (req, res) => {
  const { systemPrompt, extraInstructions } = req.body || {};
  if (typeof systemPrompt !== "string" || systemPrompt.trim().length < 20) {
    return res.status(400).json({ error: "systemPrompt demasiado corto o inválido." });
  }
  const cfg = { systemPrompt: systemPrompt.trim(), extraInstructions: (extraInstructions || "").trim() };
  try {
    fs.writeFileSync(TONE_CONFIG_PATH, JSON.stringify(cfg, null, 2), "utf8");
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: "No se pudo guardar: " + err.message });
  }
});

// ── /api/outreach ─────────────────────────────────────────────────────
app.post("/api/outreach", async (req, res) => {
  const { business, bd, regenerate } = req.body || {};
  if (!business?.name) return res.status(400).json({ error: "Faltan datos del negocio." });

  // Caché por teléfono: si ya generamos un mensaje para este lead y no
  // se pidió regenerar explícitamente, lo devolvemos sin llamar a Claude.
  const phone = business.phone || business.whatsapp || "";
  if (phone && !regenerate) {
    const cached = messageCache.getCached(phone);
    if (cached) return res.json({ message: cached.message, cached: true });
  }

  // Lee el config en cada request — cambios en /settings toman efecto sin reiniciar
  const toneConfig = loadToneConfig();
  const system = toneConfig.extraInstructions
    ? toneConfig.systemPrompt + "\n\n" + toneConfig.extraInstructions
    : toneConfig.systemPrompt;

  const bdContext = bd
    ? "\nContexto del negocio que envia el mensaje:\n" +
      "- Servicio: " + (bd.oferta || "no especificado") + "\n" +
      "- Resultado que entrega: " + (bd.resultado || "no especificado") + "\n" +
      "- Clientes objetivo: " + (bd.clientes || "no especificado") + "\n" +
      "- Diferenciador: " + (bd.diferenciador || "no especificado") + "\n"
    : "";

  // Web: omitir la línea completa si no hay sitio (para no insinuar ausencia)
  const webLine = business.website ? "\n- Web: " + business.website : "";

  const user = bdContext +
    "\nDatos del prospecto:\n" +
    "- Nombre: " + business.name + "\n" +
    "- Categoria: " + (business.category || "no especificada") + "\n" +
    "- Direccion: " + (business.address || "no disponible") + "\n" +
    "- Rating: " + (business.rating ?? "sin datos") + " (" + (business.reviewsCount ?? 0) + " resenas)\n" +
    "- Telefono: " + (business.phone || "no disponible") +
    webLine +
    "\n\nGenera el mensaje de outreach en Espanol neutro latinoamericano.";

  try {
    const text = await callClaude(system, user);
    if (phone) messageCache.setCached(phone, text);
    res.json({ message: text, cached: false });
  } catch (err) {
    console.error("outreach error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── /api/crm/config ───────────────────────────────────────────────────
app.get("/api/crm/config", (_req, res) => {
  res.json({
    stages: STAGES,
    contactStages: CONTACT_STAGES,
    lines: leadsDb.getLines(),
    suggestedLine: leadsDb.getRotationSuggestion(),
  });
});

// ── /api/crm/leads ─────────────────────────────────────────────────────
app.get("/api/crm/leads", (_req, res) => {
  res.json({ leads: leadsDb.listLeads() });
});

// ── /api/crm/leads/copy ──────────────────────────────────────────────
// Al hacer clic en "Copiar" en el modal. Etapa pasa a "Copiado" SOLO si
// el lead es nuevo o su etapa actual es "Nuevo" — ver leads-db.js.
app.post("/api/crm/leads/copy", async (req, res) => {
  const { business, message } = req.body || {};
  console.log(`[crm/leads/copy] request recibido — negocio="${business?.name}" phone="${business?.phone}" whatsapp="${business?.whatsapp}"`);
  if (!business?.name) return res.status(400).json({ error: "Faltan datos del negocio." });
  if (!message) return res.status(400).json({ error: "Falta el mensaje generado." });

  const result = leadsDb.upsertOnCopy({ business, message });
  if (!result.ok) {
    console.warn(`[crm/leads/copy] "${business.name}" NO se guardó en el CRM (reason=${result.reason}) — no se intentó Sheets.`);
    return res.json({ ok: false, reason: result.reason, sheetSynced: false });
  }

  const mirror = await sheetsClient.mirrorCopy(result.lead);
  if (!mirror.ok) {
    console.error(`[crm/leads/copy] "${result.lead.negocio}" (${result.lead.phone}) NO se sincronizó con Sheets:`, mirror.error);
  }
  res.json({
    ok: true,
    lead: result.lead,
    etapaChanged: result.etapaChanged,
    sheetSynced: mirror.ok,
    sheetError: mirror.ok ? null : mirror.error,
  });
});

// ── /api/crm/leads/:phone/stage ──────────────────────────────────────
// Cambio de Etapa desde el dropdown de la tabla CRM. Si la etapa implica
// contacto saliente, requiere numeroUsado (ver CONTACT_STAGES).
app.post("/api/crm/leads/:phone/stage", async (req, res) => {
  const { etapa, numeroUsado } = req.body || {};
  if (!isValidStage(etapa)) return res.status(400).json({ error: "Etapa inválida." });

  const result = leadsDb.setStage(req.params.phone, { etapa, numeroUsado });
  if (!result.ok) {
    const messages = {
      "no-phone": "Teléfono inválido.",
      "not-found": "El lead no existe en el CRM todavía — cópialo primero desde el modal.",
      "numero-usado-required": "Esta etapa implica un contacto — selecciona qué número usaste.",
    };
    return res.status(400).json({ error: messages[result.reason] || "No se pudo actualizar." });
  }

  const mirror = await sheetsClient.mirrorStage(result.lead, { contactUpdated: isContactStage(etapa) });
  if (!mirror.ok) {
    console.error(`[crm/leads/stage] "${result.lead.negocio}" (${result.lead.phone}) → "${etapa}" NO se sincronizó con Sheets:`, mirror.error);
  }
  res.json({ ok: true, lead: result.lead, sheetSynced: mirror.ok, sheetError: mirror.ok ? null : mirror.error });
});

// ── /api/crm/leads/:phone (DELETE) ───────────────────────────────────
// Borra un lead SOLO de la DB local. Nunca toca ni borra la fila en
// Google Sheets — eso queda intacto siempre.
app.delete("/api/crm/leads/:phone", (req, res) => {
  const result = leadsDb.deleteLead(req.params.phone);
  if (!result.ok) {
    return res.status(404).json({ error: "Lead no encontrado en el CRM." });
  }
  res.json({ ok: true });
});

// ── /api/crm/leads (DELETE, todos) ───────────────────────────────────
// Borra todos los leads SOLO de la DB local. Sheets no se toca.
app.delete("/api/crm/leads", (_req, res) => {
  const result = leadsDb.deleteAllLeads();
  res.json({ ok: true, count: result.count });
});

// ══════════════════════════════════════════════════════════════════════
//  MONETIZACIÓN — login (magic link), créditos y el flujo público
//  (MVP móvil). El resto del server.js arriba es la herramienta interna
//  que usas tú directamente — no pasa por ningún control de acceso.
// ══════════════════════════════════════════════════════════════════════

function getBaseUrl(req) {
  const proto = req.headers["x-forwarded-proto"] || req.protocol;
  return `${proto}://${req.headers.host}`;
}

// ── /api/auth/request-link ───────────────────────────────────────────
app.post("/api/auth/request-link", async (req, res) => {
  try {
    const { email } = req.body || {};
    const result = await auth.requestMagicLink(email, getBaseUrl(req));
    res.json({
      ok: true,
      message: "Te enviamos un link de acceso a tu correo.",
      devLink: result.devLink || undefined, // solo presente si no hay email real configurado
    });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// ── /api/auth/verify ──────────────────────────────────────────────────
app.get("/api/auth/verify", async (req, res) => {
  try {
    const { token } = req.query;
    if (!token) return res.status(400).send("Falta el token.");
    const { sessionToken } = await auth.verifyMagicLink(token);
    auth.setSessionCookie(res, sessionToken);
    res.redirect("/scrappy-mvp-movil.html");
  } catch (err) {
    res.status(400).send(err.message);
  }
});

// ── /api/auth/logout ──────────────────────────────────────────────────
app.post("/api/auth/logout", (_req, res) => {
  auth.clearSessionCookie(res);
  res.json({ ok: true });
});

// ── /api/public/me ────────────────────────────────────────────────────
// Devuelve si hay sesión activa. El estado de créditos real se calcula
// por rubro+ciudad en /api/public/scrape (ahí es donde importa).
app.get("/api/public/me", async (req, res) => {
  const user = await auth.getUserFromRequest(req);
  res.json({ loggedIn: Boolean(user), email: user?.email || null });
});

// ── /api/public/scrape ────────────────────────────────────────────────
// Versión monetizada de /api/scrape, para el MVP móvil. Requiere login
// y créditos/cupo disponibles para el rubro+ciudad pedido.
app.post("/api/public/scrape", async (req, res) => {
  const user = await auth.getUserFromRequest(req);
  if (!user) return res.status(401).json({ error: "Inicia sesión para buscar.", needsAuth: true });

  const sid = getSessionId(req);
  if (getJob(sid)?.running) return res.status(409).json({ error: "Ya hay una busqueda en progreso." });

  const { query = "", location = "", deepScan = false } = req.body || {};
  if (!query.trim())    return res.status(400).json({ error: "Escribe un rubro." });
  if (!location.trim()) return res.status(400).json({ error: "Escribe una ciudad." });

  const access = await credits.getUserAccess(user.id, query, location);
  if (access.remaining <= 0) {
    return res.status(402).json({
      error: "No tienes créditos disponibles para este rubro y ciudad. Compra un Paquete Ciudad o suscríbete al Plan Pro.",
      needsPayment: true,
      accessType: access.type,
    });
  }

  const limit = 100;
  const job = setJob(sid, {
    running: true,
    progress: { stage: "starting", message: "Iniciando busqueda..." },
    results: null, error: null, metrics: null,
  });
  res.json({ ok: true, message: "Busqueda iniciada" });

  const progressCallback = (progress) => { job.progress = progress; };

  try {
    const results = await searchGoogleMaps(query.trim(), location.trim(), limit, {
      deepScan: Boolean(deepScan),
      onProgress: progressCallback,
    });
    const { unlocked, lockedCount, remainingAfter } = await credits.applyAccessToResults(access, results);

    job.results = unlocked;
    job.metrics = { accessType: access.type, remaining: remainingAfter, lockedCount };
    job.progress = {
      stage: "done",
      message: lockedCount > 0
        ? `Listo. ${unlocked.length - lockedCount} prospectos completos — ${lockedCount} más disponibles si compras más créditos.`
        : `Listo. ${unlocked.length} prospectos completos.`,
      total: unlocked.length, current: unlocked.length,
    };
  } catch (error) {
    const raw = error.message || "";
    let friendly = raw.length > 200 ? raw.slice(0, 200) + "..." : raw;
    if (raw.includes("Timeout") || raw.includes("timeout")) friendly = "Google Maps tardo demasiado. Espera y vuelve a intentar.";
    job.error = friendly;
    job.progress = { stage: "error", message: friendly };
  } finally {
    job.running = false;
  }
});

// ── /api/public/status y /api/public/reset ───────────────────────────
// Mismo mecanismo de jobs por sesión que la versión interna.
app.get("/api/public/status", (req, res) => {
  const job = getJob(getSessionId(req));
  res.json({
    running:  job?.running  || false,
    progress: job?.progress || null,
    results:  job?.results  || null,
    error:    job?.error    || null,
    metrics:  job?.metrics  || null,
  });
});

app.post("/api/public/reset", (req, res) => {
  jobs.delete(getSessionId(req));
  res.json({ ok: true });
});

// ── /api/admin/* ──────────────────────────────────────────────────────
// Panel mínimo para activar accesos manualmente (pagos por Yape/Plin,
// o mientras no esté conectado el webhook de Culqi). Protegido por un
// secreto simple — configúralo en Railway como ADMIN_SECRET.
function requireAdmin(req, res, next) {
  const secret = process.env.ADMIN_SECRET;
  if (!secret) return res.status(500).json({ error: "ADMIN_SECRET no configurado en el servidor." });
  if (req.headers["x-admin-secret"] !== secret) return res.status(401).json({ error: "No autorizado." });
  next();
}

app.post("/api/admin/activate-citypack", requireAdmin, async (req, res) => {
  try {
    const { email, rubro, ciudad, credits: creditsTotal = 100, days = 30 } = req.body || {};
    if (!email || !rubro || !ciudad) return res.status(400).json({ error: "Faltan email, rubro o ciudad." });
    const userRes = await db.query(
      "INSERT INTO users (email) VALUES ($1) ON CONFLICT (email) DO UPDATE SET email = EXCLUDED.email RETURNING id",
      [String(email).trim().toLowerCase()]
    );
    const userId = userRes.rows[0].id;
    const expiresAt = new Date(Date.now() + days * 24 * 60 * 60 * 1000);
    await db.query(
      "INSERT INTO city_packs (user_id, rubro, ciudad, credits_total, expires_at) VALUES ($1, $2, $3, $4, $5)",
      [userId, rubro, ciudad, creditsTotal, expiresAt]
    );
    res.json({ ok: true, message: `Paquete Ciudad activado para ${email}: ${rubro} en ${ciudad}, ${creditsTotal} créditos, vence ${expiresAt.toISOString().slice(0, 10)}.` });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post("/api/admin/activate-subscription", requireAdmin, async (req, res) => {
  try {
    const { email, dailyLimit = 50 } = req.body || {};
    if (!email) return res.status(400).json({ error: "Falta email." });
    const userRes = await db.query(
      "INSERT INTO users (email) VALUES ($1) ON CONFLICT (email) DO UPDATE SET email = EXCLUDED.email RETURNING id",
      [String(email).trim().toLowerCase()]
    );
    const userId = userRes.rows[0].id;
    await db.query(
      "INSERT INTO subscriptions (user_id, daily_limit) VALUES ($1, $2)",
      [userId, dailyLimit]
    );
    res.json({ ok: true, message: `Plan Pro activado para ${email}: ${dailyLimit} prospectos/día.` });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get("/api/admin/users", requireAdmin, async (_req, res) => {
  try {
    const result = await db.query(`
      SELECT u.id, u.email, u.created_at,
        (SELECT COUNT(*) FROM subscriptions s WHERE s.user_id = u.id AND s.status = 'active') AS active_subscriptions,
        (SELECT COUNT(*) FROM city_packs cp WHERE cp.user_id = u.id AND cp.expires_at > now() AND cp.credits_used < cp.credits_total) AS active_city_packs
      FROM users u ORDER BY u.created_at DESC LIMIT 200
    `);
    res.json({ users: result.rows });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.listen(PORT, () => {
  console.log("Scrappy corriendo en http://localhost:" + PORT);
});
