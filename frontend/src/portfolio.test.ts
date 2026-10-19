import { describe, expect, it } from 'vitest'
import { soldToday, portfolioSections, tradingDay } from './portfolio'
import { order, position } from './test/fixtures'

describe('symbol-based sections', () => {
  it('keeps a pending OTO on one entry row, including its protection', () => {
    const stop = order({ order_id: null, status: 'AWAITING_PARENT_ORDER', cancelable: false })
    const entry = order({ order_id: '101', instruction: 'BUY', strategy_type: 'TRIGGER', child_orders: [stop] })
    const sections = portfolioSections([], [entry])
    expect(sections.entries).toHaveLength(1)
    expect(sections.entries[0].entries).toEqual([entry])
    expect(sections.entries[0].stops).toEqual([stop])
    expect(sections.holdings).toHaveLength(0)
  })
  it('keeps holdings, multiple stops, and additional entries on the same symbol', () => {
    const stop = order()
    const entry = order({ order_id: '101', instruction: 'BUY' })
    const sections = portfolioSections([position], [entry, stop, stop, order({ order_id: '103' })])
    expect(sections.holdings).toHaveLength(1)
    expect(sections.holdings[0].entries).toEqual([entry])
    expect(sections.holdings[0].stops.map(item => item.order_id)).toEqual(['102', '103'])
    expect(sections.entries).toHaveLength(0)
  })
  it('retains active children of filled parents and uncovered or unsupported orders', () => {
    const stop = order()
    const sections = portfolioSections([], [order({ order_id: '101', status: 'FILLED', child_orders: [stop] }), order({ symbol: 'AAPL', order_id: '103', order_type: 'LIMIT' })])
    expect(sections.holdings.map(row => row.symbol)).toEqual(['AAPL', 'NVDA'])
    expect(sections.holdings[1].stops).toEqual([stop])
  })
  it('uses New York dates, including the Shanghai midnight boundary and winter time', () => {
    expect(tradingDay('2026-10-16T02:00:00+08:00')).toBe('2026-10-15')
    expect(tradingDay('2026-12-02T04:59:00Z')).toBe('2026-12-01')
    expect(tradingDay('2026-12-02T05:01:00Z')).toBe('2026-12-02')
  })
  it('recovers filled sales from snapshots, preserves identical executions, and deduplicates child orders by ID', () => {
    const execution = { activity_id: '11', leg_id: '1', quantity: '15', price: '140', time: '2026-10-15T19:00:00Z' }
    const sold = order({ status: 'FILLED', filled_quantity: '30', entered_at: '2026-10-01T19:00:00Z', executions: [execution, { ...execution, activity_id: '12' }] })
    const parent = order({ order_id: '100', instruction: 'BUY', status: 'FILLED', child_orders: [sold] })
    const result = soldToday([parent, sold], '2026-10-15')
    expect(result).toHaveLength(1)
    expect(result[0]).toMatchObject({ symbol: 'NVDA', quantity: 30, amount: 4200, averagePrice: 140, occurredAt: execution.time })
    expect(result[0].executions.map(item => item.activity_id)).toEqual(['11', '12'])
    expect(portfolioSections([position], [parent, sold]).holdings).toHaveLength(1)
    expect(soldToday([parent, sold], '2026-10-16')).toEqual([])
  })
  it('combines multiple filled sell orders using execution amounts and the latest fill time', () => {
    const first = order({ status: 'FILLED', filled_quantity: '30', executions: [{ activity_id: '11', leg_id: '1', quantity: '30', price: '140', time: '2026-10-15T19:00:00Z' }] })
    const second = order({ order_id: '103', status: 'FILLED', filled_quantity: '20', executions: [{ activity_id: '12', leg_id: '1', quantity: '20', price: '145', time: '2026-10-15T19:00:02Z' }] })
    expect(soldToday([first, second], '2026-10-15')[0]).toMatchObject({ quantity: 50, amount: 7100, averagePrice: 142, occurredAt: '2026-10-15T19:00:02Z' })
    expect(soldToday([order({ ...first, instruction: 'BUY' }), order({ ...second, status: 'WORKING' })], '2026-10-15')).toEqual([])
    expect(soldToday([order({ ...first, executions: [] })], '2026-10-15')).toEqual([])
  })
  it('shows weighted actual buys for the same trading day, without treating earlier purchases as cost basis', () => {
    const fill = { activity_id: '1', leg_id: '1', quantity: '10', price: '100', time: '2026-10-15T14:00:00Z' }
    const buy = order({ order_id: '101', instruction: 'BUY', status: 'FILLED', filled_quantity: '10', executions: [fill] })
    const secondBuy = order({ ...buy, order_id: '103', filled_quantity: '20', executions: [{ ...fill, quantity: '20', price: '106' }] })
    const sale = order({ order_id: '104', status: 'FILLED', filled_quantity: '10', executions: [{ ...fill, price: '110', time: '2026-10-15T15:00:00Z' }] })
    const previousBuy = order({ ...buy, order_id: '100', executions: [{ ...fill, price: '80', time: '2026-10-14T15:00:00Z' }] })
    expect(soldToday([buy, sale, secondBuy, buy, previousBuy], '2026-10-15')[0]).toMatchObject({ boughtQuantity: 30, averageBuyPrice: 104, quantity: 10, averagePrice: 110 })
    expect(soldToday([previousBuy, sale], '2026-10-15')[0]).toMatchObject({ boughtQuantity: null, averageBuyPrice: null })
  })
})
