import { useEffect, useState } from 'react'
import { ApiError, type Decimal, type OrderItem } from './api'
import { Icon } from './Icons'
import { money, number, price, quantity, validPrice, wholeMoney, percent } from './format'
import { canReplaceStop } from './orders'
import { portfolioSections, type SymbolRow, type SoldSymbol } from './portfolio'
import type { Position } from './api'

function executionTime(value: string) {
  return new Date(value).toLocaleTimeString('en-GB', { timeZone: 'America/New_York', hour12: false })
}

function orderKey(order: OrderItem, index: number) { return order.order_id ?? `pending-${index}` }
function orderLabel(order: OrderItem) {
  const kind = order.instruction === 'BUY' ? 'Buy' : order.order_type === 'STOP' ? 'Stop' : order.instruction ?? 'Order'
  return `${kind} ${quantity(order.quantity)}`
}

function OrderControl({ order, symbol, disabled, busy, onWrite, onError }: {
  order: OrderItem; symbol: string; disabled: boolean; busy: string | null
  onWrite: RowProps['onWrite']; onError: RowProps['onError']
}) {
  const [editedPrice, setEditedPrice] = useState<string | null>(null)
  useEffect(() => { setEditedPrice(null) }, [order.stop_price])
  const currentPrice = editedPrice ?? order.stop_price ?? ''
  const editable = canReplaceStop(order)
  const inactive = order.status === 'AWAITING_PARENT_ORDER' || order.status === 'PENDING_ACTIVATION'
  async function replace() {
    if (!order.order_id || !editable) return
    if (!validPrice(currentPrice)) { onError(new ApiError('Enter a positive stop price.')); return }
    await onWrite(order.order_id, currentPrice).catch(() => {})
  }
  return <div className="order-control" aria-label={`${symbol} ${orderLabel(order)}`}>
    <span className="order-kind" title={order.status ?? undefined}>{orderLabel(order)}</span>
    <input className="row-price" aria-label={`${symbol} ${order.instruction === 'BUY' ? 'buy' : 'stop'} price`} inputMode="decimal" value={currentPrice} readOnly={!editable} disabled={busy !== null} placeholder={order.order_type === 'MARKET' ? 'Market' : '—'} onChange={event => setEditedPrice(event.target.value)} onKeyDown={event => { if (event.key === 'Enter') { event.preventDefault(); void replace() } }} />
    <div className="row-actions">
      {editable && <button className="mini-button apply-button" aria-label={`Apply stop ${symbol}`} disabled={busy !== null || disabled || currentPrice === order.stop_price} onClick={() => void replace()}><Icon name="check" size={13} /></button>}
      {order.order_id !== null && order.cancelable === true && <button className="mini-button cancel-button" aria-label={`Cancel ${symbol} ${order.order_id}`} title="Cancel order" disabled={busy !== null || disabled} onClick={() => void onWrite(order.order_id!).catch(() => {})}>×</button>}
      {busy === order.order_id && busy !== null && <span aria-label="Order request pending">…</span>}
    </div>
    {inactive && <span className="order-state" title={order.status ?? undefined}>{order.status === 'AWAITING_PARENT_ORDER' ? 'Awaiting parent' : 'Awaiting activation'}</span>}
  </div>
}

function HoldingRow({ row, selected, disabled, busy, onSelect, onWrite, onError }: RowProps) {
  const targets = [...row.stops, ...row.entries, ...row.other]
  const held = row.position
  const open = number(held?.open_profit_loss)
  const cost = number(held?.quantity) !== null && number(held?.average_price) !== null ? Number(held?.quantity) * Number(held?.average_price) : null
  const openPercent = open !== null && cost !== null && cost > 0 ? open / cost * 100 : null
  const tone = (value: number | null) => value === null || Math.abs(value) < 0.005 ? '' : value > 0 ? 'positive' : 'negative'
  const uncovered = !held || row.stops.some(order => Number(order.quantity) > Number(held.quantity))
  return <div className={`portfolio-row holding-row ${selected ? 'selected' : ''}`} data-symbol={row.symbol}>
    <button className="symbol-button" disabled={disabled} onClick={() => onSelect(row)} aria-label={`Select ${row.symbol}`}>{row.symbol}</button>
    <span className="align-right">{held ? quantity(held.quantity) : '0'}{uncovered && <span className="coverage-warning" title="Check order coverage">!</span>}</span>
    <span className="align-right">{money(held?.average_price)}</span>
    <span className="align-right market-value">{money(held?.market_value)}</span>
    <div className="holding-profit">
      <span className={tone(open)} title="Open P/L: longOpenProfitLoss. Percent = Open P/L / (averagePrice × quantity).">{money(open, true)} <small>{percent(openPercent)}</small></span>
      <span className={tone(number(held?.day_profit_loss))} title="Day P/L: currentDayProfitLoss / currentDayProfitLossPercentage."><small>Day </small>{money(held?.day_profit_loss, true)} <small>{percent(held?.day_profit_loss_percent)}</small></span>
    </div>
    <div className="row-orders">{targets.length ? targets.map((order, index) => <OrderControl key={orderKey(order, index)} order={order} symbol={row.symbol} disabled={disabled} busy={busy} onWrite={onWrite} onError={onError} />) : <span className="no-stop">No stop</span>}</div>
  </div>
}

