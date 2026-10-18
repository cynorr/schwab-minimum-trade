import { useEffect, useRef, useState } from 'react'
import { API_BASE, api, asApiError, type ApiError, type FillEvent, type Health, type QuoteUpdate, type Snapshot } from './api'
import { tradingDay } from './portfolio'

export function useWorkspace() {
  const [snapshot, setSnapshot] = useState<Snapshot>({ account: null, positions: [], orders: [], updated_at: null })
  const [health, setHealth] = useState<Health | null>(null)
  const [connection, setConnection] = useState<'connecting' | 'open' | 'reconnecting'>('connecting')
  const [healthError, setHealthError] = useState<ApiError | null>(null)
  const [positionsError, setPositionsError] = useState<ApiError | null>(null)
  const [ordersError, setOrdersError] = useState<ApiError | null>(null)
  const [loading, setLoading] = useState(true)
  const [quoteUpdate, setQuoteUpdate] = useState<QuoteUpdate | null>(null)
  const [fill, setFill] = useState<FillEvent | null>(null)
  const [fills, setFills] = useState<FillEvent[]>([])
  const refreshLock = useRef(false)

  useEffect(() => {
    let alive = true
    let healthPending = false
    let fillTimer: ReturnType<typeof setTimeout> | undefined
    let snapshotReceived = false

    async function checkHealth() {
      if (healthPending) return
      healthPending = true
      try {
        const next = await api.health()
        if (alive) { setHealth(next); setHealthError(null) }
      } catch (error) {
        if (alive) setHealthError(asApiError(error))
      } finally { healthPending = false }
    }

    void checkHealth()
    void Promise.allSettled([api.account(), api.positions(), api.orders()]).then(results => {
      if (!alive) return
      const [account, positions, orders] = results
      // The SSE initial snapshot can arrive before these REST reads finish.
      if (!snapshotReceived) {
        setSnapshot(previous => ({
          account: account.status === 'fulfilled' ? account.value : previous.account,
          positions: positions.status === 'fulfilled' ? positions.value.positions : previous.positions,
          orders: orders.status === 'fulfilled' ? orders.value.orders : previous.orders,
          updated_at: account.status === 'fulfilled' ? account.value.updated_at : previous.updated_at,
        }))
        if (positions.status === 'rejected') setPositionsError(asApiError(positions.reason))
        if (orders.status === 'rejected') setOrdersError(asApiError(orders.reason))
      }
      setLoading(false)
    })

    const source = new EventSource(`${API_BASE}/events`)
    source.onopen = () => { if (alive) { setConnection('open'); void checkHealth() } }
    source.onerror = () => { if (alive) setConnection('reconnecting') }
    // Schwab uses named SSE events; onmessage does not receive these events.
    source.addEventListener('snapshot_updated', event => {
      try {
        const next = JSON.parse((event as MessageEvent<string>).data) as Snapshot
        if (!alive) return
        snapshotReceived = true
        setSnapshot(next)
        setLoading(false)
        if (next.account) setPositionsError(null)
        setOrdersError(null)
      } catch { /* Keep the last valid snapshot if a malformed event arrives. */ }
    })
    source.addEventListener('quote_updated', event => {
      try { if (alive) setQuoteUpdate(JSON.parse((event as MessageEvent<string>).data) as QuoteUpdate) }
      catch { /* Preserve the previous quote. */ }
    })
    source.addEventListener('stream_status', event => {
      try {
        const { connected } = JSON.parse((event as MessageEvent<string>).data) as { connected: boolean }
        if (alive) setHealth(previous => previous ? { ...previous, schwab_stream: connected ? 'connected' : 'disconnected' } : previous)
      } catch { /* The next health read will restore the connection state. */ }
    })
    source.addEventListener('order_filled', event => {
      try {
        const next = JSON.parse((event as MessageEvent<string>).data) as FillEvent
        if (!alive) return
        setFill(next)
        if (typeof next.occurred_at === 'string' && tradingDay(next.occurred_at) === tradingDay()) {
          setFills(previous => previous.some(item => item.order_id === next.order_id) ? previous
            : [...previous.filter(item => tradingDay(item.occurred_at) === tradingDay()), next])
        }
        clearTimeout(fillTimer)
        fillTimer = setTimeout(() => setFill(null), 5000)
      } catch { /* Fill sounds are handled only by the backend. */ }
    })
    const poll = setInterval(() => { void checkHealth() }, 5000)
    const onVisible = () => { if (document.visibilityState === 'visible') void checkHealth() }
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      alive = false
      source.close()
      clearInterval(poll)
      clearTimeout(fillTimer)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [])

  async function refreshOrders() {
    if (refreshLock.current) return
    refreshLock.current = true
    try {
      const next = await api.orders(true)
      setSnapshot(previous => ({ ...previous, orders: next.orders }))
      setOrdersError(null)
    } catch (error) {
      setOrdersError(asApiError(error))
      throw error
    } finally { refreshLock.current = false }
  }

  return { snapshot, health, connection, healthError, positionsError, ordersError, loading, quoteUpdate, fill, fills, refreshOrders }
}
