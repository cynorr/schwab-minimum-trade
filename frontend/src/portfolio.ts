import type { FillEvent, OrderItem, Position } from './api'
import { number } from './format'
import { ACTIVE_STATUSES, flattenOrders } from './orders'

export interface ClosedSymbol {
  symbol: string
  quantity: number | null
  occurredAt: string
}
export interface SymbolRow {
  symbol: string
  position: Position | null
  entries: OrderItem[]
  stops: OrderItem[]
  other: OrderItem[]
  closed: ClosedSymbol | null
}

export function tradingDay(value: string | Date = new Date()): string {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(date)
}

export function observedClosures(orders: OrderItem[], fills: FillEvent[], day = tradingDay()): ClosedSymbol[] {
  const lookup = new Map(flattenOrders(orders).filter(order => order.order_id !== null).map(order => [order.order_id, order]))
  const result = new Map<string, ClosedSymbol>()
  const seen = new Set<string>()
  for (const fill of fills) {
    if (seen.has(fill.order_id) || tradingDay(fill.occurred_at) !== day) continue
    seen.add(fill.order_id)
    const order = lookup.get(fill.order_id)
    if (!order?.symbol || order.instruction !== 'SELL') continue
    const qty = number(order.filled_quantity) || (order.status === 'FILLED' ? number(order.quantity) : null)
    const previous = result.get(order.symbol)
    result.set(order.symbol, {
      symbol: order.symbol,
      quantity: previous ? previous.quantity !== null && qty !== null ? previous.quantity + qty : null : qty,
      occurredAt: previous && Date.parse(previous.occurredAt) > Date.parse(fill.occurred_at) ? previous.occurredAt : fill.occurred_at,
    })
  }
  return [...result.values()]
}

export function portfolioSections(positions: Position[], orders: OrderItem[], closed: ClosedSymbol[]) {
  const rows = new Map<string, SymbolRow>()
  function row(symbol: string) {
    if (!rows.has(symbol)) rows.set(symbol, { symbol, position: null, entries: [], stops: [], other: [], closed: null })
    return rows.get(symbol)!
  }
  for (const position of positions) {
    if (number(position.quantity) !== 0) row(position.symbol).position = position
  }
  const seen = new Set<string>()
  function collect(items: OrderItem[], inheritedSymbol?: string) {
    for (const order of items) {
      const children = flattenOrders(order.child_orders).map(child => child.symbol).filter(Boolean)
      const symbol = order.symbol ?? inheritedSymbol ?? (new Set(children).size === 1 ? children[0]! : `Order ${order.order_id ?? '?'}`)
      if (ACTIVE_STATUSES.has(order.status ?? '') && (order.order_id === null || !seen.has(order.order_id))) {
        if (order.order_id !== null) seen.add(order.order_id)
        const group = row(symbol)
        if (order.instruction === 'BUY') group.entries.push(order)
        else if (order.instruction === 'SELL' && order.order_type === 'STOP') group.stops.push(order)
        else group.other.push(order)
      }
      collect(order.child_orders, symbol)
    }
  }
  collect(orders)
  for (const item of closed) row(item.symbol).closed = item
  const sections = { entries: [] as SymbolRow[], holdings: [] as SymbolRow[], closed: [] as SymbolRow[] }
  for (const item of rows.values()) {
    if (item.position) sections.holdings.push(item)
    else if (item.entries.length) sections.entries.push(item)
    else if (item.stops.length || item.other.length) sections.holdings.push(item)
    else if (item.closed) sections.closed.push(item)
  }
  sections.entries.sort((a, b) => a.symbol.localeCompare(b.symbol))
  sections.holdings.sort((a, b) => a.symbol.localeCompare(b.symbol))
  sections.closed.sort((a, b) => Date.parse(b.closed!.occurredAt) - Date.parse(a.closed!.occurredAt))
  return sections
}
