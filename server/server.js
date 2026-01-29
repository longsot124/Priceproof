const express = require("express");
const path = require("path");

const app = express();
const PORT = 3000;

const rootDir = path.resolve(__dirname, "..");

// Serve frontend files
app.use(express.static(rootDir));

// API endpoint
app.get("/api/search", (req, res) => {
  res.json({
    query: req.query.q || "",
    results: [
      { store: "Walmart", price: 23.49 },
      { store: "Amazon", price: 24.99 },
      { store: "Target", price: 25.99 }
    ]
  });
});

// Root route
app.get("/", (req, res) => {
  res.sendFile(path.join(rootDir, "index.html"));
});

app.listen(PORT, () => {
  console.log(`Priceproof running at http://localhost:${PORT}`);
});
