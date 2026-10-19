# Schwab Local frontend

React 19 + TypeScript + Vite + Tailwind CSS v4. Optimized for a 640–800px half-screen window, with a fixed trade area and a scrolling, single-line portfolio.

```bash
npm ci
npm run dev
```

Open `http://127.0.0.1:3000`. The backend stays at `http://127.0.0.1:5678/api/v1`. Both development and preview use strict port 3000.

```bash
npm test
npm run build
npm run preview
```

Stop the development server before using production preview on the same port. Tests use mock fetch and SSE only; they never submit broker transactions.

## Controls

- Press `/` to focus and clear symbol search. Review/submission keeps its existing input lock.
- Quotes are requested only by entering a symbol, pressing the quote refresh button, or selecting a portfolio symbol. Typing, timers, tab visibility changes and SSE reconnection never request quotes.
- High and Low are from the last manually requested quote; Range is `(High - Low) / Low`. Bid/Ask continue to update over SSE. Same-symbol refresh preserves edited prices and quantities.
- Quantity units: below $20 → 1,000; $20–300 → 100; above $300 → 10. A new symbol starts with one unit; selecting a holding uses its whole-share quantity instead. Unit buttons change ruler resolution without overwriting an existing quantity.
- Ruler scales stay fixed while the native range thumb moves. Click the scale or drag right to increase, left to decrease. Each minor quantity tick is half a unit. Arrow keys move one tick; Shift + arrow moves two; Home/End select the scale bounds. Direct inputs accept exact values and reframe the scale only when outside its bounds.
- Buy and Stop ruler precision follows the daily range, with a fine option when the automatic increment is larger than the minimum. Decimal increments preserve the original price precision. Changing precision changes the scale; dragging does not pan or recenter it.
- Review freezes the submitted parameters and the market-order reference amount. Confirm submits once. Stop replacements and cancellations are direct, scoped to the selected real order ID.
- Existing backend limits remain $20,000 per buy, $500 estimated breakout risk, and 10% stop distance. These checks are front-end previews; broker/backend validation remains authoritative. Large market sells and stop replacements are not subject to the buy cap.

## Unified portfolio

One row per symbol. Holdings take precedence over entries. Sold Today is independent of both. Active child orders remain available after their parent fills. All active buys and stops are visible inline. Each control remains bound to its own real order ID, which is not displayed in the trading row. Quantity is shown once in the order label and price once in its input. Awaiting-parent/activation states remain explicit and read-only; they are not Working orders.

Uncovered sell orders remain visible with quantity zero and a coverage warning. A missing ID never exposes cancel/replace; replacement eligibility matches the existing backend contract.

The balance strip shows Net Liq, Stock BP, Intraday BP, Available Dollars and Balance, in that order. Balance is the frontend sum of `cash_balance` and `margin_balance`; its tooltip retains both original values. If either component is missing, Balance remains `—`. Other values are shown directly from their corresponding backend fields. Hover to see the source. Values are neutral and negative amounts use a minus sign. The strip displays integer portions (truncated toward zero); original API precision is unchanged. Intraday BP uses `intraday_buying_power`, not the legacy `day_trading_buying_power`; Stock BP uses `stock_buying_power`, not a calculated multiple of available funds.

Long Value is the last row of Holdings and uses the broker's `long_market_value` directly. It is not reconstructed from rounded displayed position values. Its integer value aligns with the Value column, including horizontally scrolling narrow windows.

Buy/Stop defaults use High + the configured offset / Low during New York weekday 09:30–16:00 when the corresponding High/Low is positive. Otherwise each side falls back to Ask/Bid, last trade, then previous close. Missing or zero prices remain blank (`—`). Fallback sources are shown inline. These are reference defaults; existing order validation remains unchanged and may require adjusting them before sending. Same-symbol refresh/SSE does not overwrite edits; reset explicitly reapplies defaults. This maps fields already in the existing `fields=quote` response, with no extra data group, endpoint or request. The clock check does not provide a full exchange calendar, including early-close schedules.

Holdings shows native `open_profit_loss` (`longOpenProfitLoss`) and daily P/L/percentage, on two lines. Open P/L percentage is calculated as `open_profit_loss / (average_price × quantity) × 100`; unavailable components stay `—`. No historical order join or tax-lot reconstruction is used.

Sold Today is reconstructed from the full order snapshot, including OTO children. It selects fully filled equity SELL orders whose latest execution is on today's `America/New_York` date. Each symbol shows sold quantity, weighted average price, gross proceeds before fees and the last fill time in ET. Expand a row to inspect quantity, price, time, order ID, activity ID and leg ID. Identical execution rows are preserved; only duplicate orders are deduplicated by order ID.

Selling part of a holding or buying back the same symbol does not hide its sales. Reloads and reconnects restore the list from existing GET/SSE snapshots. `order_filled` remains a temporary notification, with no history cache. No realized P/L is calculated. The agreed scope assumes orders fill completely within seconds, excludes cross-day fills and partially filled cancelled orders, and keeps stop orders within the existing 59-day creation-date query window.

The existing order interfaces now include `executions: [{activity_id, leg_id, quantity, price, time}]`. Prices and quantities are decimal strings, IDs are strings and times are UTC ISO 8601. No new endpoint, transaction query or polling task is added. Restart the backend to load the extended order mapping.

Remaining backend data requests are recorded in [BACKEND-REQUIREMENTS.md](BACKEND-REQUIREMENTS.md). The balance mappings are implemented in the backend; Sold Today fields are also implemented.
