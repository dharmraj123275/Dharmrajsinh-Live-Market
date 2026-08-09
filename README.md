# Dharmrajsinh Live Market V7.4

Mobile-first NSE + BSE equity analysis dashboard using the Upstox API.

## Included

- NSE + BSE equity search
- Live market quote
- Previous-day close
- Average traded price (ATP)
- Market depth and buy/sell percentage
- EMA 9 / 20 / 50
- VWAP
- RSI
- ATR
- Volume ratio
- Technical confirmation
- AI-style score and confidence
- BUY / STRONG BUY / BREAKOUT BUY / WAIT / SELL / STRONG SELL / EXIT
- Entry / Target 1 / Target 2 / Stop Loss
- Support / Resistance / breakout / breakdown levels
- Fundamental profile, key ratios, income, balance sheet, cash flow, shareholding, corporate actions and competitors when returned by Upstox
- News and simple positive/negative impact classification
- Live NIFTY 50, SENSEX, MIDCPNIFTY and INDIA VIX cards
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
