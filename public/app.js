// ============================================================
// DHARMRAJSINH LIVE MARKET V7.4.1 - FRONTEND
// ============================================================

let selected = null;
let liveTimer = null;
let statusTimer = null;
let indexTimer = null;
let liveBusy = false;

// Search/live request guards prevent an older response from replacing
// the stock that the user has just selected.
let searchRequestId = 0;
let liveRequestId = 0;
let searchController = null;
let liveController = null;

window.searchResults = [];

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function formatNumber(value, digits = 2) {
  const n = Number(value);
  if (!Number.isFinite(n)) return "—";
  return n.toLocaleString("en-IN", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits
  });
}

function formatCompact(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return "—";
  if (Math.abs(n) >= 10000000) return `${(n / 10000000).toFixed(2)} Cr`;
  if (Math.abs(n) >= 100000) return `${(n / 100000).toFixed(2)} L`;
  if (Math.abs(n) >= 1000) return `${(n / 1000).toFixed(2)} K`;
  return formatNumber(n, 0);
}

function signalClass(signal) {
  if (signal === "EXIT") return "exit";
  if (signal.includes("BUY")) return "buy";
  if (signal.includes("SELL")) return "sell";
  return "hold";
}

function changeClass(value) {
  const n = Number(value);
  return n > 0 ? "positive" : n < 0 ? "negative" : "neutral";
}

async function fetchJson(url, options = {}) {
  const response = await fetch(url, {
    cache: "no-store",
    ...options
  });

  const contentType = response.headers.get("content-type") || "";
  const data = contentType.includes("application/json")
    ? await response.json()
    : { message: await response.text() };

  if (!response.ok) {
    const err = new Error(data.message || `HTTP ${response.status}`);
    err.status = response.status;
    err.data = data;
    throw err;
  }
  return data;
}

// ============================================================
// MARKET STATUS
// ============================================================

async function loadMarketStatus() {
  try {
    const data = await fetchJson("/api/status");
    document.getElementById("marketStatus").textContent = data.market || "UNKNOWN";
    document.getElementById("lastUpdate").textContent = `${data.date || ""} ${data.time || ""}`;
    const live = String(data.market || "").toUpperCase().includes("LIVE");
    document.getElementById("liveDot").style.color = live ? "#22c55e" : "#ef4444";
  } catch (error) {
    document.getElementById("marketStatus").textContent = "⚠ Status unavailable";
  }
}

// ============================================================
// INDEXES
// ============================================================

async function loadIndexes() {
  const box = document.getElementById("indexes");
  try {
    const data = await fetchJson("/api/indexes");
    box.innerHTML = data.indexes.map(item => `
      <div class="index-card">
        <h3>${escapeHtml(item.symbol)}</h3>
        <div class="index-price">₹${formatNumber(item.price)}</div>
        <div class="index-change ${changeClass(item.change)}">
          ${item.change >= 0 ? "+" : ""}${formatNumber(item.change)}
          (${item.changePercent >= 0 ? "+" : ""}${formatNumber(item.changePercent)}%)
        </div>
        <div class="index-meta">Prev close ₹${formatNumber(item.previousClose)} • ATP ₹${formatNumber(item.averageTradePrice)}</div>
      </div>
    `).join("");
    document.getElementById("indexUpdated").textContent = new Date().toLocaleTimeString("en-IN");
  } catch (error) {
    box.innerHTML = `<div class="loading-card">⚠ ${escapeHtml(error.message)}</div>`;
  }
}

// ============================================================
// SEARCH
// ============================================================

