const express = require("express");
const cors = require("cors");

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());

// Test route
app.get("/", (req, res) => {
  res.send("Priceproof server is running");
});

// Example price endpoint (mock data for now)
app.get("/api/prices", (req, res) => {
  const query = req.query.q || "Unknown product";

  res.json({
    product: query,
    results: [
      { retailer: "Walmart", price: 499.99, total: 499.99 },
      { retailer: "Amazon", price: 529.99, total: 529.99 }
    ]
  });
});

// IMPORTANT: Railway-safe port
app.listen(PORT, () => {
  console.log(`✅ Server running on port ${PORT}`);
});
