import { useLayoutEffect, useId, useRef, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { X } from 'lucide-react'

interface Props {
  open: boolean
  onClose: () => void
  title: string
  children: ReactNode
}

const FOCUSABLE_SELECTOR = 'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])'

export default function Modal({ open, onClose, title, children }: Props) {
  const overlayRef = useRef<HTMLDivElement>(null)
  const dialogRef = useRef<HTMLDivElement>(null)
  const onCloseRef = useRef(onClose)
  const titleId = useId()
  onCloseRef.current = onClose

  useLayoutEffect(() => {
    if (!open) return
    const overlay = overlayRef.current
    const dialog = dialogRef.current
    const viewport = window.visualViewport
    const syncViewport = () => {
      if (!overlay || !viewport) return
      overlay.style.setProperty('--modal-viewport-top', `${viewport.offsetTop}px`)
      overlay.style.setProperty('--modal-viewport-left', `${viewport.offsetLeft}px`)
      overlay.style.setProperty('--modal-viewport-width', `${viewport.width}px`)
      overlay.style.setProperty('--modal-viewport-height', `${viewport.height}px`)
    }
    syncViewport()
    viewport?.addEventListener('resize', syncViewport)
    viewport?.addEventListener('scroll', syncViewport)
    const previouslyFocused = document.activeElement instanceof HTMLElement ? document.activeElement : null
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'

    const getFocusable = () => Array.from(dialog?.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR) ?? [])
      .filter(element => !element.hasAttribute('disabled') && !element.hidden && element.getAttribute('aria-hidden') !== 'true')

    const initialTarget = dialog?.querySelector<HTMLElement>('[data-modal-autofocus]') ?? getFocusable()[0] ?? dialog
    initialTarget?.focus()

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        event.stopPropagation()
        onCloseRef.current()
        return
      }
      if (event.key !== 'Tab' || !dialog) return
      const focusable = getFocusable()
      if (!focusable.length) {
        event.preventDefault()
        dialog.focus()
        return
      }
      const first = focusable[0]
      const last = focusable[focusable.length - 1]
      const active = document.activeElement
      if (event.shiftKey && (active === first || !dialog.contains(active))) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && (active === last || !dialog.contains(active))) {
        event.preventDefault()
        first.focus()
      }
    }

    document.addEventListener('keydown', handleKeyDown)
    return () => {
      viewport?.removeEventListener('resize', syncViewport)
      viewport?.removeEventListener('scroll', syncViewport)
      document.removeEventListener('keydown', handleKeyDown)
      document.body.style.overflow = previousOverflow
      if (previouslyFocused?.isConnected) previouslyFocused.focus()
    }
  }, [open])

  if (!open) return null
  return createPortal(
    <div className="fixed inset-0 z-50">
      <div className="absolute inset-0 bg-slate-900/40 backdrop-blur-[2px]" onClick={onClose} />
      <div ref={overlayRef} className="modal-viewport pointer-events-none absolute inset-0 flex items-end justify-center md:items-center md:p-4">
        <div ref={dialogRef} role="dialog" aria-modal="true" aria-labelledby={titleId} tabIndex={-1} className="pointer-events-auto relative w-full min-w-0 max-w-xl max-h-full overflow-x-hidden overflow-y-auto overscroll-contain rounded-2xl border border-line bg-surface shadow-[0_16px_48px_rgba(32,42,35,0.16)] md:max-h-[min(90dvh,48rem)]">
          <div className="sticky top-0 z-10 flex items-center justify-between gap-3 border-b border-line bg-surface px-3 py-1.5 sm:px-5 sm:py-4">
            <h2 id={titleId} className="min-w-0 break-words font-semibold text-slate-900">{title}</h2>
            <button type="button" onClick={onClose} className="inline-flex min-h-11 min-w-11 shrink-0 items-center justify-center rounded-lg text-muted hover:bg-canvas hover:text-slate-700" aria-label="Закрыть">
              <X size={20} />
            </button>
          </div>
          <div className="min-w-0 p-3 sm:p-5">{children}</div>
        </div>
      </div>
    </div>,
    document.body,
  )
}
