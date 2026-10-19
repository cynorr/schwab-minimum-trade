export const API_BASE = 'http://127.0.0.1:5678/api/v1'
export type Decimal = string | null

export interface Account {
  liquidation_value: Decimal
  buying_power: Decimal
  stock_buying_power?: Decimal
  intraday_buying_power?: Decimal
  day_trading_buying_power: Decimal
  cash_balance?: Decimal
  long_market_value: Decimal
  margin_balance: Decimal
  available_funds?: Decimal
  updated_at: string | null
}

export interface Position {
  symbol: string
  asset_type: string
  quantity: Decimal
  average_price: Decimal
  market_value: Decimal
  day_profit_loss: Decimal
  open_profit_loss: Decimal
  day_profit_loss_percent: Decimal
}

export interface Execution {
  activity_id: string
  leg_id: string
  quantity: Decimal
  price: Decimal
  time: string
}

export interface OrderItem {
  order_id: string | null
  parent_order_id: string | null
  symbol: string | null
  instruction: string | null
  order_type: string | null
  strategy_type: string | null
  quantity: Decimal
  filled_quantity: Decimal
  stop_price: Decimal
  duration: string | null
  session: string | null
  status: string | null
  cancelable: boolean | null
  entered_at: string | null
  executions: Execution[]
  child_orders: OrderItem[]
}

export interface Quote {
  symbol: string
  bid: Decimal
  ask: Decimal
  day_high: Decimal
  day_low: Decimal
  last_price: Decimal
  close_price: Decimal
  suggested_buy_stop: Decimal
  suggested_sell_stop: Decimal
  updated_at: string
}

export type QuoteUpdate = Pick<Quote, 'symbol' | 'bid' | 'ask' | 'updated_at'>
export interface FillEvent {
  symbol: string | null
  order_id: string
  occurred_at: string
}
export interface Snapshot {
  account: Account | null
  positions: Position[]
  orders: OrderItem[]
  updated_at: string | null
}

export interface Health {
  service: string
  auth_status: string
  schwab_rest: string
  schwab_stream: string
  account_initialized: boolean
  orders_initialized: boolean
  last_account_update: string | null
  last_orders_update: string | null
}

export interface WriteResult {
  result: string
  order_id?: string
  verified: boolean
}

interface ErrorBody {
  result?: string
  error?: { code?: string; message?: string; details?: unknown }
}

export class ApiError extends Error {
  constructor(
    message: string,
    readonly code = 'REQUEST_FAILED',
    readonly status = 0,
    readonly details?: unknown,
    readonly unknownResult = code === 'ORDER_RESULT_UNKNOWN',
  ) {
    super(message)
    this.name = 'ApiError'
  }
}

// Broker errors may be strings, arrays, or structured ServiceError objects.
function brokerText(value: unknown): string {
  if (typeof value === 'string') return value
  if (Array.isArray(value)) return value.map(brokerText).filter(Boolean).join('; ')
  if (value && typeof value === 'object') {
    const object = value as Record<string, unknown>
    return [object.message, object.errors].map(brokerText).filter(Boolean).join('; ')
  }
  return ''
}

export function asApiError(error: unknown): ApiError {
  return error instanceof ApiError ? error : new ApiError('Request failed. Please try again.')
}

const ERROR_LABELS: Record<string, string> = {
  AUTH_REQUIRED: 'Schwab authorization required. Run the backend auth command.',
  SCHWAB_UNAVAILABLE: 'Schwab is temporarily unavailable.',
  SCHWAB_REJECTED: 'Schwab rejected the request.',
  ORDER_CONFLICT: 'Order conflict. Check the current order and try again.',
  RISK_LIMIT_EXCEEDED: 'Order exceeds a backend risk limit.',
  VALIDATION_FAILED: 'Invalid order parameters.',
  ORDER_RESULT_UNKNOWN: 'Order result unknown. Check Schwab before submitting again.',
  NETWORK_ERROR: 'Cannot connect to the local backend.',
  NOT_FOUND: 'The requested symbol or order was not found.',
  BAD_REQUEST: 'The backend could not accept this request.',
}

