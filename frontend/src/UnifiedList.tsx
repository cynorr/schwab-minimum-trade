import { useEffect, useState } from 'react'
import { ApiError, type OrderItem } from './api'
import { Icon } from './Icons'
import { money, number, price, quantity, time, validPrice } from './format'
import { canReplaceStop, flattenOrders, ACTIVE_STATUSES } from './orders'
import { portfolioSections, type SymbolRow, type ClosedSymbol } from './portfolio'
import type { Position } from './api'

function orderKey(order: OrderItem, index: number) { return order.order_id ?? `pending-${index}` }
function orderLabel(order: OrderItem) {
  const kind = order.instruction === 'BUY' ? 'Buy' : order.order_type === 'STOP' ? 'Stop' : order.instruction ?? 'Order'
  const state = order.status === 'AWAITING_PARENT_ORDER' || order.status === 'PENDING_ACTIVATION' ? 'pending' : (order.status ?? '').toLowerCase().replaceAll('_', ' ')
  return `${kind} ${quantity(order.quantity)} @ ${price(order.stop_price)} · ${state} · #${order.order_id ?? 'pending'}`
}

function HoldingRow({ row, selected, disabled, busy, onSelect, onWrite, onError }: RowProps) {
  // Pending OTO stops stay visible, but activated protection is the initial target.
  const targets = [...row.stops.filter(canReplaceStop), ...row.stops.filter(order => !canReplaceStop(order)), ...row.entries, ...row.other]
  const [selectedKey, setSelectedKey] = useState('')
  const targetIndex = Math.max(0, targets.findIndex((order, index) => orderKey(order, index) === selectedKey))
  const target = targets[targetIndex]
  const [editedPrice, setEditedPrice] = useState<string | null>(null)
  const key = target ? orderKey(target, targetIndex) : ''
  const currentPrice = editedPrice ?? target?.stop_price ?? ''
  useEffect(() => { setEditedPrice(null) }, [key, target?.stop_price])
  const held = row.position
  const profit = number(held?.day_profit_loss)
  const tone = profit === null || profit === 0 ? '' : profit > 0 ? 'positive' : 'negative'
  const isStop = target?.instruction === 'SELL' && target.order_type === 'STOP'
  const editable = target && canReplaceStop(target)
  const stopQty = number(target?.quantity)
  const uncovered = !held || (isStop && stopQty !== null && stopQty > (number(held.quantity) ?? 0))

  async function replace() {
    if (!target?.order_id || !editable) return
    if (!validPrice(currentPrice)) { onError(new ApiError('Enter a positive stop price.')); return }
    await onWrite(target.order_id, currentPrice).catch(() => {})
  }

  return <div className={`portfolio-row holding-row ${selected ? 'selected' : ''} ${uncovered ? 'uncovered' : ''}`} data-symbol={row.symbol}>
    <button className="symbol-button" disabled={disabled} onClick={() => onSelect(row)} title={row.entries.length ? `${row.entries.length} pending buy order(s); select B to manage.` : undefined} aria-label={`Select ${row.symbol}`}>{row.symbol}{row.entries.length > 0 && <sup>+B</sup>}</button>
    <span className="align-right" title={uncovered ? 'Active order without matching long-position coverage.' : undefined}>{held ? quantity(held.quantity) : '0'}{uncovered && <span className="coverage-warning" title="Check order coverage">!</span>}</span>
    <span className="align-right">{money(held?.average_price)}</span>
    <span className="align-right market-value">{money(held?.market_value)}</span>
    <span className={`align-right ${tone}`} title={held?.day_profit_loss_percent ? `${held.day_profit_loss_percent}% today` : undefined}>{money(held?.day_profit_loss, true)}</span>
    <div className="row-stop-control">
      {target ? <>
        <select className="order-target" aria-label={`${row.symbol} order target`} title={orderLabel(target)} value={key} disabled={busy !== null} onChange={event => { setSelectedKey(event.target.value); setEditedPrice(null) }}>
          {targets.map((order, index) => <option key={orderKey(order, index)} value={orderKey(order, index)}>{order.instruction === 'BUY' ? 'B' : order.order_type === 'STOP' ? 'S' : 'O'} · {orderLabel(order)}</option>)}
        </select>
        <input className="row-price" aria-label={`${row.symbol} stop price`} title={orderLabel(target)} inputMode="decimal" value={currentPrice} readOnly={!editable} disabled={busy !== null} placeholder="—" onChange={event => setEditedPrice(event.target.value)} onKeyDown={event => { if (event.key === 'Enter') { event.preventDefault(); void replace() } }} />
      </> : <span className="no-stop">No stop</span>}
    </div>
    <div className="row-actions">
      {editable && <button className="mini-button apply-button" aria-label={`Apply stop ${row.symbol}`} title="Apply stop price" disabled={busy !== null || disabled || currentPrice === target.stop_price} onClick={() => void replace()}><Icon name="check" size={13} /></button>}
      {target?.order_id !== null && target?.order_id !== undefined && target.cancelable === true && <button className="mini-button cancel-button" aria-label={`Cancel ${row.symbol} ${target.order_id}`} title={`Cancel #${target.order_id}`} disabled={busy !== null || disabled} onClick={() => void onWrite(target.order_id!).catch(() => {})}>×</button>}
      {busy !== null && busy === target?.order_id && <span className="row-pending" aria-label="Order request pending">…</span>}
    </div>
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
  const [selectedKey, setSelectedKey] = useState('')
  const targets = [...row.entries, ...row.stops.filter(order => order.order_id !== null), ...row.other]
  const targetIndex = Math.max(0, targets.findIndex((order, index) => orderKey(order, index) === selectedKey))
  const target = targets[targetIndex]
  const entry = target.instruction === 'BUY' ? target : row.entries.find(order => flattenOrders(order.child_orders).some(child => child.order_id === target.order_id)) ?? row.entries[0]
  const stop = target.instruction === 'SELL' && target.order_type === 'STOP' ? target
    : flattenOrders(entry.child_orders).find(child => child.instruction === 'SELL' && child.order_type === 'STOP' && ACTIVE_STATUSES.has(child.status ?? ''))
  const [newStop, setNewStop] = useState<string | null>(null)
  const key = orderKey(target, targetIndex)
  useEffect(() => { setNewStop(null) }, [key, target.stop_price])
  const editable = canReplaceStop(target)
  const remaining = number(entry.quantity) === null ? null : Math.max(0, Number(entry.quantity) - (number(entry.filled_quantity) ?? 0))
  async function replace() {
    const value = newStop ?? target.stop_price ?? ''
    if (!editable || !target.order_id) return
    if (!validPrice(value)) { onError(new ApiError('Enter a positive stop price.')); return }
    await onWrite(target.order_id, value).catch(() => {})
  }
  return <div className={`portfolio-row entry-row ${selected ? 'selected' : ''}`} data-symbol={row.symbol}>
    <button className="symbol-button" disabled={disabled} onClick={() => onSelect(row)} aria-label={`Select ${row.symbol}`}>{row.symbol}</button>
    <span className="align-right" title={Number(entry.filled_quantity) > 0 ? `${quantity(entry.filled_quantity)} already filled` : undefined}>{quantity(remaining)}</span>
    <span className="entry-buy">{entry.order_type === 'MARKET' ? 'Market buy' : `Buy ${price(entry.stop_price)}`}</span>
    <span className="entry-stop" title={stop ? orderLabel(stop) : undefined}>{editable ? <input className="row-price" aria-label={`${row.symbol} stop price`} inputMode="decimal" disabled={busy !== null} value={newStop ?? target.stop_price ?? ''} onChange={event => setNewStop(event.target.value)} /> : stop ? `Stop ${price(stop.stop_price)}` : 'No linked stop'}</span>
    <div className="entry-target">{targets.length > 1 ? <select aria-label={`${row.symbol} entry target`} title={orderLabel(target)} value={key} disabled={busy !== null} onChange={event => setSelectedKey(event.target.value)}>{targets.map((order, index) => <option key={orderKey(order, index)} value={orderKey(order, index)}>{orderLabel(order)}</option>)}</select> : <span className="inline-state">{entry.status === 'PARTIALLY_FILLED' ? 'Partial' : entry.strategy_type === 'TRIGGER' ? 'OTO' : entry.duration === 'GOOD_TILL_CANCEL' ? 'GTC' : 'DAY'}</span>}</div>
    <div className="row-actions">{editable && <button className="mini-button apply-button" aria-label={`Apply stop ${row.symbol}`} disabled={busy !== null || disabled || newStop === null || newStop === target.stop_price} onClick={() => void replace()}><Icon name="check" size={13} /></button>}{target.order_id !== null && target.cancelable === true && <button className="mini-button cancel-button" aria-label={`Cancel ${row.symbol} ${target.order_id}`} title={`Cancel #${target.order_id}`} disabled={busy !== null || disabled} onClick={() => void onWrite(target.order_id!).catch(() => {})}>{busy === target.order_id ? '…' : '×'}</button>}</div>
  </div>
}

