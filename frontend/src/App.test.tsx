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
  emit(name: string, data: unknown) {
    act(() => this.listeners.get(name)?.(new MessageEvent(name, { data: JSON.stringify(data) })))
  }
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
  await screen.findByRole('button', { name: '选择持仓 NVDA' })
  await waitFor(() => expect((screen.getByRole('button', { name: 'Review Order' }) as HTMLButtonElement).disabled).toBe(false))
}
async function selectNvda() {
  fireEvent.click(screen.getByRole('button', { name: '选择持仓 NVDA' }))
  await waitFor(() => expect((screen.getByLabelText('买入触发价', { exact: false }) as HTMLInputElement).value).toBe('140.51'))
}

beforeEach(() => {
  writes = []; quoteCalls = []; MockEventSource.instances = []; quoteVersion = quote
  orders = [order({ order_id: '101', instruction: 'BUY', strategy_type: 'TRIGGER', status: 'FILLED', cancelable: false, child_orders: [order()] })]
  nextWrite = async () => json({ result: 'accepted', order_id: '200', verified: false }, 201)
  fetcher.mockReset().mockImplementation(async (input, init) => {
    const path = String(input).replace(API_BASE, '')
    if (init?.method && init.method !== 'GET') {
      writes.push({ path, init })
      return nextWrite()
    }
    if (path === '/health') return json(health)
    if (path === '/account') return json(account)
    if (path === '/positions') return json({ positions: [position], updated_at: now })
    if (path.startsWith('/orders')) return json({ orders, updated_at: now })
    if (path.startsWith('/quotes/')) {
      quoteCalls.push(path)
      return json({ ...quoteVersion, symbol: decodeURIComponent(path.split('/')[2].split('?')[0]) })
    }
    throw new Error(`Unexpected API request: ${path}`)
  })
  vi.stubGlobal('fetch', fetcher)
  vi.stubGlobal('EventSource', MockEventSource)
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => { callback(0); return 0 })
  vi.stubGlobal('localStorage', { getItem: () => null, setItem: vi.fn() })
})
afterEach(() => { cleanup(); vi.unstubAllGlobals() })

