import { afterEach, describe, expect, it, vi } from 'vitest'
import { ApiError, api, errorMessage } from './api'

afterEach(() => vi.unstubAllGlobals())

describe('REST write contract', () => {
  it('sends whole-share JSON integers and decimal price strings exactly once', async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify({ result: 'accepted', verified: false }), { status: 201 }))
    vi.stubGlobal('fetch', fetcher)
    await api.submit({ mode: 'breakout', symbol: 'NVDA', qty: 100, buy_stop: '140.5100', sell_stop: '136.20' })
    expect(fetcher).toHaveBeenCalledTimes(1)
    const [url, init] = fetcher.mock.calls[0]
    expect(url).toMatch(/\/orders\/breakout-buy$/)
    expect(init.headers).toEqual({ 'Content-Type': 'application/json' })
    expect(JSON.parse(init.body)).toEqual({ symbol: 'NVDA', qty: 100, buy_stop: '140.5100', sell_stop: '136.20' })
  })
  it('never retries an unknown broker result', async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify({ result: 'unknown', error: { code: 'ORDER_RESULT_UNKNOWN', message: 'unknown' } }), { status: 504 }))
    vi.stubGlobal('fetch', fetcher)
    await expect(api.cancel('102')).rejects.toMatchObject({ unknownResult: true, status: 504 })
    expect(fetcher).toHaveBeenCalledTimes(1)
  })
  it('treats a disconnected write as unknown and a disconnected read as unavailable', async () => {
    const fetcher = vi.fn().mockRejectedValue(new TypeError('Failed to fetch'))
    vi.stubGlobal('fetch', fetcher)
    await expect(api.replaceStop('102', '138')).rejects.toMatchObject({ unknownResult: true })
    await expect(api.quote('NVDA')).rejects.toMatchObject({ unknownResult: false, code: 'NETWORK_ERROR' })
    expect(fetcher).toHaveBeenCalledTimes(2)
  })
  it('appends nested broker messages without exposing opaque response objects', () => {
    const failure = new ApiError('券商拒单', 'SCHWAB_REJECTED', 502, { broker_error: {
      message: 'Invalid stop price', errors: [{ message: 'Price must be positive' }, 'Order rejected'],
    } })
    expect(errorMessage(failure)).toBe('Schwab rejected the request. · Invalid stop price; Price must be positive; Order rejected')
  })
})
