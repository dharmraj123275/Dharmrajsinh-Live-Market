// ============================================================
// DHARMRAJSINH LIVE MARKET V7.5
// COMPLETE SERVER.JS
//
// NSE + BSE EQUITY SCANNER
// Live quote + technical + fundamentals + news + depth
// + NIFTY 50 + SENSEX + MIDCPNIFTY + INDIA VIX
// ============================================================

require("dotenv").config();

const express = require("express");
const cors = require("cors");
const path = require("path");
const fs = require("fs");

const technical = require("./technical.js");
const upstox = require("./services/upstox.js");

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json({ limit: "1mb" }));
app.use(express.static(path.join(__dirname, "public")));

// ============================================================
// RUNTIME STATE / CACHE
// ============================================================

const quoteCache = new Map();
const technicalCache = new Map();
const fundamentalsCache = new Map();
const newsCache = new Map();
const lastSignal = new Map();
const indexCache = new Map();
const marketBreadthCache = new Map();

const QUOTE_CACHE_MS = 2500;
const TECH_CACHE_MS = 15000;
const FUNDAMENTAL_CACHE_MS = 15 * 60 * 1000;
const NEWS_CACHE_MS = 2 * 60 * 1000;
const INDEX_CACHE_MS = 2500;
const BREADTH_CACHE_MS = 30000;

let runtimeAccessToken = String(process.env.UPSTOX_ACCESS_TOKEN || "").trim();
let tokenCreatedAt = null;
let lastAuthError = null;

// ============================================================
// CONFIG
// ============================================================

const INDEXES = [
  {
    id: "NIFTY50",
    symbol: "NIFTY 50",
    name: "Nifty 50",
    instrument: "NSE_INDEX|Nifty 50",
    exchange: "NSE"
  },
  {
    id: "SENSEX",
    symbol: "SENSEX",
    name: "BSE Sensex",
    instrument: "BSE_INDEX|SENSEX",
    exchange: "BSE"
  },
  {
    id: "MIDCPNIFTY",
    symbol: "MIDCPNIFTY",
    name: "Nifty Midcap Select",
    instrument: "NSE_INDEX|Nifty Midcap Select",
    exchange: "NSE"
  },
  {
    id: "INDIAVIX",
    symbol: "INDIA VIX",
    name: "India VIX",
    instrument: "NSE_INDEX|India VIX",
    exchange: "NSE"
  }
];

// ============================================================
// HELPERS
// ============================================================

