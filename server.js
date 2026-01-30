const express = require("express");
const path = require("path");

const app = express();
const PORT = process.env.PORT || 8080;

const APIFY_TOKEN = process.env.APIFY_TOKEN;
const APIFY_ACTOR = process.env.APIFY_ECOM_ACTOR || "apify/e-commerce-scraping-tool";

app.use(express.json());
app.use(express.static(__dirname));

app.get("/api/health", (req, res) => {
  res.json({
    status: "ok",
    hasApifyToken: !!APIFY_TOKEN,
    apifyActor: APIFY_ACTOR,
    port: PORT
  });
});

app.get("/api/search", async (req, res) => {
  const q = String(req.query.q || "").trim();
  const debug = String(req.query.debug || "") === "1";
  if (!q) return res.status(400).json({ error: "Missing query parameter: q" });

  try {
    if (!APIFY_TOKEN) {
      return res.json(stubResponse(q, { source: "stub", reason: "missing APIFY_TOKEN" }));
    }

    const { offers, meta } = await fetchWalmartOffersViaApify(q);

    if (!offers.length) {
      return res.json(stubResponse(q, { source: "stub", reason: "apify returned 0 offers", meta }));
    }

    const out = buildAgentResponse(q, offers, { source: "apify", meta });
    if (debug) out.debug = meta;
    return res.json(out);
  } catch (e) {
    console.error("SEARCH ERROR:", e);
    return res.json(stubResponse(q, { source: "stub", reason: "exception", error: String(e?.message || e) }));
  }
});

app.get("/", (req, res) => res.sendFile(path.join(__dirname, "index.html")));

app.listen(PORT, () => console.log(`Server running on port ${PORT}`));

/* -------------------- Apify -------------------- */

async function fetchWalmartOffersViaApify(query) {
  const walmartUrl = `https://www.walmart.com/search?q=${encodeURIComponent(query)}`;

  const input = {
    scrapeMode: "AUTO",
    listingUrls: [walmartUrl],
    maxProductResults: 12,
    additionalProperties: true
  };

  const run = await apifyRunActor(APIFY_ACTOR, input, 60);
  const datasetId = run?.data?.defaultDatasetId;

  const meta = {
    walmartUrl,
    actor: APIFY_ACTOR,
    runId: run?.data?.id || null,
    datasetId: datasetId || null,
    itemCount: 0,
    sampleKeys: null,
    sample: null
  };

  if (!datasetId) return { offers: [], meta };

  const items = await apifyGetDatasetItems(datasetId, 20);
  meta.itemCount = Array.isArray(items) ? items.length : 0;

  if (Array.isArray(items) && items[0]) {
    meta.sampleKeys = Object.keys(items[0]).slice(0, 30);
    meta.sample = shrink(items[0]);
  }

  if (!Array.isArray(items)) return { offers: [], meta };

  const offers = [];
  for (const it of items) {
    const o = toOffer(it, query);
    if (o) offers.push(o);
  }

  meta.offerCount = offers.length;
  return { offers, meta };
}

async function apifyRunActor(actorId, input, waitSeconds = 60) {
  const act = encodeURIComponent(actorId);
  const url = `https://api.apify.com/v2/acts/${act}/runs?token=${encodeURIComponent(
    APIFY_TOKEN
  )}&waitForFinish=${Math.max(1, Math.min(300, waitSeconds))}`;

  const resp = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input)
  });

  if (!resp.ok) {
    const text = await resp.text().catch(() => "");
    throw new Error(`Apify run failed: HTTP ${resp.status} ${text}`);
  }
  return await resp.json();
}

async function apifyGetDatasetItems(datasetId, limit = 20) {
  const url = `https://api.apify.com/v2/datasets/${encodeURIComponent(
    datasetId
  )}/items?token=${encodeURIComponent(APIFY_TOKEN)}&format=json&clean=true&limit=${limit}`;

  const resp = await fetch(url);
  if (!resp.ok) {
    const text = await resp.text().catch(() => "");
    throw new Error(`Apify dataset failed: HTTP ${resp.status} ${text}`);
  }
  return await resp.json();
}

function retailerFromUrl(url) {
  const u = String(url || "").toLowerCase();
  if (u.includes("walmart.")) return "Walmart";
  if (u.includes("amazon.")) return "Amazon";
  if (u.includes("target.")) return "Target";
  if (u.includes("bestbuy.")) return "Best Buy";
  if (u.includes("ebay.")) return "eBay";
  return "Online store";
}

