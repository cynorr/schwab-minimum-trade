import type { Execution, OrderItem, Position } from './api'
import { number } from './format'
import { ACTIVE_STATUSES, flattenOrders } from './orders'

export interface SoldSymbol {
  symbol: string
  quantity: number
  amount: number
  averagePrice: number
  boughtQuantity: number | null
  averageBuyPrice: number | null
  occurredAt: string
  executions: (Execution & { order_id: string })[]
}
export interface SymbolRow {
  symbol: string
  position: Position | null
  entries: OrderItem[]
  stops: OrderItem[]
  other: OrderItem[]
}

export function tradingDay(value: string | Date = new Date()): string {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(date)
}

export function soldToday(orders: OrderItem[], day = tradingDay()): SoldSymbol[] {
  const result = new Map<string, SoldSymbol>()
  const buys = new Map<string, { quantity: number; amount: number }>()
  const seen = new Set<string>()
  for (const order of flattenOrders(orders)) {
    if (!order.order_id || !order.symbol || !['BUY', 'SELL'].includes(order.instruction ?? '') || order.status !== 'FILLED' || seen.has(order.order_id)) continue
    seen.add(order.order_id)
    const qty = number(order.filled_quantity)
    if (!qty || !order.executions.length) continue
    const occurredAt = order.executions.reduce((latest, execution) => Date.parse(execution.time) > Date.parse(latest) ? execution.time : latest, order.executions[0].time)
    if (tradingDay(occurredAt) !== day) continue
    const amount = order.executions.reduce((sum, execution) => sum + Number(execution.quantity) * Number(execution.price), 0)
    if (order.instruction === 'BUY') {
      const previous = buys.get(order.symbol)
      buys.set(order.symbol, { quantity: (previous?.quantity ?? 0) + qty, amount: (previous?.amount ?? 0) + amount })
      continue
    }
    const previous = result.get(order.symbol)
    const totalQuantity = (previous?.quantity ?? 0) + qty
    const totalAmount = (previous?.amount ?? 0) + amount
    result.set(order.symbol, {
      symbol: order.symbol, quantity: totalQuantity, amount: totalAmount, averagePrice: totalAmount / totalQuantity,
      boughtQuantity: null, averageBuyPrice: null,
      occurredAt: previous && Date.parse(previous.occurredAt) > Date.parse(occurredAt) ? previous.occurredAt : occurredAt,
      executions: [...(previous?.executions ?? []), ...order.executions.map(execution => ({ ...execution, order_id: order.order_id! }))],
    })
  }
  return [...result.values()].map(row => {
    const buy = buys.get(row.symbol)
    return { ...row, boughtQuantity: buy?.quantity ?? null, averageBuyPrice: buy ? buy.amount / buy.quantity : null }
  }).sort((a, b) => Date.parse(b.occurredAt) - Date.parse(a.occurredAt))
}

export function portfolioSections(positions: Position[], orders: OrderItem[]) {
  const rows = new Map<string, SymbolRow>()
  function row(symbol: string) {
    if (!rows.has(symbol)) rows.set(symbol, { symbol, position: null, entries: [], stops: [], other: [] })
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
  const sections = { entries: [] as SymbolRow[], holdings: [] as SymbolRow[] }
  for (const item of rows.values()) {
    if (item.position) sections.holdings.push(item)
    else if (item.entries.length) sections.entries.push(item)
    else if (item.stops.length || item.other.length) sections.holdings.push(item)
  }
  sections.entries.sort((a, b) => a.symbol.localeCompare(b.symbol))
  sections.holdings.sort((a, b) => a.symbol.localeCompare(b.symbol))
  return sections
}
