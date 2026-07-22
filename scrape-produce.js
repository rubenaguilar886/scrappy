#!/usr/bin/env node
/**
 * scrape-produce.js
 * CLI para extraer leads del directorio MIPYME de PRODUCE y enriquecerlos.
 *
 * Uso:
 *   node scrape-produce.js --ciiu 7310 --departamento LIMA
 *   node scrape-produce.js --ciiu 7310,7830 -n 50 --sector SERVICIO
 *   node scrape-produce.js --ciiu 7310 --no-enrich
 *   node scrape-produce.js --help
 */

const path = require("path");
const fs   = require("fs");

const { readProduceCSV, toProduceSheetRow, DEFAULT_CSV } = require("./scraper/produce-directory");
const { enrichBusinesses }                               = require("./scraper/produce-enrich");

// ── Argumentos CLI ────────────────────────────────────────────────────────────

function parseArgs() {
  const args = process.argv.slice(2);
  const opts = {
    ciiu:          [],
    departamento:  "LIMA",
    provincia:     null,
    distrito:      null,
    sector:        null,
    maxResults:    200,
    enrich:        true,
    concurrency:   3,
    delayMs:       1800,
    showBrowser:   false,
    csvPath:       DEFAULT_CSV,
    output:        null,
    help:          false,
  };

  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    const next = args[i + 1];

    switch (a) {
      case "--help": case "-h":
        opts.help = true; break;
      case "--ciiu": case "-c":
        opts.ciiu = next.split(",").map((s) => s.trim()); i++; break;
      case "--departamento": case "-d":
        opts.departamento = next.toUpperCase(); i++; break;
      case "--provincia": case "-p":
        opts.provincia = next.toUpperCase(); i++; break;
      case "--distrito":
        opts.distrito = next.toUpperCase(); i++; break;
      case "--sector": case "-s":
        opts.sector = next.toUpperCase(); i++; break;
      case "--max-results": case "-n":
        opts.maxResults = parseInt(next, 10); i++; break;
      case "--no-enrich":
        opts.enrich = false; break;
      case "--enrich-concurrency":
        opts.concurrency = parseInt(next, 10); i++; break;
      case "--delay-ms":
        opts.delayMs = parseInt(next, 10); i++; break;
      case "--show-browser":
        opts.showBrowser = true; break;
      case "--csv-path":
        opts.csvPath = next; i++; break;
      case "--output": case "-o":
        opts.output = next; i++; break;
    }
  }

  return opts;
}

function printHelp() {
  console.log(`
scrape-produce — Extrae leads del directorio MIPYME de PRODUCE

USO:
  node scrape-produce.js [opciones]

OPCIONES:
  --ciiu, -c        Código(s) CIIU separados por coma (ej: 7310,7830)
  --departamento, -d  Departamento (default: LIMA)
  --provincia, -p   Provincia (opcional)
  --distrito        Distrito (opcional)
  --sector, -s      Sector productivo (ej: SERVICIO, INDUSTRIA)
  --max-results, -n Máximo de resultados (default: 200)
  --no-enrich       Solo leer CSV, sin buscar contacto
  --enrich-concurrency  Búsquedas paralelas (default: 3)
  --show-browser    Mostrar navegador durante enriquecimiento
  --csv-path        Ruta al CSV (default: data/produce_mipyme.csv)
  --output, -o      Archivo de salida (default: output/produce_CIIU_DEP_fecha.csv)
  --help, -h        Mostrar esta ayuda

EJEMPLOS:
  node scrape-produce.js --ciiu 7310 --departamento LIMA
  node scrape-produce.js --ciiu 7310,7830 -n 50 --sector SERVICIO
  node scrape-produce.js --ciiu 7310 --no-enrich -o mis_leads.csv
`);
}

// ── Exportar CSV ─────────────────────────────────────────────────────────────

