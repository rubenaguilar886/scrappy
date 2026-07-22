/**
 * auth.js — login sin contraseña (magic link) + sesiones por cookie.
 *
 * Flujo: el usuario pone su email → se genera un link de un solo uso
 * (válido 15 min) → al hacer clic, se crea una sesión de 30 días
 * guardada en cookie httpOnly.
 *
 * Envío de email: si RESEND_API_KEY está configurada, se manda el
 * correo real vía Resend. Si no, el link se devuelve directo en la
 * respuesta de la API (y se imprime en logs) para poder probar el
 * flujo completo antes de conectar un proveedor de email — quitar
 * ese fallback una vez esté Resend (u otro) configurado en producción.
 */

"use strict";

const crypto = require("crypto");
const db = require("./db");

const MAGIC_LINK_TTL_MS = 15 * 60 * 1000;       // 15 min
const SESSION_TTL_MS    = 30 * 24 * 60 * 60 * 1000; // 30 días

function newToken() {
  return crypto.randomBytes(24).toString("hex");
}

function normalizeEmail(email) {
  return String(email || "").trim().toLowerCase();
}

async function getOrCreateUser(email) {
  const existing = await db.query("SELECT id, email FROM users WHERE email = $1", [email]);
  if (existing.rows.length) return existing.rows[0];
  const inserted = await db.query(
    "INSERT INTO users (email) VALUES ($1) RETURNING id, email",
    [email]
  );
  return inserted.rows[0];
}

async function sendEmail(to, subject, html) {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) return { sent: false };
  const from = process.env.RESEND_FROM || "Scrappy <acceso@scrappy.app>";
  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: "Bearer " + apiKey },
      body: JSON.stringify({ from, to, subject, html }),
    });
    return { sent: res.ok };
  } catch (err) {
    console.error("[auth] error enviando email:", err.message);
    return { sent: false };
  }
}

// ── Paso 1: pedir link ────────────────────────────────────────────────
async function requestMagicLink(email, baseUrl) {
  const clean = normalizeEmail(email);
  if (!clean || !clean.includes("@")) throw new Error("Email inválido.");

  const user = await getOrCreateUser(clean);
  const token = newToken();
  const expiresAt = new Date(Date.now() + MAGIC_LINK_TTL_MS);

  await db.query(
    "INSERT INTO magic_links (token, email, expires_at) VALUES ($1, $2, $3)",
    [token, clean, expiresAt]
  );

  const link = `${baseUrl}/api/auth/verify?token=${token}`;
  const { sent } = await sendEmail(
    clean,
    "Tu acceso a Scrappy",
    `<p>Haz clic para entrar (válido 15 minutos):</p><p><a href="${link}">${link}</a></p>`
  );

  if (!sent) {
    console.log(`[auth] link de acceso para ${clean}: ${link}`);
  }

  return { userId: user.id, devLink: sent ? null : link };
}

// ── Paso 2: verificar el link y crear sesión ────────────────────────────
async function verifyMagicLink(token) {
  const result = await db.query(
    "SELECT token, email, expires_at, used_at FROM magic_links WHERE token = $1",
    [token]
  );
  const row = result.rows[0];
  if (!row) throw new Error("Link inválido.");
  if (row.used_at) throw new Error("Este link ya fue usado.");
  if (new Date(row.expires_at) < new Date()) throw new Error("Este link expiró. Pide uno nuevo.");

  await db.query("UPDATE magic_links SET used_at = now() WHERE token = $1", [token]);

  const user = await getOrCreateUser(row.email);
  const sessionToken = newToken();
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS);
  await db.query(
    "INSERT INTO sessions (token, user_id, expires_at) VALUES ($1, $2, $3)",
    [sessionToken, user.id, expiresAt]
  );

  return { sessionToken, userId: user.id, email: user.email };
}

// ── Cookies (sin dependencias extra) ────────────────────────────────────
function parseCookies(req) {
  const header = req.headers.cookie || "";
  const out = {};
  header.split(";").forEach((part) => {
    const idx = part.indexOf("=");
    if (idx < 0) return;
    const k = part.slice(0, idx).trim();
    const v = part.slice(idx + 1).trim();
    if (k) out[k] = decodeURIComponent(v);
  });
  return out;
}

function setSessionCookie(res, token) {
  const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
  res.setHeader(
    "Set-Cookie",
    `scrappy_session=${token}; HttpOnly; Path=/; Max-Age=${Math.floor(SESSION_TTL_MS / 1000)}; SameSite=Lax${secure}`
  );
}

function clearSessionCookie(res) {
  res.setHeader("Set-Cookie", "scrappy_session=; HttpOnly; Path=/; Max-Age=0; SameSite=Lax");
}

async function getUserFromRequest(req) {
  const cookies = parseCookies(req);
  const token = cookies["scrappy_session"];
  if (!token) return null;
  const result = await db.query(
    `SELECT u.id, u.email, s.expires_at
     FROM sessions s JOIN users u ON u.id = s.user_id
     WHERE s.token = $1`,
    [token]
  );
  const row = result.rows[0];
  if (!row) return null;
  if (new Date(row.expires_at) < new Date()) return null;
  return { id: row.id, email: row.email };
}

module.exports = {
  requestMagicLink,
  verifyMagicLink,
  parseCookies,
  setSessionCookie,
  clearSessionCookie,
  getUserFromRequest,
};
