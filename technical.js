// ============================================================
// DHARMRAJSINH LIVE MARKET V7.5
// TECHNICAL ENGINE — MULTI-TIMEFRAME + CONFLUENCE
// ============================================================

function num(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

// ------------------------------------------------------------
// CORE INDICATORS
// ------------------------------------------------------------

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

// Returns the full EMA series (same length as input, leading nulls before `period`).
// Needed internally for MACD, since MACD needs an EMA time-series, not just the latest value.
function emaSeries(values, period) {
  const clean = (values || []).map(Number).filter(Number.isFinite);
  const out = new Array(clean.length).fill(null);
  if (clean.length < period) return out;

  const k = 2 / (period + 1);
  let result = clean.slice(0, period).reduce((a, b) => a + b, 0) / period;
  out[period - 1] = result;
  for (let i = period; i < clean.length; i++) {
    result = (clean[i] - result) * k + result;
    out[i] = result;
  }
  return out;
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

// Compares the average volume of the most recent N candles against the
// N candles before that, to detect accumulation/distribution instead of
// judging volume from a single latest candle only.
function volumeTrend(candles, lookback = 5) {
  if (!Array.isArray(candles) || candles.length < lookback * 2) {
    return { direction: "NEUTRAL", ratio: null };
  }
  const recent = candles.slice(-lookback).map(c => Math.max(0, num(c.volume)));
  const prior = candles.slice(-lookback * 2, -lookback).map(c => Math.max(0, num(c.volume)));
  const recentAvg = recent.reduce((a, b) => a + b, 0) / recent.length;
  const priorAvg = prior.reduce((a, b) => a + b, 0) / prior.length;
  if (priorAvg <= 0) return { direction: "NEUTRAL", ratio: null };

  const ratio = recentAvg / priorAvg;
  const direction = ratio >= 1.2 ? "RISING" : ratio <= 0.8 ? "FALLING" : "FLAT";
  return { direction, ratio };
}

// ------------------------------------------------------------
// MACD (12, 26, 9 default)
// ------------------------------------------------------------

function macd(values, fast = 12, slow = 26, signalPeriod = 9) {
  const clean = (values || []).map(Number).filter(Number.isFinite);
  if (clean.length < slow + signalPeriod) {
    return { macdLine: null, signalLine: null, histogram: null, trend: "NEUTRAL", crossover: "NONE" };
  }

  const fastSeries = emaSeries(clean, fast);
  const slowSeries = emaSeries(clean, slow);

  const macdSeries = clean.map((_, i) =>
    fastSeries[i] != null && slowSeries[i] != null ? fastSeries[i] - slowSeries[i] : null
  );

  const macdValid = macdSeries.filter(v => v != null);
  if (macdValid.length < signalPeriod) {
    return { macdLine: null, signalLine: null, histogram: null, trend: "NEUTRAL", crossover: "NONE" };
  }

  const signalSeries = emaSeries(macdValid, signalPeriod);

  const macdLine = macdValid.at(-1);
  const signalLine = signalSeries.at(-1);
  const prevMacd = macdValid.at(-2);
  const prevSignal = signalSeries.at(-2);

  if (macdLine == null || signalLine == null) {
    return { macdLine, signalLine: null, histogram: null, trend: "NEUTRAL", crossover: "NONE" };
  }

  const histogram = macdLine - signalLine;
  const trend = histogram > 0 ? "BULLISH" : histogram < 0 ? "BEARISH" : "NEUTRAL";

  let crossover = "NONE";
  if (prevMacd != null && prevSignal != null) {
    if (prevMacd <= prevSignal && macdLine > signalLine) crossover = "BULLISH_CROSS";
    else if (prevMacd >= prevSignal && macdLine < signalLine) crossover = "BEARISH_CROSS";
  }

  return { macdLine, signalLine, histogram, trend, crossover };
}

// ------------------------------------------------------------
// BOLLINGER BANDS (20, 2 std-dev default)
// ------------------------------------------------------------

function bollingerBands(values, period = 20, mult = 2) {
  const clean = (values || []).map(Number).filter(Number.isFinite);
  if (clean.length < period) return null;

  const recent = clean.slice(-period);
  const mean = recent.reduce((a, b) => a + b, 0) / period;
  const variance = recent.reduce((sum, v) => sum + (v - mean) ** 2, 0) / period;
  const stdDev = Math.sqrt(variance);

  const upper = mean + mult * stdDev;
  const lower = mean - mult * stdDev;
  const bandwidth = mean > 0 ? ((upper - lower) / mean) * 100 : null;
  const price = clean.at(-1);
  const percentB = (upper - lower) > 0 ? (price - lower) / (upper - lower) : null;

  return {
    upper,
    middle: mean,
    lower,
    bandwidth,
    percentB,
    squeeze: bandwidth != null && bandwidth < 4, // low-volatility squeeze, breakout watch
    position: percentB == null ? "NEUTRAL" : percentB >= 0.8 ? "NEAR_UPPER" : percentB <= 0.2 ? "NEAR_LOWER" : "MIDDLE"
  };
}

// ------------------------------------------------------------
// CANDLESTICK PATTERNS (last 2 candles, simple + reliable set)
// ------------------------------------------------------------

function detectCandlePattern(candles) {
  const c = (candles || []).slice(-2);
  if (c.length < 2) return { pattern: "NONE", bias: "NEUTRAL" };

  const [prev, curr] = c;
  const body = Math.abs(curr.close - curr.open);
  const range = Math.max(curr.high - curr.low, 0.0001);
  const upperWick = curr.high - Math.max(curr.open, curr.close);
  const lowerWick = Math.min(curr.open, curr.close) - curr.low;

  // Bullish engulfing
  if (prev.close < prev.open && curr.close > curr.open &&
      curr.close >= prev.open && curr.open <= prev.close) {
    return { pattern: "BULLISH_ENGULFING", bias: "BULLISH" };
  }

  // Bearish engulfing
  if (prev.close > prev.open && curr.close < curr.open &&
      curr.open >= prev.close && curr.close <= prev.open) {
    return { pattern: "BEARISH_ENGULFING", bias: "BEARISH" };
  }

  // Hammer (small body near top, long lower wick) — bullish reversal at bottom
  if (lowerWick >= body * 2 && upperWick <= body * 0.5 && body / range <= 0.35) {
    return { pattern: "HAMMER", bias: "BULLISH" };
  }

  // Shooting star (small body near bottom, long upper wick) — bearish reversal at top
  if (upperWick >= body * 2 && lowerWick <= body * 0.5 && body / range <= 0.35) {
    return { pattern: "SHOOTING_STAR", bias: "BEARISH" };
  }

  // Doji — indecision
  if (body / range <= 0.1) {
    return { pattern: "DOJI", bias: "NEUTRAL" };
  }

  return { pattern: "NONE", bias: "NEUTRAL" };
}

// ------------------------------------------------------------
// CANDLE NORMALIZATION
// ------------------------------------------------------------

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
  })
    .filter(c => c.close > 0)
    .sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp)); // oldest -> newest, required for EMA/RSI/VWAP/ATR/MACD
}

