import { useEffect, useState, type KeyboardEvent } from 'react'
import { number, price, validPrice } from './format'
import { offsetDecimal } from './trading'

interface Props {
  label: string
  value: string
  step: string
  onChange: (value: string) => void
  disabled?: boolean
  quantity?: boolean
  limit?: number
}

export function Ruler({ label, value, step, onChange, disabled = false, quantity = false, limit }: Props) {
  const [anchor, setAnchor] = useState(value)
  const base = validPrice(anchor) ? anchor : step
  const lower = quantity ? '0' : offsetDecimal(base, step, -30)
  const upper = quantity ? String(Math.max(Number(step) * 20, Math.ceil(Number(base) / Number(step)) * Number(step))) : offsetDecimal(base, step, 30)
  const min = Number(lower), max = Number(upper)
  const current = number(value) ?? min
  useEffect(() => {
    // Only a typed value outside the scale reframes it; moving the thumb never does.
    if (validPrice(value) && (!validPrice(anchor) || Number(value) < min || Number(value) > max)) setAnchor(value)
  }, [value, anchor, min, max])

  function key(event: KeyboardEvent<HTMLInputElement>) {
    if (disabled || !['ArrowRight', 'ArrowUp', 'ArrowLeft', 'ArrowDown', 'Home', 'End'].includes(event.key)) return
    event.preventDefault()
    if (event.key === 'Home') onChange(quantity ? '1' : lower === '0' ? step : lower)
    else if (event.key === 'End') onChange(upper)
    else {
      const ticks = (event.key === 'ArrowRight' || event.key === 'ArrowUp' ? 1 : -1) * (event.shiftKey ? 2 : 1)
      const next = offsetDecimal(value || step, step, ticks)
      onChange(String(Math.min(max, Math.max(quantity ? 1 : Number(step), Number(next)))))
    }
  }
  const tickCount = Math.round((max - min) / Number(step))
  const stride = Math.max(1, Math.ceil(tickCount / 60))
  const ticks = Array.from({ length: Math.floor(tickCount / stride) + 1 }, (_, labelIndex) => {
    const index = labelIndex * stride
    const tick = offsetDecimal(lower, step, index)
    return <span className={`ruler-tick ${index % 2 === 0 ? 'major' : ''} ${limit !== undefined && Number(tick) > limit ? 'over-limit' : ''}`} key={index} style={{ left: `${index / tickCount * 100}%` }}>
      {index % (quantity ? 4 : 10) === 0 && <span>{quantity ? tick : price(tick)}</span>}
    </span>
  })
  return <div className={`ruler ${disabled ? 'disabled' : ''}`}>
    <div className="ruler-track" aria-hidden="true">{!disabled && ticks}</div>
    <input type="range" aria-label={label} min={min} max={max} step="any" value={current} disabled={disabled}
      aria-valuemin={min} aria-valuemax={max} aria-valuenow={current} aria-valuetext={`${value || 'unavailable'}${quantity ? ' shares' : ' dollars'}, ${step} per tick`}
      title={`Click or drag the thumb. Arrow keys: ${step}; Shift + arrow: ${Number(step) * 2}.`}
      onKeyDown={key} onChange={event => {
        const ticks = Math.round((Number(event.target.value) - min) / Number(step))
        const next = offsetDecimal(lower, step, ticks)
        onChange(quantity && Number(next) < 1 ? '1' : next === '0' ? step : next)
      }} />
  </div>
}
