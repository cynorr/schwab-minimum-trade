import { useEffect, useRef, useState, type FormEvent } from 'react'
import { ApiError, api, asApiError, errorMessage, type OrderItem, type Position, type Quote, type Ticket } from './api'
import { Icon } from './Icons'
import { money, number, percent, price, quantity, time, validPrice } from './format'
import { ACTIVE_STATUSES, activeStops, canReplaceStop, flattenOrders, isOrderTreeVisible } from './orders'
import { useWorkspace } from './useWorkspace'

function ErrorPill({ error, onRefresh }: { error: ApiError | null; onRefresh?: () => Promise<void> }) {
  const [refreshing, setRefreshing] = useState(false)
  const [refreshFailed, setRefreshFailed] = useState(false)
  if (!error) return null
  async function refresh() {
    if (!onRefresh) return
    setRefreshing(true)
    setRefreshFailed(false)
    try { await onRefresh() } catch { setRefreshFailed(true) } finally { setRefreshing(false) }
  }
  return <div className={`error-pill ${error.unknownResult ? 'unknown' : ''}`} role="alert">
    <Icon name="alert" size={16} />
    <span title={errorMessage(error)}>{error.unknownResult ? '订单结果未确认，请人工核对后再操作' : errorMessage(error)}{refreshFailed ? ' · 刷新失败，请检查连接' : ''}</span>
    {error.unknownResult && onRefresh && <button className="text-button" onClick={() => void refresh()} disabled={refreshing}>{refreshing ? '刷新中…' : '刷新订单'}<Icon name="refresh" size={13} /></button>}
  </div>
}

function EmptyState({ kind, title, detail }: { kind: 'orders' | 'layers'; title: string; detail: string }) {
  return <div className="empty-state"><span className="empty-icon"><Icon name={kind} size={25} /></span><strong>{title}</strong><p>{detail}</p></div>
}

const statusLabels: Record<string, string> = {
  WORKING: '生效中', AWAITING_STOP_CONDITION: '等待触发', AWAITING_PARENT_ORDER: '等待父单',
  PENDING_ACTIVATION: '等待激活', QUEUED: '排队中', PENDING_REPLACE: '改价中',
  PARTIALLY_FILLED: '部分成交', ACCEPTED: '已接受', FILLED: '已成交',
  CANCELED: '已撤销', REJECTED: '已拒绝', EXPIRED: '已过期',
}

