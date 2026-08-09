// ============================================================
// DHARMRAJSINH LIVE MARKET V7.4
// TECHNICAL ENGINE
// ============================================================

function num(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function ema(values, period = 20) {
  const clean = (values || []).map(Number).filter(Number.isFinite);
  if (clean.length < period) return null;

  const k = 2 / (period + 1);
  let result = clean.slice(0, period).reduce((a, b) => a + b, 0) / period;
  for (let i = period; i < clean.length; i++) {
    result = (clean[i] - result) * k + result;
  }
  return result;
}

function rsi(values, period = 14) {
  const clean = (values || []).map(Number).filter(Number.isFinite);
  if (clean.length <= period) return null;

  let gains = 0;
  let losses = 0;

  for (let i = 1; i <= period; i++) {
    const change = clean[i] - clean[i - 1];
    if (change >= 0) gains += change;
    else losses -= change;
  }

  let avgGain = gains / period;
  let avgLoss = losses / period;

  for (let i = period + 1; i < clean.length; i++) {
    const change = clean[i] - clean[i - 1];
    const gain = Math.max(change, 0);
    const loss = Math.max(-change, 0);
    avgGain = ((avgGain * (period - 1)) + gain) / period;
    avgLoss = ((avgLoss * (period - 1)) + loss) / period;
  }

  if (avgLoss === 0) return 100;
  if (avgGain === 0) return 0;

  const rs = avgGain / avgLoss;
  return 100 - (100 / (1 + rs));
}

function vwap(candles) {
  if (!Array.isArray(candles) || !candles.length) return null;

  let pv = 0;
  let volume = 0;

  for (const candle of candles) {
    const high = num(candle.high);
    const low = num(candle.low);
    const close = num(candle.close);
    const vol = Math.max(0, num(candle.volume));
    const typical = (high + low + close) / 3;
    pv += typical * vol;
    volume += vol;
  }

  return volume > 0 ? pv / volume : null;
}

function atr(candles, period = 14) {
  if (!Array.isArray(candles) || candles.length <= period) return null;

  const trs = [];
  for (let i = 1; i < candles.length; i++) {
    const high = num(candles[i].high);
    const low = num(candles[i].low);
    const prevClose = num(candles[i - 1].close);
    trs.push(Math.max(
      high - low,
      Math.abs(high - prevClose),
      Math.abs(low - prevClose)
    ));
  }

  const recent = trs.slice(-period);
  return recent.length ? recent.reduce((a, b) => a + b, 0) / recent.length : null;
}

function averageVolume(candles, period = 20) {
  if (!Array.isArray(candles) || candles.length < period) return null;
  const values = candles.slice(-period).map(c => Math.max(0, num(c.volume)));
  return values.reduce((a, b) => a + b, 0) / values.length;
}

function normalizeCandles(rawCandles) {
  if (!Array.isArray(rawCandles)) return [];

  return rawCandles.map(c => {
    if (Array.isArray(c)) {
      return {
        timestamp: c[0],
        open: num(c[1]),
        high: num(c[2]),
        low: num(c[3]),
        close: num(c[4]),
        volume: num(c[5]),
        oi: num(c[6])
      };
    }

    return {
      timestamp: c.timestamp,
      open: num(c.open),
      high: num(c.high),
      low: num(c.low),
      close: num(c.close),
      volume: num(c.volume),
      oi: num(c.oi)
    };
  }).filter(c => c.close > 0);
}

function recentHigh(candles, lookback = 20) {
  const values = normalizeCandles(candles).slice(-lookback).map(c => c.high);
  return values.length ? Math.max(...values) : null;
}

function recentLow(candles, lookback = 20) {
  const values = normalizeCandles(candles).slice(-lookback).map(c => c.low);
  return values.length ? Math.min(...values) : null;
}

function buildTechnical(candles, price) {
  const normalized = normalizeCandles(candles);
  const closes = normalized.map(c => c.close);

  const ema9 = ema(closes, 9);
  const ema20 = ema(closes, 20);
  const ema50 = ema(closes, 50);
  const rsi14 = rsi(closes, 14);
  const dayVwap = vwap(normalized);
  const atr14 = atr(normalized, 14);
  const avgVol20 = averageVolume(normalized, 20);
  const latestVolume = normalized.at(-1)?.volume || 0;
  const volumeRatio = avgVol20 && avgVol20 > 0 ? latestVolume / avgVol20 : null;

  const p = num(price);
  let score = 0;

  if (ema9 != null && ema20 != null) score += ema9 > ema20 ? 15 : -15;
  if (ema20 != null && ema50 != null) score += ema20 > ema50 ? 20 : -20;
  if (dayVwap != null) score += p > dayVwap ? 15 : -15;
  if (rsi14 != null) {
    if (rsi14 >= 60) score += 15;
    else if (rsi14 <= 40) score -= 15;
    else if (rsi14 >= 52) score += 5;
    else if (rsi14 <= 48) score -= 5;
  }
  if (volumeRatio != null) {
    if (volumeRatio >= 1.5) score += 10;
    else if (volumeRatio < 0.7) score -= 3;
  }

  score = Math.max(-100, Math.min(100, score));

  return {
    technicalScore: score,
    ema9,
    ema20,
    ema50,
    vwap: dayVwap,
    rsi: rsi14,
    atr: atr14,
    averageVolume20: avgVol20,
    volumeRatio,
    volumeConfirmed: volumeRatio != null && volumeRatio >= 1.5,
    emaTrend: ema20 == null ? "NEUTRAL" : p > ema20 ? "BULLISH" : "BEARISH",
    emaStructure: ema20 != null && ema50 != null
      ? (ema20 > ema50 ? "BULLISH" : "BEARISH")
      : "NEUTRAL",
    vwapTrend: dayVwap == null ? "NEUTRAL" : p > dayVwap ? "ABOVE_VWAP" : "BELOW_VWAP",
    rsiSignal: rsi14 == null ? "NEUTRAL" : rsi14 >= 60 ? "BULLISH" : rsi14 <= 40 ? "BEARISH" : "NEUTRAL",
    recentHigh20: recentHigh(normalized, 20),
    recentLow20: recentLow(normalized, 20),
    candleCount: normalized.length
  };
}

module.exports = {
  ema,
  rsi,
  vwap,
  atr,
  averageVolume,
  normalizeCandles,
  recentHigh,
  recentLow,
  buildTechnical
};
