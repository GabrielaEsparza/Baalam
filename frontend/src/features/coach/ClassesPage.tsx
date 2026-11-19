import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ChevronLeft, ChevronRight, Pencil, Plus } from "lucide-react";
import { ExtraSessionSheet, SessionSheet } from "./SessionSheets";
import { api, unwrap } from "@/api/client";
import type { CoachSession, Occupancy, ScheduleIO } from "@/api/types";
import { Button, Card, ErrorBox, Field, Input, PageTitle, SectionTitle, Sheet, Spinner, Stepper, Switch, Tabs, cx } from "@/components/ui";
import { useToast } from "@/components/ui/toast";
import { fmtDate, fmtTime, isoDate, WD_SHORT, weekdayOf } from "@/lib/format";

const typeLabel = { open_gym: "Piso libre", class: "Clase" } as const;

export default function ClassesPage() {
  const [tab, setTab] = useState<"week" | "schedules">("week");
  return (
    <div>
      <PageTitle accent="horarios">Clases y</PageTitle>
      <Tabs
        className="mb-5"
        value={tab}
        onChange={setTab}
        options={[
          { value: "week", label: "Semana" },
          { value: "schedules", label: "Horarios fijos" },
        ]}
      />
      {tab === "week" ? <WeekView /> : <SchedulesView />}
    </div>
  );
}

function WeekView() {
  const [anchor, setAnchor] = useState(new Date());
  const week = isoDate(anchor);
  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ["coach", "occupancy", week],
    queryFn: async () =>
      (await unwrap(api.GET("/api/coach/occupancy", { params: { query: { week } } }))) as unknown as Occupancy,
  });
  const shift = (d: number) => setAnchor((a) => new Date(a.getFullYear(), a.getMonth(), a.getDate() + d * 7));
  const [selected, setSelected] = useState<CoachSession | null>(null);
  const [extraFor, setExtraFor] = useState<string | null>(null);
  const todayIso = isoDate(new Date());

  if (isLoading) return <Spinner />;
  if (error || !data) return <ErrorBox error={error} onRetry={refetch} />;
  const days = Array.from({ length: 7 }, (_, i) => {
    const d = new Date(`${data.week_start}T12:00:00`);
    d.setDate(d.getDate() + i);
    return isoDate(d);
  });

  return (
    <>
      <div className="mb-3 flex items-center justify-between">
        <button aria-label="Semana anterior" onClick={() => shift(-1)} className="grid size-11 place-items-center rounded-full hover:bg-surface-2">
          <ChevronLeft className="size-5" />
        </button>
        <p className="font-semibold">Semana del {fmtDate(data.week_start, { day: "numeric", month: "long" })}</p>
        <button aria-label="Semana siguiente" onClick={() => shift(1)} className="grid size-11 place-items-center rounded-full hover:bg-surface-2">
          <ChevronRight className="size-5" />
        </button>
      </div>
      <p className="mb-3 text-sm text-ink-2">Toca un horario para cerrarlo, reabrirlo o cambiarlo solo ese día.</p>
      <div className="space-y-3">
        {days.map((d) => {
          const ss = data.sessions.filter((s) => s.date === d);
          const past = d < todayIso;
          if (ss.length === 0 && past) return null;
          return (
            <Card key={d} className={cx(d === todayIso && "!border-fire")}>
              <div className="mb-2 flex items-center justify-between gap-2">
                <p className="t-label">
                  {WD_SHORT[weekdayOf(d)]} · {fmtDate(d, { day: "numeric", month: "short" })}
                  {d === todayIso && <span className="ml-1.5 text-fire">· hoy</span>}
                </p>
                {!past && (
                  <button
                    onClick={() => setExtraFor(d)}
                    className="flex h-8 items-center gap-1 rounded-full px-2.5 text-sm font-semibold text-orchid hover:bg-surface-2"
                  >
                    <Plus className="size-4" /> Horario extra
                  </button>
                )}
              </div>
              {ss.length === 0 ? (
                <p className="text-sm text-ink-2">Sin horarios este día.</p>
              ) : (
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                  {ss.map((s) => {
                    const pct = s.taken / s.capacity;
                    return (
                      <button
                        key={s.id}
                        onClick={() => setSelected(s)}
                        className={cx(
                          "rounded-btn border p-2.5 text-left transition hover:bg-surface-2",
                          s.cancelled ? "border-dashed border-line opacity-60" : "border-line",
                          s.extra && !s.cancelled && "border-orchid/60",
                        )}
                      >
                        <p className={cx("text-sm font-semibold", s.cancelled && "line-through")}>
                          {fmtTime(s.start_at)} · {s.extra ? s.name : typeLabel[s.type as keyof typeof typeLabel]}
                        </p>
                        {s.cancelled ? (
                          <p className="mt-0.5 text-sm font-bold text-danger">Cerrado</p>
                        ) : (
                          <>
                            <p className="mt-0.5 text-lg font-extrabold tabular-nums">
                              {s.taken}/{s.capacity}
                              {(s.edited || s.extra) && (
                                <span className="ml-1.5 align-middle text-[11px] font-bold uppercase text-orchid">
                                  {s.extra ? "extra" : "cambiado"}
                                </span>
                              )}
                            </p>
                            <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-surface-2">
                              <div className={cx("h-full", pct >= 1 ? "bg-danger" : "bg-purple")} style={{ width: `${Math.min(100, pct * 100)}%` }} />
                            </div>
                          </>
                        )}
                      </button>
                    );
                  })}
                </div>
              )}
            </Card>
          );
        })}
      </div>
      <SessionSheet session={selected} onClose={() => setSelected(null)} />
      <ExtraSessionSheet date={extraFor} onClose={() => setExtraFor(null)} />

      <SectionTitle>No han reservado su mes</SectionTitle>
      {data.not_booked.length === 0 ? (
        <p className="text-[15px] text-ink-2">Todos reservaron.</p>
      ) : (
        <div className="flex flex-wrap gap-2">
          {data.not_booked.map((m) => (
            <span key={m.id} className="rounded-full bg-surface-2 px-3 py-1.5 text-sm font-medium">
              {m.name}
            </span>
          ))}
        </div>
      )}

      <SectionTitle>Faltas de la semana</SectionTitle>
      {data.missed.length === 0 ? (
        <p className="text-[15px] text-ink-2">Sin faltas.</p>
      ) : (
        <Card className="divide-y divide-line p-0">
          {data.missed.map((m, i) => (
            <div key={i} className="flex justify-between px-4 py-3 text-[15px]">
              <span className="font-medium">{m.name}</span>
              <span className="text-ink-2">
                {fmtDate(m.date)} · {m.session}
              </span>
            </div>
          ))}
        </Card>
      )}
    </>
  );
}

