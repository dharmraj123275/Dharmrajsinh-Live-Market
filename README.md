# Dharmrajsinh Live Market V7.5

Mobile-first NSE + BSE equity analysis dashboard using the Upstox API.

## Included

- NSE + BSE equity search
- Live market quote
- Previous-day close
- Average traded price (ATP)
- Market depth and buy/sell percentage
- **Multi-timeframe technical analysis**: daily candles set the structural trend (EMA20/50, MACD, RSI, Bollinger), intraday 1-min candles set live entry timing (EMA9, VWAP, latest volume/pattern)
- EMA 9 / 20 / 50 (daily + intraday)
- VWAP
- RSI (daily + intraday)
- ATR
- MACD (line, signal, histogram, crossover)
- Bollinger Bands (upper/lower/bandwidth/squeeze)
- Candlestick pattern detection (engulfing, hammer, shooting star, doji)
- Volume ratio + multi-candle volume trend (accumulation/distribution)
- Multi-indicator confluence score (how many independent signals agree)
- NIFTY 50 market-breadth filter — downgrades "strong" signals that fight the index trend
- India VIX volatility-adjusted stop-loss/target distance and confidence
- Opening Range Breakout (ORB) detection and score input
- Signal accuracy tracking (trade journal with auto win/loss tracking and win rate)
- Market scanner across the local watchlist
- 52-week high/low
- Weekly timeframe with true 3-timeframe (weekly + daily + intraday) alignment
- Sector relative strength (vs NIFTY sector index)
- Position size calculator (capital + risk % → suggested quantity)
- Technical confirmation
- AI-style score and confidence
- BUY / STRONG BUY / BREAKOUT BUY / WAIT / SELL / STRONG SELL / BREAKDOWN SELL / EXIT
- Entry / Target 1 / Target 2 / Stop Loss
- Support / Resistance / breakout / breakdown levels
- Fundamental profile, key ratios, income, balance sheet, cash flow, shareholding, corporate actions and competitors when returned by Upstox
- News and simple positive/negative impact classification
- Live NIFTY 50, SENSEX, MIDCPNIFTY and INDIA VIX cards
- Auto-retry with backoff on transient Upstox API failures
- Mobile-friendly UI
- Render-ready Express server

## Upstox token

For a long-lived read-only analytics dashboard, use an Upstox Analytics Token when available and put it in Render as:

`UPSTOX_ACCESS_TOKEN`

OAuth login support is also included with:

- `UPSTOX_API_KEY`
- `UPSTOX_API_SECRET`
- `UPSTOX_REDIRECT_URI`

## Render

Build command:

`npm install`

Start command:

`npm start`

Add the required environment variable:

`UPSTOX_ACCESS_TOKEN=YOUR_TOKEN`

Do not put the token inside GitHub source files.

## Important live-data note

The dashboard refreshes quote/analysis requests from the browser every 5 seconds. The server uses short caches so technical/fundamental/news data are not unnecessarily refetched on every tick. This is near-live polling; it is not a direct browser WebSocket tick feed.

The Upstox Market Data Feed V3 is the official streaming option if a true tick-by-tick WebSocket implementation is added later.

## No order execution

This version is an analysis/read-only dashboard. It does not place, modify or cancel orders.



## V7.6.0 additions

- **52-week High/Low**: daily candle fetch extended from 220 to 370 days; a new `fiftyTwoWeekRange()` shows where the stock sits relative to its yearly range.
- **Weekly timeframe / true 3-timeframe alignment**: weekly candles (2 years) now feed a `buildWeeklyTrend()` (weekly EMA20/50, RSI, MACD). A STRONG BUY/SELL is now vetoed if the weekly structural trend directly contradicts the daily/intraday signal, and a new "3-TF Aligned" flag highlights when weekly + daily + intraday all agree — the highest-confidence setup this system can produce.
- **Sector relative strength**: matches the stock's fundamentals sector (Banking, IT, Pharma, Auto, FMCG, Metal, Realty, Energy, Financial Services, Infra, Media) to its NIFTY sector index, and compares 20-day relative performance (OUTPERFORMING / IN_LINE / UNDERPERFORMING). A STRONG BUY is vetoed if the stock is meaningfully lagging a bullish sector; a STRONG SELL is vetoed if it's outperforming a bearish one.
- **Position size calculator**: enter capital and risk % per trade in the analysis view, and it calculates suggested quantity, capital required, and max loss using the live entry/stop-loss levels.
- **Not implemented — Delivery % and FII/DII flow**: verified against Upstox's own developer community that neither is available through their API (delivery data explicitly has no market-quote field; FII/DII is NSE-published, delayed, non-API data). Rather than fake this with unreliable scraping, it was left out — sector relative strength was added instead as a comparable, reliably-sourced signal.

