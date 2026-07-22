/**
 * pipeline-stages.js — las 15 etapas oficiales del pipeline CRM Leads.
 * Fuente única de verdad: usado por server.js (validación) y expuesto
 * al frontend via GET /api/crm/config para construir el dropdown.
 */

'use strict';

// Orden oficial del pipeline (columna "Etapa" en Sheets).
const STAGES = [
  "Nuevo",
  "Copiado",
  "Enviado",
  "Toque 1",
  "Toque 2",
  "Toque 3",
  "Interesado",
  "Demo enviado",
  "Toque 1 post-demo",
  "Toque 2 post-demo",
  "Toque 3 post-demo",
  "Llamada realizada",
  "Checkpoint agendado",
  "Cerrado",
  "Perdido",
];

// Etapas que implican un contacto saliente real (se usó una línea para
// escribir o llamar). Al pasar el dropdown a una de estas, la UI pide
// confirmar qué número se usó antes de guardar el cambio.
const CONTACT_STAGES = [
  "Enviado",
  "Toque 1",
  "Toque 2",
  "Toque 3",
  "Demo enviado",
  "Toque 1 post-demo",
  "Toque 2 post-demo",
  "Toque 3 post-demo",
  "Llamada realizada",
];

const STAGE_SET = new Set(STAGES);
const CONTACT_STAGE_SET = new Set(CONTACT_STAGES);

function isValidStage(stage) {
  return STAGE_SET.has(stage);
}

function isContactStage(stage) {
  return CONTACT_STAGE_SET.has(stage);
}

module.exports = { STAGES, CONTACT_STAGES, isValidStage, isContactStage };
