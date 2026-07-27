/**
 * credits.js — quién puede buscar y cuánto puede ver.
 *
 * Tres formas de acceso, en este orden de prioridad:
 *   1. Suscripción activa (Plan Pro)  — cupo que se resetea cada día.
 *   2. Paquete Ciudad activo          — cupo de créditos con fecha de
 *      vencimiento, amarrado a un rubro+ciudad específico.
 *   3. Prueba gratis                  — una sola vez por usuario, 3
 *      prospectos completos, cualquier rubro/ciudad.
 *
 * Los resultados que exceden el cupo disponible NO se descartan: se
 * devuelven "bloqueados" (sin teléfono/whatsapp/email/web) para que el
 * usuario vea que existen y sienta el incentivo de comprar más.
 */

"use strict";

const crypto = require("crypto");
const db = require("./db");

const TRIAL_CREDITS = 10;

function normalize(str) {
  return String(str || "").trim().toLowerCase();
}

function businessKey(b) {
  const base = b.googleMapsUrl || `${b.name}|${b.address}`;
  return crypto.createHash("sha1").update(normalize(base)).digest("hex");
}

// ── Determina qué tipo de acceso tiene el usuario para este rubro+ciudad ──
async function getUserAccess(userId, rubro, ciudad) {
  // 1. Suscripción activa
  const sub = await db.query(
    "SELECT id, daily_limit FROM subscriptions WHERE user_id = $1 AND status = 'active' LIMIT 1",
    [userId]
  );
  if (sub.rows.length) {
    const { id: subscriptionId, daily_limit: dailyLimit } = sub.rows[0];
    const usage = await db.query(
      "SELECT count FROM daily_usage WHERE user_id = $1 AND usage_date = CURRENT_DATE",
      [userId]
    );
    const usedToday = usage.rows[0]?.count || 0;
    const remaining = Math.max(0, dailyLimit - usedToday);
    if (remaining > 0) {
      return { type: "subscription", userId, subscriptionId, remaining, dailyLimit };
    }
    return { type: "subscription_exhausted", userId, remaining: 0, dailyLimit };
  }

  // 2. Paquete Ciudad activo para este rubro. El paquete ya NO exige que
  // la ciudad/distrito escrito coincida exacto — así el cliente puede
  // buscar "Miraflores, Lima", después "Barranco, Lima", etc., usando el
  // mismo cupo de créditos, siempre que ambos textos compartan la ciudad
  // (ej. "Lima"). Esto evita el problema de comprar "tatuajes en Lima" y
  // sentir que solo sirve para el texto exacto "Lima".
  const candidates = await db.query(
    `SELECT id, ciudad, credits_total, credits_used, expires_at
     FROM city_packs
     WHERE user_id = $1 AND lower(rubro) = $2
       AND expires_at > now() AND credits_used < credits_total
     ORDER BY purchased_at DESC`,
    [userId, normalize(rubro)]
  );
  const ciudadNorm = normalize(ciudad);
  const match = candidates.rows.find((p) => {
    const packCiudad = normalize(p.ciudad);
    return ciudadNorm.includes(packCiudad) || packCiudad.includes(ciudadNorm);
  });
  if (match) {
    return {
      type: "city_pack",
      userId,
      packId: match.id,
      remaining: match.credits_total - match.credits_used,
      expiresAt: match.expires_at,
    };
  }

  // 3. Prueba gratis (una vez por usuario)
  const trial = await db.query("SELECT user_id FROM trial_usage WHERE user_id = $1", [userId]);
  if (!trial.rows.length) {
    return { type: "trial", userId, remaining: TRIAL_CREDITS };
  }

  return { type: "none", userId, remaining: 0 };
}

// ── Prueba gratis SIN login — identificada por session_id, no por cuenta ──
// Deja buscar una vez sin pedir correo. La siguiente búsqueda (o compra)
// sí requiere login, momento en el que recién se le pide el email.
async function hasAnonTrialUsed(sessionId) {
  const r = await db.query("SELECT 1 FROM session_trials WHERE session_id = $1", [sessionId]);
  return r.rows.length > 0;
}

