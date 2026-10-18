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

- Quotes are requested only by entering a symbol, pressing the quote refresh button, or selecting a portfolio symbol. Typing, timers, tab visibility changes and SSE reconnection never request quotes.
- High and Low are from the last manually requested quote; Range is `(High - Low) / Low`. Bid/Ask continue to update over SSE. Same-symbol refresh preserves edited prices and quantities.
- Quantity units: below $20 → 1,000; $20–300 → 100; above $300 → 10. A new symbol starts with one unit; selecting a holding uses its whole-share quantity instead. Unit buttons change ruler resolution without overwriting an existing quantity.
- Drag a ruler left to increase, right to decrease. Each minor quantity tick is half a unit. Arrow keys move one minor tick; Shift + arrow moves one unit. Direct inputs accept exact values, including quantities between ticks. Vertical touch scrolling and plain mouse-wheel scrolling do not change values.
- Buy and Stop ruler precision follows the daily range, with a fine option when the automatic increment is larger than the minimum. Decimal increments preserve the original price precision. The ruler can be dragged repeatedly in either direction; the visible window follows the selected value.
- Review freezes the submitted parameters and the market-order reference amount. Confirm submits once. Stop replacements and cancellations are direct, scoped to the selected real order ID.
- Existing backend limits remain $20,000 per buy, $500 estimated breakout risk, and 10% stop distance. These checks are front-end previews; broker/backend validation remains authoritative. Large market sells and stop replacements are not subject to the buy cap.

## Unified portfolio

One row per symbol. Holdings take precedence over entries. Sold Today is independent of both. Active child orders remain available after their parent fills. Additional buys and multiple stops are selected within the row, not merged into a synthetic order. The order selector uses B / S / O for Buy / Stop / Other.

Uncovered sell orders remain visible with quantity zero and a coverage warning. A missing ID never exposes cancel/replace; replacement eligibility matches the existing backend contract.

The balance strip shows Net Liq, Stock BP, Intraday BP, Available Dollars and Balance, in that order. Balance is the frontend sum of `cash_balance` and `margin_balance`; its tooltip retains both original values. If either component is missing, Balance remains `—`. Other values are shown directly from their corresponding backend fields. Hover to see the source. Values are neutral and negative amounts use a minus sign. Intraday BP uses `intraday_buying_power`, not the legacy `day_trading_buying_power`; Stock BP uses `stock_buying_power`, not a calculated multiple of available funds.

Long Value is the last row of Holdings and uses the broker's `long_market_value` directly. It is not reconstructed from rounded displayed position values.

Sold Today is reconstructed from the full order snapshot, including OTO children. It selects fully filled equity SELL orders whose latest execution is on today's `America/New_York` date. Each symbol shows sold quantity, weighted average price, gross proceeds before fees and the last fill time in ET. Expand a row to inspect quantity, price, time, order ID, activity ID and leg ID. Identical execution rows are preserved; only duplicate orders are deduplicated by order ID.

Selling part of a holding or buying back the same symbol does not hide its sales. Reloads and reconnects restore the list from existing GET/SSE snapshots. `order_filled` remains a temporary notification, with no history cache. No realized P/L is calculated. The agreed scope assumes orders fill completely within seconds, excludes cross-day fills and partially filled cancelled orders, and keeps stop orders within the existing 59-day creation-date query window.

The existing order interfaces now include `executions: [{activity_id, leg_id, quantity, price, time}]`. Prices and quantities are decimal strings, IDs are strings and times are UTC ISO 8601. No new endpoint, transaction query or polling task is added. Restart the backend to load the extended order mapping.

Remaining backend data requests are recorded in [BACKEND-REQUIREMENTS.md](BACKEND-REQUIREMENTS.md). The balance mappings are implemented in the backend; Sold Today fields are also implemented.
