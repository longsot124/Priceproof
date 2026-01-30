const express = require("express");
const path = require("path");

const app = express();

// Railway provides PORT. Locally you can use 8080.
const PORT = process.env.PORT || 8080;
const BUILD = "pp-v8";

// ===== Apify config =====
// Put these in Railway Variables (recommended) and optionally locally in CMD.
const APIFY_TOKEN = process.env.APIFY_TOKEN || "";
// If you stored the actor id/name in Railway as APIFY_ECOM_ACTOR, keep it.
// Otherwise default to Apify’s official actor:
const APIFY_ACTOR = process.env.APIFY_ECOM_ACTOR || "apify/e-commerce-scraping-tool";

// Walmart US marketplace must be exactly this string in the actor schema.
const WALMART_MARKETPLACE = "www.walmart.com";

// How many items to request from Apify
const MAX_RESULTS = Number(process.env.MAX_RESULTS || 8);

// Timeout for Apify run waiting (ms)
const APIFY_WAIT_MS = Number(process.env.APIFY_WAIT_MS || 25000);

app.use(express.json());

// Serve frontend files from project root (index.html, styles.css, script.js)
app.use(express.static(__dirname));

app.get("/api/health", (req, res) => {
  res.json({
    status: "ok",
    build: BUILD,
    hasApifyToken: !!APIFY_TOKEN,
    node: process.version,
    actor: APIFY_ACTOR,
  });
});

/**
 * Apify helper:
 * 1) Start run and wait for finish
 * 2) Read dataset items
 */
async function runApifyKeywordSearch(keyword) {
  if (!APIFY_TOKEN) {
    return {
      ok: false,
      reason: "missing_apify_token",
      error: "Missing APIFY_TOKEN env var",
    };
  }

  // Actor input schema fields (key ones):
  // - keyword (string)
  // - marketplaces (string[])
  // - maxProductResults (integer)
  // Docs show: detailsUrls, listingUrls, keyword, marketplaces, maxProductResults, etc. :contentReference[oaicite:1]{index=1}
  const input = {
    keyword,
    marketplaces: [WALMART_MARKETPLACE],
    maxProductResults: MAX_RESULTS,
    // optional: include more fields if the actor provides them
    additionalProperties: true,
  };

  // AbortController timeout
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), APIFY_WAIT_MS);

  try {
    // Start run + wait
    const runUrl =
      `https://api.apify.com/v2/acts/${encodeURIComponent(APIFY_ACTOR)}/runs` +
      `?token=${encodeURIComponent(APIFY_TOKEN)}` +
      `&waitForFinish=${Math.ceil(APIFY_WAIT_MS / 1000)}`; // seconds

    const runRes = await fetch(runUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
      signal: controller.signal,
    });

    if (!runRes.ok) {
      const text = await runRes.text().catch(() => "");
      return {
        ok: false,
        reason: "apify_run_failed",
        error: `Apify run failed: HTTP ${runRes.status} ${text}`,
      };
    }

    const runData = await runRes.json();
    const datasetId = runData?.data?.defaultDatasetId;

    if (!datasetId) {
      return {
        ok: false,
        reason: "no_dataset",
        error: "Apify did not return defaultDatasetId",
      };
    }

    // Fetch dataset items
    const itemsUrl =
      `https://api.apify.com/v2/datasets/${datasetId}/items` +
      `?token=${encodeURIComponent(APIFY_TOKEN)}` +
      `&clean=true&format=json`;

    const itemsRes = await fetch(itemsUrl, { signal: controller.signal });
    if (!itemsRes.ok) {
      const text = await itemsRes.text().catch(() => "");
      return {
        ok: false,
        reason: "dataset_fetch_failed",
        error: `Dataset fetch failed: HTTP ${itemsRes.status} ${text}`,
      };
    }

    const items = await itemsRes.json();
    return {
      ok: true,
      items: Array.isArray(items) ? items : [],
    };
  } catch (err) {
    return {
      ok: false,
      reason: "exception",
      error: err?.name === "AbortError" ? `Apify timed out (${APIFY_WAIT_MS}ms).` : String(err),
    };
  } finally {
    clearTimeout(t);
  }
}