## V7.5.3 fixes and additions

- **Critical fix**: the 4 dashboard index cards (NIFTY 50, SENSEX, MIDCPNIFTY, INDIA VIX) were using the same `ohlc.close`-mirrors-live-price bug that had already been fixed for individual stocks — `analyzeIndex()` now uses the same reliable `price - net_change` calculation, so index Previous Close and % change are now correct.
- **Fixed Circuit Range showing ₹0.00 - ₹0.00**: when Upstox doesn't return circuit-limit data for an instrument, the UI now shows "N/A" instead of a fake zero range.
- **Dashboard simplified**: the 4 index cards now show only symbol, price and change % — Open/High/Low/Prev Close/ATP were removed from the dashboard and are shown only inside the per-stock search/analysis view (added in V7.5.2), per request.
- **New: circuit-limit proximity veto** — a STRONG BUY/SELL (and even a plain BUY/SELL) is no longer issued when price is pinned within 0.5% of its upper/lower circuit limit, since there's little room left to move and the stock can freeze mid-trade.
- **New: data-sufficiency veto** — STRONG BUY/STRONG SELL now require at least 30 daily candles and 20 intraday candles before a strong grade is issued, so a thin/incomplete data sample can no longer produce an overconfident "strong" signal (falls back to a normal BUY/SELL grade instead).

## V7.5.2 additions

- **Open / High / Low / Prev Close now shown for every stock** in a dedicated OHLC bar right under the live price, and Open/High/Low added to the NIFTY/SENSEX/MIDCPNIFTY/VIX index cards too (the data was already returned by the API but wasn't displayed).
- Added **Gap vs Prev Close** (gap-up/gap-down %) — useful for spotting gap-and-go setups at market open.
- Added **Circuit Range** (upper/lower circuit limit) display — helps avoid placing an entry too close to a circuit band.

## V7.5.1 additions

- **Signal accuracy tracking (trade journal)**: every actionable signal (BUY/STRONG BUY/BREAKOUT BUY/SELL/STRONG SELL/BREAKDOWN SELL) is logged once, and a background check every 60s compares the live price against target1/target2/stop-loss to close it out as a win or loss. `/api/journal` returns win rate and history. File-backed (`data/signals-journal.json`), best-effort — never blocks analysis if the disk isn't writable.
- **India VIX-adjusted risk**: stop-loss/target distance now widens automatically when VIX is high (≥18) and tightens when VIX is low (≤11); confidence score also adjusts for volatility regime.
- **Opening Range Breakout (ORB)**: computes the first 15 minutes' high/low of the trading session and flags a confirmed breakout/breakdown as an extra confluence vote and score input.
- **Market scanner**: `/api/scanner` scans the local watchlist (`stocks.json`) with limited concurrency and returns only stocks with a live actionable signal, sorted by AI score. Optional `?symbols=RELIANCE,TCS` to scan a subset.
- **Frontend**: added Scan Market and Signal Journal buttons, a Volatility & Opening Range card, and win-rate/journal history display.

## V7.5 changes

- **Critical fix**: candles are now sorted oldest→newest before any indicator is calculated. Previously the code assumed Upstox always returns candles in chronological order; if the API returns newest-first, every EMA/RSI/VWAP/ATR/support-resistance value would have been calculated on the wrong slice of data.
- Added multi-timeframe engine (`buildMultiTimeframeTechnical`) combining daily structural trend with intraday entry timing, with backward-compatible fallback to the old single-timeframe `buildTechnical` when there isn't enough candle data.
- Added MACD, Bollinger Bands, candlestick pattern detection, and multi-candle volume trend.
- Added confluence scoring: counts how many independent indicators (daily trend, intraday trend, daily/intraday RSI, daily/intraday MACD, volume, patterns) agree, and factors that into the AI score.
- Added a NIFTY 50 market-breadth filter: STRONG BUY/STRONG SELL grades are held back to a normal BUY/SELL when the stock's signal fights the overall index trend.
- Added `BREAKDOWN SELL` as the bearish counterpart to `BREAKOUT BUY` for symmetric, clearer signal naming.
- Added retry-with-backoff (up to 3 attempts) in the Upstox service layer for transient network/5xx errors, so a single slow response doesn't fail the whole analysis.

## V7.4.1 search fix

- Each new search clears the previous selected instrument.
- Older search/live responses cannot overwrite a newly selected stock.
- Search results are ranked by exact symbol/name and deduplicated by instrument key.
- NSE is shown before BSE when both are returned for the same query.
