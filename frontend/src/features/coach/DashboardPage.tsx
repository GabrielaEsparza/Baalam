import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { CalendarDays, ChevronRight, QrCode, UserCheck } from "lucide-react";
import { CoachStats } from "./CoachStats";
import { api, unwrap } from "@/api/client";
import { useMe } from "@/app/session";
import type { MemberRow } from "@/api/types";
import { Card, ErrorBox, PageTitle, SectionTitle, Spinner, StatusBadge } from "@/components/ui";
import { fmtDate, fmtTime } from "@/lib/format";

/** `live`: se actualiza cada minuto mientras la pantalla está visible (solo "Asistencias de hoy"). */
const useDashboard = (live = false) =>
  useQuery({
    queryKey: ["coach", "dashboard"],
    queryFn: () => unwrap(api.GET("/api/coach/dashboard")),
    refetchInterval: live ? 60_000 : false,
  });

/** Inicio del coach: solo el QR de entrada. Lo demás vive en su propia sección. */
export default function CoachHomePage() {
  const { data: me } = useMe();
  const first = (me?.full_name ?? "").split(" ")[0];
  return (
    <div>
      <PageTitle accent={first || "coach"} sub={fmtDate(new Date(), { weekday: "long", day: "numeric", month: "long" })}>
        Hola,
      </PageTitle>
      <Link
        to="/coach/qr"
        className="flex flex-col items-center gap-4 rounded-card bg-night px-6 py-12 text-center text-white transition hover:opacity-95 dark:bg-surface"
      >
        <span className="grid size-24 place-items-center rounded-full bg-fire/15">
          <QrCode className="size-14 text-fire" strokeWidth={1.5} />
        </span>
        <span>
          <span className="block font-display text-3xl font-bold uppercase">QR de entrada</span>
          <span className="mt-1 block text-[15px] text-[#B8AEC2]">Ábrelo en la pantalla de recepción para que registren su asistencia.</span>
        </span>
        <span className="inline-flex h-12 items-center rounded-btn bg-fire px-6 font-semibold">Abrir QR</span>
      </Link>
    </div>
  );
}

/** Cómo va el gym: gráficas de asistencias y pagos por mes. */
export function StatsPage() {
  return (
    <div>
      <PageTitle accent="el gym">Cómo va</PageTitle>
      <CoachStats />
    </div>
  );
}

/** Lo de hoy: quién llegó y cómo van las clases. */
export function TodayPage() {
  const { data, isLoading, error, refetch } = useDashboard(true);
  if (isLoading) return <Spinner />;
  if (error || !data) return <ErrorBox error={error} onRetry={refetch} />;
  type Ci = { member_id: number; name: string; at: string; source: string };
  type Ses = { id: number; name: string; start_at: string; capacity: number; booked: number };
  const checkins = data.checkins_today as unknown as Ci[];
  const sessions = data.sessions_today as unknown as Ses[];

  return (
    <div>
      <PageTitle accent="hoy" sub={fmtDate(new Date(), { weekday: "long", day: "numeric", month: "long" })}>
        Asistencias de
      </PageTitle>

      <Card className="flex items-center justify-between">
        <p className="t-label">Han llegado</p>
        <p className="t-num">{checkins.length}</p>
      </Card>

      <SectionTitle>Quién llegó</SectionTitle>
      {checkins.length === 0 ? (
        <p className="text-[15px] text-ink-2">Nadie ha llegado todavía.</p>
      ) : (
        <Card className="divide-y divide-line p-0">
          {checkins.map((c) => (
            <Link key={c.member_id} to={`/coach/miembros/${c.member_id}`} className="flex items-center gap-3 px-4 py-3 hover:bg-surface-2">
              <UserCheck className="size-5 text-success" strokeWidth={1.75} />
              <p className="flex-1 font-medium">{c.name}</p>
              <p className="text-sm tabular-nums text-ink-2">{fmtTime(c.at)}</p>
            </Link>
          ))}
        </Card>
      )}

      <SectionTitle>Clases y turnos de hoy</SectionTitle>
      {sessions.length === 0 ? (
        <p className="text-[15px] text-ink-2">Sin horarios hoy.</p>
      ) : (
        <Card className="divide-y divide-line p-0">
          {sessions.map((s) => (
            <div key={s.id} className="flex items-center gap-3 px-4 py-3">
              <CalendarDays className="size-5 text-purple dark:text-orchid" strokeWidth={1.75} />
              <p className="flex-1 font-medium">
                {fmtTime(s.start_at)} · {s.name}
              </p>
              <p className="font-bold tabular-nums">
                {s.booked}/{s.capacity}
              </p>
            </div>
          ))}
        </Card>
      )}
      <Link to="/coach/clases" className="mt-3 flex items-center justify-end gap-1 text-sm font-semibold text-orchid hover:underline">
        Administrar clases <ChevronRight className="size-4" />
      </Link>
    </div>
  );
}

/** Mensualidades por vencer y vencidas. */
export function DuePage() {
  const { data, isLoading, error, refetch } = useDashboard();
  if (isLoading) return <Spinner />;
  if (error || !data) return <ErrorBox error={error} onRetry={refetch} />;
  return (
    <div>
      <PageTitle>Vencimientos</PageTitle>
      <div className="grid grid-cols-2 gap-3">
        <Card className="p-3 text-center">
          <p className="t-num text-warning">{data.expiring.length}</p>
          <p className="t-label mt-1">Por vencer</p>
        </Card>
        <Card className="p-3 text-center">
          <p className="t-num text-fire">{data.expired.length}</p>
          <p className="t-label mt-1">Vencidas</p>
        </Card>
      </div>
      <MemberList title="Vencen esta semana" empty="Nadie vence en los próximos días." rows={data.expiring} />
      <MemberList title="Vencidas" empty="No hay mensualidades vencidas." rows={data.expired} />
    </div>
  );
}

function MemberList({ title, empty, rows }: { title: string; empty: string; rows: MemberRow[] }) {
  return (
    <>
      <SectionTitle>{title}</SectionTitle>
      {rows.length === 0 ? (
        <p className="text-[15px] text-ink-2">{empty}</p>
      ) : (
        <Card className="divide-y divide-line p-0">
          {rows.map((r) => (
            <Link key={r.id} to={`/coach/miembros/${r.id}`} className="flex items-center gap-3 px-4 py-3 hover:bg-surface-2">
              <div className="flex-1">
                <p className="font-semibold">{r.full_name}</p>
                <p className="text-sm text-ink-2">
                  {r.plan_name} · {r.end_date && fmtDate(r.end_date)}
                </p>
              </div>
              <StatusBadge status={r.membership_status} />
            </Link>
          ))}
        </Card>
      )}
    </>
  );
}
