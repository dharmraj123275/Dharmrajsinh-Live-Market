// ============================================================
// UPSTOX API SERVICE - V7.4
// ============================================================

const axios = require("axios");

const V2 = "https://api.upstox.com/v2";
const V3 = "https://api.upstox.com/v3";

function getToken() {
  return String(process.env.UPSTOX_ACCESS_TOKEN || "").trim();
}

function authHeaders() {
  const token = getToken();
  if (!token) {
    const err = new Error("UPSTOX_ACCESS_TOKEN is missing.");
    err.statusCode = 401;
    throw err;
  }
  return {
    Accept: "application/json",
    "Content-Type": "application/json",
    Authorization: `Bearer ${token}`
  };
}

function normalizeError(error) {
  const status = error?.response?.status || error?.statusCode || 500;
  const data = error?.response?.data || null;
  const message =
    data?.errors?.[0]?.message ||
    data?.message ||
    error?.message ||
    "Upstox API error";

  const out = new Error(message);
  out.statusCode = status;
  out.data = data;
  return out;
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function isRetryable(error) {
  // Retry on network/timeout errors and 5xx server errors, but never on
  // 401 (bad/expired token) or other 4xx client errors — retrying those
  // just wastes time and delays the "please login again" message.
  const status = error?.response?.status;
  if (!status) return true; // network error / timeout (no response received)
  return status >= 500 && status < 600;
}

async function request(base, path, params = {}, attempt = 1) {
  const MAX_ATTEMPTS = 3;
  try {
    return await axios.get(`${base}${path}`, {
      params,
      headers: authHeaders(),
      timeout: 20000
    });
  } catch (error) {
    if (attempt < MAX_ATTEMPTS && isRetryable(error)) {
      await sleep(300 * attempt); // 300ms, 600ms backoff
      return request(base, path, params, attempt + 1);
    }
    throw normalizeError(error);
  }
}

async function getQuote(instrumentKeys) {
  const response = await request(V2, "/market-quote/quotes", {
    instrument_key: Array.isArray(instrumentKeys)
      ? instrumentKeys.join(",")
      : instrumentKeys
  });
  return response.data?.data || {};
}

async function getSingleQuote(instrumentKey) {
  const data = await getQuote(instrumentKey);
  return data[instrumentKey] || data[Object.keys(data)[0]] || null;
}

async function searchInstruments(query, options = {}) {
  const params = {
    query,
    exchanges: options.exchanges || "NSE,BSE",
    segments: options.segments || "EQ",
    page_number: options.page_number || 1,
    records: Math.min(options.records || 30, 30)
  };

  const response = await request(V2, "/instruments/search", params);
  return response.data || {};
}

async function getHistoricalCandles(instrumentKey, unit, interval, toDate, fromDate) {
  const encoded = encodeURIComponent(instrumentKey);
  const path = `/historical-candle/${encoded}/${unit}/${interval}/${toDate}/${fromDate}`;
  const response = await request(V3, path);
  return response.data?.data?.candles || [];
}

async function getIntradayCandles(instrumentKey, unit = "minutes", interval = 1) {
  const encoded = encodeURIComponent(instrumentKey);
  const path = `/historical-candle/intraday/${encoded}/${unit}/${interval}`;
  const response = await request(V3, path);
  return response.data?.data?.candles || [];
}

async function getNews(instrumentKey, pageSize = 10) {
  const response = await request(V2, "/news", {
    category: "instrument_keys",
    instrument_keys: instrumentKey,
    page_number: 1,
    page_size: Math.min(pageSize, 100)
  });
  return response.data || {};
}

async function getFundamentals(instrumentKey) {
  const isin = String(instrumentKey || "").split("|")[1] || "";
  if (!/^IN[A-Z0-9]{10}$/.test(isin)) return null;

  const endpoints = [
    ["profile", `/fundamentals/${isin}/profile`],
    ["ratios", `/fundamentals/${isin}/key-ratios`],
    ["income", `/fundamentals/${isin}/income-statement`],
    ["balance", `/fundamentals/${isin}/balance-sheet`],
    ["cashFlow", `/fundamentals/${isin}/cash-flow`],
    ["holdings", `/fundamentals/${isin}/share-holdings`],
    ["corporateActions", `/fundamentals/${isin}/corporate-actions`],
    ["competitors", `/fundamentals/${isin}/competitors`]
  ];

  const results = {};

  await Promise.all(endpoints.map(async ([key, path]) => {
    try {
      const response = await request(V2, path, key === "income"
        ? { type: "consolidated", time_period: "yearly" }
        : key === "balance" || key === "cashFlow"
          ? { type: "consolidated" }
          : {});
      results[key] = response.data?.data ?? null;
    } catch (error) {
      // Fundamentals are optional for an otherwise valid live quote.
      results[key] = null;
      results._errors = results._errors || {};
      results._errors[key] = error.message;
    }
  }));

  return { isin, ...results };
}

async function getMarketStatus(exchange = "NSE") {
  const response = await request(V2, `/market/status/${encodeURIComponent(exchange)}`);
  return response.data?.data || {};
}

module.exports = {
  getToken,
  getQuote,
  getSingleQuote,
  searchInstruments,
  getHistoricalCandles,
  getIntradayCandles,
  getNews,
  getFundamentals,
  getMarketStatus,
  normalizeError
};
