import type { Decimal } from './api'

export function number(value: Decimal | number | undefined): number | null {
  if (value === null || value === undefined || value === '') return null
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

export function money(value: Decimal | number | undefined, signed = false): string {
  const parsed = number(value)
  if (parsed === null) return '—'
  return new Intl.NumberFormat('en-US', {
    style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: 2,
    ...(signed ? { signDisplay: 'exceptZero' as const } : {}),
  }).format(parsed)
}

export function price(value: Decimal | number | undefined): string {
  const parsed = number(value)
  return parsed === null ? '—' : new Intl.NumberFormat('en-US', {
    minimumFractionDigits: 2, maximumFractionDigits: 4,
  }).format(parsed)
}

export function wholeMoney(value: Decimal | number | undefined): string {
  const parsed = number(value)
  return parsed === null ? '—' : new Intl.NumberFormat('en-US', {
    style: 'currency', currency: 'USD', maximumFractionDigits: 0,
  }).format(Math.trunc(parsed))
}

export function quantity(value: Decimal | number | undefined): string {
  const parsed = number(value)
  return parsed === null ? '—' : new Intl.NumberFormat('en-US', { maximumFractionDigits: 6 }).format(parsed)
}

export function percent(value: Decimal | number | undefined): string {
  const parsed = number(value)
  return parsed === null ? '—' : `${parsed > 0 ? '+' : ''}${parsed.toFixed(2)}%`
}

export function time(value: string | null | undefined): string {
  if (!value || Number.isNaN(Date.parse(value))) return '--:--:--'
  return new Date(value).toLocaleTimeString('en-GB', { hour12: false })
}

export function validPrice(value: string): boolean {
  return /^(?:\d+(?:\.\d*)?|\.\d+)$/.test(value) && Number(value) > 0 && Number.isFinite(Number(value))
}
