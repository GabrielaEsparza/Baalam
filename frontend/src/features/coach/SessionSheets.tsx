import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CalendarX2, CalendarCheck2, Clock, Users } from "lucide-react";
import { api, unwrap } from "@/api/client";
import type { CoachSession } from "@/api/types";
import { Button, Field, Input, Sheet, Spinner, Stepper, Switch, Tabs, cx } from "@/components/ui";
import { useToast } from "@/components/ui/toast";
import { fmtDate, fmtTime } from "@/lib/format";

const typeLabel = { open_gym: "Piso libre", class: "Clase" } as const;
const statusLabel: Record<string, string> = {
  booked: "Reservó",
  attended: "Asistió",
  missed: "Faltó",
  cancelled: "Cancelada",
};

const hhmm = (iso: string) => fmtTime(iso);
const minutesBetween = (a: string, b: string) => Math.round((new Date(b).getTime() - new Date(a).getTime()) / 60000);

function useRefresh() {
  const qc = useQueryClient();
  return () => {
    qc.invalidateQueries({ queryKey: ["coach"] });
  };
}

/** Un horario en una fecha concreta: ver reservas, cambiar solo ese día, cerrarlo o reabrirlo. */
export function SessionSheet({ session, onClose }: { session: CoachSession | null; onClose: () => void }) {
  return (
    <Sheet open={!!session} onClose={onClose} title={session ? `${session.name}` : ""}>
      {session && <SessionBody key={session.id} s={session} onClose={onClose} />}
    </Sheet>
  );
}

function SessionBody({ s, onClose }: { s: CoachSession; onClose: () => void }) {
  const toast = useToast();
  const refresh = useRefresh();
  const [time, setTime] = useState(hhmm(s.start_at));
  const [duration, setDuration] = useState(minutesBetween(s.start_at, s.end_at));
  const [capacity, setCapacity] = useState(s.capacity);
  const [confirm, setConfirm] = useState(false);

  const { data: bookings, isLoading } = useQuery({
    queryKey: ["coach", "session-bookings", s.id],
    queryFn: async () =>
      (await unwrap(
        api.GET("/api/coach/sessions/{session_id}/bookings", { params: { path: { session_id: s.id } } }),
      )) as unknown as { id: number; name: string; status: string }[],
  });

  const done = (msg: string) => {
    toast(msg);
    refresh();
    onClose();
  };
  const onError = (e: Error) => toast(e.message, "error");

  const save = useMutation({
    mutationFn: () =>
      unwrap(
        api.PATCH("/api/coach/sessions/{session_id}", {
          params: { path: { session_id: s.id } },
          body: { start_time: time, duration_min: duration, capacity },
        }),
      ),
    onSuccess: () => done("Cambio guardado solo para este día"),
    onError,
  });
  const cancel = useMutation({
    mutationFn: () => unwrap(api.POST("/api/coach/sessions/{session_id}/cancel", { params: { path: { session_id: s.id } } })),
    onSuccess: () => done("Horario cerrado este día"),
    onError,
  });
  const reopen = useMutation({
    mutationFn: () => unwrap(api.POST("/api/coach/sessions/{session_id}/reopen", { params: { path: { session_id: s.id } } })),
    onSuccess: () => done("Horario abierto de nuevo"),
    onError,
  });

  const active = (bookings ?? []).filter((b) => b.status !== "cancelled");
  const changed = time !== hhmm(s.start_at) || duration !== minutesBetween(s.start_at, s.end_at) || capacity !== s.capacity;

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-2 text-[15px] text-ink-2">
        <span className="font-semibold capitalize text-ink">{fmtDate(s.date, { weekday: "long", day: "numeric", month: "long" })}</span>
        <span>· {typeLabel[s.type as keyof typeof typeLabel]}</span>
        {s.extra && <Tag tone="orchid">Extra</Tag>}
        {s.edited && <Tag tone="gold">Cambiado</Tag>}
        {s.cancelled && <Tag tone="danger">Cerrado</Tag>}
      </div>

      {/* Reservas */}
      <div>
        <p className="t-label mb-2 flex items-center gap-1.5">
          <Users className="size-4" /> Reservas · {active.length}/{s.capacity}
        </p>
        {isLoading ? (
          <Spinner />
        ) : (bookings ?? []).length === 0 ? (
          <p className="text-[15px] text-ink-2">Nadie ha reservado.</p>
        ) : (
          <ul className="flex flex-wrap gap-2">
            {bookings!.map((b) => (
              <li
                key={b.id}
                className={cx(
                  "rounded-full bg-surface-2 px-3 py-1.5 text-sm font-medium",
                  b.status === "cancelled" && "text-ink-2 line-through",
                )}
              >
                {b.name}
                {b.status !== "booked" && <span className="ml-1 text-ink-2">· {statusLabel[b.status] ?? b.status}</span>}
              </li>
            ))}
          </ul>
        )}
      </div>

      {s.past ? (
        <p className="rounded-input bg-surface-2 p-3 text-[15px] text-ink-2">Esta fecha ya pasó; solo se puede consultar.</p>
      ) : s.cancelled ? (
        <div className="space-y-2">
          <p className="text-[15px] text-ink-2">
            Este día está cerrado. Si lo reabres, las reservas que tenía vuelven a quedar apartadas.
          </p>
          <Button full icon={CalendarCheck2} loading={reopen.isPending} onClick={() => reopen.mutate()}>
            Reabrir este día
          </Button>
        </div>
      ) : (
        <>
          {/* Cambiar solo este día */}
          <div className="space-y-3 rounded-card border border-line p-4">
            <p className="flex items-center gap-1.5 font-semibold">
              <Clock className="size-4" /> Cambiar solo este día
            </p>
            <Field label="Hora de inicio">
              <Input type="time" value={time} onChange={(e) => setTime(e.target.value)} />
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <p className="t-label mb-1.5">Duración</p>
                <Stepper value={duration} step={15} min={15} max={300} suffix="min" onChange={setDuration} />
              </div>
              <div>
                <p className="t-label mb-1.5">Cupo</p>
                <Stepper value={capacity} min={Math.max(1, active.length)} max={200} onChange={setCapacity} />
              </div>
            </div>
            <p className="text-sm text-ink-2">El horario fijo y las demás fechas no cambian. Quien reservó conserva su lugar.</p>
            <Button full variant="dark" loading={save.isPending} disabled={!changed} onClick={() => save.mutate()}>
              Guardar cambio
            </Button>
          </div>

          {/* Cerrar este día */}
          {confirm ? (
            <div className="space-y-2 rounded-card border border-danger/40 bg-danger/10 p-4">
              <p className="text-[15px] font-medium">
                ¿Cerrar {s.name} este día?
                {active.length > 0 && ` Las ${active.length} reservas quedarán canceladas (puedes reabrirlo después).`}
              </p>
              <div className="grid grid-cols-2 gap-2">
                <Button variant="secondary" onClick={() => setConfirm(false)}>
                  No
                </Button>
                <Button variant="danger" loading={cancel.isPending} onClick={() => cancel.mutate()}>
                  Sí, cerrar
                </Button>
              </div>
            </div>
          ) : (
            <Button full variant="secondary" icon={CalendarX2} onClick={() => setConfirm(true)}>
              No abrir este día
            </Button>
          )}
        </>
      )}
    </div>
  );
}