function num(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function round2(value) {
  const n = Number(value);
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : 0;
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function cacheGet(map, key, ttl) {
  const item = map.get(key);
  if (!item) return null;
  if (Date.now() - item.time > ttl) {
    map.delete(key);
    return null;
  }
  return item.value;
}

function cacheSet(map, key, value) {
  map.set(key, { time: Date.now(), value });
  return value;
}

function getAccessToken() {
  return String(runtimeAccessToken || process.env.UPSTOX_ACCESS_TOKEN || "").trim();
}

function hasAccessToken() {
  return Boolean(getAccessToken());
}

function clearRuntimeToken() {
  runtimeAccessToken = "";
  tokenCreatedAt = null;
}

function isUnauthorized(error) {
  return error?.statusCode === 401 || error?.response?.status === 401;
}

function sendTokenExpired(res) {
  return res.status(401).json({
    success: false,
    code: "UPSTOX_TOKEN_EXPIRED",
    message: "Upstox access token is missing or expired.",
    action: "LOGIN_REQUIRED",
    loginUrl: "/login",
    tokenCreatedAt
  });
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function indiaNow() {
  return new Date(new Date().toLocaleString("en-US", { timeZone: "Asia/Kolkata" }));
}

function indiaDateString(date = indiaNow()) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function dateMinusDays(days) {
  const d = indiaNow();
  d.setDate(d.getDate() - days);
  return indiaDateString(d);
}

function marketOpenNow() {
  const d = indiaNow();
  const weekday = d.getDay() >= 1 && d.getDay() <= 5;
  const mins = d.getHours() * 60 + d.getMinutes();
  return weekday && mins >= 555 && mins <= 930;
}

function findQuoteData(data, instrument) {
  if (!data || typeof data !== "object") return null;
  return data[instrument] || data[Object.keys(data)[0]] || null;
}

function normalizeCandles(raw) {
  return technical.normalizeCandles(raw);
}

// ============================================================
// OAUTH
// ============================================================

function buildLoginUrl() {
  const clientId = process.env.UPSTOX_API_KEY;
  const redirectUri = process.env.UPSTOX_REDIRECT_URI;
  if (!clientId || !redirectUri) return null;

  const params = new URLSearchParams({
    response_type: "code",
    client_id: clientId,
    redirect_uri: redirectUri
  });

  return `https://api.upstox.com/v2/login/authorization/dialog?${params}`;
}

app.get("/login", (req, res) => {
  const url = buildLoginUrl();
  if (!url) {
    return res.status(500).send(`
      <html><body style="font-family:Arial;padding:30px">
      <h2>Upstox OAuth configuration missing</h2>
      <p>Set UPSTOX_API_KEY, UPSTOX_API_SECRET and UPSTOX_REDIRECT_URI.</p>
      </body></html>
    `);
  }
  res.redirect(url);
});

app.get("/callback", async (req, res) => {
  const code = String(req.query.code || "").trim();
  if (!code) {
    return res.status(400).send("Authorization code missing. Start again from /login.");
  }

  try {
    const axios = require("axios");
    const response = await axios.post(
      "https://api.upstox.com/v2/login/authorization/token",
      new URLSearchParams({
        code,
        client_id: process.env.UPSTOX_API_KEY || "",
        client_secret: process.env.UPSTOX_API_SECRET || "",
        redirect_uri: process.env.UPSTOX_REDIRECT_URI || "",
        grant_type: "authorization_code"
      }),
      {
        headers: {
          Accept: "application/json",
          "Content-Type": "application/x-www-form-urlencoded"
        },
        timeout: 20000
      }
    );

    runtimeAccessToken = String(response.data?.access_token || "").trim();
    tokenCreatedAt = new Date().toISOString();
    lastAuthError = null;

    if (!runtimeAccessToken) throw new Error("Upstox did not return an access token.");

    res.send(`
      <html>
      <head><meta name="viewport" content="width=device-width,initial-scale=1"></head>
      <body style="font-family:Arial;text-align:center;padding:40px">
        <h2>✅ Upstox login successful</h2>
        <p>Live market data is ready.</p>
        <a href="/">Open Dharmrajsinh Live Market</a>
      </body>
      </html>
    `);
  } catch (error) {
    lastAuthError = error.message;
    res.status(500).send(`<h2>Upstox login failed</h2><p>${escapeHtml(error.message)}</p>`);
  }
});

app.get("/api/auth/status", (req, res) => {
  res.json({
    success: true,
    authenticated: hasAccessToken(),
    tokenStatus: hasAccessToken() ? "AVAILABLE" : "LOGIN_REQUIRED",
    tokenCreatedAt,
    lastAuthError,
    loginUrl: "/login"
  });
});

app.get("/api/token/test", async (req, res) => {
  if (!hasAccessToken()) return sendTokenExpired(res);
  try {
    // Market quote is a better dashboard test than account-specific endpoints.
    await upstox.getSingleQuote(INDEXES[0].instrument);
    res.json({ success: true, authenticated: true, message: "Upstox market-data token is valid." });
  } catch (error) {
    if (isUnauthorized(error)) {
      clearRuntimeToken();
      return sendTokenExpired(res);
    }
    res.status(error.statusCode || 500).json({ success: false, message: error.message });
  }
});

// ============================================================
// MARKET STATUS
// ============================================================

app.get("/api/status", async (req, res) => {
  try {
    if (hasAccessToken()) {
      const status = await upstox.getMarketStatus("NSE");
      return res.json({
        success: true,
        source: "Upstox",
        market: status.status || (marketOpenNow() ? "LIVE" : "CLOSED"),
        exchange: status.exchange || "NSE",
        authenticated: true,
        date: indiaNow().toLocaleDateString("en-IN"),
        time: indiaNow().toLocaleTimeString("en-IN")
      });
    }
  } catch (error) {
    if (isUnauthorized(error)) clearRuntimeToken();
  }

  res.json({
    success: true,
    source: "Local market hours",
    market: marketOpenNow() ? "🟢 MARKET LIVE" : "🔴 MARKET CLOSED",
    authenticated: hasAccessToken(),
    date: indiaNow().toLocaleDateString("en-IN"),
    time: indiaNow().toLocaleTimeString("en-IN")
  });
});

// ============================================================
// SEARCH - NSE + BSE EQUITY ONLY
// ============================================================

let fallbackStocks = [];
try {
  const file = path.join(__dirname, "stocks.json");
  if (fs.existsSync(file)) {
    const json = JSON.parse(fs.readFileSync(file, "utf8"));
    fallbackStocks = Array.isArray(json.aliases) ? json.aliases : [];
  }
} catch (_) {}

function normalizeSearchText(value) {
  return String(value || "")
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "");
}

function rankSearchResults(rows, query) {
  const q = normalizeSearchText(query);

  const mapped = rows.map(item => ({
    symbol: item.trading_symbol || item.short_name || item.name || "",
    name: item.name || item.short_name || item.trading_symbol || "",
    exchange: item.exchange || String(item.segment || "").split("_")[0],
    segment: item.segment || "EQ",
    instrument: item.instrument_key || "",
    isin: item.isin || "",
    securityType: item.security_type || "",
    source: "Upstox"
  })).filter(item => {
    const ex = String(item.exchange || "").toUpperCase();
    const segment = String(item.segment || "").toUpperCase();
    return item.instrument &&
      (ex === "NSE" || ex === "BSE") &&
      (segment === "EQ" || segment.endsWith("_EQ"));
  });

  // Remove duplicate instrument keys.
  const unique = Array.from(
    new Map(mapped.map(item => [item.instrument, item])).values()
  );

  return unique.sort((a, b) => {
    const as = normalizeSearchText(a.symbol);
    const bs = normalizeSearchText(b.symbol);
    const an = normalizeSearchText(a.name);
    const bn = normalizeSearchText(b.name);

    const score = value =>
      value === q ? 0 :
      value.startsWith(q) ? 1 :
      value.includes(q) ? 2 : 3;

    const sa = Math.min(score(as), score(an));
    const sb = Math.min(score(bs), score(bn));

    if (sa !== sb) return sa - sb;

    // For the same company available on NSE and BSE, keep NSE first.
    const ae = String(a.exchange).toUpperCase() === "NSE" ? 0 : 1;
    const be = String(b.exchange).toUpperCase() === "NSE" ? 0 : 1;
    if (ae !== be) return ae - be;

    return as.localeCompare(bs);
  }).slice(0, 30);
}

function localSearch(query) {
  const q = normalizeSearchText(query);

  return fallbackStocks
    .filter(x => {
      const symbol = normalizeSearchText(x.symbol);
      const name = normalizeSearchText(x.name);
      return symbol.includes(q) || name.includes(q);
    })
    .map(x => ({
      symbol: x.symbol || "",
      name: x.name || x.symbol || "",
      exchange: x.exchange || "",
      segment: x.segment || "EQ",
      instrument: x.instrument || "",
      isin: x.isin || String(x.instrument || "").split("|")[1] || "",
      securityType: x.securityType || "",
      source: "stocks.json"
    }))
    .filter(x => x.instrument);
}

app.get("/api/search", async (req, res) => {
  const query = String(req.query.q || "").trim();

  if (!query) {
    return res.status(400).json({
      success: false,
      message: "Search query required."
    });
  }

  if (!hasAccessToken()) {
    const local = localSearch(query);
    return res.json({
      success: true,
      source: "stocks.json",
      query,
      results: local
    });
  }

  try {
    const data = await upstox.searchInstruments(query, {
      exchanges: "NSE,BSE",
      segments: "EQ",
      records: 30
    });

    const rows = Array.isArray(data.data) ? data.data : [];
    const results = rankSearchResults(rows, query);

    // If Upstox returns nothing, try local aliases as a fallback.
    if (!results.length) {
      const local = localSearch(query);
      return res.json({
        success: local.length > 0,
        source: local.length ? "stocks.json" : "Upstox",
        query,
        results: local,
        message: local.length
          ? "Upstox returned no matching equity; showing local fallback."
          : "No matching NSE/BSE equity instrument found."
      });
    }

    return res.json({
      success: true,
      source: "Upstox",
      query,
      results
    });
  } catch (error) {
    if (isUnauthorized(error)) return sendTokenExpired(res);

    const local = localSearch(query);

    return res.status(local.length ? 200 : (error.statusCode || 500)).json({
      success: local.length > 0,
      source: local.length ? "stocks.json" : "Upstox",
      query,
      results: local,
      message: local.length
        ? "Upstox search unavailable; showing local fallback."
        : error.message
    });
  }
});

// ============================================================
// MARKET QUOTE + CANDLE HELPERS
// ============================================================

async function getLiveQuote(instrument) {
  const cached = cacheGet(quoteCache, instrument, QUOTE_CACHE_MS);
  if (cached) return cached;

  const quote = await upstox.getSingleQuote(instrument);
  if (!quote) {
    const err = new Error("No live quote returned by Upstox.");
    err.statusCode = 404;
    throw err;
  }
  return cacheSet(quoteCache, instrument, quote);
}

async function getCandlePack(instrument) {
  const cached = cacheGet(technicalCache, instrument, TECH_CACHE_MS);
  if (cached) return cached;

  let intraday = [];
  let daily = [];

  try {
    intraday = await upstox.getIntradayCandles(instrument, "minutes", 1);
  } catch (error) {
    if (isUnauthorized(error)) throw error;
  }

  try {
    daily = await upstox.getHistoricalCandles(
      instrument,
      "days",
      "1",
      indiaDateString(),
      dateMinusDays(220)
    );
  } catch (error) {
    if (isUnauthorized(error)) throw error;
  }

  const pack = {
    intraday: normalizeCandles(intraday),
    daily: normalizeCandles(daily)
  };

  return cacheSet(technicalCache, instrument, pack);
}

// ============================================================
// MARKET BREADTH (NIFTY 50 TREND FILTER)
// A stock's own technical signal is far more reliable when it agrees with
// the overall index trend. This fetches Nifty 50 daily candles once,
// caches it briefly, and reuses it as a directional filter/veto for every
// stock analyzed in that window.
// ============================================================

async function getMarketBreadth() {
  const cached = cacheGet(marketBreadthCache, "NIFTY", BREADTH_CACHE_MS);
  if (cached) return cached;

  const fallback = { trend: "NEUTRAL", available: false };

  try {
    const niftyInstrument = INDEXES[0].instrument; // NSE_INDEX|Nifty 50
    const quote = await getLiveQuote(niftyInstrument);
    const price = num(quote.last_price);

    let daily = [];
    try {
      daily = await upstox.getHistoricalCandles(
        niftyInstrument,
        "days",
        "1",
        indiaDateString(),
        dateMinusDays(120)
      );
    } catch (_) { /* breadth is best-effort, never block stock analysis */ }

    const normalized = technical.normalizeCandles(daily);
    const closes = normalized.map(c => c.close);
    const ema20 = technical.ema(closes, 20);
    const ema50 = technical.ema(closes, 50);

    let trend = "NEUTRAL";
    if (ema20 != null && ema50 != null) {
      if (price > ema20 && ema20 > ema50) trend = "BULLISH";
      else if (price < ema20 && ema20 < ema50) trend = "BEARISH";
    }

    return cacheSet(marketBreadthCache, "NIFTY", {
      trend,
      niftyPrice: round2(price),
      available: ema20 != null && ema50 != null
    });
  } catch (error) {
    return cacheSet(marketBreadthCache, "NIFTY", fallback);
  }
}

// ============================================================
// DEPTH
// ============================================================

function buildDepth(quote) {
  const depth = quote?.depth || {};
  const buy = Array.isArray(depth.buy) ? depth.buy : [];
  const sell = Array.isArray(depth.sell) ? depth.sell : [];

  const buyQuantity = buy.reduce((sum, x) => sum + num(x?.quantity), 0);
  const sellQuantity = sell.reduce((sum, x) => sum + num(x?.quantity), 0);

  const totalBuy = num(quote?.total_buy_quantity, buyQuantity);
  const totalSell = num(quote?.total_sell_quantity, sellQuantity);
  const total = totalBuy + totalSell;

  const buyPercent = total > 0 ? (totalBuy / total) * 100 : 50;
  const sellPercent = total > 0 ? (totalSell / total) * 100 : 50;

  let trend = "NEUTRAL";
  if (buyPercent >= 60) trend = "BUYERS_STRONG";
  else if (sellPercent >= 60) trend = "SELLERS_STRONG";

  return {
    buyQuantity: totalBuy,
    sellQuantity: totalSell,
    buyPercent,
    sellPercent,
    totalDepth: total,
    trend,
    buyLevels: buy.slice(0, 5),
    sellLevels: sell.slice(0, 5),
    buyersConfirmed: trend === "BUYERS_STRONG",
    sellersConfirmed: trend === "SELLERS_STRONG"
  };
}

// ============================================================
// NEWS IMPACT
// ============================================================

function analyzeNews(raw) {
  const data = raw?.data || {};
  const all = [];

  for (const key of Object.keys(data)) {
    if (Array.isArray(data[key])) all.push(...data[key]);
  }

  const positive = [
    "profit", "growth", "surge", "record", "upgrade", "order win",
    "strong", "buyback", "dividend", "bonus", "expansion", "approval",
    "positive", "beats", "beat estimates", "outperform"
  ];

  const negative = [
    "loss", "fall", "drop", "downgrade", "fraud", "penalty", "probe",
    "investigation", "weak", "default", "debt", "resign", "negative",
    "miss", "misses", "decline", "warning", "ban", "regulatory action"
  ];

  let score = 0;
  const items = all.slice(0, 10).map(article => {
    const text = `${article.heading || ""} ${article.summary || ""}`.toLowerCase();
    const pos = positive.filter(k => text.includes(k)).length;
    const neg = negative.filter(k => text.includes(k)).length;
    const impact = pos > neg ? "POSITIVE" : neg > pos ? "NEGATIVE" : "NEUTRAL";
    score += pos > neg ? 1 : neg > pos ? -1 : 0;

    return {
      heading: article.heading || "",
      summary: article.summary || "",
      thumbnail: article.thumbnail || "",
      articleLink: article.article_link || "",
      publishedTime: article.published_time || 0,
      impact
    };
  });

  const impact = score >= 2 ? "POSITIVE" : score <= -2 ? "NEGATIVE" : "NEUTRAL";

  return {
    score: clamp(score, -5, 5),
    impact,
    count: items.length,
    items
  };
}

async function getNewsAnalysis(instrument) {
  const cached = cacheGet(newsCache, instrument, NEWS_CACHE_MS);
  if (cached) return cached;

  try {
    const raw = await upstox.getNews(instrument, 10);
    return cacheSet(newsCache, instrument, analyzeNews(raw));
  } catch (error) {
    if (isUnauthorized(error)) throw error;
    return cacheSet(newsCache, instrument, {
      score: 0,
      impact: "UNAVAILABLE",
      count: 0,
      items: [],
      error: error.message
    });
  }
}

// ============================================================
// FUNDAMENTAL ANALYSIS
// ============================================================

function ratioMap(ratios) {
  const map = {};
  if (!Array.isArray(ratios)) return map;
  for (const r of ratios) {
    const name = String(r?.name || "").toUpperCase();
    map[name] = {
      company: r?.company_value ?? null,
      sector: r?.sector_value ?? null
    };
  }
  return map;
}

function latestHistory(statement, category) {
  const rows = Array.isArray(statement) ? statement : [];
  const row = rows.find(x => String(x?.category || "").toLowerCase() === category);
  return Array.isArray(row?.history) ? row.history[0] || null : null;
}

function buildFundamentalAnalysis(raw) {
  if (!raw) {
    return {
      available: false,
      score: 50,
      rating: "UNAVAILABLE",
      sector: "",
      ratios: {},
      highlights: []
    };
  }

  const ratios = ratioMap(raw.ratios);
  let score = 50;
  const highlights = [];

  const pe = num(String(ratios["P/E"]?.company || "").replace("%", ""), NaN);
  const sectorPe = num(String(ratios["P/E"]?.sector || "").replace("%", ""), NaN);
  const roe = num(String(ratios["ROE"]?.company || "").replace("%", ""), NaN);
  const sectorRoe = num(String(ratios["ROE"]?.sector || "").replace("%", ""), NaN);
  const roce = num(String(ratios["ROCE"]?.company || "").replace("%", ""), NaN);
  const sectorRoce = num(String(ratios["ROCE"]?.sector || "").replace("%", ""), NaN);

  if (Number.isFinite(roe)) score += roe >= 15 ? 10 : roe < 5 ? -10 : 0;
  if (Number.isFinite(roce)) score += roce >= 15 ? 10 : roce < 5 ? -10 : 0;
  if (Number.isFinite(pe) && Number.isFinite(sectorPe)) {
    if (pe <= sectorPe) score += 5;
    if (pe >= sectorPe * 1.8) score -= 8;
  }
  if (Number.isFinite(sectorRoe) && Number.isFinite(roe) && roe > sectorRoe) score += 5;
  if (Number.isFinite(sectorRoce) && Number.isFinite(roce) && roce > sectorRoce) score += 5;

  const income = raw.income?.income_statement || [];
  const revenue = latestHistory(income, "revenue");
  const profit = latestHistory(income, "net_profit");

  if (revenue?.change) {
    const n = parseFloat(String(revenue.change).replace("%", ""));
    if (Number.isFinite(n)) score += n > 10 ? 5 : n < 0 ? -5 : 0;
  }
  if (profit?.change) {
    const n = parseFloat(String(profit.change).replace("%", ""));
    if (Number.isFinite(n)) score += n > 10 ? 5 : n < 0 ? -5 : 0;
  }

  score = Math.round(clamp(score, 0, 100));

  if (Number.isFinite(roe)) highlights.push(`ROE ${roe}%`);
  if (Number.isFinite(roce)) highlights.push(`ROCE ${roce}%`);
  if (Number.isFinite(pe)) highlights.push(`P/E ${pe}`);
  if (revenue?.change) highlights.push(`Revenue ${revenue.change}`);
  if (profit?.change) highlights.push(`Net profit ${profit.change}`);

  const rating = score >= 75 ? "STRONG" : score >= 60 ? "POSITIVE" : score <= 35 ? "WEAK" : "NEUTRAL";

  return {
    available: true,
    score,
    rating,
    isin: raw.isin,
    sector: raw.profile?.sector || "",
    companyProfile: raw.profile?.company_profile || "",
    ratios,
    revenue,
    netProfit: profit,
    shareHoldings: raw.holdings || [],
    corporateActions: raw.corporateActions || [],
    competitors: raw.competitors || [],
    highlights,
    errors: raw._errors || {}
  };
}

async function getFundamentalAnalysis(instrument) {
  const cached = cacheGet(fundamentalsCache, instrument, FUNDAMENTAL_CACHE_MS);
  if (cached) return cached;

  const raw = await upstox.getFundamentals(instrument);
  return cacheSet(fundamentalsCache, instrument, buildFundamentalAnalysis(raw));
}

// ============================================================
// TRADE LEVELS + SIGNAL ENGINE
// ============================================================

function calculateLevels({ price, support, resistance, atrValue, trend, technicalScore, depthTrend }) {
  // V7.4.2: Intraday-safe level engine.
  // Do not use a distant 20-day resistance as the immediate entry.
  const p = num(price);
  const atr = Math.max(num(atrValue), p * 0.004);
  const risk = Math.max(atr * 0.8, p * 0.006);
  const minGap = Math.max(p * 0.001, atr * 0.05);
  const maxEntryDistance = Math.max(p * 0.006, atr * 0.75);

  const s = num(support, p - risk);
  const r = num(resistance, p + risk * 1.5);

  // If resistance is far away, use a nearby breakout trigger instead of
  // producing an unrealistic entry such as ₹1,614 on a ₹1,334 stock.
  const rawBreakout = r > p ? r + minGap : p + minGap;
  const buyEntry = p + Math.min(Math.max(rawBreakout - p, minGap), maxEntryDistance);

  const buyStop = Math.max(0.01, Math.min(s, p - risk));
  const safeBuyStop = buyStop >= buyEntry
    ? Math.max(0.01, buyEntry - risk)
    : buyStop;
  const buyRisk = Math.max(0.01, buyEntry - safeBuyStop);

  // Use a nearby resistance only when it provides a sensible reward.
  // Otherwise calculate targets from the actual intraday risk distance.
  const resistanceTarget = r > buyEntry ? r : 0;
  const buyTarget1 = resistanceTarget > buyEntry &&
      (resistanceTarget - buyEntry) >= buyRisk * 1.5
    ? resistanceTarget
    : buyEntry + buyRisk * 1.5;
  const buyTarget2 = Math.max(
    buyEntry + buyRisk * 2.0,
    resistanceTarget > buyTarget1 ? resistanceTarget : 0
  );

  // Sell side: keep the trigger close to current price as well.
  const rawBreakdown = s < p ? s - minGap : p - minGap;
  const sellEntry = p - Math.min(Math.max(p - rawBreakdown, minGap), maxEntryDistance);
  const sellStopBase = Math.max(sellEntry + risk, r);
  const sellStop = sellStopBase <= sellEntry
    ? sellEntry + risk
    : sellStopBase;
  const sellRisk = Math.max(0.01, sellStop - sellEntry);

  const supportTarget = s < sellEntry ? s : 0;
  const sellTarget1 = supportTarget > 0 &&
      (sellEntry - supportTarget) >= sellRisk * 1.5
    ? supportTarget
    : Math.max(0.01, sellEntry - sellRisk * 1.5);
  const sellTarget2 = Math.min(
    sellEntry - sellRisk * 2.0,
    supportTarget > 0 && supportTarget < sellTarget1 ? supportTarget : sellEntry - sellRisk * 2.0
  );

  const buyRR1 = (buyTarget1 - buyEntry) / buyRisk;
  const buyRR2 = (buyTarget2 - buyEntry) / buyRisk;
  const sellRR1 = (sellEntry - sellTarget1) / sellRisk;
  const sellRR2 = (sellEntry - sellTarget2) / sellRisk;

  const breakoutLevel = buyEntry;
  const breakdownLevel = sellEntry;

  return {
    buyEntry,
    buyStop: safeBuyStop,
    buyTarget1,
    buyTarget2,
    buyRR1,
    buyRR2,
    sellEntry,
    sellStop,
    sellTarget1,
    sellTarget2,
    sellRR1,
    sellRR2,
    riskDistance: risk,
    breakoutLevel,
    breakdownLevel,
    bias: trend,
    technicalScore,
    depthTrend
  };
}

function buildSignal({
  price,
  open,
  high,
  low,
  close,
  technicalData,
  depth,
  news,
  fundamentals,
  levels,
  support,
  resistance,
  instrument,
  marketBreadth = { trend: "NEUTRAL", available: false }
}) {
  const p = num(price);
  const range = Math.max(num(high) - num(low), p * 0.001);
  const rangePosition = clamp((p - num(low)) / range, 0, 1);

  let trend = "SIDEWAYS";
  if (technicalData.ema20 && technicalData.ema50 && technicalData.vwap) {
    if (p > technicalData.ema20 && technicalData.ema20 > technicalData.ema50 && p > technicalData.vwap) trend = "BULLISH";
    else if (p < technicalData.ema20 && technicalData.ema20 < technicalData.ema50 && p < technicalData.vwap) trend = "BEARISH";
  }
  if (trend === "SIDEWAYS") {
    if (p > num(open) && rangePosition >= 0.6) trend = "BULLISH";
    else if (p < num(open) && rangePosition <= 0.4) trend = "BEARISH";
  }

  const technicalScore = num(technicalData.technicalScore);
  const depthBias = depth.buyPercent - depth.sellPercent;
  const newsScore = num(news.score);
  const fundamentalScore = num(fundamentals.score, 50);

  // Multi-timeframe confluence: how many independent indicators agree.
  // Falls back to a neutral 0.5 ratio when the multi-timeframe build wasn't
  // available (e.g. not enough candles), so older single-timeframe data
  // doesn't get unfairly penalized.
  const confluenceRatio = technicalData.confluenceRatio != null ? technicalData.confluenceRatio : 0.5;
  const confluenceDirection = technicalData.confluenceDirection || "NEUTRAL";
  const timeframeAligned = Boolean(technicalData.timeframeAligned);
  const macdTrend = technicalData.macd?.trend || "NEUTRAL";
  const macdCrossover = technicalData.macd?.crossover || "NONE";
  const patternBias = technicalData.candlePattern?.bias || "NEUTRAL";
  const breadthTrend = marketBreadth.trend || "NEUTRAL";

  const aiScore = Math.round(clamp(
    50 +
      technicalScore * 0.25 +
      depthBias * 0.12 +
      newsScore * 2 +
      (fundamentalScore - 50) * 0.10 +
      (confluenceDirection === "BULLISH" ? confluenceRatio * 8 : confluenceDirection === "BEARISH" ? -confluenceRatio * 8 : 0) +
      (timeframeAligned ? (technicalData.dailyTrend === "BULLISH" ? 6 : -6) : 0),
    0,
    100
  ));

  const bullish = trend === "BULLISH";
  const bearish = trend === "BEARISH";
  const buyersConfirmed = depth.trend === "BUYERS_STRONG" || depth.totalDepth === 0;
  const sellersConfirmed = depth.trend === "SELLERS_STRONG" || depth.totalDepth === 0;
  const newsBullish = news.impact !== "NEGATIVE";
  const newsBearish = news.impact !== "POSITIVE";

  // Market breadth acts as a soft veto: don't fight the index. If Nifty is
  // clearly trending the opposite way, "strong" grades get held back to a
  // normal grade instead of being blocked outright (a stock can still move
  // against the index, just with lower confidence).
  const breadthBullishOk = breadthTrend !== "BEARISH" || !marketBreadth.available;
  const breadthBearishOk = breadthTrend !== "BULLISH" || !marketBreadth.available;

  // MACD + candlestick pattern must not actively contradict the trade.
  const macdBullishOk = macdTrend !== "BEARISH";
  const macdBearishOk = macdTrend !== "BULLISH";
  const patternBullishOk = patternBias !== "BEARISH";
  const patternBearishOk = patternBias !== "BULLISH";

  const breakoutConfirmed =
    p > levels.breakoutLevel &&
    num(close) >= num(open) &&
    rangePosition >= 0.70 &&
    technicalScore >= 25;

  const breakdownConfirmed =
    p < levels.breakdownLevel &&
    num(close) <= num(open) &&
    rangePosition <= 0.30 &&
    technicalScore <= -25;

  const strongBuy =
    bullish &&
    technicalScore >= 35 &&
    aiScore >= 72 &&
    buyersConfirmed &&
    newsBullish &&
    breadthBullishOk &&
    macdBullishOk &&
    patternBullishOk &&
    (technicalData.confluenceTotal == null || confluenceDirection !== "BEARISH") &&
    levels.buyRR1 >= 1.5;

  const buy =
    bullish &&
    technicalScore >= 20 &&
    aiScore >= 62 &&
    buyersConfirmed &&
    newsBullish &&
    patternBullishOk &&
    levels.buyRR1 >= 1.5;

  const strongSell =
    bearish &&
    technicalScore <= -35 &&
    aiScore <= 32 &&
    sellersConfirmed &&
    newsBearish &&
    breadthBearishOk &&
    macdBearishOk &&
    patternBearishOk &&
    (technicalData.confluenceTotal == null || confluenceDirection !== "BULLISH") &&
    levels.sellRR1 >= 1.5;

  const sell =
    bearish &&
    technicalScore <= -20 &&
    aiScore <= 45 &&
    sellersConfirmed &&
    newsBearish &&
    patternBearishOk &&
    levels.sellRR1 >= 1.5;

  let signal = "WAIT";
  let reason = "Trend exists, but complete technical, depth, news and R:R confirmation is missing.";

  if (breakoutConfirmed && strongBuy) {
    signal = "BREAKOUT BUY";
    reason = "Resistance breakout confirmed by momentum, technical trend, market depth and R:R.";
  } else if (strongBuy) {
    signal = "STRONG BUY";
    reason = "Strong bullish technical structure with buyer depth and acceptable risk/reward.";
  } else if (buy) {
    signal = "BUY";
    reason = "Bullish technical trend confirmed with market depth, news filter and acceptable R:R.";
  } else if (breakdownConfirmed && strongSell) {
    signal = "BREAKDOWN SELL";
    reason = "Support breakdown confirmed by bearish momentum, seller depth and R:R.";
  } else if (strongSell) {
    signal = "STRONG SELL";
    reason = "Strong bearish technical structure with seller depth and acceptable risk/reward.";
  } else if (sell) {
    signal = "SELL";
    reason = "Bearish technical trend confirmed with market depth, news filter and acceptable R:R.";
  } else if (!bullish && !bearish) {
    signal = "AVOID";
    reason = "No clear directional setup from price, trend and technical confirmation.";
  }

  const previous = lastSignal.get(instrument);
  if (
    previous &&
    ["BUY", "STRONG BUY", "BREAKOUT BUY"].includes(previous) &&
    ["SELL", "STRONG SELL", "BREAKDOWN SELL"].includes(signal)
  ) {
    signal = "EXIT";
    reason = "Previous bullish setup has reversed to a confirmed bearish structure. Exit-risk condition detected.";
  }

  lastSignal.set(instrument, signal);

  let entry = p;
  let target1 = p;
  let target2 = p;
  let stopLoss = p;
  let riskReward = 0;

  if (["BUY", "STRONG BUY", "BREAKOUT BUY"].includes(signal)) {
    entry = levels.buyEntry;
    target1 = levels.buyTarget1;
    target2 = levels.buyTarget2;
    stopLoss = levels.buyStop;
    riskReward = levels.buyRR1;
  } else if (["SELL", "STRONG SELL", "BREAKDOWN SELL", "EXIT"].includes(signal)) {
    entry = levels.sellEntry;
    target1 = levels.sellTarget1;
    target2 = levels.sellTarget2;
    stopLoss = levels.sellStop;
    riskReward = levels.sellRR1;
  }

  if ((signal === "BUY" || signal === "STRONG BUY" || signal === "BREAKOUT BUY") && riskReward < 1.5) {
    signal = "WAIT";
    reason = "Bullish setup rejected because R:R is below 1:1.5.";
  }
  if ((signal === "SELL" || signal === "STRONG SELL" || signal === "BREAKDOWN SELL") && riskReward < 1.5) {
    signal = "WAIT";
    reason = "Bearish setup rejected because R:R is below 1:1.5.";
  }

  // V7.4.2: WAIT/AVOID must never display distant or fake trade levels.
  // The dashboard will show WAIT instead of pretending that a trade entry exists.
  const actionable = ["BUY", "STRONG BUY", "BREAKOUT BUY", "SELL", "STRONG SELL", "BREAKDOWN SELL", "EXIT"].includes(signal);
  if (!actionable) {
    entry = "WAIT";
    target1 = "WAIT";
    target2 = "WAIT";
    stopLoss = "WAIT";
    riskReward = 0;
  }

  const confidence = Math.round(clamp(
    50 + Math.abs(technicalScore) * 0.25 + Math.abs(depthBias) * 0.15 + Math.abs(newsScore) * 2,
    50,
    95
  ));

  const tradeQuality = riskReward >= 2 ? "EXCELLENT" : riskReward >= 1.5 ? "GOOD" : riskReward >= 1 ? "WEAK" : "LOW";

  const confirmationStatus =
    signal === "STRONG BUY" || signal === "BREAKOUT BUY"
      ? "STRONG BUY CONFIRMED"
      : signal === "BUY"
        ? "BUY CONFIRMED"
        : signal === "STRONG SELL" || signal === "BREAKDOWN SELL"
          ? "STRONG SELL CONFIRMED"
          : signal === "SELL"
            ? "SELL CONFIRMED"
            : signal === "EXIT"
              ? "EXIT CONFIRMED"
              : "WAITING FOR CONFIRMATION";

  return {
    signal,
    reason,
    trend,
    aiScore,
    confidence,
    tradeQuality,
    entry,
    target1,
    target2,
    stopLoss,
    riskReward,
    riskRewardTarget1: actionable ? (["SELL", "STRONG SELL", "BREAKDOWN SELL", "EXIT"].includes(signal) ? levels.sellRR1 : levels.buyRR1) : 0,
    riskRewardTarget2: actionable ? (["SELL", "STRONG SELL", "BREAKDOWN SELL", "EXIT"].includes(signal) ? levels.sellRR2 : levels.buyRR2) : 0,
    breakoutConfirmed,
    breakdownConfirmed,
    confirmationStatus,
    bullish,
    bearish,
    technicalConfirmation: {
      technicalScore,
      emaTrend: technicalData.emaTrend,
      vwapTrend: technicalData.vwapTrend,
      rsiSignal: technicalData.rsiSignal,
      volumeConfirmed: Boolean(technicalData.volumeConfirmed),
      volumeRatio: technicalData.volumeRatio,
      volumeTrend: technicalData.volumeTrend,
      macdTrend,
      macdCrossover,
      candlePattern: technicalData.candlePattern?.pattern || "NONE",
      patternBias,
      dailyTrend: technicalData.dailyTrend,
      intradayTrend: technicalData.intradayTrend,
      timeframeAligned,
      confluenceCount: technicalData.confluenceCount,
      confluenceTotal: technicalData.confluenceTotal,
      confluenceDirection,
      marketBreadthTrend: breadthTrend,
      buyersConfirmed: depth.buyersConfirmed,
      sellersConfirmed: depth.sellersConfirmed,
      confirmationStatus
    },
    strategy: {
      minimumRR: 1.5,
      preferredRR: 2,
      nearResistance: p >= num(resistance) - Math.max(p * 0.003, num(technicalData.atr) * 0.2),
      nearSupport: p <= num(support) + Math.max(p * 0.003, num(technicalData.atr) * 0.2)
    }
  };
}

// ============================================================
// FULL ANALYSIS
// ============================================================

async function analyzeInstrument({ instrument, symbol = "", name = "", exchange = "" }) {
  const quote = await getLiveQuote(instrument);
  const price = num(quote.last_price);
  const ohlc = quote.ohlc || {};
  const open = num(ohlc.open);
  const high = num(ohlc.high);
  const low = num(ohlc.low);
  const previousClose = num(ohlc.close);
  const netChange = num(quote.net_change, price - previousClose);
  const changePercent = previousClose > 0 ? (netChange / previousClose) * 100 : 0;

  if (price <= 0) {
    const err = new Error("Live price unavailable.");
    err.statusCode = 404;
    throw err;
  }

  let candlePack = { intraday: [], daily: [] };
  try {
    candlePack = await getCandlePack(instrument);
  } catch (error) {
    if (isUnauthorized(error)) throw error;
  }

  const intraday = candlePack.intraday;
  const daily = candlePack.daily;

  // Multi-timeframe: daily candles set the structural trend (EMA20/50, MACD,
  // RSI, Bollinger), intraday 1-min candles set the live entry timing
  // (EMA9, VWAP, latest volume/pattern). Falls back gracefully when one
  // side has too little data.
  const technicalData = (daily.length >= 20 && intraday.length >= 20)
    ? technical.buildMultiTimeframeTechnical(daily, intraday, price)
    : technical.buildTechnical(intraday.length >= 20 ? intraday : daily, price);

  const marketBreadth = await getMarketBreadth();

  const recentDaily = daily.slice(-20);
  const recentHigh = recentDaily.length
    ? Math.max(...recentDaily.map(c => c.high))
    : high;
  const recentLow = recentDaily.length
    ? Math.min(...recentDaily.map(c => c.low))
    : low;

  const support = Math.min(low || recentLow, recentLow || low || price);
  const resistance = Math.max(high || recentHigh, recentHigh || high || price);

  const depth = buildDepth(quote);

  const [news, fundamentals] = await Promise.all([
    getNewsAnalysis(instrument),
    getFundamentalAnalysis(instrument)
  ]);

  const levels = calculateLevels({
    price,
    support,
    resistance,
    atrValue: technicalData.atr,
    trend: technicalData.emaTrend,
    technicalScore: technicalData.technicalScore,
    depthTrend: depth.trend
  });

  const signal = buildSignal({
    price,
    open,
    high,
    low,
    close: previousClose,
    technicalData,
    depth,
    news,
    fundamentals,
    levels,
    support,
    resistance,
    instrument,
    marketBreadth
  });

  const lastTradeTime = quote.last_trade_time
    ? new Date(Number(quote.last_trade_time)).toISOString()
    : quote.timestamp || null;

  return {
    success: true,
    symbol: symbol || quote.symbol || "",
    name: name || quote.symbol || "",
    exchange,
    instrument,
    price: round2(price),
    netChange: round2(netChange),
    changePercent: round2(changePercent),
    open: round2(open),
    high: round2(high),
    low: round2(low),
    close: round2(previousClose),
    previousClose: round2(previousClose),
    averageTradePrice: round2(quote.average_price),
    volume: num(quote.volume),
    oi: num(quote.oi),
    lowerCircuit: round2(quote.lower_circuit_limit),
    upperCircuit: round2(quote.upper_circuit_limit),
    lastTradeTime,
    support: round2(support),
    resistance: round2(resistance),
    breakoutLevel: round2(levels.breakoutLevel),
    breakdownLevel: round2(levels.breakdownLevel),
    trend: signal.trend,
    aiScore: signal.aiScore,
    confidence: signal.confidence,
    signal: signal.signal,
    reason: signal.reason,
    tradeQuality: signal.tradeQuality,
    entry: round2(signal.entry),
    target1: round2(signal.target1),
    target2: round2(signal.target2),
    stopLoss: round2(signal.stopLoss),
    riskReward: round2(signal.riskReward),
    riskRewardTarget1: round2(signal.riskRewardTarget1),
    riskRewardTarget2: round2(signal.riskRewardTarget2),
    technicalScore: round2(technicalData.technicalScore),
    technical: {
      ...technicalData,
      ema9: round2(technicalData.ema9),
      ema20: round2(technicalData.ema20),
      ema50: round2(technicalData.ema50),
      dailyEma20: round2(technicalData.dailyEma20),
      dailyEma50: round2(technicalData.dailyEma50),
      vwap: round2(technicalData.vwap),
      rsi: round2(technicalData.rsi),
      dailyRsi: round2(technicalData.dailyRsi),
      intradayRsi: round2(technicalData.intradayRsi),
      atr: round2(technicalData.atr),
      dailyAtr: round2(technicalData.dailyAtr),
      averageVolume20: round2(technicalData.averageVolume20),
      volumeRatio: technicalData.volumeRatio == null ? null : round2(technicalData.volumeRatio),
      recentHigh20: round2(technicalData.recentHigh20),
      recentLow20: round2(technicalData.recentLow20)
    },
    technicalConfirmation: signal.technicalConfirmation,
    marketBreadth,
    marketDepth: depth,
    news,
    fundamentals,
    strategy: signal.strategy,
    dataFreshness: {
      market: marketOpenNow() ? "LIVE" : "LAST_AVAILABLE",
      quoteTimestamp: quote.timestamp || null,
      analysisGeneratedAt: new Date().toISOString()
    }
  };
}

// ============================================================
// LIVE STOCK API
// ============================================================

app.get("/api/live", async (req, res) => {
  const instrument = String(req.query.instrument || "").trim();
  const symbol = String(req.query.symbol || "").trim();
  const name = String(req.query.name || "").trim();
  const exchange = String(req.query.exchange || "").trim();

  if (!instrument) return res.status(400).json({ success: false, message: "instrument is required" });
  if (!hasAccessToken()) return sendTokenExpired(res);

  try {
    const data = await analyzeInstrument({ instrument, symbol, name, exchange });
    res.json({ success: true, data });
  } catch (error) {
    if (isUnauthorized(error)) {
      clearRuntimeToken();
      return sendTokenExpired(res);
    }
    console.error("LIVE ERROR:", error.message);
    res.status(error.statusCode || 500).json({ success: false, message: error.message, error: error.data || null });
  }
});

// ============================================================
// SEARCH + ANALYZE IN ONE REQUEST
// ============================================================

app.get("/api/scan", async (req, res) => {
  const stock = String(req.query.symbol || "").trim();
  if (!stock) return res.status(400).json({ success: false, message: "symbol is required" });
  if (!hasAccessToken()) return sendTokenExpired(res);

  try {
    const search = await upstox.searchInstruments(stock, {
      exchanges: "NSE,BSE",
      segments: "EQ",
      records: 30
    });

    const list = Array.isArray(search.data) ? search.data : [];
    const upper = stock.toUpperCase();
    const selected = list.find(x => String(x.trading_symbol || "").toUpperCase() === upper) || list[0];

    if (!selected?.instrument_key) {
      return res.status(404).json({ success: false, message: `${stock} instrument not found.` });
    }

    const data = await analyzeInstrument({
      instrument: selected.instrument_key,
      symbol: selected.trading_symbol,
      name: selected.name || selected.short_name,
      exchange: selected.exchange
    });

    res.json({ success: true, instrument: selected.instrument_key, data });
  } catch (error) {
    if (isUnauthorized(error)) return sendTokenExpired(res);
    res.status(error.statusCode || 500).json({ success: false, message: error.message });
  }
});

// ============================================================
// INDEX DASHBOARD
// ============================================================

async function resolveIndexInstrument(item) {
  if (item.instrument) return item.instrument;
  return null;
}

async function analyzeIndex(item) {
  const cacheKey = item.id;
  const cached = cacheGet(indexCache, cacheKey, INDEX_CACHE_MS);
  if (cached) return cached;

  let instrument = await resolveIndexInstrument(item);
  let quote;

  try {
    quote = await getLiveQuote(instrument);
  } catch (error) {
    // Fallback to instrument search if a broker-side key changes.
    const search = await upstox.searchInstruments(item.name, {
      exchanges: item.exchange,
      segments: "INDEX",
      records: 30
    });
    const list = Array.isArray(search.data) ? search.data : [];
    const selected = list.find(x => String(x.name || "").toUpperCase() === item.name.toUpperCase()) || list[0];
    if (!selected?.instrument_key) throw error;
    instrument = selected.instrument_key;
    quote = await getLiveQuote(instrument);
  }

  const price = num(quote.last_price);
  const close = num(quote.ohlc?.close);
  const change = num(quote.net_change, price - close);
  const changePct = close > 0 ? (change / close) * 100 : 0;

  const result = {
    id: item.id,
    symbol: item.symbol,
    name: item.name,
    exchange: item.exchange,
    instrument,
    price: round2(price),
    previousClose: round2(close),
    change: round2(change),
    changePercent: round2(changePct),
    open: round2(quote.ohlc?.open),
    high: round2(quote.ohlc?.high),
    low: round2(quote.ohlc?.low),
    averageTradePrice: round2(quote.average_price),
    timestamp: quote.timestamp || null
  };

  return cacheSet(indexCache, cacheKey, result);
}

app.get("/api/indexes", async (req, res) => {
  if (!hasAccessToken()) return sendTokenExpired(res);

  try {
    const results = await Promise.all(INDEXES.map(analyzeIndex));
    res.json({
      success: true,
      marketOpen: marketOpenNow(),
      indexes: results,
      updatedAt: new Date().toISOString()
    });
  } catch (error) {
    if (isUnauthorized(error)) return sendTokenExpired(res);
    res.status(error.statusCode || 500).json({ success: false, message: error.message });
  }
});

app.get("/api/index/:id", async (req, res) => {
  if (!hasAccessToken()) return sendTokenExpired(res);
  const id = String(req.params.id || "").toUpperCase();
  const item = INDEXES.find(x => x.id === id || x.symbol === id);
  if (!item) return res.status(404).json({ success: false, message: "Index not supported." });

  try {
    const data = await analyzeIndex(item);
    res.json({ success: true, data });
  } catch (error) {
    if (isUnauthorized(error)) return sendTokenExpired(res);
    res.status(error.statusCode || 500).json({ success: false, message: error.message });
  }
});

// ============================================================
// NEWS API
// ============================================================

app.get("/api/news", async (req, res) => {
  const instrument = String(req.query.instrument || "").trim();
  if (!instrument) return res.status(400).json({ success: false, message: "instrument is required" });
  if (!hasAccessToken()) return sendTokenExpired(res);

  try {
    const data = await getNewsAnalysis(instrument);
    res.json({ success: true, data });
  } catch (error) {
    if (isUnauthorized(error)) return sendTokenExpired(res);
    res.status(error.statusCode || 500).json({ success: false, message: error.message });
  }
});

// ============================================================
// FUNDAMENTALS API
// ============================================================

app.get("/api/fundamentals", async (req, res) => {
  const instrument = String(req.query.instrument || "").trim();
  if (!instrument) return res.status(400).json({ success: false, message: "instrument is required" });
  if (!hasAccessToken()) return sendTokenExpired(res);

  try {
    const data = await getFundamentalAnalysis(instrument);
    res.json({ success: true, data });
  } catch (error) {
    if (isUnauthorized(error)) return sendTokenExpired(res);
    res.status(error.statusCode || 500).json({ success: false, message: error.message });
  }
});

// ============================================================
// SUPPORTED MARKETS
// ============================================================

app.get("/api/markets", (req, res) => {
  res.json({
    success: true,
    markets: [
      { id: "NSE_BSE_EQ", name: "NSE + BSE Equity", exchanges: ["NSE", "BSE"], segment: "EQ" },
      ...INDEXES.map(x => ({ id: x.id, name: x.name, exchange: x.exchange, segment: "INDEX" }))
    ]
  });
});

// ============================================================
// HEALTH
// ============================================================

app.get("/api/health", (req, res) => {
  res.json({
    success: true,
    app: "Dharmrajsinh Live Market",
    version: "7.5.0",
    serverTime: new Date().toISOString(),
    marketOpen: marketOpenNow(),
    upstoxToken: hasAccessToken() ? "AVAILABLE" : "MISSING",
    indexes: INDEXES.map(x => x.symbol),
    features: [
      "NSE + BSE Equity Search",
      "Live Quote",
      "Previous Close",
      "Average Trade Price",
      "Market Depth",
      "Multi-Timeframe Technical Analysis (Daily + Intraday)",
      "MACD",
      "Bollinger Bands",
      "Candlestick Pattern Detection",
      "Volume Trend (Accumulation/Distribution)",
      "Multi-Indicator Confluence Scoring",
      "Nifty 50 Market Breadth Filter",
      "Fundamental Analysis",
      "News Impact",
      "Auto-Retry on API Failures",
      "Buy / Strong Buy / Breakout Buy / Wait / Sell / Strong Sell / Breakdown Sell / Exit",
      "Nifty 50",
      "Sensex",
      "MidcapNifty",
      "India VIX"
    ]
  });
});

// ============================================================
// HOME
// ============================================================

app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

// ============================================================
// ERROR HANDLER
// ============================================================

app.use((error, req, res, next) => {
  console.error("SERVER ERROR:", error);
  if (isUnauthorized(error)) return sendTokenExpired(res);
  res.status(500).json({ success: false, message: "Internal server error." });
});

// ============================================================
// START
// ============================================================

app.listen(PORT, "0.0.0.0", () => {
  console.log("================================================");
  console.log("DHARMRAJSINH LIVE MARKET V7.5");
  console.log("================================================");
  console.log(`Server running on port ${PORT}`);
  console.log(`Upstox token: ${hasAccessToken() ? "AVAILABLE" : "MISSING"}`);
  console.log("NSE + BSE Equity | NIFTY 50 | SENSEX | MIDCPNIFTY | INDIA VIX");
  console.log("Technical + Fundamental + News + Depth + Live Levels");
  console.log("================================================");
});
