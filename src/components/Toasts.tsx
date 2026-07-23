import { X } from 'lucide-react'
import { useUi } from '@store/ui'

export function Toasts() {
  const toasts = useUi((s) => s.toasts)
  const dismiss = useUi((s) => s.dismissToast)

  if (!toasts.length) return null
  return (
    <div className="toasts">
      {toasts.map((toast) => (
        <div key={toast.id} className={`toast ${toast.tone}`}>
          <span>{toast.message}</span>
          {toast.action && (
            <button
              className="btn"
              onClick={() => {
                toast.action?.run()
                dismiss(toast.id)
              }}
            >
              {toast.action.label}
            </button>
          )}
          <button className="icon-btn" onClick={() => dismiss(toast.id)} title="Fechar">
            <X size={13} />
          </button>
        </div>
      ))}
    </div>
  )
}