function escapeCsvField(val) {
  const s = String(val ?? "");
  if (s.includes(",") || s.includes('"') || s.includes("\n")) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

function exportCSV(businesses, outputPath) {
  if (!businesses.length) return;

  fs.mkdirSync(path.dirname(outputPath), { recursive: true });

  const rows = businesses.map(toProduceSheetRow);
  const headers = Object.keys(rows[0]);
  const lines = [
    headers.join(","),
    ...rows.map((r) => headers.map((h) => escapeCsvField(r[h])).join(",")),
  ];

  fs.writeFileSync(outputPath, "﻿" + lines.join("\r\n"), "utf8");
}

// ── Tabla en consola ──────────────────────────────────────────────────────────

function printTable(businesses) {
  const MAX = 30;
  const shown = businesses.slice(0, MAX);
  const COL = [4, 40, 13, 6, 20, 18];
  const HDR = ["#", "Razón Social", "RUC", "CIIU", "Categoría", "Distrito"];

  const pad = (s, n) => String(s ?? "").slice(0, n).padEnd(n);
  const line = () => console.log("─".repeat(COL.reduce((a, b) => a + b + 3, -1)));

  line();
  console.log(HDR.map((h, i) => pad(h, COL[i])).join(" │ "));
  line();

  shown.forEach((b, i) => {
    const cols = [
      i + 1,
      b.name,
      b.ruc,
      b.ciuuCode,
      b.ciuuDesc,
      b.distrito,
    ];
    console.log(cols.map((v, i) => pad(v, COL[i])).join(" │ "));
  });

  if (businesses.length > MAX) {
    console.log(`  ... (+${businesses.length - MAX} más en el CSV)`);
  }
  line();
  console.log(`Total: ${businesses.length} empresas\n`);
}

// ── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  const opts = parseArgs();

  if (opts.help) {
    printHelp();
    return;
  }

  const timestamp   = new Date().toISOString().slice(0, 19).replace(/[T:]/g, "-");
  const ciuuTag     = opts.ciiu.join("-") || "all";
  const depTag      = opts.departamento.toLowerCase();
  const outputPath  = opts.output
    || path.join("output", `produce_${ciuuTag}_${depTag}_${timestamp}.csv`);

  console.log("\n── PRODUCE / CIIU ──────────────────────────────────────");
  console.log(`  CIIU:           ${opts.ciiu.join(", ") || "(todos)"}`);
  console.log(`  Departamento:   ${opts.departamento}`);
  if (opts.provincia) console.log(`  Provincia:      ${opts.provincia}`);
  if (opts.distrito)  console.log(`  Distrito:       ${opts.distrito}`);
  if (opts.sector)    console.log(`  Sector:         ${opts.sector}`);
  console.log(`  Max resultados: ${opts.maxResults}`);
  console.log(`  Enriquecimiento: ${opts.enrich ? "Sí" : "No"}`);
  console.log("────────────────────────────────────────────────────────\n");

  // 1. Leer CSV
  process.stdout.write("Leyendo CSV de PRODUCE...");
  let businesses;
  try {
    businesses = await readProduceCSV({
      ciiu:         opts.ciiu,
      departamento: opts.departamento,
      provincia:    opts.provincia,
      distrito:     opts.distrito,
      sector:       opts.sector,
      maxResults:   opts.maxResults,
      csvPath:      opts.csvPath,
      onProgress:   (p) => process.stdout.write(`\r${p.message}   `),
    });
  } catch (err) {
    console.error(`\n\nError: ${err.message}`);
    process.exit(1);
  }

  console.log(`\r✓ ${businesses.length} empresas cargadas del CSV\n`);

  if (!businesses.length) {
    console.log("No se encontraron empresas con esos filtros.");
    return;
  }

  printTable(businesses);

  // 2. Enriquecimiento
  if (opts.enrich) {
    console.log("Buscando contacto en Google...\n");
    businesses = await enrichBusinesses(businesses, {
      concurrency: opts.concurrency,
      delayMs:     opts.delayMs,
      headless:    !opts.showBrowser,
      onProgress:  (p) => {
        if (p.stage === "enrich") {
          process.stdout.write(`\r  ${p.message}   `);
        } else if (p.stage === "enrich_done") {
          console.log(`\n\n✓ ${p.message}`);
        }
      },
    });

    const found     = businesses.filter((b) => b.enrichmentStatus === "encontrado").length;
    const noContact = businesses.filter((b) => b.enrichmentStatus === "sin_contacto").length;
    console.log(`\n  Con contacto:   ${found}`);
    console.log(`  Sin contacto:   ${noContact}`);
    console.log(`  (filtra 'Estado Enriquecimiento'='sin_contacto' para revisión manual)\n`);
  }

  // 3. Exportar CSV
  exportCSV(businesses, outputPath);
  console.log(`✓ CSV exportado: ${path.resolve(outputPath)}`);
  console.log(`\nTip: Importa en Google Sheets → Archivo → Importar → Subir (separador: coma)\n`);
}

main().catch((err) => {
  console.error("Error inesperado:", err);
  process.exit(1);
});
