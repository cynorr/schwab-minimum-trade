import { useState } from 'react'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Ruler } from './Ruler'
import { offsetDecimal, priceTick, quoteDefaults, quantityUnit, ticketIssue } from './trading'
import { quote } from './test/fixtures'

afterEach(() => { cleanup(); vi.unstubAllGlobals() })
describe('ruler arithmetic and risk checks', () => {
  it.each([[19.99, 1000], [20, 100], [50, 100], [300, 100], [300.01, 10], [1000, 10]])('selects the unit for %s', (reference, expected) => {
    expect(quantityUnit(reference)).toBe(expected)
  })
  it('adds and subtracts exact decimal increments without rounding suggestions', () => {
    expect(offsetDecimal('218.4792', '0.01', 1)).toBe('218.4892')
    expect(offsetDecimal('140.51', '0.01', 100)).toBe('141.51')
    expect(offsetDecimal('140.51', '0.01', -100)).toBe('139.51')
    expect(offsetDecimal('.01', '0.01', -5)).toBe('0')
    expect(offsetDecimal('1000', '500', 1)).toBe('1500')
  })
  it('adapts price ticks to the range and supports sub-dollar prices', () => {
    expect(priceTick(quote)).toBe('0.01')
    expect(priceTick({ ...quote, day_high: '1000', day_low: '950', ask: '999' })).toBe('0.1')
    expect(priceTick({ ...quote, day_high: '.9', day_low: '.89', ask: '.9' })).toBe('0.0001')
  })
  it('checks exact dollar boundaries and leaves large market sells outside buy limits', () => {
    const ticket = { mode: 'breakout' as const, symbol: 'NVDA', qty: 100, buy_stop: '450', sell_stop: '430' }
    expect(ticketIssue(ticket, null, null)).toBe(null)
    expect(ticketIssue({ ...ticket, buy_stop: '450.0001' }, null, null)).toBe('Above the $45,000 buy limit.')
    expect(ticketIssue({ ...ticket, sell_stop: '429.9999' }, null, null)).toBe('Above the $2,000 estimated risk limit.')
    expect(ticketIssue({ ...ticket, qty: 1, sell_stop: '382.5' }, null, null)).toBe(null)
    expect(ticketIssue({ ...ticket, qty: 1, sell_stop: '382.4999' }, null, null)).toBe('Stop distance exceeds 15%.')
    expect(ticketIssue({ mode: 'market', side: 'buy', symbol: 'NVDA', qty: 100 }, { ...quote, ask: '450' }, null)).toBe(null)
    expect(ticketIssue({ mode: 'market', side: 'buy', symbol: 'NVDA', qty: 100 }, { ...quote, ask: '450.0001' }, null)).toBe('Above the $45,000 buy limit.')
    expect(ticketIssue({ mode: 'market', side: 'sell', symbol: 'MU', qty: 100 }, null, 100)).toBe(null)
    expect(ticketIssue({ mode: 'market', side: 'sell', symbol: 'MU', qty: 101 }, null, 100)).toBe('Quantity exceeds the current long position.')
  })
  it('supports half-unit keyboard movement, exact manual quantities, and frozen disabled controls', () => {
    function Control() { const [value, setValue] = useState('137'); return <Ruler label="Quantity ruler" value={value} step="50" onChange={setValue} quantity /> }
    render(<Control />)
    const slider = screen.getByRole('slider')
    fireEvent.keyDown(slider, { key: 'ArrowRight' })
    expect(slider.getAttribute('aria-valuenow')).toBe('187')
    fireEvent.keyDown(slider, { key: 'ArrowLeft', shiftKey: true })
    expect(slider.getAttribute('aria-valuenow')).toBe('87')
    fireEvent.keyDown(slider, { key: 'Home' })
    expect(slider.getAttribute('aria-valuenow')).toBe('1')
  })
  it('moves the thumb on a fixed scale and preserves the scale after repeated changes', () => {
    function Control() { const [value, setValue] = useState('140.51'); return <Ruler label="Buy ruler" value={value} step="0.01" onChange={setValue} /> }
    render(<Control />)
    const slider = screen.getByRole('slider')
    const scale = [slider.getAttribute('min'), slider.getAttribute('max')]
    const labels = [...document.querySelectorAll('.ruler-tick')].map(tick => tick.textContent)
    fireEvent.change(slider, { target: { value: '140.53' } })
    expect(slider.getAttribute('aria-valuenow')).toBe('140.53')
    fireEvent.change(slider, { target: { value: '140.45' } })
    expect(slider.getAttribute('aria-valuenow')).toBe('140.45')
    expect([slider.getAttribute('min'), slider.getAttribute('max')]).toEqual(scale)
    expect([...document.querySelectorAll('.ruler-tick')].map(tick => tick.textContent)).toEqual(labels)
  })
  it('selects defaults by New York session and falls back to positive available prices', () => {
    expect(quoteDefaults(quote, new Date('2026-10-15T19:00:00Z'))).toMatchObject({ buy: '140.51', stop: '136.20', note: '' })
    const premarket = quoteDefaults(quote, new Date('2026-10-15T12:00:00Z'))
    expect(premarket).toMatchObject({ buy: '140.22', stop: '140.20' })
    expect(premarket.note).toContain('Ask')
    expect(quoteDefaults({ ...quote, ask: null, bid: '0' }, new Date('2026-10-18T14:00:00Z'))).toMatchObject({ buy: '140.21', stop: '140.21' })
    expect(quoteDefaults({ ...quote, ask: null, bid: null, last_price: '0' }, new Date('2026-10-18T14:00:00Z'))).toMatchObject({ buy: '138', stop: '138' })
    expect(quoteDefaults({ ...quote, ask: null, bid: null, last_price: null, close_price: null }, new Date('2026-10-18T14:00:00Z'))).toMatchObject({ buy: '', stop: '' })
    expect(quoteDefaults(quote, new Date('2026-10-15T13:30:00Z')).buy).toBe('140.51')
    expect(quoteDefaults(quote, new Date('2026-10-15T20:00:00Z')).buy).toBe('140.22')
    expect(quoteDefaults(quote, new Date('2026-12-01T14:00:00Z')).buy).toBe('140.22')
    expect(quoteDefaults(quote, new Date('2026-12-01T14:30:00Z')).buy).toBe('140.51')
    expect(quoteDefaults({ ...quote, day_high: '0', day_low: null }, new Date('2026-10-15T19:00:00Z'))).toMatchObject({ buy: '140.22', stop: '140.20' })
  })
})