function OrderNode({ order, depth = 0, busy, locked, onCancel, onReplace }: {
  order: OrderItem; depth?: number; busy: string | null; locked: boolean
  onCancel: (id: string) => Promise<void>
  onReplace: (id: string, value: string) => Promise<void>
}) {
  const [newStop, setNewStop] = useState('')
  const [edited, setEdited] = useState(false)
  const [localError, setLocalError] = useState<ApiError | null>(null)
  const [replaced, setReplaced] = useState(false)
  useEffect(() => { if (!edited) setNewStop(order.stop_price ?? '') }, [order.stop_price, edited])
  const active = ACTIVE_STATUSES.has(order.status ?? '')
  const id = order.order_id
  const rowBusy = busy !== null && busy === id
  const canCancel = id !== null && order.cancelable === true
  const editable = canReplaceStop(order)
  const isBuy = order.instruction?.startsWith('BUY')

  async function replace(event: FormEvent) {
    event.preventDefault()
    if (!id || locked) return
    if (!validPrice(newStop)) { setLocalError(new ApiError('请输入有效的正数止损价')); return }
    setLocalError(null)
    try { await onReplace(id, newStop); setEdited(false); setReplaced(true) } catch { /* Parent displays write errors. */ }
  }

  return <div className={`order-node ${depth > 0 ? 'child-node' : ''}`}>
    <div className={`order-row ${active ? '' : 'inactive'}`}>
      <span className={`order-side ${isBuy ? 'buy' : 'sell'}`}><Icon name="arrow" size={17} /></span>
      <div className="order-main">
        <div className="order-title"><strong>{order.symbol ?? '—'}</strong><span>{order.instruction ?? '—'} {order.order_type ?? '—'}</span><span className={`order-status ${active ? 'active' : ''}`} title={order.status ?? ''}>{statusLabels[order.status ?? ''] ?? order.status}</span></div>
        <div className="order-detail"><span>{quantity(order.quantity)} 股{order.stop_price ? ` @ $${price(order.stop_price)}` : ''}</span><span className="detail-dot">·</span><span>{order.duration === 'GOOD_TILL_CANCEL' ? 'GTC' : order.duration ?? '—'}</span>{number(order.filled_quantity) !== null && Number(order.filled_quantity) > 0 && <span>· 已成交 {quantity(order.filled_quantity)}</span>}</div>
      </div>
      {canCancel && <button className="button button-subtle button-small cancel-button" disabled={locked} onClick={() => void onCancel(id).catch(() => {})} aria-label={`撤单 ${order.symbol} ${id}`}>{rowBusy ? '处理中…' : '撤单'}</button>}
    </div>
    {editable && <form className="replace-row" onSubmit={event => void replace(event)}>
      <label className="stop-input"><span>$</span><input aria-label={`${order.symbol} 新止损价 ${id}`} inputMode="decimal" value={newStop} disabled={locked} onChange={event => { setNewStop(event.target.value); setEdited(true); setReplaced(false); setLocalError(null) }} /></label>
      <button className="button button-subtle button-small" type="submit" disabled={locked || newStop === order.stop_price}>{rowBusy ? '处理中…' : '改价'}<Icon name="arrow" size={13} /></button>
      <span className="replace-caption">{replaced ? '已接受 · 等待同步' : '调整止损价'}</span>
    </form>}
    <ErrorPill error={localError} />
    {order.child_orders.filter(isOrderTreeVisible).map((child, index) => <OrderNode key={child.order_id ?? `${index}-${child.symbol}`} order={child} depth={depth + 1} busy={busy} locked={locked} onCancel={onCancel} onReplace={onReplace} />)}
  </div>
}

