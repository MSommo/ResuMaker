import { useLayoutEffect, useState, type RefObject } from 'react'

export const PAGE_W = 794 // 210mm @ 96dpi
export const PAGE_H = 1123 // 297mm @ 96dpi
export type ZoomMode = 'width' | 'page' | number

/** Scale factor that fits an A4 page into `ref`'s box (CSS `zoom` is applied by the layout via `--fit`). */
export function useFit(ref: RefObject<HTMLElement | null>, mode: ZoomMode, pad = 24, max = 1): number {
  const [fit, setFit] = useState(1)
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const calc = () => {
      if (typeof mode === 'number') return setFit(mode)
      const w = (el.clientWidth - pad * 2) / PAGE_W
      const h = (el.clientHeight - pad * 2) / PAGE_H
      setFit(Math.max(0.1, Math.min(max, mode === 'width' ? w : Math.min(w, h))))
    }
    calc()
    const ro = new ResizeObserver(calc)
    ro.observe(el)
    return () => ro.disconnect()
  }, [ref, mode, pad, max])
  return fit
}
