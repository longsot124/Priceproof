const express = require("express");
const path = require("path");

const app = express();
const PORT = process.env.PORT || 3000;

// Parse JSON bodies (future-proof)
app.use(express.json());

// Serve your frontend files (index.html, styles.css, script.js) from the project root
app.use(express.static(__dirname));

// Health check (debug + Railway)
app.get("/api/health", (req, res) => {
  res.json({ status: "ok" });
});

/**
 * V1 Search Endpoint (structured output)
 * Later we will replace the stubbed offers with real Walmart results.
 *
 * GET /api/search?q=ps5
 */
app.get("/api/search", (req, res) => {
  const q = String(req.query.q || "").trim();

  if (!q) {
    return res.status(400).json({ error: "Missing query parameter: q" });
  }

  // ---- STUB OFFERS (replace with real Walmart + other sources next) ----
  // These are placeholders so the app works end-to-end without breaking.
  // They are intentionally simple and consistent.
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
      trust: "Verified"
    },
    {
      id: "target-1",
      title: `${q} (New)`,
      condition: "New",
      retailer: "Target",
      seller: "Target",
      pricing: { item: 459.0, shipping: 0.0, tax: 28.47, total: 487.47 },
      delivery: "1–2 days",
      returns: "Free returns within 30 days",
      trust: "Verified"
    },
    {
      id: "ebay-1",
      title: `${q} (Used - Good)`,
      condition: "Used - Good",
      retailer: "eBay",
      seller: "Top Rated Seller",
      pricing: { item: 429.0, shipping: 12.99, tax: 26.5, total: 468.49 },
      delivery: "5–8 days",
      returns: "Return policy varies by seller",
      trust: "Marketplace"
    }
  ];

  // ---- Ranking (simple “agent brain v0”) ----
  // Lower total is better; Verified trust gets a boost; faster delivery gets a small boost.
  function deliveryScore(deliveryStr) {
    // crude: extract first number of days, smaller is better
    const m = deliveryStr.match(/\d+/);
    if (!m) return 0;
    const days = Number(m[0]);
    return Math.max(0, 10 - days); // 1 day => 9, 5 days => 5, etc.
  }

  function trustScore(trust) {
    if (trust === "Verified") return 10;
    if (trust === "Marketplace") return 6;
    return 5;
  }

  function scoreOffer(o) {
    const total = o.pricing.total;              // lower better
    const totalComponent = 1000 - total;        // convert to higher-is-better
    const trustComponent = trustScore(o.trust) * 10;
    const deliveryComponent = deliveryScore(o.delivery) * 5;

    return totalComponent * 0.5 + trustComponent * 0.2 + deliveryComponent * 0.3;
  }

  const ranked = [...offers].sort((a, b) => scoreOffer(b) - scoreOffer(a));
  const best = ranked[0];
  const alternatives = ranked.slice(1, 4);

  // Build the structured response your frontend can render
  return res.json({
    query: q,
    summary: {
      best_pick_reason: `Best total cost + trustworthy seller + solid delivery.`,
      confidence: 0.75
    },
    best_pick: {
      ...best,
      cta: {
        primary_label: "Buy via Priceproof",
        // For now, send them to retailer home page (later: real checkout/affiliate link)
        checkout_url:
          best.retailer === "Walmart"
            ? "https://www.walmart.com"
            : best.retailer === "Target"
            ? "https://www.target.com"
            : "https://www.ebay.com"
      }
    },
    alternatives: alternatives.map((o) => ({
      label:
        o.retailer === "eBay"
          ? "Best used/refurb"
          : o.retailer === "Target"
          ? "Fastest delivery"
          : "Alternative",
      tradeoff:
        o.retailer === "eBay"
          ? "Cheaper option, but marketplace/used varies."
          : "Similar price with different shipping/returns.",
      ...o,
      cta: {
        primary_label: "Buy via Priceproof",
        checkout_url:
          o.retailer === "Walmart"
            ? "https://www.walmart.com"
            : o.retailer === "Target"
            ? "https://www.target.com"
            : "https://www.ebay.com"
      }
    })),
    watch_suggestions: {
      default_enabled: true,
      price_drop_threshold_suggestion: 25,
      include_used_refurb_suggestion: true
    },
    disclosures: {
      pricing_note:
        "Totals may vary slightly at checkout based on location tax and final shipping options.",
      trust_note:
        "We prioritize clear return policies and trusted sellers when available."
    }
  });
});

// Fallback for homepage
app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "index.html"));
});

// Start server
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
