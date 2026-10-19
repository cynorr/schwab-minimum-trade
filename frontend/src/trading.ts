import type { Quote, Ticket } from './api'
import { number, validPrice } from './format'

// Mirrors the existing backend configuration; this never changes broker limits.
export const BUY_LIMIT = 20_000
export const LOSS_LIMIT = 500
export type QuantityUnit = 10 | 100 | 1000

export function quantityUnit(reference: number): QuantityUnit {
  return reference < 20 ? 1000 : reference <= 300 ? 100 : 10
}

function parts(value: string) {
  const [whole, fraction = ''] = (value.startsWith('.') ? `0${value}` : value).split('.')
  return { digits: BigInt(`${whole || '0'}${fraction}`), scale: fraction.length }
}

function scaled(value: string, scale: number): bigint {
  const parsed = parts(value)
  return parsed.digits * 10n ** BigInt(scale - parsed.scale)
}

/** Add ruler increments as decimal integers, preserving the original precision. */
export function offsetDecimal(value: string, step: string, ticks: number): string {
  const scale = Math.max(parts(value).scale, parts(step).scale)
  const result = scaled(value, scale) + scaled(step, scale) * BigInt(ticks)
  if (result <= 0n) return '0'
  const digits = result.toString().padStart(scale + 1, '0')
  return scale ? `${digits.slice(0, -scale)}.${digits.slice(-scale)}`.replace(/\.?0+$/, '') : digits
}

function productExceeds(qty: number, price: string, limit: number): boolean {
  const { digits, scale } = parts(price)
  return BigInt(qty) * digits > BigInt(limit) * 10n ** BigInt(scale)
}

export function priceTick(quote: Quote | null): string {
  const high = number(quote?.day_high), low = number(quote?.day_low)
  const reference = number(quote?.ask) ?? high ?? 1
  const minimum = reference < 1 ? 0.0001 : 0.01
  const target = Math.max(minimum, high !== null && low !== null ? Math.max(0, high - low) / 500 : minimum)
  const steps = ['0.0001', '0.0002', '0.0005', '0.001', '0.002', '0.005', '0.01', '0.02', '0.05', '0.1', '0.2', '0.5', '1', '2', '5', '10', '20', '50', '100']
  return steps.reduce((best, step) => Math.abs(Math.log(Number(step) / target)) < Math.abs(Math.log(Number(best) / target)) ? step : best,
    String(minimum))
}

export function ticketIssue(ticket: Ticket, quote: Quote | null, held: number | null): string | null {
  if (!Number.isSafeInteger(ticket.qty) || ticket.qty <= 0) return 'Enter a positive whole-share quantity.'
  if (ticket.mode === 'market' && ticket.side === 'sell') {
    return held === null || ticket.qty > held ? 'Quantity exceeds the current long position.' : null
  }
  const buyPrice = ticket.mode === 'breakout' ? ticket.buy_stop : quote?.ask
  if (!buyPrice || !validPrice(buyPrice)) return 'A valid buy price is required.'
  if (productExceeds(ticket.qty, buyPrice, BUY_LIMIT)) return 'Above the $20,000 buy limit.'
  if (ticket.mode === 'market') return null
  if (!validPrice(ticket.sell_stop)) return 'Enter a positive stop price.'
  const scale = Math.max(parts(buyPrice).scale, parts(ticket.sell_stop).scale)
  const buy = scaled(buyPrice, scale), stop = scaled(ticket.sell_stop, scale)
  if (stop >= buy) return 'Stop must be below the buy price.'
  if ((buy - stop) * 10n > buy) return 'Stop distance exceeds 10%.'
  if (BigInt(ticket.qty) * (buy - stop) > BigInt(LOSS_LIMIT) * 10n ** BigInt(scale)) return 'Above the $500 estimated risk limit.'
  const ask = number(quote?.ask), bid = number(quote?.bid)
  if (ask !== null && Number(buyPrice) <= ask) return 'Buy stop must be above Ask.'
  if (bid !== null && Number(ticket.sell_stop) >= bid) return 'Sell stop must be below Bid.'
  return null
}

export function quoteDefaults(quote: Quote | null, now = new Date()) {
  if (!quote) return { buy: '', stop: '', note: '' }
  const clock = new Intl.DateTimeFormat('en-GB', { timeZone: 'America/New_York', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(now)
  const weekday = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', weekday: 'short' }).format(now)
  const regular = !['Sat', 'Sun'].includes(weekday) && clock >= '09:30' && clock < '16:00'
  const available = (...values: (string | null)[]) => values.find(value => value !== null && validPrice(value)) ?? ''
  const last = available(quote.last_price, quote.close_price)
  const buy = available(regular && validPrice(quote.day_high ?? '') ? quote.suggested_buy_stop : null, quote.ask, last)
  const stop = available(regular && validPrice(quote.day_low ?? '') ? quote.suggested_sell_stop : null, quote.bid, last)
  const source = (value: string, primary: string | null, regularPrimary: string | null, name: string) => !value ? 'unavailable' : regular && value === regularPrimary ? name : value === primary ? (name === 'High' ? 'Ask' : 'Bid') : value === quote.last_price ? 'Last trade' : 'Previous close'
  const buySource = source(buy, quote.ask, quote.suggested_buy_stop, 'High')
  const stopSource = source(stop, quote.bid, quote.suggested_sell_stop, 'Low')
  return { buy, stop, note: buySource === 'High' && stopSource === 'Low' ? '' : `Defaults: Buy · ${buySource}; Stop · ${stopSource}. Reference prices; review before sending.` }
}
