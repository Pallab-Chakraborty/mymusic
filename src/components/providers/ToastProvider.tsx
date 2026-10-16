"use client";

import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from "react";

export type ToastKind = "success" | "error" | "info";

interface Toast {
  id: number;
  kind: ToastKind;
  message: string;
  action?: { label: string; onClick: () => void };
}

interface ToastApi {
  show(message: string, options?: { kind?: ToastKind; action?: Toast["action"]; durationMs?: number }): void;
}

const ToastContext = createContext<ToastApi | null>(null);

export function useToast(): ToastApi {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error("useToast must be used inside ToastProvider");
  return ctx;
}

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const nextId = useRef(1);

  const dismiss = useCallback((id: number) => setToasts((t) => t.filter((x) => x.id !== id)), []);

  const show = useCallback<ToastApi["show"]>(
    (message, options = {}) => {
      const id = nextId.current++;
      const kind = options.kind ?? "success";
      setToasts((t) => [...t.slice(-3), { id, kind, message, action: options.action }]);
      const ms = options.durationMs ?? (kind === "error" ? 8000 : options.action ? 7000 : 3500);
      setTimeout(() => dismiss(id), ms);
    },
    [dismiss],
  );

  const api = useMemo(() => ({ show }), [show]);

  return (
    <ToastContext.Provider value={api}>
      {children}
      <div
        className="pointer-events-none fixed inset-x-0 bottom-[calc(env(safe-area-inset-bottom)+9.5rem)] z-[60] flex flex-col items-center gap-2 px-4 md:bottom-28"
        role="region"
        aria-label="Notifications"
      >
        {toasts.map((t) => (
          <div
            key={t.id}
            role={t.kind === "error" ? "alert" : "status"}
            className={`pointer-events-auto flex max-w-md items-center gap-3 rounded-xl border px-4 py-3 text-sm shadow-xl shadow-black/40 [animation:toast-in_160ms_ease-out] ${
              t.kind === "error" ? "border-danger/50 bg-[#2a1220] text-fg" : "border-line bg-raised text-fg"
            }`}
          >
            <span
              aria-hidden
              className={`h-2 w-2 shrink-0 rounded-full ${
                t.kind === "error" ? "bg-danger" : t.kind === "success" ? "bg-ok" : "bg-blue"
              }`}
            />
            <span className="min-w-0 flex-1">{t.message}</span>
            {t.action && (
              <button
                type="button"
                className="shrink-0 rounded-md px-2 py-1 font-medium text-violet hover:bg-white/5"
                onClick={() => {
                  t.action?.onClick();
                  dismiss(t.id);
                }}
              >
                {t.action.label}
              </button>
            )}
            <button
              type="button"
              aria-label="Dismiss"
              className="shrink-0 rounded-md px-1.5 text-muted hover:text-fg"
              onClick={() => dismiss(t.id)}
            >
              ×
            </button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}
