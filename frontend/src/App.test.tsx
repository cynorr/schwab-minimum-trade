import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import App from './App'
import { API_BASE } from './api'
import { account, health, now, order, position, quote } from './test/fixtures'

class MockEventSource {
  static instances: MockEventSource[] = []
  listeners = new Map<string, EventListener>()
  onopen: (() => void) | null = null
  onerror: (() => void) | null = null
  close = vi.fn()
  constructor(readonly url: string) { MockEventSource.instances.push(this) }
  addEventListener(name: string, listener: EventListener) { this.listeners.set(name, listener) }
  emit(name: string, data: unknown) { act(() => this.listeners.get(name)?.(new MessageEvent(name, { data: JSON.stringify(data) }))) }
}

const fetcher = vi.fn<typeof fetch>()
let writes: { path: string; init: RequestInit }[] = []
let quoteCalls: string[] = []
let nextWrite: () => Promise<Response>
let quoteVersion = quote
let orders = [order({ order_id: '101', instruction: 'BUY', strategy_type: 'TRIGGER', status: 'FILLED', cancelable: false, child_orders: [order()] })]
function json(value: unknown, status = 200) { return new Response(JSON.stringify(value), { status }) }
function source() { return MockEventSource.instances.at(-1)! }
async function ready() {
  render(<App />)
  act(() => source().onopen?.())
  await screen.findByRole('button', { name: 'Select NVDA' })
  await screen.findByText('Online')
}
async function selectNvda() {
  fireEvent.click(screen.getByRole('button', { name: 'Select NVDA' }))
  await waitFor(() => expect((screen.getByLabelText('Buy stop') as HTMLInputElement).value).toBe('140.51'))
}
beforeEach(() => {
  writes = []; quoteCalls = []; MockEventSource.instances = []; quoteVersion = quote
  orders = [order({ order_id: '101', instruction: 'BUY', strategy_type: 'TRIGGER', status: 'FILLED', cancelable: false, child_orders: [order()] })]
  nextWrite = async () => json({ result: 'accepted', order_id: '200', verified: false }, 201)
  fetcher.mockReset().mockImplementation(async (input, init) => {
    const path = String(input).replace(API_BASE, '')
    if (init?.method && init.method !== 'GET') { writes.push({ path, init }); return nextWrite() }
    if (path === '/health') return json(health)
    if (path === '/account') return json(account)
    if (path === '/positions') return json({ positions: [position], updated_at: now })
    if (path.startsWith('/orders')) return json({ orders, updated_at: now })
    if (path.startsWith('/quotes/')) { quoteCalls.push(path); return json({ ...quoteVersion, symbol: decodeURIComponent(path.split('/')[2].split('?')[0]) }) }
    throw new Error(`Unexpected request: ${path}`)
  })
  vi.stubGlobal('fetch', fetcher)
  vi.stubGlobal('EventSource', MockEventSource)
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => { callback(0); return 0 })
  vi.stubGlobal('localStorage', { getItem: () => null, setItem: vi.fn() })
})
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.restoreAllMocks() })

