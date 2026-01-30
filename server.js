const express = require("express");
const path = require("path");

const app = express();

// --- Build/version label (helps confirm the live site updated) ---
const BUILD = "pp-v10";

// --- Config ---
const PORT = Number(process.env.PORT || 8080);
const APIFY_TOKEN = process.env.APIFY_TOKEN || "";
const APIFY_ECOM_ACTOR = process.env.APIFY_ECOM_ACTOR || "apify/e-commerce-scraping-tool";

// Cache (minutes)
const CACHE_TTL_MIN = Number(process.env.CACHE_TTL_MINUTES || 10);
const CACHE_TTL_MS = CACHE_TTL_MIN * 60 * 1000;

// In-memory cache: key -> { expiresAt, data }
const cache = new Map();

// Middleware
app.use(express.json());
app.use(express.static(__dirname));

// Small request logger (useful for debugging on Railway)
app.use((req, res, next) => {
  const start = Date.now();
  res.on("finish", () => {
    const ms = Date.now() - start;
    console.log(`${req.method} ${req.originalUrl} -> ${res.statusCode} (${ms}ms)`);
  });
  next();
});

// Helpers
function money(n) {
  const num = Number(n);
  if (!isFinite(num)) return null;
  return num;
}

function safeStr(x) {
  return typeof x === "string" ? x : x == null ? "" : String(x);
}

function pickFirst(...vals) {
  for (const v of vals) {
    if (v === 0) return 0;
    if (v) return v;
  }
  return null;
}

function extractPrice(item) {
  // Apify results vary by site; try a bunch of common fields
  const candidates = [
    item.price,
    item.currentPrice,
    item.priceCurrent,
    item.priceValue,
    item.finalPrice,
    item.salePrice,
    item.price_amount,
    item?.pricing?.price,
    item?.pricing?.current,
    item?.price?.value
  ];

  // Sometimes it’s like "$439.99"
  for (const c of candidates) {
    if (typeof c === "number") return c;
    if (typeof c === "string") {
      const cleaned = c.replace(/[^\d.]/g, "");
      const num = Number(cleaned);
      if (isFinite(num) && num > 0) return num;
    }
  }
  return null;
}

function extractImage(item) {
  return (
    pickFirst(
      item.image,
      item.imageUrl,
      item.thumbnail,
      item.thumbnailUrl,
      item?.images?.[0],
      item?.imageUrls?.[0]
    ) || null
  );
}

function extractUrl(item) {
  return pickFirst(item.url, item.productUrl, item.link, item.detailUrl) || null;
}

function buildFallback(query, meta = {}) {
  return {
    query,
    meta: { build: BUILD, ...meta },
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

async function apifyRunKeywordSearch(keyword) {
  if (!APIFY_TOKEN) {
    return { ok: false, error: "Missing APIFY_TOKEN env var" };
  }

  // IMPORTANT: correct input fields for apify/e-commerce-scraping-tool
  const input = {
    keyword,
    marketplaces: ["www.walmart.com"],
    maxProductResults: 8,
    scrapeMode: "AUTO"
  };

  // Start a run and wait for results
  const runUrl =
    `https://api.apify.com/v2/acts/${encodeURIComponent(APIFY_ECOM_ACTOR)}/runs?token=${encodeURIComponent(APIFY_TOKEN)}&waitForFinish=25`;

  const runRes = await fetch(runUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input)
  });

  if (!runRes.ok) {
    const text = await runRes.text().catch(() => "");
    return { ok: false, error: `Apify HTTP ${runRes.status} ${text}` };
  }

  const runJson = await runRes.json();
  const run = runJson?.data;

  if (!run || !run.defaultDatasetId) {
    return { ok: false, error: "Apify returned no run dataset id" };
  }

  // Get dataset items
  const itemsUrl =
    `https://api.apify.com/v2/datasets/${encodeURIComponent(run.defaultDatasetId)}/items?token=${encodeURIComponent(APIFY_TOKEN)}&clean=true&format=json`;

  const itemsRes = await fetch(itemsUrl);
  if (!itemsRes.ok) {
    const text = await itemsRes.text().catch(() => "");
    return { ok: false, error: `Apify dataset HTTP ${itemsRes.status} ${text}` };
  }

  const items = await itemsRes.json();
  return { ok: true, items: Array.isArray(items) ? items : [] };
}

// Health check
app.get("/api/health", (req, res) => {
  res.json({
    status: "ok",
    build: BUILD,
    hasApifyToken: !!APIFY_TOKEN,
    node: process.version,
    actor: APIFY_ECOM_ACTOR,
    cacheTtlMinutes: CACHE_TTL_MIN
  });
});

// Search endpoint
app.get("/api/search", async (req, res) => {
  const q = safeStr(req.query.q).trim();
  if (!q) return res.status(400).json({ error: "Missing query parameter: q" });

  const cacheKey = `walmart:${q.toLowerCase()}`;
  const cached = cache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) {
    return res.json({ ...cached.data, meta: { ...(cached.data.meta || {}), cached: true } });
  }

  let payload = null;

  try {
    const result = await apifyRunKeywordSearch(q);

    if (!result.ok) {
      payload = buildFallback(q, { source: "stub", reason: "exception", error: result.error });
    } else {
      const items = result.items || [];

      // Map items into offers with prices
      const mapped = items
        .map((it, idx) => {
          const price = extractPrice(it);
          const title = safeStr(it.title || it.name || it.productName || "");
          if (!title) return null;

          const url = extractUrl(it) || `https://www.walmart.com/search?q=${encodeURIComponent(q)}`;
          const image = extractImage(it);

          return {
            id: `walmart-${idx + 1}`,
            title,
            condition: "New",
            retailer: "Walmart",
            seller: "Walmart",
            pricing: {
              item: money(price) ?? null,
              shipping: 0,
              tax: 0,
              total: money(price) ?? null
            },
            delivery: null,
            returns: null,
            trust: "Verified",
            image,
            url,
            cta: { primary_label: "View deal", checkout_url: url }
          };
        })
        .filter(Boolean);

      const priced = mapped.filter((o) => typeof o.pricing.total === "number" && o.pricing.total > 0);

      if (!priced.length) {
        payload = buildFallback(q, {
          source: "apify",
          reason: "no_results",
          note: "Apify returned 0 priced items for this keyword (try a more specific search)."
        });
      } else {
        priced.sort((a, b) => a.pricing.total - b.pricing.total);
        const best = priced[0];
        const alternatives = priced.slice(1, 4);

        payload = {
          query: q,
          meta: {
            build: BUILD,
            source: "apify",
            marketplace: "www.walmart.com",
            apifyItemsCount: items.length,
            mappedPricedCount: priced.length,
            cached: false
          },
          summary: { best_pick_reason: "Lowest priced Walmart result.", confidence: 0.75 },
          best_pick: best,
          alternatives,
          disclosures: {
            pricing_note: "Shipping/tax may vary at checkout. Verify the listing details.",
            trust_note: "We prioritize trusted retailers when available."
          }
        };
      }
    }
  } catch (err) {
    payload = buildFallback(q, { source: "stub", reason: "exception", error: String(err?.message || err) });
  }

  // Cache it
  cache.set(cacheKey, { expiresAt: Date.now() + CACHE_TTL_MS, data: payload });

  return res.json(payload);
});

// Fallback route
app.get("/", (req, res) => res.sendFile(path.join(__dirname, "index.html")));

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT} (build ${BUILD})`);
});
