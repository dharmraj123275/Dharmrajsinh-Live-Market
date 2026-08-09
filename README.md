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