async function searchStock() {
  const input = document.getElementById("search");
  const button = document.getElementById("searchButton");
  const query = input.value.trim();

  if (!query) {
    input.focus();
    return;
  }

  // IMPORTANT: every new search is a new session.
  // Stop the previous stock's refresh and invalidate old responses.
  stopLiveTimer();
  selected = null;
  liveBusy = false;
  liveRequestId++;
  window.searchResults = [];

  if (searchController) {
    try { searchController.abort(); } catch (_) {}
  }
  searchController = new AbortController();

  const requestId = ++searchRequestId;
  const result = document.getElementById("result");

  if (button) button.disabled = true;
  result.innerHTML = `
    <div class="loading-card">
      🔎 Searching NSE + BSE for <strong>${escapeHtml(query)}</strong>...
    </div>
  `;

  try {
    const data = await fetchJson(
      `/api/search?q=${encodeURIComponent(query)}&_=${Date.now()}`,
      { signal: searchController.signal }
    );

    // Ignore a response belonging to an older search.
    if (requestId !== searchRequestId) return;

    const results = Array.isArray(data.results) ? data.results : [];
    window.searchResults = results;

    if (!results.length) {
      result.innerHTML = `
        <div class="error-card">
          ❌ No NSE/BSE equity instrument found for
          <strong>${escapeHtml(query)}</strong>.
        </div>
      `;
      return;
    }

    result.innerHTML = `
      <div class="search-results">
        <h3>🔎 Select Exchange / Stock</h3>
        ${results.map((item, index) => `
          <div class="stock-result">
            <div>
              <strong>${escapeHtml(item.symbol)}</strong>
              <span class="badge">${escapeHtml(item.exchange || "EQ")}</span>
              <div>${escapeHtml(item.name)}</div>
              <small>
                ${escapeHtml(item.segment || "EQ")}
                ${item.isin ? ` • ${escapeHtml(item.isin)}` : ""}
              </small>
            </div>
            <button class="analyze-btn" onclick="selectStock(${index})">
              📊 Analyze
            </button>
          </div>
        `).join("")}
      </div>
    `;
  } catch (error) {
    if (error.name === "AbortError") return;
    if (requestId !== searchRequestId) return;

    result.innerHTML = `
      <div class="error-card">
        ⚠ Search error: ${escapeHtml(error.message)}
      </div>
    `;
  } finally {
    if (requestId === searchRequestId && button) {
      button.disabled = false;
    }
  }
}

function selectStock(index) {
  const item = window.searchResults[index];

  if (!item?.instrument) {
    document.getElementById("result").innerHTML = `
      <div class="error-card">❌ Selected stock instrument is unavailable.</div>
    `;
    return;
  }

  // Create a fresh object so a later search cannot mutate the active stock.
  selected = {
    symbol: item.symbol || "",
    name: item.name || item.symbol || "",
    exchange: item.exchange || "",
    segment: item.segment || "EQ",
    instrument: item.instrument,
    isin: item.isin || "",
    source: item.source || ""
  };

  stopLiveTimer();

  // Cancel an older live request and invalidate its response.
  liveRequestId++;
  if (liveController) {
    try { liveController.abort(); } catch (_) {}
  }

  loadLiveAnalysis();
  liveTimer = setInterval(loadLiveAnalysis, 5000);
}

// ============================================================
// LIVE ANALYSIS
// ============================================================

async function loadLiveAnalysis() {
  if (!selected || liveBusy) return;

  const activeInstrument = selected.instrument;
  const activeSymbol = selected.symbol;
  const requestId = ++liveRequestId;

  liveBusy = true;

  if (liveController) {
    try { liveController.abort(); } catch (_) {}
  }
  liveController = new AbortController();

  const result = document.getElementById("result");

  if (!document.querySelector(".analysis-card")) {
    result.innerHTML = `
      <div class="loading-card">
        📡 Loading live analysis for
        <strong>${escapeHtml(activeSymbol)}</strong>...
      </div>
    `;
  }

  try {
    const params = new URLSearchParams({
      instrument: activeInstrument,
      symbol: activeSymbol || "",
      name: selected.name || activeSymbol || "",
      exchange: selected.exchange || ""
    });

    const response = await fetchJson(
      `/api/live?${params.toString()}&_=${Date.now()}`,
      { signal: liveController.signal }
    );

    // Never allow a late response for RELIANCE to overwrite TCS/INFY/etc.
    if (
      requestId !== liveRequestId ||
      !selected ||
      selected.instrument !== activeInstrument
    ) {
      return;
    }

    renderAnalysis(response.data);
  } catch (error) {
    if (error.name === "AbortError") return;

    if (
      requestId !== liveRequestId ||
      !selected ||
      selected.instrument !== activeInstrument
    ) {
      return;
    }

    if (error.status === 401) {
      result.innerHTML = `
        <div class="error-card">
          🔐 Upstox token expired/missing. Set
          <strong>UPSTOX_ACCESS_TOKEN</strong> on Render or use
          <a href="/login">Upstox Login</a>.
        </div>
      `;
    } else {
      const existing = document.querySelector(".analysis-card");
      if (!existing) {
        result.innerHTML = `
          <div class="error-card">
            ⚠ Live analysis error: ${escapeHtml(error.message)}
          </div>
        `;
      }
    }
  } finally {
    if (requestId === liveRequestId) {
      liveBusy = false;
    }
  }
}

