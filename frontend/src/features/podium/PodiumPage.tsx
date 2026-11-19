import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ChevronLeft, ChevronRight, Trophy } from "lucide-react";
import { api, unwrap } from "@/api/client";
import { Avatar } from "@/components/Avatar";
import type { Podium, PodiumRow } from "@/api/types";
import { useMe } from "@/app/session";
import { Card, EmptyState, ErrorBox, PageTitle, SectionTitle, Sheet, Spinner, cx } from "@/components/ui";
import { monthKey, monthLabel } from "@/lib/format";

const RULE_LABELS: Record<string, string> = {
  checkin: "Asistencia (1 por día)",
  workout: "Completar entrenamiento (≥ 80 % de series)",
  class: "Asistir a clase reservada",
  pr: "Nuevo PR (máx. 3 por día)",
  streak_week: "Semana con 4+ asistencias",
  body_log: "Registrar peso o medidas (1 por semana)",
};

function shiftMonth(key: string, delta: number) {
  const [y, m] = key.split("-").map(Number);
  return monthKey(new Date(y, m - 1 + delta, 1));
}

export default function PodiumPage() {
  const { data: me } = useMe();
  const [month, setMonth] = useState(monthKey());
  const [rules, setRules] = useState(false);
  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ["podium", month],
    queryFn: async () => (await unwrap(api.GET("/api/podium", { params: { query: { month } } }))) as unknown as Podium,
  });
  const isCurrent = month === monthKey();

  return (
    <div>
      <PageTitle accent="mes">Podio del</PageTitle>
      <div className="mb-4 flex items-center justify-between">
        <button aria-label="Mes anterior" onClick={() => setMonth(shiftMonth(month, -1))} className="grid size-11 place-items-center rounded-full hover:bg-surface-2">
          <ChevronLeft className="size-5" />
        </button>
        <p className="font-semibold first-letter:uppercase">{monthLabel(month)}</p>
        <button
          aria-label="Mes siguiente"
          disabled={isCurrent}
          onClick={() => setMonth(shiftMonth(month, 1))}
          className="grid size-11 place-items-center rounded-full hover:bg-surface-2 disabled:opacity-30"
        >
          <ChevronRight className="size-5" />
        </button>
      </div>

      {isLoading ? (
        <Spinner />
      ) : error || !data ? (
        <ErrorBox error={error} onRetry={refetch} />
      ) : (
        <>
          {/* Tu posición */}
          <Card className="mb-5 flex items-center justify-between bg-night text-white dark:bg-surface">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.08em] text-[#B8AEC2]">Tu posición este mes</p>
              <p className="t-num mt-1 text-gold">{data.me.position ? `#${data.me.position}` : "—"}</p>
            </div>
            <div className="text-right">
              <p className="text-xs font-semibold uppercase tracking-[0.08em] text-[#B8AEC2]">Puntos</p>
              <p className="t-num mt-1">{data.me.points}</p>
            </div>
          </Card>
          {!me?.show_in_podium && (
            <p className="-mt-3 mb-4 text-sm text-ink-2">Ocultaste tu nombre del podio público (lo cambias en tu perfil).</p>
          )}

          {data.top.length === 0 ? (
            <EmptyState icon={Trophy} text="Aún no hay puntos este mes. El primer check-in suma 100." />
          ) : (
            <>
              <Top3 rows={data.top} myId={me?.id} />
              {data.rest.length > 0 && (
                <Card className="mt-4 divide-y divide-line p-0">
                  {data.rest.map((r) => (
                    <Row key={r.member_id} r={r} mine={r.member_id === me?.id} />
                  ))}
                </Card>
              )}
            </>
          )}

          <SectionTitle>Cómo sumar puntos</SectionTitle>
          <button onClick={() => setRules(true)} className="card w-full text-left font-semibold text-orchid hover:bg-surface-2">
            Ver tabla de puntos →
          </button>
          <Sheet open={rules} onClose={() => setRules(false)} title="Puntos">
            <ul className="divide-y divide-line">
              {Object.entries(data.rules).map(([k, v]) => (
                <li key={k} className="flex items-center justify-between py-3">
                  <span className="text-[15px]">{RULE_LABELS[k] ?? k}</span>
                  <span className="rounded-full bg-gold px-2.5 py-0.5 text-sm font-extrabold text-night">+{v}</span>
                </li>
              ))}
            </ul>
            <p className="mt-3 text-sm text-ink-2">Empate: gana quien tenga más asistencias. El ranking se reinicia el día 1.</p>
          </Sheet>
        </>
      )}
    </div>
  );
}

function Top3({ rows, myId }: { rows: PodiumRow[]; myId?: number }) {
  // Orden visual 2 · 1 · 3
  const order = [rows[1], rows[0], rows[2]].filter(Boolean);
  const heights: Record<number, string> = { 1: "h-28", 2: "h-20", 3: "h-16" };
  return (
    <div className="flex items-end justify-center gap-2">
      {order.map((r) => (
        <div key={r.member_id} className="flex w-1/3 max-w-36 flex-col items-center">
          <Avatar
            url={r.avatar_url}
            name={r.name}
            size={r.position === 1 ? 64 : 56}
            className={cx("mb-2", r.position === 1 && "ring-4 ring-gold", r.member_id === myId && "ring-4 ring-fire")}
          />
          <p className="w-full truncate text-center text-sm font-semibold">{r.name.split(" ")[0]}</p>
          {/* Dorado = logros, siempre con texto oscuro encima */}
          <div className={cx("mt-1 flex w-full flex-col items-center justify-start rounded-t-btn bg-gold pt-2 text-night", heights[r.position])}>
            <span className="font-display text-2xl font-bold">{r.position}</span>
            <span className="text-sm font-extrabold tabular-nums">{r.points}</span>
          </div>
        </div>
      ))}
    </div>
  );
}

function Row({ r, mine }: { r: PodiumRow; mine: boolean }) {
  return (
    <div className={cx("flex items-center gap-3 px-4 py-3", mine && "bg-fire/10")}>
      <span className="w-7 text-center font-bold tabular-nums text-ink-2">{r.position}</span>
      <Avatar url={r.avatar_url} name={r.name} size={36} />
      <span className="flex-1 truncate font-medium">{r.name}</span>
      <span className="font-extrabold tabular-nums">{r.points}</span>
    </div>
  );
}
