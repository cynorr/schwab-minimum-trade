import { useRef, useState, type KeyboardEvent, type PointerEvent } from 'react'
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

const SPACING = 9

export function Ruler({ label, value, step, onChange, disabled = false, quantity = false, limit }: Props) {
  const [dragging, setDragging] = useState(false)
  const [residual, setResidual] = useState(0)
  const drag = useRef<{ x: number; y: number; value: string; ticks: number; active: boolean } | null>(null)
  const base = validPrice(value) ? value : '0'
  const min = quantity ? '1' : step
  const stepNumber = Number(step)

  function changed(start: string, ticks: number) {
    let next = offsetDecimal(start, step, ticks)
    if (Number(next) < Number(min)) next = min
    onChange(next)
  }

  function start(event: PointerEvent<HTMLDivElement>) {
    if (disabled || (event.pointerType === 'mouse' && event.button !== 0)) return
    drag.current = { x: event.clientX, y: event.clientY, value: base, ticks: 0, active: false }
    event.currentTarget.focus({ preventScroll: true })
    event.currentTarget.setPointerCapture?.(event.pointerId)
  }

  function move(event: PointerEvent<HTMLDivElement>) {
    const current = drag.current
    if (!current || disabled) return
    const delta = current.x - event.clientX
    if (!current.active && Math.abs(event.clientY - current.y) > Math.abs(delta) + 5) { end(event); return }
    if (!current.active && Math.abs(delta) < 4) return
    current.active = true
    setDragging(true)
    const ticks = Math.round(delta / SPACING)
    if (ticks !== current.ticks) {
      current.ticks = ticks
      changed(current.value, ticks)
    }
    const raw = offsetDecimal(current.value, step, ticks)
    setResidual(Number(raw) >= Number(min) ? -delta + ticks * SPACING : 0)
  }

  function end(event: PointerEvent<HTMLDivElement>) {
    drag.current = null
    setDragging(false)
    setResidual(0)
    if (event.currentTarget.hasPointerCapture?.(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId)
  }

  function key(event: KeyboardEvent<HTMLDivElement>) {
    if (disabled) return
    const multiplier = event.shiftKey ? 2 : 1
    if (['ArrowRight', 'ArrowUp', 'ArrowLeft', 'ArrowDown', 'Home'].includes(event.key)) {
      event.preventDefault()
      if (event.key === 'Home') onChange(min)
      else changed(base, (event.key === 'ArrowRight' || event.key === 'ArrowUp' ? 1 : -1) * multiplier)
    }
  }

  const ticks = Array.from({ length: 61 }, (_, index) => {
    const offset = index - 30
    const tick = offsetDecimal(base, step, offset)
    const major = offset % 2 === 0
    return <span className={`ruler-tick ${major ? 'major' : ''} ${limit !== undefined && Number(tick) > limit ? 'over-limit' : ''}`} key={offset}
      style={{ left: `calc(50% + ${offset * SPACING + residual}px)`, visibility: Number(tick) <= 0 && offset !== 0 ? 'hidden' : 'visible' }}>
      {offset % (quantity ? 4 : 10) === 0 && <span>{quantity ? tick : price(tick)}</span>}
    </span>
  })

  return <div className={`ruler ${dragging ? 'dragging' : ''} ${disabled ? 'disabled' : ''}`} role="slider" aria-label={label}
    aria-valuemin={base === '0' ? 0 : Number(min)} aria-valuemax={Math.max(Number(min), Number(base) + stepNumber * 30)} aria-valuenow={number(value) ?? 0} aria-valuetext={`${value || '0'}${quantity ? ' shares' : ' dollars'}, ${step} per tick`}
    aria-disabled={disabled} aria-orientation="horizontal" tabIndex={disabled ? -1 : 0}
    title={`Drag to adjust. Arrow keys: ${step}; Shift + arrow: ${stepNumber * 2}.`}
    onPointerDown={start} onPointerMove={move} onPointerUp={end} onPointerCancel={end} onLostPointerCapture={() => { drag.current = null; setDragging(false); setResidual(0) }} onKeyDown={key}>
    <div className="ruler-track" aria-hidden="true">{ticks}</div><span className="ruler-cursor" aria-hidden="true" />
  </div>
}