const EMPTY: ScheduleIO = {
  name: "",
  type: "open_gym",
  weekdays: [0, 1, 2, 3, 4],
  start_time: "07:00",
  duration_min: 60,
  capacity: 12,
  requires_reservation: true,
  active: true,
};

function SchedulesView() {
  const { data, isLoading } = useQuery({ queryKey: ["coach", "schedules"], queryFn: () => unwrap(api.GET("/api/coach/schedules")) });
  const [editing, setEditing] = useState<ScheduleIO | null>(null);
  if (isLoading) return <Spinner />;
  return (
    <>
      <Button full icon={Plus} onClick={() => setEditing({ ...EMPTY })}>
        Nuevo horario
      </Button>
      <Card className="mt-4 divide-y divide-line p-0">
        {(data ?? []).map((s) => (
          <button key={s.id} onClick={() => setEditing(s)} className={cx("flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-surface-2", !s.active && "opacity-50")}>
            <span className="w-14 text-lg font-extrabold tabular-nums">{String(s.start_time).slice(0, 5)}</span>
            <span className="flex-1">
              <span className="block font-semibold">{s.name}</span>
              <span className="text-sm text-ink-2">
                {typeLabel[s.type as keyof typeof typeLabel]} · {s.weekdays.map((w) => WD_SHORT[w]).join(" ")} · cupo {s.capacity}
              </span>
            </span>
            <Pencil className="size-4 text-ink-2" />
          </button>
        ))}
      </Card>
      <ScheduleSheet value={editing} onClose={() => setEditing(null)} />
    </>
  );
}

function ScheduleSheet({ value, onClose }: { value: ScheduleIO | null; onClose: () => void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const [s, setS] = useState<ScheduleIO | null>(null);
  const cur = s && value && s.id === value.id ? s : value;
  const set = (patch: Partial<ScheduleIO>) => setS({ ...(cur as ScheduleIO), ...patch });

  const save = useMutation({
    mutationFn: (body: ScheduleIO) =>
      unwrap(
        body.id
          ? api.PUT("/api/coach/schedules/{schedule_id}", { params: { path: { schedule_id: body.id } }, body })
          : api.POST("/api/coach/schedules", { body }),
      ),
    onSuccess: () => {
      toast("Horario guardado");
      qc.invalidateQueries({ queryKey: ["coach"] });
      setS(null);
      onClose();
    },
    onError: (e) => toast((e as Error).message, "error"),
  });

  return (
    <Sheet
      open={!!value}
      onClose={() => {
        setS(null);
        onClose();
      }}
      title={value?.id ? "Editar horario" : "Nuevo horario"}
    >
      {cur && (
        <div className="space-y-4">
          <Tabs
            value={cur.type}
            onChange={(type) => set({ type })}
            options={[
              { value: "open_gym", label: "Turno de piso libre" },
              { value: "class", label: "Clase" },
            ]}
          />
          <Field label="Nombre">
            <Input value={cur.name} onChange={(e) => set({ name: e.target.value })} placeholder="Ej. Clase de la mañana" />
          </Field>
          <div>
            <p className="t-label mb-1.5">Días</p>
            <div className="grid grid-cols-7 gap-1.5">
              {WD_SHORT.map((d, i) => {
                const on = cur.weekdays.includes(i);
                return (
                  <button
                    key={i}
                    onClick={() => set({ weekdays: on ? cur.weekdays.filter((w) => w !== i) : [...cur.weekdays, i].sort() })}
                    className={cx("h-11 rounded-btn font-bold", on ? "bg-purple text-white" : "bg-surface-2 text-ink-2")}
                  >
                    {d}
                  </button>
                );
              })}
            </div>
          </div>
          <Field label="Hora de inicio">
            <Input type="time" value={String(cur.start_time).slice(0, 5)} onChange={(e) => set({ start_time: e.target.value })} />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <p className="t-label mb-1.5">Duración</p>
              <Stepper value={cur.duration_min ?? 60} step={15} min={15} max={300} suffix="min" onChange={(v) => set({ duration_min: v })} />
            </div>
            <div>
              <p className="t-label mb-1.5">Cupo</p>
              <Stepper value={cur.capacity ?? 12} min={1} max={200} onChange={(v) => set({ capacity: v })} />
            </div>
          </div>
          <Switch label="Requiere reserva" checked={cur.requires_reservation ?? true} onChange={(v) => set({ requires_reservation: v })} />
          <Switch label="Activo" checked={cur.active ?? true} onChange={(v) => set({ active: v })} />
          <Button full loading={save.isPending} disabled={!cur.name || cur.weekdays.length === 0} onClick={() => save.mutate(cur)}>
            Guardar
          </Button>
        </div>
      )}
    </Sheet>
  );
}
