import { useEffect, useRef } from 'react';
import { X } from 'lucide-react';

export interface Toast {
  id: number;
  message: string;
  kind: 'success' | 'error';
}

interface ToastItemProps {
  toast: Toast;
  onDismiss: (id: number) => void;
}

function ToastItem({ toast, onDismiss }: ToastItemProps) {
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (toast.kind === 'success') {
      timerRef.current = setTimeout(() => {
        onDismiss(toast.id);
      }, 3500);
    }
    return () => {
      if (timerRef.current !== null) {
        clearTimeout(timerRef.current);
      }
    };
  }, [toast.id, toast.kind, onDismiss]);

  return (
    <div
      className={`toast toast--${toast.kind}`}
      role={toast.kind === 'error' ? 'alert' : 'status'}
      aria-live={toast.kind === 'error' ? 'assertive' : 'polite'}
    >
      <span className="toast-message">{toast.message}</span>
      <button
        type="button"
        className="toast-close"
        aria-label="Dismiss notification"
        onClick={() => { onDismiss(toast.id); }}
      >
        <X aria-hidden="true" size={13} />
      </button>
    </div>
  );
}

interface ToastStackProps {
  toasts: Toast[];
  onDismiss: (id: number) => void;
}

export function ToastStack({ toasts, onDismiss }: ToastStackProps) {
  if (toasts.length === 0) return null;

  return (
    <div className="toast-stack" aria-label="Notifications">
      {toasts.map(toast => (
        <ToastItem key={toast.id} toast={toast} onDismiss={onDismiss} />
      ))}
    </div>
  );
}