describe('compact trading workspace', () => {
  it('loads quotes only through explicit actions, never health polling, visibility, or SSE reconnects', async () => {
    const intervals = vi.spyOn(window, 'setInterval')
    await ready()
    const field = screen.getByLabelText('Symbol')
    fireEvent.change(field, { target: { value: 'nVda' } })
    expect(quoteCalls).toEqual([])
    fireEvent.submit(field.closest('form')!)
    await waitFor(() => expect((screen.getByLabelText('Buy stop') as HTMLInputElement).value).toBe('140.51'))
    expect(quoteCalls).toEqual(['/quotes/NVDA'])
    await act(async () => {
      for (const [callback] of intervals.mock.calls) if (typeof callback === 'function') callback()
      document.dispatchEvent(new Event('visibilitychange'))
      source().onerror?.(); source().onopen?.()
    })
    expect(quoteCalls).toHaveLength(1)
    fireEvent.click(screen.getByRole('button', { name: 'Refresh quote' }))
    await waitFor(() => expect(quoteCalls).toEqual(['/quotes/NVDA', '/quotes/NVDA?refresh=true']))
  })

  it('prioritizes High/Low, uses Low as the range denominator, and never substitutes buying power for Available', async () => {
    await ready(); await selectNvda()
    expect(screen.getByText('3.16%')).toBeTruthy()
    const available = screen.getByText('Available').parentElement!
    expect(available.textContent).toBe('Available—')
    expect(screen.queryByText('$54,000.00')).toBe(null)
    expect(document.body.textContent).not.toMatch(/[\u3400-\u9fff]/)
  })

  it('fills whole position shares and preserves prices and quantity across REST and SSE changes', async () => {
    await ready(); await selectNvda()
    expect((screen.getByLabelText('Quantity') as HTMLInputElement).value).toBe('100')
    const buy = screen.getByLabelText('Buy stop') as HTMLInputElement
    fireEvent.change(buy, { target: { value: '142.25' } })
    quoteVersion = { ...quote, day_high: '141.50', suggested_buy_stop: '141.51' }
    fireEvent.click(screen.getByRole('button', { name: 'Refresh quote' }))
    await screen.findByText('141.50')
    source().emit('quote_updated', { symbol: 'NVDA', bid: '141', ask: '141.02', updated_at: '2026-10-15T19:01:00Z' })
    expect(buy.value).toBe('142.25')
    expect((screen.getByLabelText('Quantity') as HTMLInputElement).value).toBe('100')
    expect(screen.getByText('141.50')).toBeTruthy()
    source().emit('quote_updated', { symbol: 'AAPL', bid: '220', ask: '221', updated_at: '2026-10-15T19:02:00Z' })
    expect(screen.queryByText('221.00')).toBe(null)
    fireEvent.click(screen.getByRole('button', { name: 'Reset buy price' }))
    expect(buy.value).toBe('141.51')
  })

  it.each([
    ['LOW', '12', '1000', '500'], ['MID', '75', '100', '50'], ['HIGH', '850', '10', '5'],
  ])('initializes %s from the quote and provides half-unit quantity ticks', async (symbol, ask, expected, half) => {
    await ready()
    quoteVersion = { ...quote, ask, suggested_buy_stop: ask }
    fireEvent.change(screen.getByLabelText('Symbol'), { target: { value: symbol } })
    fireEvent.click(screen.getByRole('button', { name: 'Load symbol' }))
    await waitFor(() => expect((screen.getByLabelText('Quantity') as HTMLInputElement).value).toBe(expected))
    fireEvent.keyDown(screen.getByRole('slider', { name: 'Quantity ruler' }), { key: 'ArrowRight' })
    expect((screen.getByLabelText('Quantity') as HTMLInputElement).value).toBe(String(Number(expected) + Number(half)))
    fireEvent.click(screen.getByRole('button', { name: 'Unit 10' }))
    expect((screen.getByLabelText('Quantity') as HTMLInputElement).value).toBe(String(Number(expected) + Number(half)))
  })

  it('locks the review, sends exact parameters once, and clears quantity after acceptance', async () => {
    await ready(); await selectNvda()
    let resolveWrite!: (response: Response) => void
    nextWrite = () => new Promise(resolve => { resolveWrite = resolve })
    fireEvent.click(screen.getByRole('button', { name: 'Review' }))
    expect(writes).toHaveLength(0)
    expect((screen.getByLabelText('Symbol') as HTMLInputElement).disabled).toBe(true)
    expect(screen.getByText('BUY STOP 100 @ 140.51 DAY → SELL STOP 136.20 GTC')).toBeTruthy()
    const confirm = screen.getByRole('button', { name: 'Confirm & Send' })
    fireEvent.click(confirm); fireEvent.click(confirm)
    expect(writes).toHaveLength(1)
    expect(JSON.parse(writes[0].init.body as string)).toEqual({ symbol: 'NVDA', qty: 100, buy_stop: '140.51', sell_stop: '136.20' })
    await act(async () => resolveWrite(json({ result: 'accepted', verified: false }, 201)))
    await screen.findByRole('button', { name: 'Review' })
    expect((screen.getByLabelText('Quantity') as HTMLInputElement).value).toBe('')
  })

  it('shows the existing $20k buy cap without silently reducing a 100-share default', async () => {
    await ready()
    quoteVersion = { ...quote, ask: '249.98', bid: '249.97', suggested_buy_stop: '250', suggested_sell_stop: '248' }
    fireEvent.change(screen.getByLabelText('Symbol'), { target: { value: 'HIGH' } })
    fireEvent.click(screen.getByRole('button', { name: 'Load symbol' }))
    await screen.findByText('Above the $20,000 buy limit.')
    expect((screen.getByLabelText('Quantity') as HTMLInputElement).value).toBe('100')
    expect((screen.getByRole('button', { name: 'Review' }) as HTMLButtonElement).disabled).toBe(true)
    fireEvent.keyDown(screen.getByRole('slider', { name: 'Quantity ruler' }), { key: 'ArrowLeft' })
    expect((screen.getByLabelText('Quantity') as HTMLInputElement).value).toBe('50')
    expect((screen.getByRole('button', { name: 'Review' }) as HTMLButtonElement).disabled).toBe(false)
    expect(writes).toHaveLength(0)
  })

  it('keeps unknown-result warnings through later edits and only reads orders on refresh', async () => {
    await ready(); await selectNvda()
    nextWrite = async () => json({ result: 'unknown', error: { code: 'ORDER_RESULT_UNKNOWN', message: '订单结果未确认' } }, 504)
    fireEvent.click(screen.getByRole('button', { name: 'Review' }))
    fireEvent.click(screen.getByRole('button', { name: 'Confirm & Send' }))
    await screen.findByText('Order result unknown. Check Schwab before submitting again.')
    fireEvent.change(screen.getByLabelText('Quantity'), { target: { value: '50' } })
    fireEvent.click(within(screen.getByRole('alert')).getByRole('button', { name: 'Refresh orders' }))
    await waitFor(() => expect(fetcher.mock.calls.some(([url]) => String(url).endsWith('/orders?refresh=true'))).toBe(true))
    expect(writes).toHaveLength(1)
    expect(screen.getByText('Order result unknown. Check Schwab before submitting again.')).toBeTruthy()
    expect(document.body.textContent).not.toMatch(/[\u3400-\u9fff]/)
  })

  it('offers All for a market sell and freezes the reference amount during review', async () => {
    await ready(); await selectNvda()
    fireEvent.click(screen.getByRole('button', { name: 'Market' }))
    fireEvent.click(screen.getByRole('button', { name: 'Sell' }))
    fireEvent.click(screen.getByRole('button', { name: 'All' }))
    expect((screen.getByLabelText('Quantity') as HTMLInputElement).value).toBe('100')
    fireEvent.click(screen.getByRole('button', { name: 'Review' }))
    expect(screen.getByText('$14,020.00')).toBeTruthy()
    source().emit('quote_updated', { symbol: 'NVDA', bid: '145', ask: '146', updated_at: '2026-10-15T19:01:00Z' })
    expect(screen.getByText('$14,020.00')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Confirm & Send' }))
    await waitFor(() => expect(writes[0].path).toBe('/orders/market-sell'))
    expect(JSON.parse(writes[0].init.body as string)).toEqual({ symbol: 'NVDA', qty: 100 })
  })

  it('merges a filled parent and holding into one row and manages the selected real stop ID directly', async () => {
    orders.push(order({ order_id: '103', stop_price: '134', quantity: '50' }))
    await ready()
    expect(screen.getAllByRole('button', { name: 'Select NVDA' })).toHaveLength(1)
    expect(within(screen.getByRole('region', { name: 'Entries' })).queryByRole('button', { name: 'Select NVDA' })).toBe(null)
    fireEvent.change(screen.getByLabelText('NVDA order target'), { target: { value: '103' } })
    fireEvent.change(screen.getByLabelText('NVDA stop price'), { target: { value: '138.50' } })
    fireEvent.click(screen.getByRole('button', { name: 'Apply stop NVDA' }))
    await waitFor(() => expect(writes).toHaveLength(1))
    expect(writes[0].path).toBe('/orders/103/stop')
    expect(JSON.parse(writes[0].init.body as string)).toEqual({ new_stop: '138.50' })
    await waitFor(() => expect((screen.getByRole('button', { name: 'Cancel NVDA 103' }) as HTMLButtonElement).disabled).toBe(false))
    fireEvent.click(screen.getByRole('button', { name: 'Cancel NVDA 103' }))
    await waitFor(() => expect(writes).toHaveLength(2))
    expect(writes[1].path).toBe('/orders/103')
    expect(writes[1].init.method).toBe('DELETE')
    expect(writes[1].init.body).toBeUndefined()
  })

  it('does not infer a closure from order creation dates; requires a received sell fill and a flat position', async () => {
    await ready()
    const sold = order({ status: 'FILLED', filled_quantity: '100', cancelable: false })
    source().emit('snapshot_updated', { account, positions: [], orders: [sold], updated_at: now })
    expect(screen.queryByRole('button', { name: 'Select NVDA' })).toBe(null)
    const filledAt = new Date().toISOString()
    source().emit('order_filled', { symbol: 'NVDA', order_id: '102', occurred_at: filledAt })
    expect(within(screen.getByRole('region', { name: 'Closed today' })).queryByRole('button', { name: 'Select NVDA' })).toBe(null)
    source().emit('snapshot_updated', { account: { ...account, updated_at: filledAt }, positions: [], orders: [sold], updated_at: filledAt })
    expect(within(screen.getByRole('region', { name: 'Closed today' })).getByRole('button', { name: 'Select NVDA' })).toBeTruthy()
    expect(screen.getByText('Sold 100')).toBeTruthy()
    source().emit('snapshot_updated', { account, positions: [position], orders: [sold], updated_at: now })
    expect(within(screen.getByRole('region', { name: 'Closed today' })).queryByRole('button', { name: 'Select NVDA' })).toBe(null)
    expect(within(screen.getByRole('region', { name: 'Holdings' })).getByRole('button', { name: 'Select NVDA' })).toBeTruthy()
  })

  it('does not turn missing High/Low into zero prices or enable an uninitialized price ruler', async () => {
    await ready()
    quoteVersion = { ...quote, day_high: '0', day_low: '0', suggested_buy_stop: null, suggested_sell_stop: null }
    fireEvent.click(screen.getByRole('button', { name: 'Select NVDA' }))
    await waitFor(() => expect((screen.getByRole('button', { name: 'Refresh quote' }) as HTMLButtonElement).disabled).toBe(false))
    expect(within(screen.getByLabelText('Quote')).queryByText('0.00')).toBe(null)
    expect(screen.getByRole('slider', { name: 'Buy price ruler' }).getAttribute('aria-disabled')).toBe('true')
    expect((screen.getByRole('button', { name: 'Review' }) as HTMLButtonElement).disabled).toBe(true)
    expect(quoteCalls).toHaveLength(1)
  })

  it('does not expose cancel/replace without IDs or replace a pending child stop', async () => {
    orders = [order({ status: 'AWAITING_PARENT_ORDER', cancelable: false }), order({ symbol: 'AAPL', order_id: null, cancelable: true })]
    await ready()
    expect(screen.queryByRole('button', { name: 'Apply stop NVDA' })).toBe(null)
    expect(screen.queryByRole('button', { name: /Cancel AAPL/ })).toBe(null)
    expect(screen.queryByRole('button', { name: 'Apply stop AAPL' })).toBe(null)
    expect((screen.getByLabelText('NVDA stop price') as HTMLInputElement).readOnly).toBe(true)
  })

  it('updates named SSE states and closes the stream on unmount', async () => {
    await ready()
    expect([...source().listeners.keys()]).toEqual(['snapshot_updated', 'quote_updated', 'stream_status', 'order_filled'])
    source().emit('stream_status', { connected: false })
    expect(screen.getByText('REST only')).toBeTruthy()
    act(() => source().onerror?.())
    expect(screen.getByText('Reconnecting')).toBeTruthy()
    act(() => source().onopen?.())
    await screen.findByText('Online')
    cleanup(); expect(source().close).toHaveBeenCalledOnce()
  })
})
