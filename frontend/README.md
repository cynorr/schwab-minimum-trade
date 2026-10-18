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

One row per symbol. Holdings take precedence over entries, and entries take precedence over observed closures. Active child orders remain available after their parent fills. Additional buys and multiple stops are selected within the row, not merged into a synthetic order. The order selector uses B / S / O for Buy / Stop / Other.

Uncovered sell orders remain visible with quantity zero and a coverage warning. A missing ID never exposes cancel/replace; replacement eligibility matches the existing backend contract.

The balance strip shows Net Liq, Available Funds, Cash Balance, Margin Balance, Intraday BP, Stock BP and Long Value. Hover over each value to see its native Schwab source path. Values are neutral, negative amounts use a minus sign, and missing fields remain `—`. Intraday BP uses `intraday_buying_power`, not the legacy `day_trading_buying_power`; Stock BP uses `stock_buying_power`, not a calculated multiple of available funds. Cash Balance and Margin Balance stay separate.

`Closed today · Session only` contains observed SELL fill events for the New York date, shown only after the position is flat and there are no remaining active orders. Historical creation dates are not execution dates. Closing/reloading the page loses session-only observations. No execution price or realized P/L is invented.

Remaining backend data requests are recorded in [BACKEND-REQUIREMENTS.md](BACKEND-REQUIREMENTS.md). The balance mappings are implemented in the backend; the other requests are unchanged.
