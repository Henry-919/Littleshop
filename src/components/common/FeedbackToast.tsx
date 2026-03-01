import React, { useEffect } from 'react';
import { AlertCircle, CheckCircle2, Info, X } from 'lucide-react';

export type FeedbackMessage = {
  type: 'success' | 'error' | 'info';
  text: string;
};

export function FeedbackToast({
  message,
  onClose,
  autoHideMs = 2800,
}: {
  message: FeedbackMessage | null;
  onClose: () => void;
  autoHideMs?: number;
}) {
  useEffect(() => {
    if (!message) return;
    const timer = window.setTimeout(onClose, autoHideMs);
    return () => window.clearTimeout(timer);
  }, [message, onClose, autoHideMs]);

  const icon = message?.type === 'success'
    ? <CheckCircle2 className="w-4 h-4 shrink-0" />
    : message?.type === 'error'
      ? <AlertCircle className="w-4 h-4 shrink-0" />
      : <Info className="w-4 h-4 shrink-0" />;

  const tone = message?.type === 'success'
    ? 'bg-emerald-50 border-emerald-100 text-emerald-700'
    : message?.type === 'error'
      ? 'bg-rose-50 border-rose-100 text-rose-700'
      : 'bg-sky-50 border-sky-100 text-sky-700';

  return (
    <div
      className={`transition-all duration-300 ease-out ${message ? 'opacity-100 translate-y-0 max-h-20' : 'opacity-0 -translate-y-1 max-h-0 pointer-events-none'} overflow-hidden`}
    >
      {message && (
        <div className={`rounded-xl border px-4 py-3 flex items-center justify-between gap-3 text-sm ${tone}`}>
          <div className="flex items-center gap-2 min-w-0">
            {icon}
            <span className="truncate">{message.text}</span>
          </div>
          <button
            onClick={onClose}
            className="shrink-0 p-1 rounded-md hover:bg-white/60 transition-all"
            title="关闭提示"
            type="button"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      )}
    </div>
  );
}