describe('trade workspace', () => {
  it('does not request quotes while typing and queries on Enter or refresh only', async () => {
    await ready()
    const field = screen.getByLabelText('股票代码')
    fireEvent.change(field, { target: { value: 'nVda' } })
    expect(quoteCalls).toEqual([])
    fireEvent.submit(field.closest('form')!)
    await waitFor(() => expect(quoteCalls).toEqual(['/quotes/NVDA']))
    await waitFor(() => expect((screen.getByRole('button', { name: '刷新行情' }) as HTMLButtonElement).disabled).toBe(false))
    fireEvent.click(screen.getByRole('button', { name: '刷新行情' }))
    await waitFor(() => expect(quoteCalls).toEqual(['/quotes/NVDA', '/quotes/NVDA?refresh=true']))
  })

  it('fills whole position shares and preserves edited prices across REST and SSE updates', async () => {
    await ready(); await selectNvda()
    expect((screen.getByLabelText('交易数量', { exact: false }) as HTMLInputElement).value).toBe('100')
    const buyStop = screen.getByLabelText('买入触发价', { exact: false }) as HTMLInputElement
    fireEvent.change(buyStop, { target: { value: '142.25' } })
    quoteVersion = { ...quote, suggested_buy_stop: '141.51' }
    fireEvent.click(screen.getByRole('button', { name: '刷新行情' }))
    await waitFor(() => expect(quoteCalls).toHaveLength(2))
    source().emit('quote_updated', { symbol: 'NVDA', bid: '141', ask: '141.02', updated_at: '2026-10-15T19:01:00Z' })
    await screen.findByText('141.02')
    expect(buyStop.value).toBe('142.25')
    source().emit('quote_updated', { symbol: 'AAPL', bid: '220', ask: '221', updated_at: '2026-10-15T19:02:00Z' })
    expect(screen.queryByText('221.00')).toBe(null)
    await waitFor(() => expect((screen.getByRole('button', { name: '重置建议价' }) as HTMLButtonElement).disabled).toBe(false))
    fireEvent.click(screen.getByRole('button', { name: '重置建议价' }))
    expect(buyStop.value).toBe('141.51')
    fireEvent.change(screen.getByLabelText('股票代码'), { target: { value: 'AAPL' } })
    fireEvent.submit(screen.getByLabelText('股票代码').closest('form')!)
    await waitFor(() => expect(quoteCalls).toHaveLength(3))
    expect((screen.getByLabelText('交易数量', { exact: false }) as HTMLInputElement).value).toBe('')
  })

  it('locks review parameters, prevents duplicate submission, and returns to editing after 201', async () => {
    await ready(); await selectNvda()
    let resolveWrite!: (response: Response) => void
    nextWrite = () => new Promise(resolve => { resolveWrite = resolve })
    fireEvent.click(screen.getByRole('button', { name: 'Review Order' }))
    expect(writes).toHaveLength(0)
    expect((screen.getByLabelText('股票代码') as HTMLInputElement).disabled).toBe(true)
    expect((screen.getByLabelText('交易数量', { exact: false }) as HTMLInputElement).matches(':disabled')).toBe(true)
    expect(screen.getByText('$14,051.00')).toBeTruthy()
    expect(screen.getByText('$431.00')).toBeTruthy()
    const confirm = screen.getByRole('button', { name: 'Confirm & Send' })
    fireEvent.click(confirm); fireEvent.click(confirm)
    expect(writes).toHaveLength(1)
    expect(JSON.parse(writes[0].init.body as string)).toEqual({ symbol: 'NVDA', qty: 100, buy_stop: '140.51', sell_stop: '136.20' })
    await act(async () => resolveWrite(json({ result: 'accepted', verified: false }, 201)))
    await screen.findByRole('button', { name: 'Review Order' })
    expect((screen.getByLabelText('交易数量', { exact: false }) as HTMLInputElement).value).toBe('')
    expect(screen.getByText('订单已接受 · 等待券商同步')).toBeTruthy()
  })

  it('keeps an unknown-result warning after edits and only refreshes orders when requested', async () => {
    await ready(); await selectNvda()
    nextWrite = async () => json({ result: 'unknown', error: { code: 'ORDER_RESULT_UNKNOWN', message: 'Unknown' } }, 504)
    fireEvent.click(screen.getByRole('button', { name: 'Review Order' }))
    fireEvent.click(screen.getByRole('button', { name: 'Confirm & Send' }))
    await screen.findByText('订单结果未确认，请人工核对后再操作')
    expect(writes).toHaveLength(1)
    fireEvent.change(screen.getByLabelText('交易数量', { exact: false }), { target: { value: '50' } })
    fireEvent.click(screen.getByRole('button', { name: '刷新订单' }))
    await waitFor(() => expect(fetcher.mock.calls.some(([url]) => String(url).endsWith('/orders?refresh=true'))).toBe(true))
    expect(writes).toHaveLength(1)
    expect(screen.getByText('订单结果未确认，请人工核对后再操作')).toBeTruthy()
  })

  it('reviews market sell separately, keeps the stop warning, and freezes the reference amount', async () => {
    await ready(); await selectNvda()
    fireEvent.click(screen.getByRole('button', { name: '市价单 Market' }))
    fireEvent.click(screen.getByRole('button', { name: '卖出 Sell' }))
    expect(screen.getByText('已挂止损 100股 @ $136.20')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Review Order' }))
    expect(screen.getByText('MARKET SELL 100 股')).toBeTruthy()
    expect(screen.getByText('$14,020.00')).toBeTruthy()
    source().emit('quote_updated', { symbol: 'NVDA', bid: '145', ask: '146', updated_at: '2026-10-15T19:01:00Z' })
    expect(screen.getByText('$14,020.00')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Confirm & Send' }))
    await waitFor(() => expect(writes[0].path).toBe('/orders/market-sell'))
    expect(JSON.parse(writes[0].init.body as string)).toEqual({ symbol: 'NVDA', qty: 100 })
  })

  it('renders filled parents, offers only valid actions, and sends cancel and replace directly', async () => {
    orders.push(order({ order_id: null, symbol: 'AAPL' }))
    await ready()
    expect(screen.getByText('已成交')).toBeTruthy()
    expect(screen.queryByRole('button', { name: '撤单 NVDA 101' })).toBe(null)
    expect(screen.queryByRole('button', { name: /撤单 AAPL/ })).toBe(null)
    expect(screen.queryByLabelText(/AAPL 新止损价/)).toBe(null)
    fireEvent.change(screen.getByLabelText('NVDA 新止损价 102'), { target: { value: '138.50' } })
    fireEvent.click(screen.getByRole('button', { name: '改价' }))
    await waitFor(() => expect(writes).toHaveLength(1))
    expect(writes[0].init.method).toBe('PUT')
    expect(JSON.parse(writes[0].init.body as string)).toEqual({ new_stop: '138.50' })
    await waitFor(() => expect((screen.getByRole('button', { name: '撤单 NVDA 102' }) as HTMLButtonElement).disabled).toBe(false))
    fireEvent.click(screen.getByRole('button', { name: '撤单 NVDA 102' }))
    await waitFor(() => expect(writes).toHaveLength(2))
    expect(writes[1].init.method).toBe('DELETE')
    expect(writes[1].init.body).toBeUndefined()
    expect(screen.queryByRole('button', { name: 'Confirm & Send' })).toBe(null)
  })

  it('receives every named SSE event, recovers the connection, and closes the stream on unmount', async () => {
    await ready()
    expect(source().url).toBe(`${API_BASE}/events`)
    expect([...source().listeners.keys()]).toEqual(['snapshot_updated', 'quote_updated', 'stream_status', 'order_filled'])
    source().emit('stream_status', { connected: false })
    expect(screen.getByText('REST Only')).toBeTruthy()
    act(() => source().onerror?.())
    expect(screen.getByText('Reconnecting')).toBeTruthy()
    act(() => source().onopen?.())
    await screen.findByText('Online')
    source().emit('snapshot_updated', { account, positions: [], orders: [], updated_at: now })
    expect(screen.getByText('暂无持仓')).toBeTruthy()
    expect(screen.getByText('暂无活动订单')).toBeTruthy()
    source().emit('order_filled', { symbol: 'NVDA', order_id: '102' })
    expect(within(screen.getByRole('region', { name: '连接状态与账户资金' })).getByText('NVDA 已成交')).toBeTruthy()
    cleanup()
    expect(source().close).toHaveBeenCalledOnce()
  })
})
