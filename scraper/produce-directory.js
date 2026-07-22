/**
 * produce-directory.js
 * Lee el CSV del directorio MIPYME de PRODUCE y filtra por CIIU, departamento, etc.
 * Sin dependencias externas — usa solo fs/readline de Node.
 */

const fs = require("fs");
const readline = require("readline");
const path = require("path");

const DEFAULT_CSV = path.join(__dirname, "..", "data", "produce_mipyme.csv");

/**
 * Parsea una línea CSV respetando comillas.
 */
function parseCsvLine(line) {
  const result = [];
  let current = "";
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (ch === "," && !inQuotes) {
      result.push(current.trim());
      current = "";
    } else {
      current += ch;
    }
  }
  result.push(current.trim());
  return result;
}

/**
 * Lee el CSV de PRODUCE línea a línea y devuelve un array de objetos Business.
 *
 * @param {Object} opts
 * @param {string[]} opts.ciiu        - Códigos CIIU a incluir. Vacío = todos.
 * @param {string}   opts.departamento - Departamento (mayúsculas). Default "LIMA".
 * @param {string}   [opts.provincia]
 * @param {string}   [opts.distrito]
 * @param {string}   [opts.sector]    - Sector (ej: "SERVICIO", "INDUSTRIA").
 * @param {number}   [opts.maxResults] - Default 200.
 * @param {string}   [opts.csvPath]   - Ruta al CSV. Default data/produce_mipyme.csv.
 * @param {Function} [opts.onProgress]
 * @returns {Promise<Object[]>}
 */
async function readProduceCSV(opts = {}) {
  const {
    ciiu = [],
    departamento = "LIMA",
    provincia = null,
    distrito = null,
    sector = null,
    maxResults = 200,
    csvPath = DEFAULT_CSV,
    rucType = null,   // "10" | "20" | null (todos)
    onProgress,
  } = opts;

  if (!fs.existsSync(csvPath)) {
    throw new Error(
      `CSV de PRODUCE no encontrado en: ${csvPath}\n` +
      `Descárgalo de https://www.datosabiertos.gob.pe y colócalo en data/produce_mipyme.csv`
    );
  }

  const ciuuSet = new Set(ciiu.map((c) => c.trim().toUpperCase()));
  const depNorm  = departamento.trim().toUpperCase();
  const provNorm = provincia ? provincia.trim().toUpperCase() : null;
  const distNorm = distrito  ? distrito.trim().toUpperCase()  : null;
  const secNorm  = sector    ? sector.trim().toUpperCase()    : null;

  return new Promise((resolve, reject) => {
    const businesses = [];
    let headers = null;
    let colIdx = {};
    let lineNum = 0;
    let totalRead = 0;

    const rl = readline.createInterface({
      input: fs.createReadStream(csvPath, { encoding: "utf8" }),
      crlfDelay: Infinity,
    });

    rl.on("line", (line) => {
      lineNum++;

      // BOM strip
      if (lineNum === 1) line = line.replace(/^﻿/, "");

      const fields = parseCsvLine(line);

      if (lineNum === 1) {
        // Cabecera — normalizar a lowercase sin espacios
        headers = fields;
        headers.forEach((h, i) => {
          colIdx[h.trim().toLowerCase()] = i;
        });
        return;
      }

      if (businesses.length >= maxResults) {
        rl.close();
        return;
      }

      const get = (key) => (fields[colIdx[key]] || "").trim().toUpperCase();
      const raw = (key) => (fields[colIdx[key]] || "").trim();

      // ── Filtros ───────────────────────────────────────────────────────
      if (get("departamento") !== depNorm) return;
      if (provNorm && get("provincia") !== provNorm) return;
      if (distNorm && get("distrito")  !== distNorm) return;
      if (secNorm  && get("sector")    !== secNorm)  return;

      const ciuuVal = raw("ciiu3").toUpperCase();
      if (ciuuSet.size > 0 && !ciuuSet.has(ciuuVal)) return;

      // Filtro por tipo de RUC (primeros 2 dígitos)
      if (rucType) {
        const rucVal = raw("ruc");
        if (!rucVal.startsWith(rucType)) return;
      }

      const razon = raw("razon_social");
      if (!razon) return;

      totalRead++;

      businesses.push({
        name:              razon,
        ruc:               raw("ruc")               || null,
        ciuuCode:          ciuuVal                  || null,
        ciuuDesc:          raw("descripcion_ciiu3") || null,
        departamento:      raw("departamento")      || null,
        provincia:         raw("provincia")         || null,
        distrito:          raw("distrito")          || null,
        ubigeo:            raw("ubigeo")            || null,
        sector:            raw("sector")            || null,
        periodo:           raw("periodo") || raw("fecha_publicacion") || null,
        // Campos de contacto (a llenar en enriquecimiento)
        phone:             null,
        whatsapp:          null,
        website:           null,
        email:             null,
        // Trazabilidad
        enrichmentStatus:  "pendiente",
        enrichmentSource:  null,
        source:            "produce_directory",
        scrapedAt:         new Date().toISOString(),
      });

      if (totalRead % 500 === 0) {
        onProgress?.({
          stage: "reading",
          message: `Leyendo CSV... ${totalRead} empresas encontradas`,
          current: totalRead,
        });
      }
    });

    rl.on("close", () => resolve(businesses));
    rl.on("error", reject);
  });
}

/**
 * Convierte un Business de PRODUCE al formato de fila para CSV de exportación.
 */

/**
 * Convierte un Business de PRODUCE al formato de fila para CSV de exportación.
 */
function toProduceSheetRow(b) {
  return {
    "Razón Social":            b.name              || "",
    "RUC":                     b.ruc               || "",
    "CIIU":                    b.ciuuCode          || "",
    "Descripción CIIU":        b.ciuuDesc          || "",
    "Sector":                  b.sector            || "",
    "Departamento":            b.departamento      || "",
    "Provincia":               b.provincia         || "",
    "Distrito":                b.distrito          || "",
    "Gerente / Rep. Legal":    b.gerente           || "",
    "LinkedIn":                b.linkedinUrl       || "",
    "Fecha Constitución":      b.fechaConstitucion || "",
    "Teléfono":                b.phone             || "",
    "WhatsApp":                b.whatsapp          || "",
    "Email":                   b.email             || "",
    "Estado SUNAT":            b.sunatEstado       || "",
    "Estado Enriquecimiento":  b.enrichmentStatus  || "",
    "Fuente Enriquecimiento":  b.enrichmentSource  || "",
  };
}

module.exports = { readProduceCSV, toProduceSheetRow, DEFAULT_CSV };
