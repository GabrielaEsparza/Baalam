import { createContext, useCallback, useContext, useRef, useState, type ReactNode } from "react";
import { CheckCircle2, AlertTriangle } from "lucide-react";
import { cx } from ".";

type Action = { label: string; onClick: () => void };
type Toast = { id: number; text: string; kind: "ok" | "error"; action?: Action };
type Push = (text: string, kind?: Toast["kind"], action?: Action) => void;
const Ctx = createContext<Push>(() => {});

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const seq = useRef(0);
  const dismiss = useCallback((id: number) => setToasts((t) => t.filter((x) => x.id !== id)), []);
  const push = useCallback<Push>(
    (text, kind = "ok", action) => {
      const id = ++seq.current;
      setToasts((t) => [...t, { id, text, kind, action }]);
      // Con acción (p. ej. "Deshacer") damos más tiempo para alcanzar a tocarla.
      setTimeout(() => dismiss(id), action ? 6000 : 3000);
    },
    [dismiss],
  );
  return (
    <Ctx.Provider value={push}>
      {children}
      {/* Abajo, sobre la barra de navegación */}
      <div
        aria-live="polite"
        className="pointer-events-none fixed inset-x-0 bottom-[calc(76px+env(safe-area-inset-bottom))] z-[60] flex flex-col items-center gap-2 px-4 lg:bottom-6"
      >
        {toasts.map((t) => (
          <div
            key={t.id}
            className={cx(
              "animate-slide-up flex w-full max-w-md items-center gap-2.5 rounded-btn px-4 py-3 text-[15px] font-medium text-white shadow-lg",
              t.kind === "ok" ? "bg-night" : "bg-danger",
            )}
          >
            {t.kind === "ok" ? <CheckCircle2 className="size-5 shrink-0" /> : <AlertTriangle className="size-5 shrink-0" />}
            <span className="min-w-0 flex-1">{t.text}</span>
            {t.action && (
              <button
                onClick={() => {
                  dismiss(t.id);
                  t.action!.onClick();
                }}
                className="pointer-events-auto -my-1 shrink-0 rounded-btn px-3 py-2 font-bold text-white underline-offset-2 hover:underline"
              >
                {t.action.label}
              </button>
            )}
          </div>
        ))}
      </div>
    </Ctx.Provider>
  );
}

export const useToast = () => useContext(Ctx);