export default function App() {
  const workspace = useWorkspace()
  const { snapshot, health, connection, healthError, positionsError, ordersError, loading, quoteUpdate, fill, refreshOrders } = workspace
  const [dark, setDark] = useState(() => {
    try { return localStorage.getItem('schwab-theme') === 'dark' } catch { return false }
  })
  const [symbolInput, setSymbolInput] = useState('')
  const [symbol, setSymbol] = useState('')
  const selectedSymbol = useRef('')
  const quoteRequest = useRef(0)
  const [quote, setQuote] = useState<Quote | null>(null)
  const [quoteLoading, setQuoteLoading] = useState(false)
  const [quoteError, setQuoteError] = useState<ApiError | null>(null)
  const [mode, setMode] = useState<'breakout' | 'market'>('breakout')
  const [side, setSide] = useState<'buy' | 'sell'>('buy')
  const [qty, setQty] = useState('')
  const [buyStop, setBuyStop] = useState('')
  const [sellStop, setSellStop] = useState('')
  const suggestionsInitialized = useRef('')
  const [review, setReview] = useState<Ticket | null>(null)
  const [referencePrice, setReferencePrice] = useState<number | null>(null)
  const [tradeError, setTradeError] = useState<ApiError | null>(null)
  const [orderError, setOrderError] = useState<ApiError | null>(null)
  const [sending, setSending] = useState(false)
  const [orderBusy, setOrderBusy] = useState<string | null>(null)
  const [ordersRefreshing, setOrdersRefreshing] = useState(false)
  const [orderFeedback, setOrderFeedback] = useState('')
  const [tradeFeedback, setTradeFeedback] = useState('')
  const writeLock = useRef(false)
  const reviewHeading = useRef<HTMLHeadingElement>(null)
  const qtyInput = useRef<HTMLInputElement>(null)

  useEffect(() => {
    document.documentElement.dataset.theme = dark ? 'dark' : 'light'
    try { localStorage.setItem('schwab-theme', dark ? 'dark' : 'light') } catch { /* Theme remains usable without storage. */ }
  }, [dark])
  useEffect(() => { if (review) reviewHeading.current?.focus() }, [review])
  useEffect(() => {
    if (!quoteUpdate) return
    setQuote(previous => previous && previous.symbol === quoteUpdate.symbol
      && Date.parse(quoteUpdate.updated_at) >= Date.parse(previous.updated_at)
      ? { ...previous, ...quoteUpdate } : previous)
  }, [quoteUpdate])
  useEffect(() => () => { quoteRequest.current += 1 }, [])

  const authRequired = health?.auth_status === 'auth_required'
  const unavailable = authRequired || healthError !== null || !health || health.schwab_rest !== 'connected' || connection !== 'open'
  const writing = sending || orderBusy !== null
  const editingLocked = review !== null || sending
  const visibleOrders = snapshot.orders.filter(isOrderTreeVisible)
  const activeOrderCount = flattenOrders(snapshot.orders).filter(order => ACTIVE_STATUSES.has(order.status ?? '')).length
  const stops = activeStops(snapshot.orders, symbol)
  const snapshotTime = snapshot.account ? snapshot.updated_at ?? snapshot.account.updated_at : null
  const accountMetrics = [
    ['账户净值', 'Net liquidation', snapshot.account?.liquidation_value],
    ['可用购买力', 'Buying power', snapshot.account?.buying_power],
    ['日内购买力', 'Day trading BP', snapshot.account?.day_trading_buying_power],
    ['多头市值', 'Long market value', snapshot.account?.long_market_value],
    ['融资余额', 'Margin balance', snapshot.account?.margin_balance],
  ]

  let status = { label: 'Online', tone: 'green' }
  if (authRequired) status = { label: 'Auth Required', tone: 'red' }
  else if (connection === 'reconnecting' || healthError) status = { label: 'Reconnecting', tone: 'orange' }
  else if (connection === 'connecting' || !health) status = { label: 'Connecting', tone: 'muted' }
  else if (health.schwab_rest !== 'connected') status = { label: 'REST Unavailable', tone: 'orange' }
  else if (health.schwab_stream !== 'connected') status = { label: 'REST Only', tone: 'amber' }

  async function loadQuote(raw: string, refresh = false, positionQty?: string) {
    if (editingLocked) return
    const next = raw.trim().toUpperCase()
    if (!/^[A-Z0-9][A-Z0-9./-]*$/.test(next)) {
      setQuoteError(new ApiError('请输入有效的股票代码，例如 NVDA'))
      return
    }
    const changed = selectedSymbol.current !== next
    const requestId = ++quoteRequest.current
    selectedSymbol.current = next
    setSymbol(next)
    setSymbolInput(next)
    setQuoteLoading(true)
    setQuoteError(null)
    if (!tradeError?.unknownResult) setTradeError(null)
    setTradeFeedback('')
    if (changed) {
      setQuote(null)
      setBuyStop('')
      setSellStop('')
      setQty(positionQty ?? '')
      suggestionsInitialized.current = ''
    } else if (positionQty !== undefined) setQty(positionQty)
    try {
      const nextQuote = await api.quote(next, refresh)
      if (requestId !== quoteRequest.current) return
      setQuote(previous => previous?.symbol === next && Date.parse(previous.updated_at) > Date.parse(nextQuote.updated_at)
        ? { ...nextQuote, bid: previous.bid, ask: previous.ask, updated_at: previous.updated_at } : nextQuote)
      if (suggestionsInitialized.current !== next) {
        setBuyStop(nextQuote.suggested_buy_stop ?? '')
        setSellStop(nextQuote.suggested_sell_stop ?? '')
        suggestionsInitialized.current = next
      }
    } catch (error) {
      if (requestId === quoteRequest.current) setQuoteError(asApiError(error))
    } finally {
      if (requestId === quoteRequest.current) setQuoteLoading(false)
    }
  }

  function selectPosition(position: Position) {
    const held = number(position.quantity)
    void loadQuote(position.symbol, false, held !== null && held >= 1 ? String(Math.floor(held)) : '')
  }

  function startReview(event: FormEvent) {
    event.preventDefault()
    if (writing || unavailable || quoteLoading) return
    let message = ''
    if (!symbol || symbolInput.trim().toUpperCase() !== symbol) message = '请输入股票代码后按 Enter 查询行情'
    else if (!/^[1-9]\d*$/.test(qty) || !Number.isSafeInteger(Number(qty))) message = '数量须为正整数股'
    else if (mode === 'breakout' && (!validPrice(buyStop) || !validPrice(sellStop))) message = '请输入有效的买入与卖出止损价'
    else if (mode === 'breakout' && Number(sellStop) >= Number(buyStop)) message = '卖出止损价须低于买入触发价'
    if (message) { if (!tradeError?.unknownResult) setTradeError(new ApiError(message)); return }
    if (!tradeError?.unknownResult) setTradeError(null)
    setTradeFeedback('')
    setReferencePrice(number(side === 'buy' ? quote?.ask : quote?.bid))
    setReview(mode === 'breakout'
      ? { mode, symbol, qty: Number(qty), buy_stop: buyStop, sell_stop: sellStop }
      : { mode, side, symbol, qty: Number(qty) })
  }

  async function sendOrder() {
    if (!review || writeLock.current || unavailable) return
    writeLock.current = true
    setSending(true)
    if (!tradeError?.unknownResult) setTradeError(null)
    try {
      await api.submit(review)
      setReview(null)
      setQty('')
      if (!tradeError?.unknownResult) setTradeError(null)
      setTradeFeedback('订单已接受 · 等待券商同步')
      requestAnimationFrame(() => qtyInput.current?.focus())
    } catch (error) {
      const failure = asApiError(error)
      setTradeError(previous => previous?.unknownResult ? previous : failure)
      if (failure.unknownResult) setReview(null)
    }
    finally { setSending(false); writeLock.current = false }
  }

  async function writeOrder(id: string, newPrice?: string) {
    if (writeLock.current || unavailable) return
    writeLock.current = true
    setOrderBusy(id)
    if (!orderError?.unknownResult) setOrderError(null)
    setOrderFeedback('')
    try {
      if (newPrice !== undefined) await api.replaceStop(id, newPrice)
      else await api.cancel(id)
      setOrderFeedback(`${newPrice !== undefined ? '改价' : '撤单'}请求已接受 · 等待券商同步`)
    } catch (error) {
      setOrderError(previous => previous?.unknownResult ? previous : asApiError(error))
      throw error
    }
    finally { setOrderBusy(null); writeLock.current = false }
  }

  async function manualRefreshOrders() {
    if (ordersRefreshing) return
    setOrdersRefreshing(true)
    try { await refreshOrders() } finally { setOrdersRefreshing(false) }
  }

  const nominal = review?.mode === 'breakout' ? review.qty * Number(review.buy_stop)
    : review && referencePrice !== null ? review.qty * referencePrice : null
  const risk = review?.mode === 'breakout' ? review.qty * (Number(review.buy_stop) - Number(review.sell_stop)) : null

  return <div className="app-shell">
    <header className="page-header">
      <a className="brand" href="/" aria-label="Schwab Local 首页"><span className="brand-mark"><svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M5 18v-6m7 6V7m7 11V3" stroke="currentColor" strokeWidth="3.5" strokeLinecap="round" /></svg></span><span>Schwab<span className="brand-local">Local</span></span></a>
      <div className="header-tools"><span className="local-badge"><Icon name="shield" size={14} />本机连接</span><button className="icon-button theme-button" onClick={() => setDark(previous => !previous)} aria-label={dark ? '切换浅色模式' : '切换深色模式'}><Icon name={dark ? 'sun' : 'moon'} size={18} /></button></div>
    </header>

    <div className="workspace-heading"><div><div className="eyebrow">YOUR DAILY WORKSPACE</div><h1>交易工作台<span className="heading-dot">.</span></h1></div><div className="workspace-date">{new Date().toLocaleDateString('zh-CN', { year: 'numeric', month: 'long', day: 'numeric', weekday: 'long' })}<span>专注每一笔交易</span></div></div>

    <section className={`account-bar ${fill ? 'fill-highlight' : ''}`} aria-label="连接状态与账户资金">
      <div className="connection-block"><div className={`connection-pill ${status.tone}`} role="status"><span className="status-dot" />{status.label}</div><div className="snapshot-time"><Icon name="clock" size={12} />{connection === 'reconnecting' ? 'Last ' : ''}{time(snapshotTime)}</div>{fill && <span className="fill-message"><Icon name="check" size={12} />{fill.symbol ?? `#${fill.order_id}`} 已成交</span>}</div>
      <div className="account-metrics">{accountMetrics.map(([label, english, value]) => <div className="account-metric" key={label}><span className="metric-label" title={english ?? ''}>{label}</span><strong>{money(value)}</strong></div>)}</div>
    </section>
    {authRequired ? <div className="connection-note red" role="status"><Icon name="alert" size={14} />Schwab 授权已失效，请在终端运行 <code>.venv/bin/python schwab_backend.py auth</code>，完成后自动恢复。</div>
      : healthError ? <div className="connection-note" role="status"><Icon name="link" size={14} />无法连接本地后端，正在重连。请确认 127.0.0.1:5678 的服务已启动。</div>
      : health && health.schwab_rest !== 'connected' ? <div className="connection-note" role="status"><Icon name="alert" size={14} />账户服务暂不可用，当前保留最后成功快照，连接恢复后自动更新。</div> : null}

    <main className="workspace-grid">
      <section className="card trade-card" aria-labelledby="trade-title">
        <div className="card-heading"><div className="card-title"><span className="section-icon blue"><Icon name="trend" size={19} /></span><h2 id="trade-title">交易面板</h2><span className="section-english">Trade ticket</span></div><span className="subtle-label">US EQUITIES</span></div>
        <div className="symbol-label"><label htmlFor="symbol">股票代码</label><span>Symbol</span></div>
        <form className="symbol-form" onSubmit={event => { event.preventDefault(); void loadQuote(symbolInput) }}>
          <div className="symbol-field"><Icon name="search" size={18} /><input id="symbol" value={symbolInput} onChange={event => setSymbolInput(event.target.value.toUpperCase())} placeholder="输入代码，如 NVDA" autoComplete="off" autoCapitalize="characters" spellCheck={false} disabled={editingLocked} /><kbd>↵</kbd></div>
          <button type="button" className={`icon-button refresh-quote ${quoteLoading ? 'is-loading' : ''}`} aria-label="刷新行情" disabled={quoteLoading || editingLocked || !symbolInput.trim()} onClick={() => void loadQuote(symbolInput, true)}><Icon name="refresh" size={19} /></button>
        </form>
        <div className="quote-strip" aria-label="实时报价" aria-busy={quoteLoading}>
          <div className="quote-item"><span><span className="quote-dot bid" />Bid <small>买价</small></span><strong>{price(quote?.bid)}</strong></div><span className="quote-divider" /><div className="quote-item"><span><span className="quote-dot ask" />Ask <small>卖价</small></span><strong>{price(quote?.ask)}</strong></div>
        </div>
        <div className="quote-range"><span>日低 <strong>{price(quote?.day_low)}</strong></span><span className="range-line"><i /></span><span>日高 <strong>{price(quote?.day_high)}</strong></span></div>
        <div className="quote-meta"><span>{symbol || '等待选择标的'}</span><span>{quoteLoading ? '更新行情中…' : quote ? `更新于 ${time(quote.updated_at)}` : '输入代码后按 Enter 查询'}</span></div>
        <ErrorPill error={quoteError} />

        <form className="ticket-form" onSubmit={startReview}>
          <div className="segmented-control" aria-label="交易模式"><button type="button" className={mode === 'breakout' ? 'selected' : ''} aria-pressed={mode === 'breakout'} disabled={editingLocked} onClick={() => setMode('breakout')}><Icon name="trend" size={15} />突破单 <span>Breakout</span></button><button type="button" className={mode === 'market' ? 'selected' : ''} aria-pressed={mode === 'market'} disabled={editingLocked} onClick={() => setMode('market')}>市价单 <span>Market</span></button></div>
          <fieldset disabled={editingLocked} className="ticket-fields">
            {mode === 'market' && <div className="market-side" aria-label="买卖方向"><button type="button" className={side === 'buy' ? 'selected buy' : ''} aria-pressed={side === 'buy'} onClick={() => setSide('buy')}>买入 Buy</button><button type="button" className={side === 'sell' ? 'selected sell' : ''} aria-pressed={side === 'sell'} onClick={() => setSide('sell')}>卖出 Sell</button></div>}
            <div className="field-row"><label htmlFor="qty">交易数量<span>Quantity</span></label><div className="pill-input"><input ref={qtyInput} id="qty" inputMode="numeric" autoComplete="off" value={qty} onChange={event => { setQty(event.target.value); setTradeFeedback('') }} placeholder="0" /><span>股</span></div></div>
            {mode === 'breakout' && <>
              <div className="field-row"><label htmlFor="buy-stop">买入触发价<span>Buy stop · DAY</span></label><div className="pill-input"><span>$</span><input id="buy-stop" inputMode="decimal" autoComplete="off" value={buyStop} onChange={event => setBuyStop(event.target.value)} placeholder="0.00" disabled={quoteLoading && !quote} /></div></div>
              <div className="field-row"><label htmlFor="sell-stop">卖出止损价<span>Sell stop · GTC</span></label><div className="pill-input"><span>$</span><input id="sell-stop" inputMode="decimal" autoComplete="off" value={sellStop} onChange={event => setSellStop(event.target.value)} placeholder="0.00" disabled={quoteLoading && !quote} /></div></div>
              <div className="suggestion-row"><span><Icon name="link" size={12} />成交后激活关联止损单</span><button type="button" className="text-button" disabled={!quote || quoteLoading} onClick={() => { setBuyStop(quote?.suggested_buy_stop ?? ''); setSellStop(quote?.suggested_sell_stop ?? '') }}>重置建议价<Icon name="refresh" size={11} /></button></div>
            </>}
          </fieldset>
          {mode === 'market' && stops.length > 0 && <div className="existing-stops">{stops.map((stop, index) => <div className="existing-stop" key={stop.order_id ?? index}><Icon name="shield" size={13} /><span>已挂止损 {quantity(stop.quantity)}股 @ {money(stop.stop_price)}</span>{stop.order_id !== null && stop.cancelable === true && <button type="button" className="text-button" disabled={writing || unavailable} onClick={() => void writeOrder(stop.order_id!).catch(() => {})}>撤单</button>}</div>)}</div>}

          {review && <div className="review-panel"><div className="review-heading"><h3 ref={reviewHeading} tabIndex={-1}>核对订单</h3><span className="review-badge">INLINE REVIEW</span></div><p className="review-summary"><strong>{review.symbol}</strong><span>{review.mode === 'breakout' ? `BUY STOP ${quantity(review.qty)} 股 @ $${price(review.buy_stop)}` : `MARKET ${review.side.toUpperCase()} ${quantity(review.qty)} 股`}</span><small>DAY{review.mode === 'breakout' ? ` → SELL STOP @ $${price(review.sell_stop)} · GTC` : ' · 常规交易时段'}</small></p><dl className="review-values"><div><dt>{review.mode === 'breakout' ? '名义金额' : '参考金额'}</dt><dd>{money(nominal)}</dd></div>{review.mode === 'breakout' && <div><dt>预估风险</dt><dd className="risk-value">{money(risk)}<small>({nominal ? ((risk ?? 0) / nominal * 100).toFixed(2) : '—'}%)</small></dd></div>}</dl><p className="review-note">{review.mode === 'breakout' ? '价差风险为估算值，止损触发后的成交价可能不同。' : `按核对时${review.side === 'buy' ? ' Ask' : ' Bid'}估算，最终以实际成交为准。`}</p></div>}

          <div className="ticket-bottom"><ErrorPill error={tradeError} onRefresh={manualRefreshOrders} />{tradeFeedback && <div className="inline-feedback" role="status"><Icon name="check" size={14} />{tradeFeedback}</div>}
            {review ? <div className="review-actions"><button type="button" className="button button-secondary" disabled={sending} onClick={() => setReview(null)}>返回修改</button><button type="button" className={`button button-primary ${review.mode === 'market' && review.side === 'sell' ? 'sell-primary' : ''}`} disabled={writing || unavailable} onClick={() => void sendOrder()}>{sending ? '发送中…' : 'Confirm & Send'}{!sending && <Icon name="arrow" size={16} />}</button></div>
              : <button className="button button-primary review-button" type="submit" disabled={writing || unavailable || quoteLoading}>Review Order<Icon name="arrow" size={17} /></button>}
            <p className="ticket-footnote"><Icon name="shield" size={12} />{review ? '核对后发送至 Schwab' : '下一步核对订单，确认后发送'}</p>
          </div>
        </form>
      </section>

      <div className="portfolio-column">
        <section className="card positions-card" aria-labelledby="positions-title"><div className="card-heading"><div className="card-title"><span className="section-icon"><Icon name="layers" size={18} /></span><h2 id="positions-title">持仓</h2><span className="section-english">Positions</span><span className="count-badge">{snapshot.positions.length}</span></div><span className="subtle-label">点击填入交易面板<Icon name="arrow" size={12} /></span></div>
          {snapshot.positions.length > 0 ? <div className="positions-table"><div className="position-table-head"><span>标的 / 数量</span><span>持仓均价</span><span>市值</span><span>当日盈亏</span><span /></div><div className="position-list">{snapshot.positions.map(position => {
            const profit = number(position.day_profit_loss)
            const tone = profit === null || profit === 0 ? 'neutral' : profit > 0 ? 'positive' : 'negative'
            return <button className={`position-row ${symbol === position.symbol ? 'is-selected' : ''}`} key={position.symbol} disabled={editingLocked} onClick={() => selectPosition(position)} aria-label={`选择持仓 ${position.symbol}`}><span className="position-symbol"><strong>{position.symbol}</strong><small>{quantity(position.quantity)} 股</small></span><span className="position-average">{money(position.average_price)}</span><span className="position-value">{money(position.market_value)}</span><span className={`position-profit ${tone}`}><strong>{money(position.day_profit_loss, true)}</strong><small className="profit-badge">{percent(position.day_profit_loss_percent)}</small></span><Icon name="chevron" size={14} /></button>
          })}</div></div> : <EmptyState kind="layers" title={loading ? '正在读取持仓' : authRequired ? '等待账户授权' : '暂无持仓'} detail={loading ? '连接本地账户，获取最新快照' : authRequired ? '完成 Schwab 授权后，持仓将在这里显示' : '账户中的股票与 ETF 将显示在这里'} />}
          <ErrorPill error={positionsError} />
        </section>

        <section className="card orders-card" aria-labelledby="orders-title"><div className="card-heading"><div className="card-title"><span className="section-icon"><Icon name="orders" size={18} /></span><h2 id="orders-title">活动订单</h2><span className="section-english">Orders</span><span className="count-badge">{activeOrderCount}</span></div><button className={`icon-button small-icon-button ${ordersRefreshing ? 'is-loading' : ''}`} onClick={() => void manualRefreshOrders().catch(() => {})} aria-label="刷新活动订单" disabled={ordersRefreshing || writing}><Icon name="refresh" size={16} /></button></div>
          {visibleOrders.length > 0 ? <div className="orders-list">{visibleOrders.map((order, index) => <div className="order-tree" key={order.order_id ?? `${index}-${order.symbol}`}><OrderNode order={order} busy={orderBusy} locked={writing || unavailable} onCancel={id => writeOrder(id)} onReplace={(id, value) => writeOrder(id, value)} /></div>)}</div> : <EmptyState kind="orders" title={loading ? '正在同步订单' : authRequired ? '等待账户授权' : '暂无活动订单'} detail={loading ? '正在获取最新订单状态' : authRequired ? '完成授权后自动同步订单' : '新的挂单和关联止损单将在这里显示'} />}
          <div className="orders-bottom"><ErrorPill error={orderError ?? ordersError} onRefresh={manualRefreshOrders} />{orderFeedback && <div className="inline-feedback" role="status"><Icon name="check" size={14} />{orderFeedback}</div>}<div className="orders-caption"><span className="tiny-dot" />订单状态自动同步<span>DAY / GTC</span></div></div>
        </section>
      </div>
    </main>
    <footer className="page-footer"><span><Icon name="shield" size={12} />本地工作台 · 直连 Schwab</span><span><span className={`tiny-dot ${connection === 'open' ? 'connected' : ''}`} />{connection === 'open' ? '实时同步已连接' : '等待实时同步'}<span className="footer-separator">/</span>USD</span></footer>
  </div>
}