// Try to extract a numeric price from common shapes
function extractPrice(item) {
  // Common possibilities across scrapers:
  // - item.price
  // - item.currentPrice
  // - item.price.value
  // - item.price.amount
  // - item.pricing.price
  const candidates = [
    item?.price,
    item?.currentPrice,
    item?.price?.value,
    item?.price?.amount,
    item?.pricing?.price,
    item?.pricing?.current,
    item?.offers?.[0]?.price,
  ];

  for (const c of candidates) {
    const n = Number(
      typeof c === "object" && c !== null
        ? (c.value ?? c.amount ?? c.current ?? c.price)
        : c
    );
    if (Number.isFinite(n) && n > 0) return n;
  }
  return null;
}

function extractTitle(item) {
  return (
    item?.title ||
    item?.name ||
    item?.productName ||
    item?.product?.title ||
    "Unknown item"
  );
}

function extractUrl(item) {
  return item?.url || item?.productUrl || item?.link || null;
}

function extractImage(item) {
  return (
    item?.image ||
    item?.imageUrl ||
    item?.thumbnail ||
    item?.thumbnailUrl ||
    (Array.isArray(item?.images) ? item.images[0] : null) ||
    null
  );
}

function toOffer(item, idx) {
  const price = extractPrice(item);
  const title = extractTitle(item);
  const url = extractUrl(item);
  const image = extractImage(item);

  // Shipping/tax calculation later. For now total=item when we only have item price.
  const itemPrice = price ?? 0;

  return {
    id: `walmart-${idx + 1}`,
    title,
    condition: item?.condition || "New",
    retailer: "Walmart",
    seller: "Walmart",
    pricing: { item: itemPrice, shipping: 0, tax: 0, total: itemPrice },
    delivery: item?.delivery || null,
    returns: item?.returns || null,
    trust: "Verified",
    image: image,
    url: url,
    cta: {
      primary_label: "View deal",
      checkout_url: url || "https://www.walmart.com",
    },
  };
}

function fallbackResponse(q, metaExtra = {}) {
  return {
    query: q,
    meta: { build: BUILD, source: "stub", ...metaExtra },
    summary: {
      best_pick_reason: "Fallback shown (no live results yet).",
      confidence: 0.5,
    },
    best_pick: {
      id: "fallback-1",
      title: `${q} (Fallback)`,
      condition: "Unknown",
      retailer: "Walmart",
      seller: "Walmart",
      pricing: { item: 0, shipping: 0, tax: 0, total: 0 },
      delivery: null,
      returns: null,
      trust: "Fallback",
      image: null,
      url: "https://www.walmart.com",
      cta: {
        primary_label: "Search Walmart",
        checkout_url: `https://www.walmart.com/search?q=${encodeURIComponent(q)}`,
      },
    },
    alternatives: [],
    disclosures: {
      pricing_note: "Live prices unavailable right now. Try again or refine the search.",
      trust_note: "We prioritize trusted retailers when available.",
    },
  };
}

// MAIN SEARCH ENDPOINT
app.get("/api/search", async (req, res) => {
  const q = String(req.query.q || "").trim();
  if (!q) return res.status(400).json({ error: "Missing query parameter: q" });

  const apify = await runApifyKeywordSearch(q);

  if (!apify.ok) {
    return res.json(
      fallbackResponse(q, {
        source: "apify",
        reason: apify.reason,
        error: apify.error,
      })
    );
  }

  const rawItems = apify.items || [];
  const offersAll = rawItems.map(toOffer).filter(o => o.pricing.item > 0);

  // If Apify returned items but none had a price we could parse
  if (!offersAll.length) {
    return res.json(
      fallbackResponse(q, {
        source: "apify",
        reason: "no_results",
        note: "Apify returned 0 priced items for this keyword (try a more specific search).",
        apifyItemsCount: rawItems.length,
      })
    );
  }

  // Sort lowest price first
  offersAll.sort((a, b) => (a.pricing.total || 0) - (b.pricing.total || 0));

  const best = offersAll[0];
  const alternatives = offersAll.slice(1, 4);

  return res.json({
    query: q,
    meta: {
      build: BUILD,
      source: "apify",
      marketplace: WALMART_MARKETPLACE,
      apifyItemsCount: rawItems.length,
      mappedPricedCount: offersAll.length,
    },
    summary: {
      best_pick_reason: "Lowest priced Walmart result.",
      confidence: 0.75,
    },
    best_pick: best,
    alternatives: alternatives,
    disclosures: {
      pricing_note: "Shipping/tax may vary at checkout. Verify the listing details.",
      trust_note: "We prioritize trusted retailers when available.",
    },
  });
});

// Fallback homepage
app.get("/", (req, res) => res.sendFile(path.join(__dirname, "index.html")));

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT} (build ${BUILD})`);
});
