const express = require("express");
const cors = require("cors");
const path = require("path");

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());

// Serve frontend files (root folder)
app.use(express.static(path.join(__dirname, "..")));

// API test route
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

// Catch-all: serve index.html
app.get("*", (req, res) => {
  res.sendFile(path.join(__dirname, "..", "index.html"));
});

// Start server
app.listen(PORT, () => {
  console.log(`✅ Server running on port ${PORT}`);
});