function Tag({ tone, children }: { tone: "orchid" | "gold" | "danger"; children: React.ReactNode }) {
  const cls = { orchid: "bg-orchid/15 text-orchid", gold: "bg-gold/25 text-ink", danger: "bg-danger/15 text-danger" }[tone];
  return <span className={cx("rounded-full px-2 py-0.5 text-xs font-bold uppercase", cls)}>{children}</span>;
}

/** Abrir un horario de un solo día (clase extra, turno extra). */
export function ExtraSessionSheet({ date, onClose }: { date: string | null; onClose: () => void }) {
  return (
    <Sheet open={!!date} onClose={onClose} title="Abrir horario extra">
      {date && <ExtraBody key={date} date={date} onClose={onClose} />}
    </Sheet>
  );
}

function ExtraBody({ date, onClose }: { date: string; onClose: () => void }) {
  const toast = useToast();
  const refresh = useRefresh();
  const [type, setType] = useState<"class" | "open_gym">("class");
  const [name, setName] = useState("");
  const [time, setTime] = useState("08:00");
  const [duration, setDuration] = useState(60);
  const [capacity, setCapacity] = useState(12);
  const [reservation, setReservation] = useState(true);

  const create = useMutation({
    mutationFn: () =>
      unwrap(
        api.POST("/api/coach/sessions/extra", {
          body: { name, type, date, start_time: time, duration_min: duration, capacity, requires_reservation: reservation },
        }),
      ),
    onSuccess: () => {
      toast("Horario extra abierto");
      refresh();
      onClose();
    },
    onError: (e) => toast((e as Error).message, "error"),
  });

  return (
    <div className="space-y-4">
      <p className="text-[15px] font-semibold capitalize">{fmtDate(date, { weekday: "long", day: "numeric", month: "long" })}</p>
      <Tabs
        value={type}
        onChange={setType}
        options={[
          { value: "class", label: "Clase" },
          { value: "open_gym", label: "Piso libre" },
        ]}
      />
      <Field label="Nombre (opcional)">
        <Input value={name} onChange={(e) => setName(e.target.value)} placeholder={type === "class" ? "Clase extra" : "Turno extra"} />
      </Field>
      <Field label="Hora de inicio">
        <Input type="time" value={time} onChange={(e) => setTime(e.target.value)} />
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <p className="t-label mb-1.5">Duración</p>
          <Stepper value={duration} step={15} min={15} max={300} suffix="min" onChange={setDuration} />
        </div>
        <div>
          <p className="t-label mb-1.5">Cupo</p>
          <Stepper value={capacity} min={1} max={200} onChange={setCapacity} />
        </div>
      </div>
      <Switch label="Requiere reserva" checked={reservation} onChange={setReservation} />
      <p className="text-sm text-ink-2">Solo existe ese día: no se agrega a los horarios fijos ni a la reserva del mes. Los miembros lo ven para apartar lugar.</p>
      <Button full loading={create.isPending} onClick={() => create.mutate()}>
        Abrir horario
      </Button>
    </div>
  );
}
