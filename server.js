/* server.js — Priceproof (pp-v9)
   - Serves frontend from project root
   - /api/health health check
   - /api/search?q=... pulls Walmart results via Apify E-commerce Scraping Tool
   - Longer timeout + safe fallback
*/

const express = require("express");
const path = require("path");

const app = express();

// Railway uses process.env.PORT. Locally you can hit :8080
const PORT = process.env.PORT || 8080;

// ---- Build / config ----
const BUILD = "pp-v9";

// Apify settings (Actor: apify/e-commerce-scraping-tool)
const APIFY_ACTOR = process.env.APIFY_ECOM_ACTOR || "apify/e-commerce-scraping-tool";
const APIFY_TOKEN = process.env.APIFY_TOKEN || "";

// Timeouts
const APIFY_TIMEOUT_MS = 65000; // how long OUR server waits for Apify response
const APIFY_RUN_TIMEOUT_SECS = 120; // how long Apify is allowed to run (actor-side)

// Simple in-memory cache (helps speed / avoid repeated scrapes)
const CACHE_TTL_MS = 10 * 60 * 1000; // 10 minutes
const cache = new Map(); // key -> { at, data }

// ---- middleware ----
app.use(express.json());

// Serve your frontend files (index.html, styles.css, script.js) from the project root
app.use(express.static(__dirname));

// Log requests (helps debug)
app.use((req, res, next) => {
  const start = Date.now();
  res.on("finish", () => {
    const ms = Date.now() - start;
    console.log(`${req.method} ${req.originalUrl} -> ${res.statusCode} (${ms}ms)`);
  });
  next();
});

// ---- helpers ----
function money(n) {
  const num = Number(n);
  return Number.isFinite(num) ? num : null;
}

function safeStr(x) {
  return typeof x === "string" ? x : x == null ? "" : String(x);
}

function getFirstImage(item) {
  // Apify actors vary; images can be string, array, or nested
  if (!item) return null;
  if (typeof item.image === "string") return item.image;
  if (typeof item.imageUrl === "string") return item.imageUrl;
  if (typeof item.thumbnail === "string") return item.thumbnail;
  if (Array.isArray(item.images) && item.images.length) return item.images[0];
  if (Array.isArray(item.imageUrls) && item.imageUrls.length) return item.imageUrls[0];
  return null;
}

function getUrl(item) {
  if (!item) return null;
  return (
    item.url ||
    item.productUrl ||
    item.itemUrl ||
    item.link ||
    null
  );
}

function extractPrice(item) {
  // Try common fields from ecomm actors
  const candidates = [
    item.price,
    item.currentPrice,
    item.salePrice,
    item.minPrice,
    item.priceValue,
    item.price_amount,
  ];

  for (const c of candidates) {
    const v = money(c);
    if (v != null && v > 0) return v;
  }

  // Sometimes price is inside nested structures
  if (item.pricing && typeof item.pricing === "object") {
    const v = money(item.pricing.price || item.pricing.current || item.pricing.value);
    if (v != null && v > 0) return v;
  }

  return null;
}

function mapWalmartItems(apifyItems, query) {
  const mapped = [];

  for (let i = 0; i < apifyItems.length; i++) {
    const it = apifyItems[i];
    const title = safeStr(it.title || it.name || it.productTitle || query).trim();
    const price = extractPrice(it);
    const url = getUrl(it);
    const image = getFirstImage(it);

    if (!title) continue;
    if (price == null) continue; // we only keep priced items

    mapped.push({
      id: `walmart-${i + 1}`,
      title,
      condition: "New",
      retailer: "Walmart",
      seller: "Walmart",
      pricing: { item: price, shipping: 0, tax: 0, total: price },
      delivery: null,
      returns: null,
      trust: "Verified",
      image: image || null,
      url: url || `https://www.walmart.com/search?q=${encodeURIComponent(query)}`,
      cta: {
        primary_label: "View deal",
        checkout_url: url || `https://www.walmart.com/search?q=${encodeURIComponent(query)}`
      }
    });
  }

  return mapped;
}

function pickBest(items) {
  if (!items.length) return null;
  const sorted = [...items].sort((a, b) => (a.pricing.total || 1e12) - (b.pricing.total || 1e12));
  return { best: sorted[0], alternatives: sorted.slice(1, 4) };
}