export function UnifiedList({ positions, orders, closed, symbol, locked, selectionLocked, busy, loading, onSelect, onWrite, onError, onRefresh, refreshing }: {
  positions: Position[]; orders: OrderItem[]; closed: ClosedSymbol[]; symbol: string
  locked: boolean; selectionLocked: boolean; busy: string | null; loading: boolean
  onSelect: (row: SymbolRow) => void; onWrite: RowProps['onWrite']; onError: RowProps['onError']
  onRefresh: () => void; refreshing: boolean
}) {
  const sections = portfolioSections(positions, orders, closed)
  const common = { busy, onWrite, onError, onSelect }
  return <section className="portfolio-panel" aria-label="Unified portfolio">
    <div className="portfolio-scroll">
      <section aria-label="Entries"><div className="list-section-heading"><span>Entries <b>{sections.entries.length}</b></span><button className={`icon-button ${refreshing ? 'is-loading' : ''}`} aria-label="Refresh orders" title="Refresh orders" disabled={refreshing || busy !== null} onClick={onRefresh}><Icon name="refresh" size={14} /></button></div>
        {sections.entries.map(row => <EntryRow key={row.symbol} row={row} selected={symbol === row.symbol} disabled={locked || selectionLocked} {...common} />)}
        {loading && sections.entries.length === 0 && <div className="empty-row">Loading…</div>}
      </section>
      <section aria-label="Holdings"><div className="list-section-heading"><span>Holdings <b>{sections.holdings.filter(row => row.position).length}</b></span><span>{sections.holdings.some(row => !row.position) ? `${sections.holdings.filter(row => !row.position).length} uncovered` : 'Day P/L'}</span></div>
        {sections.holdings.length > 0 && <div className="holding-columns" aria-hidden="true"><span>Symbol</span><span>Qty</span><span>Avg</span><span className="market-value">Value</span><span>P/L</span><span>Stop / order</span><span /></div>}
        {sections.holdings.map(row => <HoldingRow key={row.symbol} row={row} selected={symbol === row.symbol} disabled={locked || selectionLocked} {...common} />)}
        {loading && sections.holdings.length === 0 && <div className="empty-row">Loading…</div>}
      </section>
      <section aria-label="Closed today"><div className="list-section-heading"><span>Closed today <b>{sections.closed.length}</b></span><span className="session-scope" title="Only sell fills received while this page is open, with a confirmed flat position. Full-day history is not provided by the backend.">Session only</span></div>
        {sections.closed.map(row => <div className="portfolio-row closed-row" key={row.symbol}><button className="symbol-button" aria-label={`Select ${row.symbol}`} disabled={selectionLocked} onClick={() => onSelect(row)}>{row.symbol}</button><span>Sold {quantity(row.closed?.quantity)}</span><span>{time(row.closed?.occurredAt)}</span><span className="inline-state">Flat</span></div>)}
      </section>
    </div>
  </section>
}