interface RowProps {
  row: SymbolRow
  selected: boolean
  disabled: boolean
  busy: string | null
  onSelect: (row: SymbolRow) => void
  onWrite: (id: string, price?: string) => Promise<void>
  onError: (error: ApiError) => void
}

function EntryRow({ row, selected, disabled, busy, onSelect, onWrite, onError }: RowProps) {
  return <div className={`portfolio-row entry-row ${selected ? 'selected' : ''}`}>
    <button className="symbol-button" disabled={disabled} onClick={() => onSelect(row)} aria-label={`Select ${row.symbol}`}>{row.symbol}</button>
    <div className="entry-orders">{[...row.entries, ...row.stops, ...row.other].map((order, index) => <OrderControl key={orderKey(order, index)} order={order} symbol={row.symbol} disabled={disabled} busy={busy} onWrite={onWrite} onError={onError} />)}</div>
  </div>
}

export function UnifiedList({ positions, orders, sold, longValue, symbol, locked, selectionLocked, busy, loading, onSelect, onWrite, onError, onRefresh, refreshing }: {
  positions: Position[]; orders: OrderItem[]; sold: SoldSymbol[]; symbol: string
  longValue?: Decimal
  locked: boolean; selectionLocked: boolean; busy: string | null; loading: boolean
  onSelect: (row: SymbolRow) => void; onWrite: RowProps['onWrite']; onError: RowProps['onError']
  onRefresh: () => void; refreshing: boolean
}) {
  const sections = portfolioSections(positions, orders)
  const common = { busy, onWrite, onError, onSelect }
  return <section className="portfolio-panel" aria-label="Unified portfolio">
    <div className="portfolio-scroll">
      <section aria-label="Entries"><div className="list-section-heading"><span>Entries <b>{sections.entries.length}</b></span><button className={`icon-button ${refreshing ? 'is-loading' : ''}`} aria-label="Refresh orders" title="Refresh orders" disabled={refreshing || busy !== null} onClick={onRefresh}><Icon name="refresh" size={14} /></button></div>
        {sections.entries.map(row => <EntryRow key={row.symbol} row={row} selected={symbol === row.symbol} disabled={locked || selectionLocked} {...common} />)}
        {loading && sections.entries.length === 0 && <div className="empty-row">Loading…</div>}
      </section>
      <section aria-label="Holdings"><div className="list-section-heading"><span>Holdings <b>{sections.holdings.filter(row => row.position).length}</b></span><span>{sections.holdings.some(row => !row.position) ? `${sections.holdings.filter(row => !row.position).length} uncovered` : ''}</span></div>
        {sections.holdings.length > 0 && <div className="holding-columns" aria-hidden="true"><span>Symbol</span><span>Qty</span><span>Avg</span><span className="market-value">Value</span><span>Open / Day P/L</span><span>Orders</span></div>}
        {sections.holdings.map(row => <HoldingRow key={row.symbol} row={row} selected={symbol === row.symbol} disabled={locked || selectionLocked} {...common} />)}
        {loading && sections.holdings.length === 0 && <div className="empty-row">Loading…</div>}
        <div className="holdings-total" aria-label="Holdings total" title="currentBalances.longMarketValue"><span>Long Value</span><strong className="market-value">{wholeMoney(longValue)}</strong></div>
      </section>
      <section aria-label="Sold Today"><div className="list-section-heading"><span>Sold Today <b>{sold.length}</b></span><span>ET · Gross proceeds</span></div>
        {sold.length > 0 && <div className="sold-columns" aria-hidden="true"><span>Symbol</span><span>Sold</span><span>Avg</span><span>Amount</span><span>Last (ET)</span></div>}
        {sold.map(row => <details className="sold-item" key={row.symbol}>
          <summary className="portfolio-row sold-row" aria-label={`${row.symbol} sell executions`}><span>▸ {row.symbol}</span><span>{quantity(row.quantity)}</span><span>{price(row.averagePrice)}</span><span>{money(row.amount)}</span><span>{executionTime(row.occurredAt)}</span></summary>
          <div className="sold-details">{row.executions.map((execution, index) => <div className="execution-row" key={index}>
            <span>{executionTime(execution.time)} ET · {quantity(execution.quantity)} @ {price(execution.price)}</span>
            <span>Order #{execution.order_id} · Activity #{execution.activity_id} · Leg {execution.leg_id}</span>
          </div>)}</div>
        </details>)}
        {!loading && sold.length === 0 && <div className="empty-row">No sales today</div>}
      </section>
    </div>
  </section>
}
