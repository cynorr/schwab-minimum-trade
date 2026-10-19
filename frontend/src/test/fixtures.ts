import type { Account, Health, OrderItem, Position, Quote } from '../api'

export const now = '2026-10-15T19:00:00Z'
export const account: Account = {
  liquidation_value: '125000', buying_power: '54000', day_trading_buying_power: '75000',
  long_market_value: '86000', margin_balance: '15000', updated_at: now,
}
export const health: Health = {
  service: 'running', auth_status: 'valid', schwab_rest: 'connected', schwab_stream: 'connected',
  account_initialized: true, orders_initialized: true, last_account_update: now, last_orders_update: now,
}
export const position: Position = {
  symbol: 'NVDA', asset_type: 'EQUITY', quantity: '100.5', average_price: '135.00',
  market_value: '14050', day_profit_loss: '210', day_profit_loss_percent: '1.5',
  open_profit_loss: '482.50',
}
export const quote: Quote = {
  symbol: 'NVDA', bid: '140.20', ask: '140.22', day_low: '136.20', day_high: '140.50',
  suggested_buy_stop: '140.51', suggested_sell_stop: '136.20', updated_at: now,
  last_price: '140.21', close_price: '138',
}
export function order(overrides: Partial<OrderItem> = {}): OrderItem {
  return {
    order_id: '102', parent_order_id: null, symbol: 'NVDA', instruction: 'SELL', order_type: 'STOP',
    strategy_type: 'SINGLE', quantity: '100', filled_quantity: '0', stop_price: '136.20',
    duration: 'GOOD_TILL_CANCEL', session: 'NORMAL', status: 'WORKING', cancelable: true,
    entered_at: now, executions: [], child_orders: [], ...overrides,
  }
}
