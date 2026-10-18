import { describe, expect, it } from 'vitest'
import { observedClosures, portfolioSections, tradingDay } from './portfolio'
import { order, position } from './test/fixtures'

describe('symbol-based sections', () => {
  it('keeps a pending OTO on one entry row, including its protection', () => {
    const stop = order({ order_id: null, status: 'AWAITING_PARENT_ORDER', cancelable: false })
    const entry = order({ order_id: '101', instruction: 'BUY', strategy_type: 'TRIGGER', child_orders: [stop] })
    const sections = portfolioSections([], [entry], [])
    expect(sections.entries).toHaveLength(1)
    expect(sections.entries[0].entries).toEqual([entry])
    expect(sections.entries[0].stops).toEqual([stop])
    expect(sections.holdings).toHaveLength(0)
  })
  it('keeps holdings, multiple stops, and additional entries on the same symbol', () => {
    const stop = order()
    const entry = order({ order_id: '101', instruction: 'BUY' })
    const sections = portfolioSections([position], [entry, stop, stop, order({ order_id: '103' })], [])
    expect(sections.holdings).toHaveLength(1)
    expect(sections.holdings[0].entries).toEqual([entry])
    expect(sections.holdings[0].stops.map(item => item.order_id)).toEqual(['102', '103'])
    expect(sections.entries).toHaveLength(0)
  })
  it('retains active children of filled parents and uncovered or unsupported orders', () => {
    const stop = order()
    const sections = portfolioSections([], [order({ order_id: '101', status: 'FILLED', child_orders: [stop] }), order({ symbol: 'AAPL', order_id: '103', order_type: 'LIMIT' })], [])
    expect(sections.holdings.map(row => row.symbol)).toEqual(['AAPL', 'NVDA'])
    expect(sections.holdings[1].stops).toEqual([stop])
  })
  it('only places a symbol in Closed when it is flat and has no active orders', () => {
    const closed = [{ symbol: 'NVDA', quantity: 100, occurredAt: '2026-10-15T20:00:00Z' }]
    expect(portfolioSections([], [], closed).closed).toHaveLength(1)
    expect(portfolioSections([position], [], closed).closed).toHaveLength(0)
    expect(portfolioSections([], [order({ instruction: 'BUY' })], closed).entries).toHaveLength(1)
  })
  it('uses New York dates, including the Shanghai midnight boundary and winter time', () => {
    expect(tradingDay('2026-10-16T02:00:00+08:00')).toBe('2026-10-15')
    expect(tradingDay('2026-12-02T04:59:00Z')).toBe('2026-12-01')
    expect(tradingDay('2026-12-02T05:01:00Z')).toBe('2026-12-02')
  })
  it('uses received sell execution events, not entry dates, and deduplicates fill IDs', () => {
    const fills = [
      { symbol: 'NVDA', order_id: '102', occurred_at: '2026-10-15T19:00:00Z' },
      { symbol: 'NVDA', order_id: '102', occurred_at: '2026-10-15T19:00:00Z' },
      { symbol: 'NVDA', order_id: '103', occurred_at: '2026-10-14T19:00:00Z' },
    ]
    const sold = order({ status: 'FILLED', filled_quantity: '100', entered_at: '2026-09-01T19:00:00Z' })
    expect(observedClosures([sold], [], '2026-10-15')).toEqual([])
    expect(observedClosures([sold], fills, '2026-10-15')).toEqual([{ symbol: 'NVDA', quantity: 100, occurredAt: '2026-10-15T19:00:00Z' }])
    expect(observedClosures([order({ instruction: 'BUY' })], fills, '2026-10-15')).toEqual([])
  })
})