export function errorMessage(error: ApiError): string {
  const details = error.details as { broker_error?: unknown } | undefined
  const broker = brokerText(details?.broker_error)
  const english = /[\u3400-\u9fff]/.test(error.message)
    ? ERROR_LABELS[error.code] ?? 'Request failed. Check the order in Schwab.' : error.message
  return broker && !/[\u3400-\u9fff]/.test(broker) ? `${english} · ${broker}` : english
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const writing = !!init?.method && init.method !== 'GET'
  const controller = new AbortController()
  const timeout = window.setTimeout(() => controller.abort(), 20_000)
  try {
    const response = await fetch(`${API_BASE}${path}`, {
      ...init,
      signal: controller.signal,
      ...(init?.body ? { headers: { 'Content-Type': 'application/json' } } : {}),
    })
    const body: unknown = await response.json().catch(() => null)
    if (!response.ok) {
      const failure = body as ErrorBody | null
      throw new ApiError(
        failure?.error?.message ?? `Request failed (HTTP ${response.status}).`,
        failure?.error?.code ?? 'REQUEST_FAILED',
        response.status,
        failure?.error?.details,
        failure?.result === 'unknown' || failure?.error?.code === 'ORDER_RESULT_UNKNOWN',
      )
    }
    if (body === null) {
      throw new ApiError(
        writing ? 'Order response unknown. Check Schwab.' : 'Invalid response from the backend.',
        writing ? 'ORDER_RESULT_UNKNOWN' : 'INVALID_RESPONSE',
      )
    }
    return body as T
  } catch (error) {
    if (error instanceof ApiError) throw error
    // A disconnected browser cannot know whether a write reached the broker.
    // Never retry writes, including requests interrupted by a timeout or sleep.
    throw new ApiError(
      writing ? 'Order result unknown. Check Schwab before submitting again.' : 'Cannot connect to the local backend.',
      writing ? 'ORDER_RESULT_UNKNOWN' : 'NETWORK_ERROR',
    )
  } finally {
    window.clearTimeout(timeout)
  }
}

export type Ticket =
  | { mode: 'breakout'; symbol: string; qty: number; buy_stop: string; sell_stop: string }
  | { mode: 'market'; side: 'buy' | 'sell'; symbol: string; qty: number }

export const api = {
  health: () => request<Health>('/health'),
  account: () => request<Account>('/account'),
  positions: () => request<{ positions: Position[]; updated_at: string }>('/positions'),
  orders: (refresh = false) =>
    request<{ orders: OrderItem[]; updated_at: string }>(`/orders${refresh ? '?refresh=true' : ''}`),
  quote: (symbol: string, refresh = false) =>
    request<Quote>(`/quotes/${encodeURIComponent(symbol)}${refresh ? '?refresh=true' : ''}`),
  submit: (ticket: Ticket) => {
    if (ticket.mode === 'breakout') {
      const { symbol, qty, buy_stop, sell_stop } = ticket
      return request<WriteResult>('/orders/breakout-buy', {
        method: 'POST', body: JSON.stringify({ symbol, qty, buy_stop, sell_stop }),
      })
    }
    return request<WriteResult>(`/orders/market-${ticket.side}`, {
      method: 'POST', body: JSON.stringify({ symbol: ticket.symbol, qty: ticket.qty }),
    })
  },
  replaceStop: (id: string, price: string) => request<WriteResult>(`/orders/${encodeURIComponent(id)}/stop`, {
    method: 'PUT', body: JSON.stringify({ new_stop: price }),
  }),
  cancel: (id: string) => request<WriteResult>(`/orders/${encodeURIComponent(id)}`, { method: 'DELETE' }),
}
