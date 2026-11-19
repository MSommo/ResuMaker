import { useRef, type CSSProperties } from 'react'
import { getLayout } from '../layouts/registry'
import type { Resume } from '../model/types'
import { PAGE_W, useFit, type ZoomMode } from './useFit'

export function CvView({ resume }: { resume: Resume }) {
  const Layout = getLayout(resume.layoutId).Component
  return <Layout resume={resume} />
}

/** Scrollable area that scales the CV to fit. Used by the editor and the fullscreen preview. */
export function CvViewport({ resume, mode = 'width', max = 1, className = '' }: { resume: Resume; mode?: ZoomMode; max?: number; className?: string }) {
  const ref = useRef<HTMLDivElement>(null)
  const fit = useFit(ref, mode, 24, max)
  return (
    <div ref={ref} className={`viewport ${className}`} style={{ '--fit': fit } as CSSProperties}>
      <CvView resume={resume} />
    </div>
  )
}

/** First page only, as a card thumbnail. Not interactive. */
export function PageThumb({ resume }: { resume: Resume }) {
  const ref = useRef<HTMLDivElement>(null)
  const fit = useFit(ref, 'width', 0, 1)
  return (
    <div ref={ref} className="thumb" style={{ '--fit': fit, '--page-w': `${PAGE_W}px` } as CSSProperties} aria-hidden {...({ inert: '' } as object)}>
      <CvView resume={resume} />
    </div>
  )
}
