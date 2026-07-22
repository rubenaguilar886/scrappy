"use strict";

// ─── Audience Classification ─────────────────────────────────────────────────

/**
 * Classifies a business into an audience segment based solely on
 * website presence and contactability score.
 *
 * Case A: No website + contactability > 1  → "Web Opportunity"
 * Case B: Website    + contactability <= 1 → "Google Business Opportunity"
 * Case C: No website + contactability <= 1 → "Web + Google Business Opportunity"
 * Case D: Website    + contactability > 1  → "" (no action needed)
 */
function computeAudience(business) {
  const hasWebsite = Boolean(business.website);
  // contactabilityScore is computed by the backend; use pre-computed value if
  // available, otherwise fall back to the raw field (0 when missing).
  const score = typeof business.contactabilityScore === "number"
    ? business.contactabilityScore
    : 0;

  if (!hasWebsite && score > 1) return "Web Opportunity";
  if (hasWebsite  && score <= 1) return "Google Business Opportunity";
  if (!hasWebsite && score <= 1) return "Web + Google Business Opportunity";
  // Case D: website && score > 1 — well-covered, no specific opportunity
  return "";
}

// ─── Chain / Business Group Detection ────────────────────────────────────────

function normalizeWebsite(url) {
  if (!url) return null;
  return url
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .replace(/^www\./, "")
    .replace(/\/$/, "")
    .trim();
}

function normalizePhone(phone) {
  if (!phone) return null;
  // Strip all non-digit characters for comparison
  const digits = phone.replace(/\D/g, "");
  // Ignore very short/generic numbers
  return digits.length >= 7 ? digits : null;
}

/**
 * Returns the longest common leading-word prefix shared by all names.
 * Falls back to the shortest name in the group.
 */
function commonNamePrefix(names) {
  if (!names.length) return "";
  if (names.length === 1) return names[0];

  const words = names.map(n => n.split(/\s+/));
  const first = words[0];
  const common = [];

  for (let i = 0; i < first.length; i++) {
    const w = first[i].toLowerCase();
    if (words.every(arr => arr[i] && arr[i].toLowerCase() === w)) {
      common.push(first[i]);
    } else break;
  }

  if (common.length >= 1) return common.join(" ");
  return names.reduce((a, b) => (a.length <= b.length ? a : b));
}

/**
 * Groups businesses that share a website, Instagram handle, or email into
 * "chains". Returns a new array where each business has:
 *   - audience        (string, semicolon-separated tags)
 *   - businessGroup   (string, common name prefix or own name)
 *   - locationsCount  (number, how many locations in the group)
 *   - isChain         (boolean)
 */
function detectChains(businesses) {
  const n = businesses.length;

  // Union-Find
  const parent = Array.from({ length: n }, (_, i) => i);

  function find(x) {
    if (parent[x] !== x) parent[x] = find(parent[x]);
    return parent[x];
  }

  function union(x, y) {
    const px = find(x),
      py = find(y);
    if (px !== py) parent[px] = py;
  }

  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      const bi = businesses[i],
        bj = businesses[j];

      const wi = normalizeWebsite(bi.website);
      const wj = normalizeWebsite(bj.website);
      const pi = normalizePhone(bi.phone);
      const pj = normalizePhone(bj.phone);

      const shared =
        (wi && wj && wi === wj) ||
        (pi && pj && pi === pj);

      if (shared) union(i, j);
    }
  }

  // Build group index map: root → [indices]
  const groupMap = new Map();
  for (let i = 0; i < n; i++) {
    const root = find(i);
    if (!groupMap.has(root)) groupMap.set(root, []);
    groupMap.get(root).push(i);
  }

  return businesses.map((b, i) => {
    const root = find(i);
    const group = groupMap.get(root);
    const isChain = group.length > 1;
    const groupName = isChain
      ? commonNamePrefix(group.map(idx => businesses[idx].name))
      : b.name;

    return {
      ...b,
      audience: computeAudience(b),
      businessGroup: groupName,
      locationsCount: group.length,
      isChain,
    };
  });
}

// ─── Lead Scoring ─────────────────────────────────────────────────────────────

/**
 * Classifies review count into a power tier.
 */
function computeReviewPower(business) {
  const r = business.reviewsCount;
  if (r === null || r === undefined || r === 0) return "No Data";
  if (r <= 20)  return "Low";
  if (r <= 100) return "Medium";
  if (r <= 300) return "High";
  return "Very High";
}

/**
 * Reputation based on rating + review count combination.
 */
function computeReputationScore(business) {
  const { rating, reviewsCount } = business;
  if (!rating || reviewsCount === null || reviewsCount === undefined) return "Sin datos";
  if (rating >= 4.5 && reviewsCount > 100) return "Excelente";
  if (rating >= 4.0 && reviewsCount > 20)  return "Buena";
  return "Regular";
}

/**
 * Opportunity Score 0-100.
 * +40 no website · +20 reviews>100 · +15 instagram · +10 rating≥4.5 · +10 whatsapp · +5 email
 */
function computeOpportunityScore(business) {
  let score = 0;
  if (!business.website)                       score += 40;
  if ((business.reviewsCount || 0) > 100)      score += 20;
  if (business.instagram)                       score += 15;
  if ((business.rating || 0) >= 4.5)           score += 10;
  if (business.whatsapp)                        score += 10;
  if (business.email)                           score +=  5;
  return Math.min(score, 100);
}

/**
 * Opportunity Tier A–D based on Opportunity Score.
 */
function computeOpportunityTier(business) {
  const score = typeof business.opportunityScore === "number"
    ? business.opportunityScore
    : computeOpportunityScore(business);
  if (score >= 80) return "A";
  if (score >= 60) return "B";
  if (score >= 40) return "C";
  return "D";
}

module.exports = {
  computeAudience,
  detectChains,
  computeReviewPower,
  computeReputationScore,
  computeOpportunityScore,
  computeOpportunityTier,
};
