import { describe, expect, it } from 'vitest'
import { percent, roundedMoney, price, wholeMoney } from './format'

describe('compact display precision', () => {
  it('rounds P/L to whole dollars and one decimal percent, including losses and tiny values', () => {
    expect(roundedMoney('482.50', true)).toBe('+$483')
    expect(roundedMoney('-482.50', true)).toBe('-$483')
    expect(roundedMoney('-0.1', true)).toBe('$0')
    expect(percent('3.56')).toBe('+3.6%')
    expect(percent('-3.56')).toBe('-3.6%')
    expect(percent('-0.04')).toBe('0.0%')
    expect(percent(null)).toBe('—')
    expect(roundedMoney(null)).toBe('—')
  })
  it('rounds execution prices for display while preserving balance truncation and default quote precision', () => {
    expect(price('140.205', 2)).toBe('140.21')
    expect(price('140.205')).toBe('140.205')
    expect(roundedMoney('4206.75')).toBe('$4,207')
    expect(wholeMoney('4206.75')).toBe('$4,206')
  })
})