function normalizePrice(n) {
  const num = Number(n);
  return Number.isFinite(num) ? num : null;
}

function pickFirst(...vals) {
  for (const v of vals) {
    if (v === null || v === undefined) continue;
    if (typeof v === "string" && !v.trim()) continue;
    return v;
  }
  return null;
}

function toOffer(item, query) {
  const url = pickFirst(item?.url, item?.productUrl, item?.link, item?.product?.url);
  const retailer = retailerFromUrl(url || "");

  const title = pickFirst(
    item?.name,
    item?.title,
    item?.productName,
    item?.productTitle,
    item?.product?.name,
    item?.product?.title,
    `${query}`
  );

  const image = pickFirst(
    item?.image,
    item?.imageUrl,
    item?.mainImage,
    item?.thumbnail,
    item?.product?.image,
    item?.product?.imageUrl,
    Array.isArray(item?.images) ? item.images[0] : null,
    Array.isArray(item?.product?.images) ? item.product.images[0] : null,
    item?.images?.[0]?.url,
    item?.product?.images?.[0]?.url
  );

  // price is usually item.offers.price, but can appear in other places
  const price = normalizePrice(
    pickFirst(
      item?.offers?.price,
      item?.offers?.[0]?.price,
      item?.offers?.[0]?.price?.value,
      item?.price,
      item?.price?.value,
      item?.currentPrice,
      item?.salePrice,
      item?.product?.offers?.price,
      item?.product?.price,
      item?.product?.currentPrice
    )
  );

  if (!price) return null;

  const shipping = 0;
  const tax = 0;
  const total = price + shipping + tax;

  return {
    id: `${retailer.toLowerCase().replace(/\s/g, "-")}-${Math.random().toString(16).slice(2)}`,
    title: String(title).slice(0, 160),
    condition: item?.condition || item?.product?.condition || "New",
    retailer,
    seller: retailer,
    pricing: { item: price, shipping, tax, total },
    delivery: pickFirst(item?.delivery, item?.shipping, item?.product?.delivery, ""),
    returns: pickFirst(item?.returnPolicy, item?.returns, ""),
    trust: ["Walmart", "Target", "Amazon", "Best Buy"].includes(retailer) ? "Verified" : "Marketplace",
    image: image || null,
    url: url || null
  };
}

/* -------------------- Ranking + response -------------------- */

function scoreOffer(o) {
  const total = o?.pricing?.total ?? 999999;
  const trust = o?.trust === "Verified" ? 10 : 6;
  return (100000 - total) * 0.7 + trust * 1000 * 0.3;
}

function buildAgentResponse(query, offers, metaExtra = {}) {
  const ranked = [...offers].sort((a, b) => scoreOffer(b) - scoreOffer(a));
  const best = ranked[0];
  const alternatives = ranked.slice(1, 4);

  return {
    query,
    meta: metaExtra,
    summary: {
      best_pick_reason: "Best balance of total cost and trust from Walmart results.",
      confidence: 0.65
    },
    best_pick: {
      ...best,
      cta: {
        primary_label: "View deal",
        checkout_url: best.url || "https://www.walmart.com"
      }
    },
    alternatives: alternatives.map((o, idx) => ({
      label: idx === 0 ? "Good alternative" : idx === 1 ? "Another option" : "More choices",
      tradeoff: "Prices and availability can change quickly.",
      ...o,
      cta: {
        primary_label: "View deal",
        checkout_url: o.url || "#"
      }
    })),
    disclosures: {
      pricing_note:
        "Shipping/tax may vary at checkout based on your location and retailer settings.",
      trust_note:
        "We prioritize trusted retailers when available."
    }
  };
}

function stubResponse(q, meta = {}) {
  const offers = [
    {
      id: "walmart-1",
      title: `${q} (New)`,
      condition: "New",
      retailer: "Walmart",
      seller: "Walmart",
      pricing: { item: 449.0, shipping: 0.0, tax: 27.85, total: 476.85 },
      delivery: "2–4 days",
      returns: "Free returns within 30 days",
      trust: "Verified",
      image: null,
      url: "https://www.walmart.com"
    }
  ];
  const out = buildAgentResponse(q, offers, meta);
  return out;
}

function shrink(obj) {
  try {
    const s = JSON.stringify(obj);
    if (s.length <= 2000) return obj;
    const copy = {};
    for (const k of Object.keys(obj).slice(0, 20)) copy[k] = obj[k];
    return copy;
  } catch {
    return null;
  }
}
