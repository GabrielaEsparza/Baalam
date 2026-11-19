import { forwardRef, useEffect, useState, type ButtonHTMLAttributes, type InputHTMLAttributes, type ReactNode } from "react";
import { Eye, EyeOff, Loader2, Minus, Plus, X, type LucideIcon } from "lucide-react";

export function cx(...c: (string | false | null | undefined)[]) {
  return c.filter(Boolean).join(" ");
}

/* ---------------- Button ---------------- */
type Variant = "primary" | "secondary" | "dark" | "ghost" | "danger";
const variants: Record<Variant, string> = {
  // Solo un primario (fire-600) por pantalla.
  primary: "bg-fire-600 text-white hover:brightness-110 active:brightness-95",
  secondary: "bg-surface text-ink border border-line hover:bg-surface-2",
  dark: "bg-night text-white hover:bg-purple dark:bg-surface-2 dark:border dark:border-line",
  ghost: "bg-transparent text-ink hover:bg-surface-2",
  danger: "bg-surface text-danger border border-line hover:bg-surface-2",
};

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  loading?: boolean;
  icon?: LucideIcon;
  full?: boolean;
  size?: "md" | "sm";
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = "primary", loading, icon: Icon, full, size = "md", className, children, disabled, ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      disabled={disabled || loading}
      className={cx(
        "inline-flex items-center justify-center gap-2 rounded-btn font-semibold uppercase tracking-wide transition duration-150 ease-out select-none",
        "disabled:opacity-50 disabled:pointer-events-none",
        size === "md" ? "h-[52px] px-5 text-[15px]" : "h-10 px-3.5 text-[13px]",
        full && "w-full",
        variants[variant],
        className,
      )}
      {...rest}
    >
      {loading ? <Loader2 className="size-5 animate-spin" /> : Icon && <Icon className="size-5" strokeWidth={1.75} />}
      {children}
    </button>
  );
});

/* ---------------- Card ---------------- */
export function Card({ className, children, ...rest }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={cx("card", className)} {...rest}>
      {children}
    </div>
  );
}

/* ---------------- Badge de estado ---------------- */
export type MStatus = "active" | "expiring" | "grace" | "expired" | "paused" | "pending";
const statusMap: Record<MStatus, { label: string; color: string }> = {
  active: { label: "Activa", color: "var(--success)" },
  expiring: { label: "Por vencer", color: "var(--warning)" },
  grace: { label: "Vencida · gracia", color: "var(--danger)" },
  expired: { label: "Vencida", color: "var(--danger)" },
  paused: { label: "Pausada", color: "var(--text-2)" },
  pending: { label: "Pendiente", color: "var(--text-2)" },
};

export function StatusBadge({ status }: { status: string }) {
  const s = statusMap[(status as MStatus) ?? "pending"] ?? statusMap.pending;
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full bg-surface-2 px-2.5 py-1 text-[13px] font-semibold text-ink">
      <span className="size-2 rounded-full" style={{ background: s.color }} aria-hidden />
      {s.label}
    </span>
  );
}

