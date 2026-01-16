require("dotenv").config();

console.log("🚀 Server file loaded");

// ================= IMPORTS =================
const express = require("express");
const cors = require("cors");
const Parser = require("rss-parser");
const parser = new Parser();
const { createClient } = require("@supabase/supabase-js");
const axios = require("axios");
const crypto = require("crypto");

// ================= APP =================
const app = express();

/**
 * ===================================================
 * 🔔 PAYSTACK WEBHOOK (MUST BE FIRST & RAW)
 * ===================================================
 */
app.post(
  "/paystack/webhook",
  express.raw({ type: "application/json" }),
  async (req, res) => {
    try {
      const secret = process.env.PAYSTACK_SECRET_KEY;

      const hash = crypto
        .createHmac("sha512", secret)
        .update(req.body)
        .digest("hex");

      if (hash !== req.headers["x-paystack-signature"]) {
        return res.status(401).send("Invalid signature");
      }

      const event = JSON.parse(req.body.toString());

      if (event.event === "charge.success") {
        const email = event.data.customer.email;

        const { data: user } = await supabase
          .from("profiles")
          .select("id")
          .eq("email", email)
          .single();

        if (user) {
          await supabase
            .from("profiles")
            .update({ role: "premium" })
            .eq("id", user.id);

          console.log(`✅ User ${email} upgraded to premium`);
        }
      }

      res.sendStatus(200);
    } catch (err) {
      console.error("Webhook error:", err);
      res.sendStatus(500);
    }
  }
);

// ================= GLOBAL MIDDLEWARE =================
app.use(express.json());

app.use((req, res, next) => {
  console.log("➡️ Incoming:", req.method, req.url);
  next();
});

app.use(
  cors({
    origin: [
      "http://localhost:5173",
      "https://cryptoiq-frontend-jsl1.onrender.com",
    ],
    methods: ["GET", "POST", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization" , "X-country"],
  })
);
// handle preflight requests safely for Node.js v22.17.0 and above
/*app.use(cors()); */
// ================= SUPABASE =================
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

// ================= AUTH MIDDLEWARE =================
const authenticateUser = async (req, res, next) => {
  if (req.method === "OPTIONS") {
    return next();
  }
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

// ================= ROUTES =================
app.get("/", (req, res) => {
  res.send("CryptoIQ backend is running");
});



// ================= CRYPTO NEWS ROUTE (FREE COINGECKO) =================
app.get("/news", async (req, res) => {
  try {
    const response = await axios.get(
      "https://api.coingecko.com/api/v3/search/trending",
      {
        timeout: 8000,
        headers: {
          "User-Agent": "CryptoIQ/1.0",
          Accept: "application/json",
        },
      }
    );

    const items = response.data.coins.slice(0, 10).map((item) => ({
      title: `${item.item.name} (${item.item.symbol}) is trending`,
      link: `https://www.coingecko.com/en/coins/${item.item.id}`,
    }));

    res.status(200).json(items);
  } catch (err) {
    console.error(
      "❌ News fetch failed:",
      err.response?.status,
      err.message
    );

    // IMPORTANT: Never break frontend UI
    res.status(200).json([]);
  }
});


// ================= PAYSTACK INIT =================
app.post("/paystack/initialize", authenticateUser, async (req, res) => {
  try {
     // 🔍 TEMP DEBUG LOG (SAFE TO REMOVE LATER)
 console.log("PAYSTACK KEY PRESENT:", !!process.env.PAYSTACK_SECRET_KEY);    
    if (!process.env.PAYSTACK_SECRET_KEY) {
       console.error("❌ PAYSTACK_SECRET_KEY is missing");
       return res.status(500).json({
         error: "Payment system not configured",
      });
    }

    const response = await axios.post(
      "https://api.paystack.co/transaction/initialize",
      {
        email: req.user.email,
        amount: 750000,
        currency: "NGN",
        callback_url: `${process.env.FRONTEND_URL}/payment-success`,
        metadata: {
          user_id: req.user.id,
          plan: "premium",
        },
      },
      {
        headers: {
          Authorization: `Bearer ${process.env.PAYSTACK_SECRET_KEY}`,
          "Content-Type": "application/json",
        },
      }
    );
const paystackData = response.data?.data;
    if (!paystackData?.authorization_url) {
      return res.status(500).json({
        error: "Paystack did not return authorization URL",
      });
    }
    res.json({
      authorization_url: paystackData.authorization_url,
      reference: paystackData.reference,
    });
  } catch (err) {
    console.error("Paystack init error:", err.response?.data || err.message);
    res.status(500).json({ error: "Failed to initialize payment" });
  }
});

// ================= PAYSTACK VERIFY =================
app.post("/paystack/verify", authenticateUser, async (req, res) => {
  try {
    const { reference } = req.body;

    if (!reference) {
      return res.status(400).json({ error: "Missing reference" });
    }

    const response = await axios.get(
      `https://api.paystack.co/transaction/verify/${reference}`,
      {
        headers: {
          Authorization: `Bearer ${process.env.PAYSTACK_SECRET_KEY}`,
        },
      }
    );

    const payment = response.data?.data;

    if (payment?.status !== "success") {
      return res.status(400).json({ error: "Payment not successful" });
    }

    // Upgrade user
    await supabase
      .from("profiles")
      .update({ role: "premium" })
      .eq("id", req.user.id);

    res.json({ success: true });
  } catch (err) {
    console.error("Verify error:", err.response?.data || err.message);
    res.status(500).json({ error: "Verification failed" });
  }
});

// ================= SERVER =================
const PORT = process.env.PORT || 5001;
app.listen(PORT, () =>
  console.log(`✅ Backend listening on port ${PORT}`)
);