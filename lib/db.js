/**
 * db.js — conexión Postgres + creación de esquema al arrancar.
 *
 * Requiere la variable de entorno DATABASE_URL (Railway la inyecta sola
 * en cuanto agregas el addon de Postgres al proyecto). En local, si no
 * existe, el server sigue arrancando pero todo lo que dependa de la
 * base de datos (login, créditos, suscripciones) devuelve error claro
 * en vez de tumbar el proceso.
 */

"use strict";

const { Pool } = require("pg");

const connectionString = process.env.DATABASE_URL || "";
let pool = null;

if (connectionString) {
  pool = new Pool({
    connectionString,
    ssl: connectionString.includes("localhost") ? false : { rejectUnauthorized: false },
  });
} else {
  console.warn("[db] DATABASE_URL no configurada — login, créditos y suscripciones no funcionarán hasta que agregues Postgres.");
}

async function query(text, params) {
  if (!pool) throw new Error("Base de datos no configurada (falta DATABASE_URL).");
  return pool.query(text, params);
}

const SCHEMA = `
CREATE TABLE IF NOT EXISTS users (
  id SERIAL PRIMARY KEY,
  email TEXT UNIQUE NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS magic_links (
  token TEXT PRIMARY KEY,
  email TEXT NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  used_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS sessions (
  token TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id),
  created_at TIMESTAMPTZ DEFAULT now(),
  expires_at TIMESTAMPTZ NOT NULL
);

CREATE TABLE IF NOT EXISTS subscriptions (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id),
  status TEXT NOT NULL DEFAULT 'active',
  daily_limit INTEGER NOT NULL DEFAULT 50,
  culqi_subscription_id TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  canceled_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS daily_usage (
  user_id INTEGER NOT NULL REFERENCES users(id),
  usage_date DATE NOT NULL,
  count INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (user_id, usage_date)
);

CREATE TABLE IF NOT EXISTS city_packs (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id),
  rubro TEXT NOT NULL,
  ciudad TEXT NOT NULL,
  credits_total INTEGER NOT NULL DEFAULT 100,
  credits_used INTEGER NOT NULL DEFAULT 0,
  purchased_at TIMESTAMPTZ DEFAULT now(),
  expires_at TIMESTAMPTZ NOT NULL,
  culqi_charge_id TEXT
);

CREATE TABLE IF NOT EXISTS delivered_businesses (
  id SERIAL PRIMARY KEY,
  city_pack_id INTEGER NOT NULL REFERENCES city_packs(id),
  business_key TEXT NOT NULL,
  delivered_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(city_pack_id, business_key)
);

CREATE TABLE IF NOT EXISTS trial_usage (
  user_id INTEGER PRIMARY KEY REFERENCES users(id),
  used_at TIMESTAMPTZ DEFAULT now()
);
`;

async function initSchema() {
  if (!pool) return;
  try {
    await pool.query(SCHEMA);
    console.log("[db] esquema verificado/creado correctamente.");
  } catch (err) {
    console.error("[db] error creando esquema:", err.message);
  }
}

module.exports = { query, initSchema, isConfigured: () => Boolean(pool) };
