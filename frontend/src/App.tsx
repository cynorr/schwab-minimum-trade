import { useEffect, useRef, useState, type FormEvent } from 'react'
import { ApiError, api, asApiError, errorMessage, type Quote, type Ticket } from './api'
import { Icon } from './Icons'
import { money, number, price, quantity, time, validPrice } from './format'
import { activeStops } from './orders'
import { soldToday, type SymbolRow } from './portfolio'
import { BUY_LIMIT, priceTick, quantityUnit, ticketIssue, type QuantityUnit } from './trading'
import { Ruler } from './Ruler'
import { UnifiedList } from './UnifiedList'
import { useWorkspace } from './useWorkspace'

function ErrorLine({ error, onRefresh }: { error: ApiError | null; onRefresh?: () => Promise<void> }) {
  const [refreshing, setRefreshing] = useState(false)
  const [failed, setFailed] = useState(false)
  if (!error) return null
  async function refresh() {
    if (!onRefresh || refreshing) return
    setRefreshing(true); setFailed(false)
    try { await onRefresh() } catch { setFailed(true) } finally { setRefreshing(false) }
  }
  return <div className={`error-line ${error.unknownResult ? 'unknown' : ''}`} role="alert"><Icon name="alert" size={13} /><span>{errorMessage(error)}{failed ? ' Refresh failed.' : ''}</span>{error.unknownResult && onRefresh && <button className="text-button" disabled={refreshing} onClick={() => void refresh()}>{refreshing ? 'Refreshing…' : 'Refresh orders'}</button>}</div>
}

