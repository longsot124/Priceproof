const express = require("express");
const path = require("path");

const app = express();

// Railway provides the PORT automatically
const PORT = process.env.PORT || 3000;

// Middleware
app.use(express.json());

// Health check (Railway + sanity test)
app.get("/api/health", (req, res) => {
  res.json({ status: "ok" });
});

// Serve frontend (index.html, styles.css, script.js)
app.use(express.static(__dirname));

// Fallback for root
app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "index.html"));
});

// Start server
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
