import { describe, expect, it } from 'vitest'
import { ACTIVE_STATUSES, activeStops, canReplaceStop, isOrderTreeVisible } from './orders'
import { order } from './test/fixtures'

describe('order tree visibility and controls', () => {
  it.each([...ACTIVE_STATUSES])('retains active status %s', status => {
    expect(isOrderTreeVisible(order({ status }))).toBe(true)
  })
  it('keeps filled ancestors of deeply nested active stops', () => {
    expect(isOrderTreeVisible(order({ status: 'FILLED', child_orders: [
      order({ status: 'CANCELED', child_orders: [order()] }),
    ] }))).toBe(true)
    expect(isOrderTreeVisible(order({ status: 'FILLED', child_orders: [order({ status: 'CANCELED' })] }))).toBe(false)
  })
  it.each(['WORKING', 'AWAITING_STOP_CONDITION', 'QUEUED', 'ACCEPTED'])('allows replacing a single activated sell stop: %s', status => {
    expect(canReplaceStop(order({ status }))).toBe(true)
  })
  it.each([
    { order_id: null }, { instruction: 'BUY' }, { order_type: 'STOP_LIMIT' },
    { strategy_type: 'TRIGGER' }, { child_orders: [order()] },
    { status: 'AWAITING_PARENT_ORDER' }, { status: 'PARTIALLY_FILLED' }, { status: 'FILLED' },
  ])('does not expose an unsupported replacement: %o', overrides => {
    expect(canReplaceStop(order(overrides))).toBe(false)
  })
  it('finds market-mode stop warnings recursively and only for the selected symbol', () => {
    const stop = order()
    const orders = [order({ instruction: 'BUY', status: 'FILLED', child_orders: [stop] }), order({ symbol: 'AAPL' })]
    expect(activeStops(orders, 'NVDA')).toEqual([stop])
  })
})