function recentHigh(candles, lookback = 20) {
  const values = normalizeCandles(candles).slice(-lookback).map(c => c.high);
  return values.length ? Math.max(...values) : null;
}

function recentLow(candles, lookback = 20) {
  const values = normalizeCandles(candles).slice(-lookback).map(c => c.low);
  return values.length ? Math.min(...values) : null;
}

// ------------------------------------------------------------
// SINGLE-TIMEFRAME TECHNICAL BUILD (kept for backward compatibility)
// ------------------------------------------------------------

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
  const macdData = macd(closes);
  const bands = bollingerBands(closes);
  const pattern = detectCandlePattern(normalized);
  const volTrend = volumeTrend(normalized);

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
  if (macdData.trend === "BULLISH") score += 10;
  else if (macdData.trend === "BEARISH") score -= 10;
  if (macdData.crossover === "BULLISH_CROSS") score += 8;
  else if (macdData.crossover === "BEARISH_CROSS") score -= 8;
  if (pattern.bias === "BULLISH") score += 6;
  else if (pattern.bias === "BEARISH") score -= 6;

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
    volumeTrend: volTrend.direction,
    emaTrend: ema20 == null ? "NEUTRAL" : p > ema20 ? "BULLISH" : "BEARISH",
    emaStructure: ema20 != null && ema50 != null
      ? (ema20 > ema50 ? "BULLISH" : "BEARISH")
      : "NEUTRAL",
    vwapTrend: dayVwap == null ? "NEUTRAL" : p > dayVwap ? "ABOVE_VWAP" : "BELOW_VWAP",
    rsiSignal: rsi14 == null ? "NEUTRAL" : rsi14 >= 60 ? "BULLISH" : rsi14 <= 40 ? "BEARISH" : "NEUTRAL",
    macd: macdData,
    bollinger: bands,
    candlePattern: pattern,
    recentHigh20: recentHigh(normalized, 20),
    recentLow20: recentLow(normalized, 20),
    candleCount: normalized.length
  };
}

