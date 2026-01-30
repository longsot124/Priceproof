const express = require("express");
const path = require("path");

const app = express();
const PORT = process.env.PORT || 8080;

const APIFY_TOKEN = process.env.APIFY_TOKEN;
const APIFY_ACTOR = process.env.APIFY_ECOM_ACTOR || "apify/e-commerce-scraping-tool";

app.use(express.json());
app.use(express.static(__dirname));

app.get("/api/health", (req, res) => res.json({ status: "ok" }));

app.get("/api/search", async (req, res) => {
  const q = String(req.query.q || "").trim();
  if (!q) return res.status(400).json({ error: "Missing query parameter: q" });

  try {
    if (!APIFY_TOKEN) return res.json(stubResponse(q));

    const offers = await fetchWalmartOffersViaApify(q);
    if (!offers.length) return res.json(stubResponse(q));

    return res.json(buildAgentResponse(q, offers));
  } catch (e) {
    console.error(e);
    return res.json(stubResponse(q));
  }
});

app.get("/", (req, res) => res.sendFile(path.join(__dirname, "index.html")));

app.listen(PORT, () => console.log(`Server running on port ${PORT}`));

/* -------------------- Apify helpers -------------------- */

async function fetchWalmartOffersViaApify(query) {
  // Walmart-first: scrape Walmart search results
  const walmartUrl = `https://www.walmart.com/search?q=${encodeURIComponent(query)}`;

  const input = {
    scrapeMode: "AUTO",
    listingUrls: [walmartUrl],
    maxProductResults: 12,
    additionalProperties: true
  };

  const run = await apifyRunActor(APIFY_ACTOR, input, 60);
  const datasetId = run?.data?.defaultDatasetId;
  if (!datasetId) return [];

  const items = await apifyGetDatasetItems(datasetId, 30);
  if (!Array.isArray(items)) return [];

  const offers = [];
  for (const it of items) {
    const o = toOffer(it, query);
    if (o) offers.push(o);
  }
  return offers;
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

function toOffer(item, query) {
  const url = item?.url || item?.productUrl || item?.link || "";
  const retailer = retailerFromUrl(url);

  const title =
    item?.name ||
    item?.title ||
    item?.productName ||
    item?.productTitle ||
    `${query}`;

  const image =
    item?.image ||
    item?.imageUrl ||
    item?.mainImage ||
    item?.thumbnail ||
    (Array.isArray(item?.images) ? item.images[0] : null) ||
    null;

  const price =
    normalizePrice(item?.offers?.price) ??
    normalizePrice(item?.price) ??
    normalizePrice(item?.currentPrice) ??
    normalizePrice(item?.salePrice) ??
    null;

  if (!price) return null;

  const shipping = 0;
  const tax = 0;
  const total = price + shipping + tax;

  return {
    id: `${retailer.toLowerCase().replace(/\s/g, "-")}-${Math.random().toString(16).slice(2)}`,
    title: String(title).slice(0, 160),
    condition: item?.condition || "New",
    retailer,
    seller: retailer,
    pricing: { item: price, shipping, tax, total },
    delivery: item?.delivery || "",
    returns: item?.returnPolicy || "",
    trust: ["Walmart", "Target", "Amazon", "Best Buy"].includes(retailer) ? "Verified" : "Marketplace",
    image,
    url
  };
}

/* -------------------- Ranking + response -------------------- */

function scoreOffer(o) {
  const total = o?.pricing?.total ?? 999999;
  const trust = o?.trust === "Verified" ? 10 : 6;
  return (100000 - total) * 0.7 + trust * 1000 * 0.3;
}

function buildAgentResponse(query, offers) {
  const ranked = [...offers].sort((a, b) => scoreOffer(b) - scoreOffer(a));
  const best = ranked[0];
  const alternatives = ranked.slice(1, 4);

  return {
    query,
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

function stubResponse(q) {
  // fallback if Apify fails (keeps site working)
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
  return buildAgentResponse(q, offers);
}
