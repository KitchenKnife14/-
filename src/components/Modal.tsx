import { type ReactNode } from 'react'
import { X } from 'lucide-react'

interface Props {
  open: boolean
  onClose: () => void
  title: string
  children: ReactNode
}

export default function Modal({ open, onClose, title, children }: Props) {
  if (!open) return null
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center p-0 md:items-center md:p-4">
      <div className="absolute inset-0 bg-slate-900/40 backdrop-blur-[2px]" onClick={onClose} />
      <div role="dialog" aria-modal="true" aria-label={title} className="relative max-h-[92dvh] w-full overflow-y-auto rounded-t-2xl border border-line bg-surface shadow-[0_16px_48px_rgba(32,42,35,0.16)] md:max-w-lg md:rounded-2xl">
        <div className="sticky top-0 flex items-center justify-between border-b border-line bg-surface px-5 py-4">
          <h2 className="font-semibold text-slate-900">{title}</h2>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-700" aria-label="Закрыть">
            <X size={20} />
          </button>
        </div>
        <div className="p-5">{children}</div>
      </div>
    </div>
  )
}
