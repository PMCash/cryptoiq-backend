console.log("🚀 Server file loaded");

const express = require("express");
const cors = require("cors");
const Parser = require("rss-parser");

const app = express();
const parser = new Parser();

app.use(cors());
app.use(express.json());

// ---- Health check
app.get("/", (req, res) => {
  res.send("CryptoIQ backend is running");
});

// ---- Calculator
app.post("/calculate", (req, res) => {
  const { amount, buyPrice, sellPrice } = req.body;

  if (!amount || !buyPrice || !sellPrice) {
    return res.status(400).json({ error: "Missing fields" });
  }

  const growth = ((sellPrice - buyPrice) / buyPrice) * 100;
  const newValue = (amount / buyPrice) * sellPrice;
  const profit = newValue - amount;

  res.json({
    growth: growth.toFixed(2),
    newValue: newValue.toFixed(2),
    profit: profit.toFixed(2),
  });
});

// ---- News (cached)
let cachedNews = [];
let lastFetchTime = 0;
const CACHE_DURATION = 1000 * 60 * 30; // 30 minutes

app.get("/news", async (req, res) => {
  try {
    const now = Date.now();
    const tier = req.query.tier || "free";

    // Serve from cache if still fresh
    if (cachedNews.length && now - lastFetchTime < CACHE_DURATION) {
      const limited =
        tier === "premium" ? cachedNews : cachedNews.slice(0, 3);
      return res.json(limited);
    }

    const feed = await parser.parseURL(
      "https://www.coindesk.com/arc/outboundfeeds/rss/"
    );

    // Always cache full set
    cachedNews = feed.items.slice(0, 10).map(item => ({
      title: item.title,
      link: item.link,
      published: item.pubDate,
      source: "CoinDesk",
    }));

    lastFetchTime = now;

    // Return based on tier
    const response =
      tier === "premium" ? cachedNews : cachedNews.slice(0, 3);

    res.json(response);
  } catch (err) {
    console.error("News error:", err);
    res.status(500).json({ error: "Failed to fetch crypto news" });
  }
});

// ---- START SERVER (MUST BE LAST)
const PORT = process.env.PORT || 5001;

const server = app.listen(PORT, () => {
  console.log(`✅ Backend listening on port ${PORT}`);
});

// Optional: log server errors
server.on("error", (err) => {
  console.error("Server error:", err);
});
