import { useEffect, useState } from 'react'
import { ApiError, type Decimal, type OrderItem } from './api'
import { Icon } from './Icons'
import { number, price, quantity, validPrice, wholeMoney, roundedMoney, percent } from './format'
import { canReplaceStop } from './orders'
import { portfolioSections, type SymbolRow, type SoldSymbol } from './portfolio'
import type { Position } from './api'

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
  return <tr className={`portfolio-row holding-row ${selected ? 'selected' : ''}`} data-symbol={row.symbol}>
    <td><button className="symbol-button" disabled={disabled} onClick={() => onSelect(row)} aria-label={`Select ${row.symbol}`}>{row.symbol}</button></td>
    <td>{held ? quantity(held.quantity) : '0'}{uncovered && <span className="coverage-warning" title="Check order coverage">!</span>}</td>
    <td>{price(held?.average_price, 2)}</td>
    <td className="market-value">{wholeMoney(held?.market_value)}</td>
    <td className={tone(open)} title="Open P/L: longOpenProfitLoss.">{roundedMoney(open, true)}</td>
    <td className={tone(openPercent)} title="Open P/L / (average price × quantity).">{percent(openPercent)}</td>
    <td className={tone(number(held?.day_profit_loss))} title="Day P/L: currentDayProfitLoss.">{roundedMoney(held?.day_profit_loss, true)}</td>
    <td className={tone(number(held?.day_profit_loss_percent))} title="Day P/L: currentDayProfitLossPercentage.">{percent(held?.day_profit_loss_percent)}</td>
    <td><div className="row-orders">{targets.length ? targets.map((order, index) => <OrderControl key={orderKey(order, index)} order={order} symbol={row.symbol} disabled={disabled} busy={busy} onWrite={onWrite} onError={onError} />) : <span className="no-stop">No stop</span>}</div></td>
  </tr>
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
  return <tr className={`portfolio-row entry-row ${selected ? 'selected' : ''}`}>
    <td><button className="symbol-button" disabled={disabled} onClick={() => onSelect(row)} aria-label={`Select ${row.symbol}`}>{row.symbol}</button></td>
    <td><div className="entry-orders">{[...row.entries, ...row.stops, ...row.other].map((order, index) => <OrderControl key={orderKey(order, index)} order={order} symbol={row.symbol} disabled={disabled} busy={busy} onWrite={onWrite} onError={onError} />)}</div></td>
  </tr>
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
        {sections.entries.length > 0 && <div className="list-table-scroll"><table className="portfolio-table entries-table" aria-label="Entry orders"><tbody>{sections.entries.map(row => <EntryRow key={row.symbol} row={row} selected={symbol === row.symbol} disabled={locked || selectionLocked} {...common} />)}</tbody></table></div>}
        {loading && sections.entries.length === 0 && <div className="empty-row">Loading…</div>}
      </section>
      <section aria-label="Holdings"><div className="list-section-heading"><span>Holdings <b>{sections.holdings.filter(row => row.position).length}</b></span><span>{sections.holdings.some(row => !row.position) ? `${sections.holdings.filter(row => !row.position).length} uncovered` : ''}</span></div>
        <div className="list-table-scroll"><table className="portfolio-table holdings-table" aria-label="Holdings and orders">
          {sections.holdings.length > 0 && <thead><tr><th>Symbol</th><th>Qty</th><th>Avg</th><th>Value</th><th>Open P/L</th><th>Open %</th><th>Day P/L</th><th>Day %</th><th>Orders</th></tr></thead>}
          <tbody>{sections.holdings.map(row => <HoldingRow key={row.symbol} row={row} selected={symbol === row.symbol} disabled={locked || selectionLocked} {...common} />)}</tbody>
          <tfoot><tr className="holdings-total" aria-label="Holdings total" title="currentBalances.longMarketValue"><td colSpan={3}>Long Value</td><td className="market-value"><strong>{wholeMoney(longValue)}</strong></td><td colSpan={5} /></tr></tfoot>
        </table></div>
        {loading && sections.holdings.length === 0 && <div className="empty-row">Loading…</div>}
      </section>
      <section aria-label="Sold Today"><div className="list-section-heading"><span>Sold Today <b>{sold.length}</b></span></div>
        {sold.length > 0 && <div className="list-table-scroll"><table className="portfolio-table sold-table" aria-label="Today's buys and sales">
          <thead><tr><th>Symbol</th><th className="buy-column" title="Shares bought today (ET)">Buy Qty</th><th className="buy-column" title="Weighted average of today's actual buy fills; not a matched cost basis">Buy Avg</th><th className="sold-column">Sold Qty</th><th className="sold-column" title="Weighted average of today's actual sell fills">Sold Avg</th><th title="Gross sale proceeds before fees">Proceeds</th></tr></thead>
          <tbody>{sold.map(row => <tr className="portfolio-row sold-row" key={row.symbol} aria-label={`${row.symbol} buys and sales`}>
            <td className="sold-symbol">{row.symbol}</td><td className="buy-column">{quantity(row.boughtQuantity)}</td><td className="buy-column">{price(row.averageBuyPrice, 2)}</td><td className="sold-column">{quantity(row.quantity)}</td><td className="sold-column">{price(row.averagePrice, 2)}</td><td>{roundedMoney(row.amount)}</td>
          </tr>)}</tbody>
        </table></div>}
        {!loading && sold.length === 0 && <div className="empty-row">No sales today</div>}
      </section>
    </div>
  </section>
}