export default function App() {
  const { snapshot, health, connection, healthError, positionsError, ordersError, loading, quoteUpdate, fill, refreshOrders } = useWorkspace()
  const [dark, setDark] = useState(() => { try { return localStorage.getItem('schwab-theme') === 'dark' } catch { return false } })
  const [symbolInput, setSymbolInput] = useState('')
  const [symbol, setSymbol] = useState('')
  const selectedSymbol = useRef('')
  const quoteRequest = useRef(0)
  const [quote, setQuote] = useState<Quote | null>(null)
  const [quoteFetchedAt, setQuoteFetchedAt] = useState<string | null>(null)
  const [quoteLoading, setQuoteLoading] = useState(false)
  const [quoteError, setQuoteError] = useState<ApiError | null>(null)
  const [mode, setMode] = useState<'breakout' | 'market'>('breakout')
  const [side, setSide] = useState<'buy' | 'sell'>('buy')
  const [qty, setQty] = useState('')
  const [unit, setUnit] = useState<QuantityUnit>(100)
  const quantityEdited = useRef(false)
  const [buyStop, setBuyStop] = useState('')
  const [sellStop, setSellStop] = useState('')
  const suggestionsInitialized = useRef('')
  const [fine, setFine] = useState(false)
  const [autoTick, setAutoTick] = useState('0.01')
  const [smallestTick, setSmallestTick] = useState('0.01')
  const [review, setReview] = useState<Ticket | null>(null)
  const [referencePrice, setReferencePrice] = useState<number | null>(null)
  const [tradeError, setTradeError] = useState<ApiError | null>(null)
  const [orderError, setOrderError] = useState<ApiError | null>(null)
  const [sending, setSending] = useState(false)
  const [orderBusy, setOrderBusy] = useState<string | null>(null)
  const [ordersRefreshing, setOrdersRefreshing] = useState(false)
  const [feedback, setFeedback] = useState('')
  const writeLock = useRef(false)
  const reviewHeading = useRef<HTMLHeadingElement>(null)
  const qtyInput = useRef<HTMLInputElement>(null)

  useEffect(() => {
    document.documentElement.dataset.theme = dark ? 'dark' : 'light'
    try { localStorage.setItem('schwab-theme', dark ? 'dark' : 'light') } catch { /* Theme does not require storage. */ }
  }, [dark])
  useEffect(() => { if (review) reviewHeading.current?.focus() }, [review])
  useEffect(() => {
    if (!quoteUpdate) return
    setQuote(previous => previous && previous.symbol === quoteUpdate.symbol && Date.parse(quoteUpdate.updated_at) >= Date.parse(previous.updated_at) ? { ...previous, ...quoteUpdate } : previous)
  }, [quoteUpdate])
  useEffect(() => () => { quoteRequest.current += 1 }, [])

  const authRequired = health?.auth_status === 'auth_required'
  const unavailable = authRequired || healthError !== null || !health || health.schwab_rest !== 'connected' || connection !== 'open'
  const writing = sending || orderBusy !== null
  const editingLocked = review !== null || sending
  const held = snapshot.positions.find(position => position.symbol === symbol)
  const heldQty = number(held?.quantity)
  const stops = activeStops(snapshot.orders, symbol)
  const high = number(quote?.day_high), low = number(quote?.day_low)
  const range = high !== null && low !== null && low > 0 && high >= low ? (high - low) / low * 100 : null
  const tick = fine ? smallestTick : autoTick
  const candidate: Ticket = mode === 'breakout' ? { mode, symbol, qty: Number(qty), buy_stop: buyStop, sell_stop: sellStop } : { mode, side, symbol, qty: Number(qty) }
  const issue = symbol && qty ? ticketIssue(candidate, quote, heldQty) : null
  const currentPrice = mode === 'breakout' ? number(buyStop) : number(side === 'buy' ? quote?.ask : quote?.bid)
  const nominal = currentPrice !== null && number(qty) !== null ? currentPrice * Number(qty) : null
  const risk = mode === 'breakout' && number(buyStop) !== null && number(sellStop) !== null && number(qty) !== null ? (Number(buyStop) - Number(sellStop)) * Number(qty) : null
  const reviewNominal = review ? review.qty * (review.mode === 'breakout' ? Number(review.buy_stop) : referencePrice ?? NaN) : null
  const reviewRisk = review?.mode === 'breakout' ? review.qty * (Number(review.buy_stop) - Number(review.sell_stop)) : null
  const soldRecords = soldToday(snapshot.orders)
  let status = { label: 'Online', tone: 'green' }
  if (authRequired) status = { label: 'Auth required', tone: 'red' }
  else if (connection === 'reconnecting' || healthError) status = { label: 'Reconnecting', tone: 'amber' }
  else if (connection === 'connecting' || !health) status = { label: 'Connecting', tone: 'muted' }
  else if (health.schwab_rest !== 'connected') status = { label: 'REST unavailable', tone: 'amber' }
  else if (health.schwab_stream !== 'connected') status = { label: 'REST only', tone: 'amber' }

  function editQuantity(value: string) { quantityEdited.current = true; setQty(value); setFeedback('') }
  async function loadQuote(raw: string, refresh = false, positionQty?: string) {
    if (editingLocked) return
    const next = raw.trim().toUpperCase()
    if (!/^[A-Z0-9][A-Z0-9./-]*$/.test(next)) { setQuoteError(new ApiError('Enter a valid symbol.')); return }
    const changed = selectedSymbol.current !== next
    const requestId = ++quoteRequest.current
    selectedSymbol.current = next
    setSymbol(next); setSymbolInput(next); setQuoteLoading(true); setQuoteError(null)
    setTradeError(previous => previous?.unknownResult ? previous : null); setFeedback('')
    if (changed) {
      setQuote(null); setQuoteFetchedAt(null); setBuyStop(''); setSellStop(''); setFine(false)
      setQty(positionQty ?? ''); setUnit(100); quantityEdited.current = positionQty !== undefined; suggestionsInitialized.current = ''
    } else if (positionQty !== undefined) editQuantity(positionQty)
    try {
      const nextQuote = await api.quote(next, refresh)
      if (requestId !== quoteRequest.current) return
      setQuote(previous => previous?.symbol === next && Date.parse(previous.updated_at) > Date.parse(nextQuote.updated_at) ? { ...nextQuote, bid: previous.bid, ask: previous.ask, updated_at: previous.updated_at } : nextQuote)
      setQuoteFetchedAt(new Date().toISOString())
      setAutoTick(priceTick(nextQuote))
      setSmallestTick((number(nextQuote.ask) ?? number(nextQuote.day_high) ?? 1) < 1 ? '0.0001' : '0.01')
      if (suggestionsInitialized.current !== next) {
        setBuyStop(nextQuote.suggested_buy_stop ?? ''); setSellStop(nextQuote.suggested_sell_stop ?? '')
        const initialUnit = quantityUnit(number(nextQuote.suggested_buy_stop) ?? number(nextQuote.ask) ?? number(nextQuote.day_high) ?? 100)
        setUnit(initialUnit); if (!quantityEdited.current) setQty(String(initialUnit))
        suggestionsInitialized.current = next
      }
    } catch (error) { if (requestId === quoteRequest.current) setQuoteError(asApiError(error)) }
    finally { if (requestId === quoteRequest.current) setQuoteLoading(false) }
  }
  function selectRow(row: SymbolRow) {
    const owned = number(row.position?.quantity)
    void loadQuote(row.symbol, false, owned !== null && owned >= 1 ? String(Math.floor(owned)) : undefined)
  }
  function startReview(event: FormEvent) {
    event.preventDefault()
    if (writing || unavailable || quoteLoading) return
    const message = !symbol || symbolInput.trim().toUpperCase() !== symbol ? 'Press Enter to select this symbol.' : !/^[1-9]\d*$/.test(qty) ? 'Enter a positive whole-share quantity.' : ticketIssue(candidate, quote, heldQty)
    if (message) { setTradeError(previous => previous?.unknownResult ? previous : new ApiError(message)); return }
    setTradeError(previous => previous?.unknownResult ? previous : null); setFeedback('')
    setReferencePrice(number(side === 'buy' ? quote?.ask : quote?.bid)); setReview(candidate)
  }
  async function sendOrder() {
    if (!review || writeLock.current || unavailable) return
    writeLock.current = true; setSending(true)
    try {
      await api.submit(review)
      setReview(null); setQty(''); quantityEdited.current = true
      setTradeError(previous => previous?.unknownResult ? previous : null); setFeedback('Order accepted · awaiting broker sync')
      requestAnimationFrame(() => qtyInput.current?.focus())
    } catch (error) {
      const failure = asApiError(error)
      setTradeError(previous => previous?.unknownResult ? previous : failure); if (failure.unknownResult) setReview(null)
    } finally { setSending(false); writeLock.current = false }
  }
  async function writeOrder(id: string, newPrice?: string) {
    if (writeLock.current || unavailable) return
    writeLock.current = true; setOrderBusy(id); setFeedback('')
    setOrderError(previous => previous?.unknownResult ? previous : null)
    try {
      if (newPrice !== undefined) await api.replaceStop(id, newPrice); else await api.cancel(id)
      setFeedback(`${newPrice !== undefined ? 'Replacement' : 'Cancellation'} accepted · awaiting broker sync`)
    } catch (error) { setOrderError(previous => previous?.unknownResult ? previous : asApiError(error)); throw error }
    finally { setOrderBusy(null); writeLock.current = false }
  }
  async function manualRefreshOrders() {
    if (ordersRefreshing) return
    setOrdersRefreshing(true)
    try { await refreshOrders() } finally { setOrdersRefreshing(false) }
  }

  const cashBalance = number(snapshot.account?.cash_balance)
  const marginBalance = number(snapshot.account?.margin_balance)
  const balance = cashBalance !== null && marginBalance !== null ? cashBalance + marginBalance : null

  return <div className="app-shell">
    <header className="app-header"><a className="brand" href="/" aria-label="Schwab Local home"><span className="brand-mark"><svg width="17" height="17" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M5 18v-6m7 6V7m7 11V3" stroke="currentColor" strokeWidth="3.5" strokeLinecap="round" /></svg></span><span>Schwab <span className="brand-local">Local</span></span></a><div className="header-status"><span className={`connection-pill ${status.tone}`} role="status"><span className="status-dot" />{status.label}</span><time title="Last snapshot">{time(snapshot.account ? snapshot.updated_at : null)}</time><button className="icon-button" aria-label={dark ? 'Use light theme' : 'Use dark theme'} onClick={() => setDark(previous => !previous)}><Icon name={dark ? 'sun' : 'moon'} size={14} /></button></div></header>
    <section className="account-strip" aria-label="Account balances">{([
      ['Net Liq', snapshot.account?.liquidation_value, 'currentBalances.liquidationValue'],
      ['Stock BP', snapshot.account?.stock_buying_power, 'projectedBalances.stockBuyingPower'],
      ['Intraday BP', snapshot.account?.intraday_buying_power, 'currentBalances.intradayBuyingPowerAmount'],
      ['Available Dollars', snapshot.account?.available_funds, 'currentBalances.availableFunds'],
      ['Balance', balance, `currentBalances.cashBalance ${money(snapshot.account?.cash_balance)} + currentBalances.marginBalance ${money(snapshot.account?.margin_balance)}`],
    ] as const).map(([label, value, source]) => <div className="account-metric" key={label} title={source}><span>{label}</span><strong>{money(value)}</strong></div>)}</section>
    {(authRequired || healthError || (health && health.schwab_rest !== 'connected')) && <div className="service-note" role="status"><Icon name="alert" size={13} />{authRequired ? 'Authorization required: run .venv/bin/python schwab_backend.py auth' : healthError ? 'Local backend disconnected. Reconnecting…' : 'Account service unavailable. Last snapshot retained.'}</div>}
    <section className="trade-panel" aria-label="Trade ticket">
      <div className="trade-toolbar"><form className="symbol-form" onSubmit={event => { event.preventDefault(); void loadQuote(symbolInput) }}><Icon name="search" size={14} /><input aria-label="Symbol" value={symbolInput} onChange={event => setSymbolInput(event.target.value.toUpperCase())} placeholder="Symbol" autoComplete="off" spellCheck={false} autoCapitalize="characters" disabled={editingLocked} /><button type="submit" className="symbol-enter" aria-label="Load symbol" title="Load symbol (Enter)" disabled={editingLocked || !symbolInput.trim()}>↵</button></form><button className={`icon-button refresh-quote ${quoteLoading ? 'is-loading' : ''}`} aria-label="Refresh quote" title="Refresh High / Low and quote" disabled={quoteLoading || editingLocked || !symbolInput.trim()} onClick={() => void loadQuote(symbolInput, true)}><Icon name="refresh" size={14} /></button><div className="segmented-control" aria-label="Order type"><button className={mode === 'breakout' ? 'selected' : ''} aria-pressed={mode === 'breakout'} disabled={editingLocked} onClick={() => setMode('breakout')}>Breakout</button><button className={mode === 'market' ? 'selected' : ''} aria-pressed={mode === 'market'} disabled={editingLocked} onClick={() => setMode('market')}>Market</button></div>{mode === 'market' && <div className="side-control" aria-label="Side"><button className={side === 'buy' ? 'selected buy' : ''} aria-pressed={side === 'buy'} disabled={editingLocked} onClick={() => setSide('buy')}>Buy</button><button className={side === 'sell' ? 'selected sell' : ''} aria-pressed={side === 'sell'} disabled={editingLocked} onClick={() => setSide('sell')}>Sell</button></div>}</div>
      <div className="quotes" aria-label="Quote" aria-busy={quoteLoading}><div className="high-low"><div><span>High</span><strong>{price(high !== null && high > 0 ? high : null)}</strong></div><div><span>Low</span><strong>{price(low !== null && low > 0 ? low : null)}</strong></div></div><div className="range-quote" title={`(High − Low) / Low. High / Low fetched ${time(quoteFetchedAt)}; refresh manually.`}><span>Range</span><strong>{range === null ? '—' : `${range.toFixed(2)}%`}</strong></div><div className="bid-ask"><div><span>Ask</span><strong>{price(quote?.ask)}</strong></div><div><span>Bid</span><strong>{price(quote?.bid)}</strong></div></div></div>
      <ErrorLine error={quoteError} />
      <form className="ticket-form" onSubmit={startReview}>
        {review ? <div className="review-block"><h2 ref={reviewHeading} tabIndex={-1}>Review <strong>{review.symbol}</strong></h2><div className="review-summary">{review.mode === 'breakout' ? `BUY STOP ${quantity(review.qty)} @ ${price(review.buy_stop)} DAY → SELL STOP ${price(review.sell_stop)} GTC` : `MARKET ${review.side.toUpperCase()} ${quantity(review.qty)} · DAY`}</div><div className="review-numbers"><span>{review.mode === 'breakout' ? 'Notional' : 'Reference'} <strong>{money(reviewNominal)}</strong></span>{reviewRisk !== null && <span>Risk <strong>{money(reviewRisk)}</strong> ({reviewNominal ? (reviewRisk / reviewNominal * 100).toFixed(2) : '—'}%)</span>}</div><div className="review-actions"><span className="review-note">{review.mode === 'breakout' ? 'Stop execution may differ.' : 'Estimated at review; fill price may differ.'}</span><button type="button" className="button secondary" disabled={sending} onClick={() => setReview(null)}>Back</button><button type="button" className={`button primary ${review.mode === 'market' && review.side === 'sell' ? 'sell-primary' : ''}`} disabled={writing || unavailable} onClick={() => void sendOrder()}>{sending ? 'Sending…' : 'Confirm & Send'}<Icon name="arrow" size={13} /></button></div></div> : <>
          <div className="control-row quantity-row"><label htmlFor="qty">Qty</label><input ref={qtyInput} className="value-input" id="qty" aria-label="Quantity" inputMode="numeric" autoComplete="off" value={qty} onChange={event => editQuantity(event.target.value)} placeholder="0" /><div className="unit-control" aria-label="Quantity unit">{([10, 100, 1000] as const).map(option => <button type="button" key={option} aria-label={`Unit ${option}`} aria-pressed={unit === option} className={unit === option ? 'selected' : ''} onClick={() => { setUnit(option); if (!qty) editQuantity(String(option)) }}>{option === 1000 ? '1k' : option}</button>)}</div><Ruler label="Quantity ruler" value={qty} step={String(unit / 2)} onChange={editQuantity} disabled={!symbol || quoteLoading || writing} quantity limit={currentPrice && (mode === 'breakout' || side === 'buy') ? BUY_LIMIT / currentPrice : undefined} />{mode === 'market' && side === 'sell' ? <button className="text-button ruler-meta" type="button" disabled={!heldQty || heldQty < 1} onClick={() => editQuantity(String(Math.floor(heldQty!)))}>All</button> : <span className="ruler-meta" title="Shares per minor tick">{unit / 2}/tick</span>}</div>
          {mode === 'breakout' && <><div className="control-row price-row"><label htmlFor="buy-stop">Buy</label><input className="value-input" id="buy-stop" aria-label="Buy stop" inputMode="decimal" autoComplete="off" value={buyStop} onChange={event => setBuyStop(event.target.value)} placeholder="0.00" disabled={quoteLoading && !quote} /><Ruler label="Buy price ruler" value={buyStop} step={tick} disabled={!quote || !validPrice(buyStop) || quoteLoading || writing} onChange={setBuyStop} /><button type="button" className={`text-button ruler-meta ${fine ? 'fine-active' : ''}`} disabled={autoTick === smallestTick} onClick={() => setFine(previous => !previous)} aria-label="Toggle fine price ticks" aria-pressed={fine} title="Toggle fine adjustment">{tick}/tick</button><button type="button" className="icon-button reset-button" aria-label="Reset buy price" disabled={!quote?.suggested_buy_stop || quoteLoading} onClick={() => setBuyStop(quote?.suggested_buy_stop ?? '')}><Icon name="refresh" size={12} /></button></div><div className="control-row price-row"><label htmlFor="sell-stop">Stop</label><input className="value-input" id="sell-stop" aria-label="Sell stop" inputMode="decimal" autoComplete="off" value={sellStop} onChange={event => setSellStop(event.target.value)} placeholder="0.00" disabled={quoteLoading && !quote} /><Ruler label="Stop price ruler" value={sellStop} step={tick} disabled={!quote || !validPrice(sellStop) || quoteLoading || writing} onChange={setSellStop} /><span className="ruler-meta">{tick}/tick</span><button type="button" className="icon-button reset-button" aria-label="Reset stop price" disabled={!quote?.suggested_sell_stop || quoteLoading} onClick={() => setSellStop(quote?.suggested_sell_stop ?? '')}><Icon name="refresh" size={12} /></button></div></>}
          <div className="ticket-summary"><div><span>Est <strong>{money(nominal)}</strong></span>{risk !== null && <span className="risk-summary">Risk <strong>{money(risk)}</strong> {nominal && risk >= 0 ? `${(risk / nominal * 100).toFixed(2)}%` : ''}</span>}{mode === 'market' && stops.length > 0 && <span className="existing-stop" title={stops.map(stop => `${quantity(stop.quantity)} @ ${price(stop.stop_price)}`).join('; ')}><Icon name="shield" size={11} />{stops.length === 1 ? `Stop ${price(stops[0].stop_price)}` : `${stops.length} stops`}</span>}</div><button type="submit" className="button primary" disabled={writing || unavailable || quoteLoading || !symbol || !qty || !!issue}>Review<Icon name="arrow" size={13} /></button></div>{issue && <div className="limit-note" role="status"><Icon name="alert" size={12} />{issue}</div>}
        </>}
      </form><ErrorLine error={tradeError} onRefresh={manualRefreshOrders} />
    </section>
    <div className="portfolio-wrapper"><UnifiedList positions={snapshot.positions} orders={snapshot.orders} sold={soldRecords} longValue={snapshot.account?.long_market_value} symbol={symbol} locked={unavailable || writing} selectionLocked={editingLocked} busy={orderBusy} loading={loading} onSelect={selectRow} onWrite={writeOrder} onError={error => setOrderError(previous => previous?.unknownResult ? previous : error)} onRefresh={() => void manualRefreshOrders().catch(() => {})} refreshing={ordersRefreshing} /><ErrorLine error={orderError ?? ordersError ?? positionsError} onRefresh={manualRefreshOrders} /></div>
    {(feedback || fill) && <div className="workspace-feedback" role="status"><Icon name="check" size={12} />{fill ? `${fill.symbol ?? `#${fill.order_id}`} filled` : feedback}</div>}
  </div>
}
