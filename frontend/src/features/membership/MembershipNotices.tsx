import { useQuery } from "@tanstack/react-query";
import { CalendarClock, Lock, LogOut, MessageCircle } from "lucide-react";
import { api, unwrap } from "@/api/client";
import type { Me } from "@/api/types";
import { Button, cx } from "@/components/ui";
import { useLogout } from "@/features/auth/useLogout";
import { fmtDate, waLink } from "@/lib/format";

/** WhatsApp de la coach (Ajustes del gym); si aún no carga, el número de recepción. */
const FALLBACK_WA = "523841008315";

export function useGymWhatsapp() {
  const { data } = useQuery({ queryKey: ["gym"], queryFn: () => unwrap(api.GET("/api/gym")), staleTime: 10 * 60_000 });
  return data?.whatsapp || FALLBACK_WA;
}

export function WhatsAppButton({
  text,
  label = "Escribir a la coach por WhatsApp",
  variant = "primary",
  className,
}: {
  text: string;
  label?: string;
  variant?: "primary" | "secondary" | "dark";
  className?: string;
}) {
  const wa = useGymWhatsapp();
  return (
    <a href={waLink(wa, text)} target="_blank" rel="noreferrer" className={cx("block", className)}>
      <Button full variant={variant} icon={MessageCircle}>
        {label}
      </Button>
    </a>
  );
}

/** Estados en los que la app se puede usar. */
export const USABLE = ["active", "expiring", "grace"];

export function isUsable(me: Me | null | undefined) {
  return !!me && USABLE.includes(me.membership?.status ?? "pending");
}

const endLabel = (iso: string) => fmtDate(iso, { weekday: "long", day: "numeric", month: "long" });

/** Pantalla completa cuando la mensualidad no está vigente: solo info y contacto. */
export function InactiveScreen({ me }: { me: Me }) {
  const logout = useLogout();
  const m = me.membership;
  const status = m?.status ?? "pending";
  const first = me.full_name.split(" ")[0];

  const detail =
    status === "paused"
      ? "Tu mensualidad está en pausa."
      : !m
        ? "Tu cuenta aún no tiene una mensualidad activa."
        : `Venció el ${endLabel(m.end_date)}.`;

  return (
    <main className="grid min-h-dvh place-items-center bg-bg px-4 py-10">
      <div className="w-full max-w-sm text-center">
        <img src="/logo.webp" alt="" className="mx-auto size-20 rounded-full" />
        <div className="mx-auto mt-6 grid size-14 place-items-center rounded-full bg-danger/10 text-danger">
          <Lock className="size-7" strokeWidth={1.75} />
        </div>
        <h1 className="t-display mt-4">
          Tu mensualidad <span className="text-fire">Báalam</span> no está vigente
        </h1>
        <p className="mt-3 text-[15px] text-ink-2">{detail}</p>
        <p className="mt-1 text-[15px] text-ink-2">
          Acércate a recepción o comunícate con administración para renovarla. Tu progreso sigue guardado.
        </p>
        <div className="mt-6 space-y-2">
          <WhatsAppButton text={`Hola, soy ${first}. Quiero renovar mi mensualidad de BÁALAM.`} />
          <Button full variant="secondary" icon={LogOut} onClick={logout}>
            Cerrar sesión
          </Button>
        </div>
      </div>
    </main>
  );
}

/** Aviso en todas las pantallas la semana en que termina la mensualidad; se quita al renovar. */
export function ExpiringBanner({ me }: { me: Me }) {
  const wa = useGymWhatsapp();
  const m = me.membership;
  if (!m || (m.status !== "expiring" && m.status !== "grace")) return null;
  const first = me.full_name.split(" ")[0];
  const grace = m.status === "grace";
  const when =
    m.days_left === 0 ? "hoy" : m.days_left === 1 ? "mañana" : `el ${endLabel(m.end_date)}`;

  return (
    <div
      role="status"
      className={cx(
        "mb-4 flex gap-3 rounded-card border px-4 py-3",
        grace ? "border-danger/40 bg-danger/10" : "border-gold bg-gold/20",
      )}
    >
      <CalendarClock className={cx("mt-0.5 size-5 shrink-0", grace ? "text-danger" : "text-warning")} />
      <div className="flex-1 space-y-1 text-[15px]">
        <p className="font-semibold">
          {grace ? `Tu mensualidad venció el ${endLabel(m.end_date)}.` : `Tu mensualidad termina ${when}.`}
        </p>
        {m.blocked_on && (
          <p className="font-medium">
            Si no la renuevas, dejarás de tener acceso a la app el <b>{endLabel(m.blocked_on)}</b>.
          </p>
        )}
        <p className="text-ink-2">Acércate a recepción para renovarla.</p>
        <a
          className="inline-block font-semibold text-orchid underline underline-offset-2"
          target="_blank"
          rel="noreferrer"
          href={waLink(wa, `Hola, soy ${first}. Quiero renovar mi mensualidad de BÁALAM.`)}
        >
          Escribir a la coach
        </a>
      </div>
    </div>
  );
}