async function markAnonTrialUsed(sessionId) {
  await db.query(
    "INSERT INTO session_trials (session_id) VALUES ($1) ON CONFLICT DO NOTHING",
    [sessionId]
  );
}

// ── Aplica el cupo a los resultados y descuenta lo consumido ────────────
// Devuelve { unlocked: [...], lockedCount, remainingAfter }
async function applyAccessToResults(access, results) {
  if (access.type === "subscription") {
    const n = Math.min(results.length, access.remaining);
    await db.query(
      `INSERT INTO daily_usage (user_id, usage_date, count)
       VALUES ($1, CURRENT_DATE, $2)
       ON CONFLICT (user_id, usage_date) DO UPDATE SET count = daily_usage.count + $2`,
      [access.userId, n]
    );
    return finalize(results, n, access.remaining - n);
  }

  if (access.type === "city_pack") {
    // Deduplicar: negocios ya entregados antes en este paquete no
    // vuelven a cobrar crédito (pero sí se muestran completos de nuevo).
    const alreadyRes = await db.query(
      "SELECT business_key FROM delivered_businesses WHERE city_pack_id = $1",
      [access.packId]
    );
    const already = new Set(alreadyRes.rows.map((r) => r.business_key));

    const withKeys = results.map((b) => ({ b, key: businessKey(b) }));
    const seenBefore = withKeys.filter((x) => already.has(x.key));
    const brandNew = withKeys.filter((x) => !already.has(x.key));

    const newAllowed = Math.min(brandNew.length, access.remaining);
    const toInsert = brandNew.slice(0, newAllowed);

    if (toInsert.length) {
      await db.query(
        "UPDATE city_packs SET credits_used = credits_used + $1 WHERE id = $2",
        [toInsert.length, access.packId]
      );
      for (const item of toInsert) {
        await db.query(
          "INSERT INTO delivered_businesses (city_pack_id, business_key) VALUES ($1, $2) ON CONFLICT DO NOTHING",
          [access.packId, item.key]
        );
      }
    }

    const unlockedItems = [...seenBefore, ...toInsert].map((x) => x.b);
    const unlocked = unlockedItems.map(stripNothing);
    const lockedItems = brandNew.slice(newAllowed).map((x) => x.b);
    const locked = lockedItems.map(stripContact);
    return {
      unlocked: [...unlocked, ...locked],
      lockedCount: locked.length,
      remainingAfter: access.remaining - toInsert.length,
    };
  }

  if (access.type === "trial") {
    const n = Math.min(results.length, access.remaining);
    // La prueba anónima (sin cuenta) no tiene userId — su marca de "ya
    // usada" se registra aparte, en session_trials (ver markAnonTrialUsed
    // en server.js), no aquí.
    if (access.userId) {
      await db.query(
        "INSERT INTO trial_usage (user_id) VALUES ($1) ON CONFLICT DO NOTHING",
        [access.userId]
      );
    }
    return finalize(results, n, access.remaining - n);
  }

  // Sin acceso — no debería llegar aquí (se corta antes en el endpoint)
  return { unlocked: results.map(stripContact), lockedCount: results.length, remainingAfter: 0 };
}

function finalize(results, unlockCount, remainingAfter) {
  const unlocked = results.slice(0, unlockCount).map(stripNothing);
  const locked = results.slice(unlockCount).map(stripContact);
  return {
    unlocked: [...unlocked, ...locked],
    lockedCount: locked.length,
    remainingAfter: Math.max(0, remainingAfter),
  };
}

function stripNothing(b) {
  return { ...b, locked: false };
}

function stripContact(b) {
  return {
    name: b.name,
    rating: b.rating,
    reviewsCount: b.reviewsCount,
    category: b.category,
    searchLocation: b.searchLocation,
    address: undefined,
    locked: true,
  };
}

module.exports = {
  getUserAccess,
  applyAccessToResults,
  businessKey,
  TRIAL_CREDITS,
  hasAnonTrialUsed,
  markAnonTrialUsed,
};