// ------------------------------------------------------------
// MULTI-TIMEFRAME TECHNICAL BUILD
// Daily candles decide the structural trend (EMA20/50, MACD, RSI on daily).
// Intraday (1-min) candles decide the live entry timing (EMA9, VWAP, latest
// volume/pattern). A signal is only "confirmed" when both timeframes agree —
// this is the single highest-value upgrade for live-market accuracy.
// ------------------------------------------------------------

function buildMultiTimeframeTechnical(dailyCandles, intradayCandles, price) {
  const daily = normalizeCandles(dailyCandles);
  const intraday = normalizeCandles(intradayCandles);
  const p = num(price);

  const dailyCloses = daily.map(c => c.close);
  const intraCloses = intraday.map(c => c.close);

  // --- Daily (structural) indicators ---
  const dEma20 = ema(dailyCloses, 20);
  const dEma50 = ema(dailyCloses, 50);
  const dRsi = rsi(dailyCloses, 14);
  const dMacd = macd(dailyCloses);
  const dBands = bollingerBands(dailyCloses);
  const dAtr = atr(daily, 14);
  const dPattern = detectCandlePattern(daily);

  const dailyTrend =
    dEma20 != null && dEma50 != null
      ? (p > dEma20 && dEma20 > dEma50 ? "BULLISH" : p < dEma20 && dEma20 < dEma50 ? "BEARISH" : "NEUTRAL")
      : "NEUTRAL";

  // --- Intraday (timing) indicators ---
  const iEma9 = ema(intraCloses, 9);
  const iEma20 = ema(intraCloses, 20);
  const iVwap = vwap(intraday);
  const iRsi = rsi(intraCloses, 14);
  const iMacd = macd(intraCloses);
  const iAvgVol20 = averageVolume(intraday, 20);
  const iLatestVolume = intraday.at(-1)?.volume || 0;
  const iVolumeRatio = iAvgVol20 && iAvgVol20 > 0 ? iLatestVolume / iAvgVol20 : null;
  const iVolTrend = volumeTrend(intraday);
  const iPattern = detectCandlePattern(intraday);
  const iAtr = atr(intraday, 14);

  const intradayTrend =
    iEma9 != null && iEma20 != null && iVwap != null
      ? (p > iEma9 && iEma9 > iEma20 && p > iVwap ? "BULLISH"
        : p < iEma9 && iEma9 < iEma20 && p < iVwap ? "BEARISH" : "NEUTRAL")
      : "NEUTRAL";

  // --- Confluence: count how many independent signals agree ---
  let bullishVotes = 0;
  let bearishVotes = 0;
  let totalVotes = 0;

  const vote = (condition) => {
    if (condition === null) return;
    totalVotes++;
    if (condition === true) bullishVotes++;
    else bearishVotes++;
  };

  vote(dailyTrend === "NEUTRAL" ? null : dailyTrend === "BULLISH");
  vote(intradayTrend === "NEUTRAL" ? null : intradayTrend === "BULLISH");
  vote(dRsi == null ? null : dRsi >= 55 ? true : dRsi <= 45 ? false : null);
  vote(iRsi == null ? null : iRsi >= 55 ? true : iRsi <= 45 ? false : null);
  vote(dMacd.trend === "NEUTRAL" ? null : dMacd.trend === "BULLISH");
  vote(iMacd.trend === "NEUTRAL" ? null : iMacd.trend === "BULLISH");
  vote(iVolumeRatio == null ? null : iVolumeRatio >= 1.3 ? (intradayTrend === "BULLISH") : null);
  vote(dPattern.bias === "NEUTRAL" ? null : dPattern.bias === "BULLISH");
  vote(iPattern.bias === "NEUTRAL" ? null : iPattern.bias === "BULLISH");

  const confluenceCount = Math.max(bullishVotes, bearishVotes);
  const confluenceDirection = bullishVotes > bearishVotes ? "BULLISH" : bearishVotes > bullishVotes ? "BEARISH" : "NEUTRAL";
  const confluenceRatio = totalVotes > 0 ? confluenceCount / totalVotes : 0;

  // Multi-timeframe agreement: strongest possible confirmation.
  const timeframeAligned = dailyTrend !== "NEUTRAL" && dailyTrend === intradayTrend;

  // --- Combined score (daily structure weighted higher than intraday noise) ---
  let score = 0;
  if (dEma20 != null && dEma50 != null) score += dEma20 > dEma50 ? 18 : -18;
  if (iEma9 != null && iEma20 != null) score += iEma9 > iEma20 ? 10 : -10;
  if (iVwap != null) score += p > iVwap ? 12 : -12;
  if (dRsi != null) {
    if (dRsi >= 60) score += 12; else if (dRsi <= 40) score -= 12;
  }
  if (iRsi != null) {
    if (iRsi >= 60) score += 8; else if (iRsi <= 40) score -= 8;
  }
  if (dMacd.trend === "BULLISH") score += 10; else if (dMacd.trend === "BEARISH") score -= 10;
  if (iMacd.crossover === "BULLISH_CROSS") score += 6; else if (iMacd.crossover === "BEARISH_CROSS") score -= 6;
  if (iVolumeRatio != null) {
    if (iVolumeRatio >= 1.5) score += 8; else if (iVolumeRatio < 0.7) score -= 3;
  }
  if (dPattern.bias === "BULLISH") score += 6; else if (dPattern.bias === "BEARISH") score -= 6;
  if (timeframeAligned) score += dailyTrend === "BULLISH" ? 10 : -10;

  score = Math.max(-100, Math.min(100, score));

  return {
    technicalScore: score,
    confluenceCount,
    confluenceTotal: totalVotes,
    confluenceDirection,
    confluenceRatio,
    timeframeAligned,
    dailyTrend,
    intradayTrend,
    ema9: iEma9,
    ema20: iEma20 ?? dEma20,
    ema50: dEma50,
    dailyEma20: dEma20,
    dailyEma50: dEma50,
    vwap: iVwap,
    rsi: iRsi ?? dRsi,
    dailyRsi: dRsi,
    intradayRsi: iRsi,
    atr: iAtr ?? dAtr,
    dailyAtr: dAtr,
    averageVolume20: iAvgVol20,
    volumeRatio: iVolumeRatio,
    volumeConfirmed: iVolumeRatio != null && iVolumeRatio >= 1.5,
    volumeTrend: iVolTrend.direction,
    emaTrend: intradayTrend !== "NEUTRAL" ? intradayTrend : dailyTrend,
    emaStructure: dEma20 != null && dEma50 != null ? (dEma20 > dEma50 ? "BULLISH" : "BEARISH") : "NEUTRAL",
    vwapTrend: iVwap == null ? "NEUTRAL" : p > iVwap ? "ABOVE_VWAP" : "BELOW_VWAP",
    rsiSignal: (iRsi ?? dRsi) == null ? "NEUTRAL" : (iRsi ?? dRsi) >= 60 ? "BULLISH" : (iRsi ?? dRsi) <= 40 ? "BEARISH" : "NEUTRAL",
    macd: iMacd,
    dailyMacd: dMacd,
    bollinger: dBands,
    candlePattern: iPattern.pattern !== "NONE" ? iPattern : dPattern,
    dailyCandlePattern: dPattern,
    recentHigh20: recentHigh(daily, 20),
    recentLow20: recentLow(daily, 20),
    candleCount: intraday.length,
    dailyCandleCount: daily.length
  };
}

module.exports = {
  ema,
  emaSeries,
  rsi,
  vwap,
  atr,
  macd,
  bollingerBands,
  detectCandlePattern,
  volumeTrend,
  averageVolume,
  normalizeCandles,
  recentHigh,
  recentLow,
  buildTechnical,
  buildMultiTimeframeTechnical
};
