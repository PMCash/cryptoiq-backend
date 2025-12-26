require("dotenv").config();

console.log("🚀 Server file loaded");
//console.log("SUPABASE_URL:", process.env.SUPABASE_URL);

// 1️⃣ IMPORTS
const express = require("express");
const cors = require("cors");
const Parser = require("rss-parser");
const { createClient } = require("@supabase/supabase-js");

// 2️⃣ APP + CLIENT SETUP
const app = express();
const parser = new Parser();

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

// 3️⃣ GLOBAL MIDDLEWARE
app.use(cors());
app.use(express.json());

// ===================================================
// 🔐 5️⃣ AUTH MIDDLEWARE (CORRECT PLACE)
// ===================================================
const authenticateUser = async (req, res, next) => {
  const authHeader = req.headers.authorization;

  if (!authHeader) {
    return res.status(401).json({ error: "Missing authorization header" });
  }

  const token = authHeader.replace("Bearer ", "");

  const { data, error } = await supabase.auth.getUser(token);

  if (error || !data?.user) {
    return res.status(401).json({ error: "Invalid or expired token" });
  }

  req.user = data.user;
  next();
};

// 4️⃣ PUBLIC ROUTES
app.get("/", (req, res) => {
  res.send("CryptoIQ backend is running");
});

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

app.get("/portfolio/summary", authenticateUser, async (req, res) => {
  try {
    // 1️⃣ Get user holdings
    const { data: holdings, error } = await supabase
      .from("portfolios")
      .select("*")
      .eq("user_id", req.user.id);

    if (error) {
      return res.status(400).json({ error: error.message });
    }

    if (!holdings.length) {
      return res.json({
        invested: 0,
        currentValue: 0,
        profit: 0,
        profitPercent: 0,
        assets: [],
      });
    }

    // 2️⃣ Prepare CoinGecko IDs
    const coinMap = {
      BTC: "bitcoin",
      ETH: "ethereum",
      SOL: "solana",
      BNB: "binancecoin",
      XRP: "ripple",
      ADA: "cardano",
      DOGE: "dogecoin",
      AVAX: "avalanche-2",
      USDT: "tether",
      USDC: "usd-coin",
    };

    const ids = [
      ...new Set(
        holdings.map(h => coinMap[h.coin]).filter(Boolean)
      ),
    ].join(",");

    // 3️⃣ Fetch prices
    const priceRes = await fetch(
      `https://api.coingecko.com/api/v3/simple/price?ids=${ids}&vs_currencies=usd`
    );
    const prices = await priceRes.json();

    let invested = 0;
    let currentValue = 0;
    const assets = [];

    // 4️⃣ Calculate totals
    for (const h of holdings) {
      const id = coinMap[h.coin];
      const price = prices[id]?.usd || 0;

      const buyTotal = h.amount * h.buy_price;
      const nowTotal = h.amount * price;

      invested += buyTotal;
      currentValue += nowTotal;

      assets.push({
        coin: h.coin,
        amount: h.amount,
        buy_price: h.buy_price,
        current_price: price,
        invested: buyTotal,
        value: nowTotal,
        profit: nowTotal - buyTotal,
      });
    }

    const profit = currentValue - invested;
    const profitPercent =
      invested > 0 ? (profit / invested) * 100 : 0;

    res.json({
      invested: invested.toFixed(2),
      currentValue: currentValue.toFixed(2),
      profit: profit.toFixed(2),
      profitPercent: profitPercent.toFixed(2),
      assets,
    });
  } catch (err) {
    console.error("Summary error:", err);
    res.status(500).json({ error: "Failed to calculate summary" });
  }
});

// ---- News (cached)
let cachedNews = [];
let lastFetchTime = 0;
const CACHE_DURATION = 1000 * 60 * 30;

app.get("/news", async (req, res) => {
  try {
    const now = Date.now();
    const tier = req.query.tier || "free";

    if (cachedNews.length && now - lastFetchTime < CACHE_DURATION) {
      return res.json(
        tier === "premium" ? cachedNews : cachedNews.slice(0, 3)
      );
    }

    const feed = await parser.parseURL(
      "https://www.coindesk.com/arc/outboundfeeds/rss/"
    );

    cachedNews = feed.items.slice(0, 10).map(item => ({
      title: item.title,
      link: item.link,
      published: item.pubDate,
      source: "CoinDesk",
    }));

    lastFetchTime = now;

    res.json(
      tier === "premium" ? cachedNews : cachedNews.slice(0, 3)
    );
  } catch (err) {
    console.error("News error:", err);
    res.status(500).json({ error: "Failed to fetch crypto news" });
  }
});

// ===================================================
// 📦 6️⃣ PORTFOLIO ROUTES (PROTECTED)
// ===================================================
app.post("/portfolio", authenticateUser, async (req, res) => {
  const { coin, amount, buy_price } = req.body;

  if (!coin || !amount || !buy_price) {
    return res.status(400).json({ error: "Missing fields" });
  }

  const { error } = await supabase.from("portfolios").insert([
    {
      user_id: req.user.id,
      coin,
      amount,
      buy_price,
    },
  ]);

  if (error) {
    return res.status(400).json({ error: error.message });
  }

  res.json({ success: true });
});

app.get("/portfolio", authenticateUser, async (req, res) => {
  const { data, error } = await supabase
    .from("portfolios")
    .select("*")
    .eq("user_id", req.user.id)
    .order("created_at", { ascending: false });

  if (error) {
    return res.status(400).json({ error: error.message });
  }

  res.json(data);
});

app.delete("/portfolio/:id", authenticateUser, async (req, res) => {
  const { id } = req.params;

  const { error } = await supabase
    .from("portfolios")
    .delete()
    .eq("id", id)
    .eq("user_id", req.user.id);

  if (error) {
    return res.status(400).json({ error: error.message });
  }

  res.json({ success: true });
});
app.put("/portfolio/:id", authenticateUser, async (req, res) => {
  const { id } = req.params;
  const { amount, buy_price } = req.body;

  if (!amount || !buy_price) {
    return res.status(400).json({ error: "Missing fields" });
  }

  const { error } = await supabase
    .from("portfolios")
    .update({ amount, buy_price })
    .eq("id", id)
    .eq("user_id", req.user.id);

  if (error) {
    return res.status(400).json({ error: error.message });
  }

  res.json({ success: true });
});

// 7️⃣ START SERVER (LAST)
const PORT = process.env.PORT || 5001;
const server = app.listen(PORT, () => {
  console.log(`✅ Backend listening on port ${PORT}`);
});

server.on("error", (err) => {
  console.error("Server error:", err);
});