/* ---------------- Tabs segmentados ---------------- */
export function Tabs<T extends string>({
  value,
  onChange,
  options,
  className,
}: {
  value: T;
  onChange: (v: T) => void;
  options: { value: T; label: string }[];
  className?: string;
}) {
  return (
    <div role="tablist" className={cx("flex gap-1 rounded-btn bg-surface-2 p-1", className)}>
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="tab"
          aria-selected={value === o.value}
          onClick={() => onChange(o.value)}
          className={cx(
            "h-10 flex-1 rounded-[9px] text-sm font-semibold transition duration-150",
            value === o.value ? "bg-fire text-white" : "text-ink-2 hover:text-ink",
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

/* ---------------- Inputs ---------------- */
export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(function Input(
  { className, ...rest },
  ref,
) {
  return (
    <input
      ref={ref}
      className={cx(
        "h-12 w-full rounded-input border border-line bg-surface-2 px-3.5 text-base text-ink placeholder:text-ink-2",
        "focus:border-orchid focus:outline-none",
        className,
      )}
      {...rest}
    />
  );
});

/** Contraseña con botón de ojito para mostrarla u ocultarla. */
export const PasswordInput = forwardRef<HTMLInputElement, Omit<InputHTMLAttributes<HTMLInputElement>, "type">>(
  function PasswordInput({ className, ...rest }, ref) {
    const [show, setShow] = useState(false);
    const Icon = show ? EyeOff : Eye;
    return (
      <div className="relative">
        <Input ref={ref} type={show ? "text" : "password"} className={cx("pr-12", className)} {...rest} />
        <button
          type="button"
          onClick={() => setShow((v) => !v)}
          aria-label={show ? "Ocultar contraseña" : "Mostrar contraseña"}
          aria-pressed={show}
          className="absolute inset-y-0 right-0 grid w-12 place-items-center rounded-r-input text-ink-2 hover:text-ink focus-visible:outline-2 focus-visible:outline-orchid"
        >
          <Icon className="size-5" strokeWidth={1.75} />
        </button>
      </div>
    );
  },
);

export function Field({
  label,
  error,
  hint,
  children,
}: {
  label: string;
  error?: string;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <label className="block space-y-1.5">
      <span className="t-label">{label}</span>
      {children}
      {error ? (
        <span className="block text-sm font-medium text-danger">{error}</span>
      ) : hint ? (
        <span className="block text-sm text-ink-2">{hint}</span>
      ) : null}
    </label>
  );
}

/** Stepper +/- (el coach ajusta sin teclado). */
export function Stepper({
  value,
  onChange,
  min = 0,
  max = 999,
  step = 1,
  suffix,
}: {
  value: number;
  onChange: (v: number) => void;
  min?: number;
  max?: number;
  step?: number;
  suffix?: string;
}) {
  return (
    <div className="flex h-14 items-center rounded-input border border-line bg-surface-2">
      <button
        type="button"
        aria-label="Menos"
        className="grid h-full w-14 place-items-center text-ink"
        onClick={() => onChange(Math.max(min, value - step))}
      >
        <Minus className="size-5" />
      </button>
      <span className="flex-1 text-center text-xl font-bold tabular-nums">
        {value}
        {suffix && <span className="ml-1 text-sm font-medium text-ink-2">{suffix}</span>}
      </span>
      <button
        type="button"
        aria-label="Más"
        className="grid h-full w-14 place-items-center text-ink"
        onClick={() => onChange(Math.min(max, value + step))}
      >
        <Plus className="size-5" />
      </button>
    </div>
  );
}

export function Switch({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <label className="flex min-h-12 cursor-pointer items-center justify-between gap-4">
      <span className="text-[15px] font-medium">{label}</span>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        onClick={() => onChange(!checked)}
        className={cx(
          "relative h-7 w-12 shrink-0 rounded-full transition duration-150",
          checked ? "bg-purple" : "bg-line",
        )}
      >
        <span
          className={cx(
            "absolute top-0.5 size-6 rounded-full bg-white shadow transition-all duration-150",
            checked ? "left-[22px]" : "left-0.5",
          )}
        />
      </button>
    </label>
  );
}

/* ---------------- Estados ---------------- */
export function EmptyState({
  icon: Icon,
  text,
  action,
}: {
  icon: LucideIcon;
  text: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center gap-3 px-6 py-10 text-center">
      <div className="grid size-14 place-items-center rounded-full bg-surface-2 text-purple dark:text-orchid">
        <Icon className="size-7" strokeWidth={1.75} />
      </div>
      <p className="max-w-xs text-[15px] text-ink-2">{text}</p>
      {action}
    </div>
  );
}

export function Spinner({ className }: { className?: string }) {
  return (
    <div className={cx("grid place-items-center py-16", className)}>
      <Loader2 className="size-7 animate-spin text-orchid" />
    </div>
  );
}

export function ErrorBox({ error, onRetry }: { error: unknown; onRetry?: () => void }) {
  const msg = error instanceof Error ? error.message : "Algo salió mal.";
  return (
    <Card className="border-danger/40 text-center">
      <p className="mb-3 font-medium text-danger">{msg}</p>
      {onRetry && (
        <Button variant="secondary" size="sm" onClick={onRetry}>
          Reintentar
        </Button>
      )}
    </Card>
  );
}

/* ---------------- Sheet (panel inferior) ---------------- */
export function Sheet({
  open,
  onClose,
  title,
  children,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
    };
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center lg:items-center" role="dialog" aria-modal>
      <div className="absolute inset-0 bg-night/60" onClick={onClose} />
      <div className="animate-slide-up safe-bottom relative max-h-[90dvh] w-full overflow-y-auto rounded-t-[20px] bg-surface p-4 pb-6 lg:max-w-lg lg:rounded-card">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="t-h2">{title}</h2>
          <button aria-label="Cerrar" onClick={onClose} className="grid size-11 place-items-center rounded-full hover:bg-surface-2">
            <X className="size-5" />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

/* ---------------- Encabezado de pantalla ---------------- */
/** Título en mayúsculas con una palabra clave en color (como el Figma). */
export function PageTitle({ children, accent, sub }: { children: ReactNode; accent?: string; sub?: ReactNode }) {
  return (
    <header className="mb-5 space-y-1">
      <h1 className="t-display">
        {children} {accent && <span className="text-fire">{accent}</span>}
      </h1>
      {sub && <p className="text-[15px] text-ink-2">{sub}</p>}
    </header>
  );
}

export function SectionTitle({ children, right }: { children: ReactNode; right?: ReactNode }) {
  return (
    <div className="mb-2 mt-6 flex items-center justify-between">
      <h2 className="t-h2 text-orchid">{children}</h2>
      {right}
    </div>
  );
}