function fallbackResponse(query, metaExtra = {}) {
  return {
    query,
    meta: { build: BUILD, source: "stub", ...metaExtra },
    summary: { best_pick_reason: "Fallback shown (no live results yet).", confidence: 0.5 },
    best_pick: {
      id: "fallback-1",
      title: `${query} (Fallback)`,
      condition: "Unknown",
      retailer: "Walmart",
      seller: "Walmart",
      pricing: { item: 0, shipping: 0, tax: 0, total: 0 },
      delivery: null,
      returns: null,
      trust: "Fallback",
      image: null,
      url: `https://www.walmart.com/search?q=${encodeURIComponent(query)}`,
      cta: {
        primary_label: "Search Walmart",
        checkout_url: `https://www.walmart.com/search?q=${encodeURIComponent(query)}`
      }
    },
    alternatives: [],
    disclosures: {
      pricing_note: "Live prices unavailable right now. Try again or refine the search.",
      trust_note: "We prioritize trusted retailers when available."
    }
  };
}

async function apifyRunAndGetItems({ query }) {
  // Use Apify “run-sync-get-dataset-items” endpoint
  // Docs-style pattern:
  // POST https://api.apify.com/v2/acts/{actor}/run-sync-get-dataset-items?token=...&timeout=...
  const url =
    `https://api.apify.com/v2/acts/${encodeURIComponent(APIFY_ACTOR)}` +
    `/run-sync-get-dataset-items?token=${encodeURIComponent(APIFY_TOKEN)}` +
    `&timeout=${APIFY_RUN_TIMEOUT_SECS}`;

  // IMPORTANT: marketplaces must be EXACT allowed values; Walmart is "www.walmart.com"
  const input = {
    // keyword search mode
    search: query,
    marketplaces: ["www.walmart.com"],
    // keep results small while testing; you can increase later
    maxItems: 10
  };

  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), APIFY_TIMEOUT_MS);

  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
      signal: controller.signal
    });

    if (!res.ok) {
      const txt = await res.text().catch(() => "");
      throw new Error(`Apify HTTP ${res.status} ${txt}`);
    }

    const items = await res.json();
    return Array.isArray(items) ? items : [];
  } finally {
    clearTimeout(t);
  }
}

// ---- routes ----
app.get("/api/health", (req, res) => {
  res.json({
    status: "ok",
    build: BUILD,
    hasApifyToken: !!APIFY_TOKEN,
    node: process.version,
    actor: APIFY_ACTOR,
    cacheTtlMinutes: Math.round(CACHE_TTL_MS / 60000)
  });
});

app.get("/api/search", async (req, res) => {
  const q = safeStr(req.query.q || "").trim();
  const nocache = safeStr(req.query.nocache || "") === "1";

  if (!q) return res.status(400).json({ error: "Missing query parameter: q" });

  // If token missing, return fallback with clear reason
  if (!APIFY_TOKEN) {
    return res.json(fallbackResponse(q, { source: "stub", reason: "missing APIFY_TOKEN" }));
  }

  // Cache check
  const key = q.toLowerCase();
  const now = Date.now();
  const cached = cache.get(key);
  if (!nocache && cached && now - cached.at < CACHE_TTL_MS) {
    return res.json({ ...cached.data, meta: { ...(cached.data.meta || {}), cached: true } });
  }

  // Call Apify
  try {
    const apifyItems = await apifyRunAndGetItems({ query: q });
    const mapped = mapWalmartItems(apifyItems, q);

    if (!mapped.length) {
      const data = fallbackResponse(q, {
        source: "apify",
        reason: "no_results",
        note: "Apify returned 0 priced items for this keyword (try a more specific search).",
        cached: false
      });
      cache.set(key, { at: now, data });
      return res.json(data);
    }

    const { best, alternatives } = pickBest(mapped);

    const data = {
      query: q,
      meta: {
        build: BUILD,
        source: "apify",
        marketplace: "www.walmart.com",
        apifyItemsCount: apifyItems.length,
        mappedPricedCount: mapped.length,
        cached: false
      },
      summary: {
        best_pick_reason: "Lowest priced Walmart result.",
        confidence: 0.75
      },
      best_pick: best,
      alternatives,
      disclosures: {
        pricing_note: "Shipping/tax may vary at checkout. Verify the listing details.",
        trust_note: "We prioritize trusted retailers when available."
      }
    };

    cache.set(key, { at: now, data });
    return res.json(data);

  } catch (err) {
    const msg = err?.name === "AbortError"
      ? `Apify timed out (${APIFY_TIMEOUT_MS}ms).`
      : safeStr(err?.message || err);

    const data = fallbackResponse(q, {
      source: "apify",
      reason: "exception",
      error: msg,
      cached: false
    });

    cache.set(key, { at: now, data });
    return res.json(data);
  }
});

// Fallback for homepage
app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "index.html"));
});

// Start server
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT} (build ${BUILD})`);
});