function metric(title, value) {
  return `<div class="metric"><span>${escapeHtml(title)}</span><strong>${escapeHtml(String(value))}</strong></div>`;
}

function level(title, value) {
  return `<div class="level"><span>${escapeHtml(title)}</span><strong>₹${formatNumber(value)}</strong></div>`;
}

function renderAnalysis(data) {
  const result = document.getElementById("result");
  const signal = data.signal || "WAIT";
  const depth = data.marketDepth || {};
  const tech = data.technicalConfirmation || {};
  const fundamentals = data.fundamentals || {};
  const news = data.news || {};

  const newsItems = Array.isArray(news.items) ? news.items : [];
  const newsHtml = newsItems.length
    ? newsItems.map(item => `
      <div class="news-item">
        <a href="${escapeHtml(item.articleLink || "#")}" target="_blank" rel="noopener noreferrer">
          ${escapeHtml(item.heading || "News")}
        </a>
        <span class="impact ${escapeHtml(item.impact || "NEUTRAL")}">${escapeHtml(item.impact || "NEUTRAL")}</span>
        <p>${escapeHtml(item.summary || "")}</p>
      </div>
    `).join("")
    : `<div class="reason">No recent instrument news available.</div>`;

  const ratioEntries = Object.entries(fundamentals.ratios || {}).slice(0, 6);
  const ratioHtml = ratioEntries.length
    ? ratioEntries.map(([key, value]) => metric(key, `${value.company ?? "—"} / Sector ${value.sector ?? "—"}`)).join("")
    : metric("Fundamental Score", fundamentals.available ? `${fundamentals.score}/100` : "Unavailable");

  result.innerHTML = `
    <div class="analysis-card">
      <div class="analysis-top">
        <div class="analysis-title">
          <div>
            <h2>${escapeHtml(data.symbol || selected?.symbol || "")}</h2>
            <p>${escapeHtml(data.name || selected?.name || "")} • ${escapeHtml(data.exchange || selected?.exchange || "")}</p>
          </div>
          <div class="signal ${signalClass(signal)}">${escapeHtml(signal)}</div>
        </div>
        <div class="price-row">
          <div>
            <div class="price">₹${formatNumber(data.price)}</div>
            <div class="${changeClass(data.netChange)} price-sub">
              ${data.netChange >= 0 ? "+" : ""}${formatNumber(data.netChange)}
              (${data.changePercent >= 0 ? "+" : ""}${formatNumber(data.changePercent)}%)
            </div>
          </div>
          <div class="live-label">● LIVE ANALYSIS</div>
        </div>
      </div>

      <div class="grid">
        ${metric("AI Score", `${formatNumber(data.aiScore)}/100`)}
        ${metric("Trend", data.trend)}
        ${metric("Confidence", `${formatNumber(data.confidence)}%`)}
        ${metric("Trade Quality", data.tradeQuality)}
        ${metric("Previous Close", `₹${formatNumber(data.previousClose)}`)}
        ${metric("Average Trade Price", `₹${formatNumber(data.averageTradePrice)}`)}
        ${metric("Volume", formatCompact(data.volume))}
        ${metric("OI", formatCompact(data.oi))}
      </div>

      <div class="section-card">
        <h3>🎯 Live Trading Levels</h3>
        <div class="levels-grid">
          ${level("Entry", data.entry)}
          ${level("Target 1", data.target1)}
          ${level("Target 2", data.target2)}
          ${level("Stop Loss", data.stopLoss)}
          ${level("Support", data.support)}
          ${level("Resistance", data.resistance)}
        </div>
        <div class="small-row" style="margin-top:8px">
          <span>RR T1: 1 : ${formatNumber(data.riskRewardTarget1)}</span>
          <span>RR T2: 1 : ${formatNumber(data.riskRewardTarget2)}</span>
        </div>
      </div>

      <div class="section-card">
        <h3>📊 Market Depth</h3>
        <div class="depth-grid">
          <div class="depth-box"><span>🟢 Buy Qty</span><strong>${formatCompact(depth.buyQuantity)}</strong></div>
          <div class="depth-box"><span>🔴 Sell Qty</span><strong>${formatCompact(depth.sellQuantity)}</strong></div>
        </div>
        <div class="depth-bars">
          <div class="buy-bar" style="width:${Math.max(0, Math.min(100, Number(depth.buyPercent || 0)))}%"></div>
          <div class="sell-bar" style="width:${Math.max(0, Math.min(100, Number(depth.sellPercent || 0)))}%"></div>
        </div>
        <div class="small-row"><span>Buy ${formatNumber(depth.buyPercent)}%</span><span>${escapeHtml(depth.trend || "NEUTRAL")}</span><span>Sell ${formatNumber(depth.sellPercent)}%</span></div>
      </div>

      <div class="section-card">
        <h3>🧠 Technical Confirmation</h3>
        <div class="tech-grid">
          ${metric("Technical Score", `${tech.technicalScore >= 0 ? "+" : ""}${formatNumber(tech.technicalScore)}`)}
          ${metric("EMA Trend", tech.emaTrend || "NEUTRAL")}
          ${metric("VWAP", tech.vwapTrend || "NEUTRAL")}
          ${metric("RSI", tech.rsiSignal || "NEUTRAL")}
          ${metric("Volume Confirmed", tech.volumeConfirmed ? "YES" : "NO")}
          ${metric("Volume Ratio", tech.volumeRatio == null ? "N/A" : `${formatNumber(tech.volumeRatio)}x`)}
          ${metric("Buyers Confirmed", tech.buyersConfirmed ? "YES" : "NO")}
          ${metric("Sellers Confirmed", tech.sellersConfirmed ? "YES" : "NO")}
          ${metric("EMA 20", `₹${formatNumber(data.technical?.ema20)}`)}
          ${metric("EMA 50", `₹${formatNumber(data.technical?.ema50)}`)}
          ${metric("VWAP", `₹${formatNumber(data.technical?.vwap)}`)}
          ${metric("RSI Value", formatNumber(data.technical?.rsi))}
        </div>
        <div class="reason" style="margin-top:10px"><strong>⚡ ${escapeHtml(tech.confirmationStatus || "WAITING FOR CONFIRMATION")}</strong></div>
      </div>

      <div class="section-card">
        <h3>🏢 Fundamental Analysis</h3>
        <div class="two-col">
          ${metric("Fundamental Score", fundamentals.available ? `${formatNumber(fundamentals.score)}/100` : "Unavailable")}
          ${metric("Rating", fundamentals.rating || "UNAVAILABLE")}
          ${metric("Sector", fundamentals.sector || "—")}
          ${metric("ISIN", fundamentals.isin || selected?.isin || "—")}
        </div>
        <div class="grid" style="padding:10px 0 0">${ratioHtml}</div>
        ${fundamentals.highlights?.length ? `<div class="reason">${escapeHtml(fundamentals.highlights.join(" • "))}</div>` : ""}
      </div>

      <div class="section-card">
        <h3>📰 News & Market Impact</h3>
        <div class="small-row" style="margin-bottom:10px">
          <span>Impact: <strong>${escapeHtml(news.impact || "UNAVAILABLE")}</strong></span>
          <span>${formatNumber(news.count || 0, 0)} recent articles</span>
        </div>
        ${newsHtml}
      </div>

      <div class="section-card">
        <h3>📌 Signal Reason</h3>
        <div class="reason">${escapeHtml(data.reason || "No reason available")}</div>
      </div>

      <div class="instrument">
        Instrument: <code>${escapeHtml(data.instrument || selected?.instrument || "")}</code><br>
        Last analysis: ${escapeHtml(new Date(data.dataFreshness?.analysisGeneratedAt || Date.now()).toLocaleTimeString("en-IN"))}
      </div>
    </div>
  `;
}

// ============================================================
// ENTER KEY
// ============================================================

document.getElementById("search")?.addEventListener("keydown", event => {
  if (event.key === "Enter") {
    event.preventDefault();
    searchStock();
  }
});

function stopLiveTimer() {
  if (liveTimer) clearInterval(liveTimer);
  liveTimer = null;
}

// ============================================================
// INIT
// ============================================================

loadMarketStatus();
loadIndexes();
statusTimer = setInterval(loadMarketStatus, 15000);
indexTimer = setInterval(loadIndexes, 5000);
