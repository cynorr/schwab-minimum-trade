import { useState } from 'react'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Ruler } from './Ruler'
import { offsetDecimal, priceTick, quantityUnit, ticketIssue } from './trading'
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
    const ticket = { mode: 'breakout' as const, symbol: 'NVDA', qty: 100, buy_stop: '200', sell_stop: '195' }
    expect(ticketIssue(ticket, null, null)).toBe(null)
    expect(ticketIssue({ ...ticket, buy_stop: '200.0001' }, null, null)).toBe('Above the $20,000 buy limit.')
    expect(ticketIssue({ ...ticket, sell_stop: '194.9999' }, null, null)).toBe('Above the $500 estimated risk limit.')
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
  it('only changes the price after an intentional horizontal drag, not a click or vertical gesture', () => {
    vi.stubGlobal('PointerEvent', MouseEvent)
    function Control() { const [value, setValue] = useState('140.51'); return <Ruler label="Buy ruler" value={value} step="0.01" onChange={setValue} /> }
    render(<Control />)
    const slider = screen.getByRole('slider')
    fireEvent.pointerDown(slider, { clientX: 100, clientY: 10 })
    fireEvent.pointerUp(slider, { clientX: 100, clientY: 10 })
    expect(slider.getAttribute('aria-valuenow')).toBe('140.51')
    fireEvent.pointerDown(slider, { clientX: 100, clientY: 10 })
    fireEvent.pointerMove(slider, { clientX: 99, clientY: 30 })
    expect(slider.getAttribute('aria-valuenow')).toBe('140.51')
    fireEvent.pointerDown(slider, { clientX: 100, clientY: 10 })
    fireEvent.pointerMove(slider, { clientX: 82, clientY: 10 })
    fireEvent.pointerUp(slider, { clientX: 82, clientY: 10 })
    expect(slider.getAttribute('aria-valuenow')).toBe('140.53')
  })
})
