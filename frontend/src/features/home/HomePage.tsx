import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { CalendarPlus, CheckCircle2, ChevronRight, Dumbbell, Megaphone, Pin, QrCode, Ruler } from "lucide-react";
import { BirthdayToast } from "./BirthdayToast";
import { WaterCard } from "./WaterCard";
import { api, unwrap } from "@/api/client";
import { useMe } from "@/app/session";
import { Avatar } from "@/components/Avatar";
import type { TodayWorkout } from "@/api/types";
import { Button, Card, ErrorBox, Spinner, StatusBadge, cx } from "@/components/ui";
import { fmtDate, fmtTime, WD_SHORT } from "@/lib/format";

export const useHome = () => useQuery({ queryKey: ["home"], queryFn: () => unwrap(api.GET("/api/home")) });

export default function HomePage() {
  const { data: h, isLoading, error, refetch } = useHome();
  const { data: me } = useMe();
  if (isLoading) return <Spinner />;
  if (error || !h) return <ErrorBox error={error} onRetry={refetch} />;

  const m = h.membership;
  const status = m?.status ?? "pending";
  const workout = h.today_workout as TodayWorkout | null;
  const attended = h.week_checkins.filter(Boolean).length;
  const todayIdx = (new Date().getDay() + 6) % 7;

  return (
    <div className="space-y-4">
      <BirthdayToast people={h.birthdays} />
      <header className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="t-label">{fmtDate(new Date(), { weekday: "long", day: "numeric", month: "long" })}</p>
          <h1 className="t-display mt-1">
            {h.greeting}, <span className="text-orchid">{h.first_name}</span>
          </h1>
        </div>
        <Link to="/app/perfil" aria-label="Mi perfil" className="shrink-0">
          <Avatar url={me?.avatar_url} name={h.first_name} size={52} />
        </Link>
      </header>

      {/* Avisos del coach: se quedan aquí hasta que el coach los borre */}
      {h.announcements.map((a) => (
        <section key={a.id} className="rounded-card border border-orchid/40 bg-orchid/10 px-4 py-3">
          <p className="t-label flex items-center gap-1.5 text-orchid">
            {a.pinned ? <Pin className="size-4" /> : <Megaphone className="size-4" />} Aviso del coach
          </p>
          <p className="mt-1 font-semibold">{a.title}</p>
          {a.body && <p className="mt-0.5 whitespace-pre-line text-[15px] text-ink-2">{a.body}</p>}
        </section>
      ))}

      {/* Acción principal: registrar asistencia */}
      {h.checked_in_today ? (
        <Card className="animate-pop flex items-center gap-4">
          <div className="grid size-14 shrink-0 place-items-center rounded-full bg-success/15 text-success">
            <CheckCircle2 className="size-8" strokeWidth={1.75} />
          </div>
          <div>
            <p className="t-h2">Asistencia registrada</p>
            <p className="text-[15px] text-ink-2">+100 puntos. A darle.</p>
          </div>
        </Card>
      ) : (
        <Card className="space-y-4 bg-night text-white dark:bg-surface">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="t-h2">Registra tu asistencia</p>
              <p className="mt-1 text-[15px] text-[#B8AEC2]">
                {h.today_booking
                  ? `Hoy · ${h.today_booking.name} · ${fmtTime(h.today_booking.start_at)}`
                  : "Escanea el QR de recepción al llegar."}
              </p>
            </div>
            <QrCode className="size-9 shrink-0 text-fire" strokeWidth={1.75} />
          </div>
          <Link to="/app/checkin" className="block">
            <Button full icon={QrCode} disabled={!["active", "expiring", "grace"].includes(status)}>
              Escanear QR
            </Button>
          </Link>
        </Card>
      )}

      {/* Días faltantes por reservar */}
      {h.missing_days_week > 0 && (
        <Link to="/app/horarios" className="card flex items-center gap-3 hover:bg-surface-2">
          <CalendarPlus className="size-6 shrink-0 text-purple dark:text-orchid" strokeWidth={1.75} />
          <p className="flex-1 text-[15px] font-medium">
            Te {h.missing_days_week === 1 ? "falta 1 día" : `faltan ${h.missing_days_week} días`} por reservar esta semana
          </p>
          <ChevronRight className="size-5 text-ink-2" />
        </Link>
      )}

      {/* Entrenamiento de hoy */}
      {workout && (
        <Card className="flex items-center gap-4">
          <div className="grid size-12 shrink-0 place-items-center rounded-full bg-purple/10 text-purple dark:text-orchid">
            <Dumbbell className="size-6" strokeWidth={1.75} />
          </div>
          <div className="min-w-0 flex-1">
            <p className="t-label">Hoy</p>
            <p className="truncate font-display text-xl font-bold uppercase">
              {workout.title}
              {workout.focus && ` · ${workout.focus}`}
            </p>
            <p className="text-sm text-ink-2">
              {workout.exercises} ejercicios · ~{workout.est_minutes} min
            </p>
          </div>
          <Link to="/app/entrenar">
            <Button variant="secondary" size="sm">
              Empezar
            </Button>
          </Link>
        </Card>
      )}

      {/* Nunca ha registrado peso/medidas */}
      {h.measures_never && (
        <Link to="/app/progreso" className="card flex items-center gap-3 border-gold bg-gold/15 hover:bg-gold/25">
          <Ruler className="size-6 shrink-0 text-warning" strokeWidth={1.75} />
          <div className="flex-1">
            <p className="font-semibold">Registra tu peso y medidas</p>
            <p className="text-sm text-ink-2">Así ves tu avance y se calcula tu meta de agua.</p>
          </div>
          <ChevronRight className="size-5 text-ink-2" />
        </Link>
      )}

      {/* Un mes sin registrar peso/medidas */}
      {h.measures_due_days != null && (
        <Link to="/app/progreso" className="card flex items-center gap-3 border-gold bg-gold/15 hover:bg-gold/25">
          <Ruler className="size-6 shrink-0 text-warning" strokeWidth={1.75} />
          <div className="flex-1">
            <p className="font-semibold">Actualiza tu peso y medidas</p>
            <p className="text-sm text-ink-2">
              {h.measures_due_days >= 60 ? `Hace ${Math.floor(h.measures_due_days / 30)} meses` : "Hace más de un mes"} que no las registras.
            </p>
          </div>
          <ChevronRight className="size-5 text-ink-2" />
        </Link>
      )}

      {/* Agua del día */}
      {h.water && <WaterCard water={h.water as { ml: number; goal_ml: number }} />}

      {/* Racha de la semana */}
      <Card>
        <div className="flex items-baseline justify-between">
          <p className="t-label">Racha de la semana</p>
          <p className="text-sm font-semibold text-ink-2">
            {attended}/{m?.sessions_per_week ?? 0} días
          </p>
        </div>
        <ol className="mt-3 grid grid-cols-7 gap-1.5">
          {h.week_checkins.map((done, i) => (
            <li key={i} className="flex flex-col items-center gap-1.5">
              <span
                className={cx(
                  "grid size-9 place-items-center rounded-full border-2 text-xs font-bold",
                  done ? "border-gold bg-gold text-night" : "border-line text-ink-2",
                  i === todayIdx && !done && "border-fire",
                )}
                aria-label={done ? "Asististe" : "Sin asistencia"}
              >
                {done ? "✓" : ""}
              </span>
              <span className={cx("text-xs font-semibold", i === todayIdx ? "text-fire" : "text-ink-2")}>
                {WD_SHORT[i]}
              </span>
            </li>
          ))}
        </ol>
      </Card>

      {/* Membresía */}
      {m && (
        <Link to="/app/membresia" className="card flex items-center justify-between hover:bg-surface-2">
          <div>
            <p className="t-label">Plan actual</p>
            <p className="font-display text-xl font-bold uppercase">{m.plan_name}</p>
            <p className="text-sm text-ink-2">Vence {fmtDate(m.end_date, { day: "numeric", month: "long" })}</p>
          </div>
          <StatusBadge status={status} />
        </Link>
      )}

    </div>
  );
}
