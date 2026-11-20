import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react'
import { More } from './icons'

const CloseCtx = createContext<() => void>(() => {})

/**
 * A button that opens a floating panel. The panel closes on Escape (returning focus to the button), on a click outside it,
 * and when the caller closes it, so no popover stays open behind another one.
 */
export function Popover({ trigger, triggerClassName = 'btn small', label, children, align = 'left', className = '', role = 'dialog', onOpenChange }: {
  trigger: ReactNode
  triggerClassName?: string
  label: string
  /** Panel content; receives `close`. */
  children: (close: () => void) => ReactNode
  align?: 'left' | 'right'
  className?: string
  role?: 'dialog' | 'menu'
  onOpenChange?: (open: boolean) => void
}) {
  const [open, setOpenState] = useState(false)
  const wrap = useRef<HTMLDivElement>(null)
  const button = useRef<HTMLButtonElement>(null)
  const panel = useRef<HTMLDivElement>(null)

  const setOpen = useCallback(
    (v: boolean) => {
      setOpenState(v)
      onOpenChange?.(v)
    },
    [onOpenChange],
  )
  const close = useCallback(() => setOpen(false), [setOpen])

  useEffect(() => {
    if (!open) return
    const onPointer = (e: PointerEvent) => {
      if (!wrap.current?.contains(e.target as Node)) close()
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      e.stopPropagation() // closing the popover must not also close a panel behind it
      close()
      button.current?.focus()
    }
    document.addEventListener('pointerdown', onPointer, true)
    document.addEventListener('keydown', onKey, true)
    return () => {
      document.removeEventListener('pointerdown', onPointer, true)
      document.removeEventListener('keydown', onKey, true)
    }
  }, [open, close])

  const focusItem = (dir: 1 | -1 | 'first') => {
    const items = [...(panel.current?.querySelectorAll<HTMLElement>('[role="menuitem"]:not(:disabled)') ?? [])]
    if (!items.length) return
    const i = items.indexOf(document.activeElement as HTMLElement)
    items[dir === 'first' ? 0 : (i + dir + items.length) % items.length].focus()
  }

  return (
    <div className="pop" ref={wrap}>
      <button
        ref={button}
        type="button"
        className={triggerClassName}
        aria-label={label}
        title={label}
        aria-haspopup={role}
        aria-expanded={open}
        onClick={() => setOpen(!open)}
        onKeyDown={(e) => {
          if (role === 'menu' && e.key === 'ArrowDown') {
            e.preventDefault()
            if (!open) setOpen(true)
            requestAnimationFrame(() => focusItem('first'))
          }
        }}
      >
        {trigger}
      </button>
      {open && (
        <div
          ref={panel}
          className={`pop-panel ${align} ${className}`}
          role={role}
          aria-label={label}
          onKeyDown={(e) => {
            if (role !== 'menu') return
            if (e.key === 'ArrowDown') (e.preventDefault(), focusItem(1))
            else if (e.key === 'ArrowUp') (e.preventDefault(), focusItem(-1))
          }}
        >
          <CloseCtx.Provider value={close}>{children(close)}</CloseCtx.Provider>
        </div>
      )}
    </div>
  )
}

/** The "…" button with a list of actions. */
export function Menu({ label = 'More actions', trigger = <More />, children, align = 'right', triggerClassName = 'btn small icon' }: {
  label?: string
  trigger?: ReactNode
  children: ReactNode
  align?: 'left' | 'right'
  triggerClassName?: string
}) {
  return (
    <Popover label={label} trigger={trigger} align={align} className="menu-pop" role="menu" triggerClassName={triggerClassName}>
      {() => children}
    </Popover>
  )
}

/** One action in a `Menu`. Closes the menu when chosen. */
export function MenuItem({ onSelect, icon, danger, disabled, children }: { onSelect: () => void; icon?: ReactNode; danger?: boolean; disabled?: boolean; children: ReactNode }) {
  const close = useContext(CloseCtx)
  return (
    <button
      type="button"
      role="menuitem"
      className={danger ? 'danger' : ''}
      disabled={disabled}
      onClick={() => {
        close()
        onSelect()
      }}
    >
      {icon} {children}
    </button>
  )
}

export const MenuSep = () => <hr className="menu-sep" role="separator" />
