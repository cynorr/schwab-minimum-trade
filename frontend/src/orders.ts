import type { OrderItem } from './api'

export const ACTIVE_STATUSES = new Set([
  'WORKING', 'AWAITING_STOP_CONDITION', 'AWAITING_PARENT_ORDER',
  'PENDING_ACTIVATION', 'QUEUED', 'PENDING_REPLACE', 'PARTIALLY_FILLED', 'ACCEPTED',
])

const REPLACE_STATUSES = new Set(['WORKING', 'AWAITING_STOP_CONDITION', 'QUEUED', 'ACCEPTED'])

export function isOrderTreeVisible(order: OrderItem): boolean {
  return ACTIVE_STATUSES.has(order.status ?? '') || order.child_orders.some(isOrderTreeVisible)
}

export function canReplaceStop(order: OrderItem): boolean {
  return order.order_id !== null && order.instruction === 'SELL' && order.order_type === 'STOP'
    && order.strategy_type === 'SINGLE' && order.child_orders.length === 0
    && REPLACE_STATUSES.has(order.status ?? '')
}

export function flattenOrders(orders: OrderItem[]): OrderItem[] {
  return orders.flatMap(order => [order, ...flattenOrders(order.child_orders)])
}

export function activeStops(orders: OrderItem[], symbol: string): OrderItem[] {
  return flattenOrders(orders).filter(order => order.symbol === symbol && order.instruction === 'SELL'
    && order.order_type === 'STOP' && ACTIVE_STATUSES.has(order.status ?? ''))
}
