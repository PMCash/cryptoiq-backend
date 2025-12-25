console.log(" Server file loaded");


const express = require("express");
const cors = require("cors");

const app = express();

app.use(cors());
app.use(express.json());

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

const PORT = process.env.PORT || 5001;

app.get("/", (req, res) => {
  res.send("CryptoIQ backend is running");
});

app.listen(PORT, () => console.log("Backend running on port " + PORT));
