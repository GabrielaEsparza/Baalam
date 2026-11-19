import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CalendarDays, Clock, Repeat, Users } from "lucide-react";
import { api, unwrap } from "@/api/client";
import type { BookingOut, BookMonthResult, MonthBookings, SessionOut } from "@/api/types";
import { useMe } from "@/app/session";
import { Button, Card, EmptyState, ErrorBox, PageTitle, SectionTitle, Sheet, Spinner, Tabs, cx } from "@/components/ui";
import { useToast } from "@/components/ui/toast";
import { fmtDate, fmtTime, isoDate, monthKey, monthLabel, WEEKDAYS, weekdayOf } from "@/lib/format";

const statusLabel: Record<string, string> = {
  booked: "Reservado",
  attended: "Asististe",
  missed: "Falta",
  cancelled: "Cancelado por el coach",
};

function nextMonthKey() {
  const d = new Date();
  return monthKey(new Date(d.getFullYear(), d.getMonth() + 1, 1));
}

function weekRange(iso: string) {
  const d = new Date(`${iso}T12:00:00`);
  const start = new Date(d);
  start.setDate(d.getDate() - ((d.getDay() + 6) % 7));
  const end = new Date(start);
  end.setDate(start.getDate() + 6);
  return { start: isoDate(start), end: isoDate(end) };
}

export default function SchedulePage() {
  const { data: me } = useMe();
  const [month, setMonth] = useState(monthKey());
  const [booking, setBooking] = useState(false);
  const [changing, setChanging] = useState<BookingOut | null>(null);
  const qc = useQueryClient();
  const toast = useToast();

  const q = useQuery({
    queryKey: ["bookings", month],
    queryFn: async () =>
      (await unwrap(api.GET("/api/bookings", { params: { query: { month } } }))) as unknown as MonthBookings,
  });
  const nextOpen = useQuery({
    queryKey: ["bookings", nextMonthKey()],
    queryFn: async () =>
      (await unwrap(api.GET("/api/bookings", { params: { query: { month: nextMonthKey() } } }))) as unknown as MonthBookings,
  });

  const leaveWait = useMutation({
    mutationFn: (id: number) => unwrap(api.DELETE("/api/waitlist/{entry_id}", { params: { path: { entry_id: id } } })),
    onSuccess: () => {
      toast("Saliste de la lista de espera");
      qc.invalidateQueries({ queryKey: ["bookings"] });
    },
  });

  if (!me) return null;
  const perWeek = me.membership?.sessions_per_week ?? 0;
  const kind = me.features.classes && !me.features.open_gym ? "clases" : "turnos";

  const monthTabs = [{ value: monthKey(), label: "Este mes" }];
  if (nextOpen.data?.open) monthTabs.push({ value: nextMonthKey(), label: "Próximo mes" });

  const data = q.data;
  const now = Date.now();
  const upcoming = data?.bookings.filter((b) => new Date(b.session.end_at).getTime() >= now) ?? [];
  const past = data?.bookings.filter((b) => new Date(b.session.end_at).getTime() < now) ?? [];
  const hasActive = upcoming.some((b) => b.status === "booked");

  return (
    <div>
      <PageTitle accent={kind === "clases" ? "clases" : "horarios"} sub={`${perWeek} días por semana · se cambia, no se cancela`}>
        Mis
      </PageTitle>
      {monthTabs.length > 1 && <Tabs className="mb-4" value={month} onChange={setMonth} options={monthTabs} />}

      {!me.features.access ? (
        <Card>
          <EmptyState icon={CalendarDays} text="Necesitas una membresía activa para reservar." />
        </Card>
      ) : q.isLoading ? (
        <Spinner />
      ) : q.error || !data ? (
        <ErrorBox error={q.error} onRetry={q.refetch} />
      ) : (
        <>
          {!hasActive && data.open && (
            <Card className="mb-4 space-y-3">
              <p className="t-h2">Reserva {monthLabel(month).split(" ")[0]}</p>
              <p className="text-[15px] text-ink-2">
                Elige tus {perWeek} días y el horario una vez. Se repite todas las semanas del mes.
              </p>
              <Button full onClick={() => setBooking(true)}>
                Reservar mi mes
              </Button>
            </Card>
          )}
          {hasActive && data.open && (
            <Button variant="secondary" full className="mb-4" onClick={() => setBooking(true)}>
              Agregar días que me faltan
            </Button>
          )}

          {data.waitlist.length > 0 && (
            <>
              <SectionTitle>En lista de espera</SectionTitle>
              <div className="space-y-2">
                {data.waitlist.map((w) => (
                  <Card key={w.id} className="flex items-center justify-between">
                    <div>
                      <p className="font-semibold">
                        {fmtDate(w.target.date, { weekday: "short", day: "numeric", month: "short" })} · {fmtTime(w.target.start_at)}
                      </p>
                      <p className="text-sm text-ink-2">Si se libera lugar, el cambio se hace solo.</p>
                    </div>
                    <Button variant="ghost" size="sm" onClick={() => leaveWait.mutate(w.id)}>
                      Salir
                    </Button>
                  </Card>
                ))}
              </div>
            </>
          )}

          <SectionTitle>Próximos</SectionTitle>
          {upcoming.length === 0 ? (
            <p className="text-[15px] text-ink-2">No tienes {kind} próximos este mes.</p>
          ) : (
            <Card className="divide-y divide-line p-0">
              {upcoming.map((b) => (
                <div key={b.id} className="flex items-center gap-3 px-4 py-3">
                  <DateChip iso={b.session.date} />
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-semibold">{b.session.name}</p>
                    <p className="text-sm text-ink-2">
                      {fmtTime(b.session.start_at)} · {statusLabel[b.status]}
                    </p>
                  </div>
                  {b.status === "booked" && (
                    <Button variant="secondary" size="sm" icon={Repeat} onClick={() => setChanging(b)}>
                      Cambiar
                    </Button>
                  )}
                </div>
              ))}
            </Card>
          )}

          {past.length > 0 && (
            <>
              <SectionTitle>Pasados</SectionTitle>
              <Card className="divide-y divide-line p-0">
                {past.reverse().map((b) => (
                  <div key={b.id} className="flex items-center gap-3 px-4 py-3 opacity-80">
                    <DateChip iso={b.session.date} />
                    <p className="flex-1 truncate text-[15px]">{b.session.name}</p>
                    <span
                      className={cx(
                        "text-sm font-semibold",
                        b.status === "attended" && "text-success",
                        b.status === "missed" && "text-danger",
                      )}
                    >
                      {b.status === "booked" ? "Sin asistencia" : statusLabel[b.status]}
                    </span>
                  </div>
                ))}
              </Card>
            </>
          )}
        </>
      )}

      <BookMonthSheet open={booking} onClose={() => setBooking(false)} month={month} perWeek={perWeek} />
      <ChangeSheet booking={changing} onClose={() => setChanging(null)} />
    </div>
  );
}

function DateChip({ iso }: { iso: string }) {
  const d = new Date(`${iso}T12:00:00`);
  return (
    <div className="grid w-12 shrink-0 place-items-center rounded-btn bg-surface-2 py-1.5 text-center leading-tight">
      <span className="text-[11px] font-semibold uppercase text-ink-2">{d.toLocaleDateString("es-MX", { weekday: "short" })}</span>
      <span className="text-lg font-extrabold tabular-nums">{d.getDate()}</span>
    </div>
  );
}

/* ---------- Reservar mes: patrón semanal ---------- */
function BookMonthSheet({ open, onClose, month, perWeek }: { open: boolean; onClose: () => void; month: string; perWeek: number }) {
  const qc = useQueryClient();
  const toast = useToast();
  const [pattern, setPattern] = useState<Record<number, number>>({});
  const [result, setResult] = useState<BookMonthResult | null>(null);
  const schedules = useQuery({
    queryKey: ["my-schedules"],
    queryFn: () => unwrap(api.GET("/api/schedule/schedules")),
    enabled: open,
  });
  const chosen = Object.keys(pattern).length;

  const submit = useMutation({
    mutationFn: async () =>
      (await unwrap(
        api.POST("/api/bookings/month", {
          body: { month, pattern: Object.entries(pattern).map(([wd, id]) => ({ weekday: Number(wd), schedule_id: id })) },
        }),
      )) as unknown as BookMonthResult,
    onSuccess: (r) => {
      qc.invalidateQueries({ queryKey: ["bookings"] });
      qc.invalidateQueries({ queryKey: ["home"] });
      if (r.conflicts.length === 0) {
        toast(`Listo: ${r.created.length} fechas reservadas`);
        close();
      } else setResult(r);
    },
    onError: (e) => toast((e as Error).message, "error"),
  });

  function close() {
    setPattern({});
    setResult(null);
    onClose();
  }

  return (
    <Sheet open={open} onClose={close} title={result ? "Fechas sin lugar" : "Tu semana"}>
      {result ? (
        <ConflictResolver result={result} onDone={close} />
      ) : schedules.isLoading ? (
        <Spinner />
      ) : (
        <div className="space-y-4">
          <p className="text-[15px] text-ink-2">
            Elige hasta <b className="text-ink">{perWeek}</b> días ({chosen}/{perWeek}).
          </p>
          {WEEKDAYS.map((name, wd) => {
            const opts = (schedules.data ?? []).filter((s) => s.weekdays.includes(wd));
            if (opts.length === 0) return null;
            const disabled = pattern[wd] === undefined && chosen >= perWeek;
            return (
              <div key={wd}>
                <p className="t-label mb-1.5">{name}</p>
                <div className="flex flex-wrap gap-2">
                  {opts.map((s) => {
                    const on = pattern[wd] === s.id;
                    return (
                      <button
                        key={s.id}
                        disabled={disabled}
                        onClick={() =>
                          setPattern((p) => {
                            const n = { ...p };
                            if (on) delete n[wd];
                            else n[wd] = s.id!;
                            return n;
                          })
                        }
                        className={cx(
                          "h-11 rounded-full border px-4 text-[15px] font-semibold tabular-nums transition",
                          on ? "border-purple bg-purple text-white" : "border-line bg-surface text-ink",
                          disabled && "opacity-40",
                        )}
                      >
                        {String(s.start_time).slice(0, 5)}
                      </button>
                    );
                  })}
                </div>
              </div>
            );
          })}
          <Button full disabled={chosen === 0} loading={submit.isPending} onClick={() => submit.mutate()}>
            Reservar {chosen > 0 ? `${chosen} días por semana` : ""}
          </Button>
        </div>
      )}
    </Sheet>
  );
}

/** Para las fechas llenas, ofrece otros horarios del mismo día. */
function ConflictResolver({ result, onDone }: { result: BookMonthResult; onDone: () => void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const [solved, setSolved] = useState<Set<string>>(new Set());
  const dates = result.conflicts.map((c) => c.date);
  const range = useMemo(() => ({ start: dates[0], end: dates[dates.length - 1] }), [dates]);
  const sessions = useQuery({
    queryKey: ["sessions", range.start, range.end],
    queryFn: () => unwrap(api.GET("/api/schedule/sessions", { params: { query: range } })),
  });
  const book = useMutation({
    mutationFn: (s: SessionOut) => unwrap(api.POST("/api/bookings/single", { body: { session_id: s.id } })),
    onSuccess: (_, s) => {
      setSolved((x) => new Set(x).add(s.date));
      qc.invalidateQueries({ queryKey: ["bookings"] });
      toast("Fecha reservada");
    },
    onError: (e) => toast((e as Error).message, "error"),
  });

  return (
    <div className="space-y-4">
      <p className="text-[15px] text-ink-2">
        Reservamos {result.created.length} fechas. Estas estaban llenas: elige otro horario solo ahí.
      </p>
      {sessions.isLoading && <Spinner />}
      {dates.map((d) => {
        const alts = (sessions.data ?? []).filter((s) => s.date === d && s.taken < s.capacity);
        return (
          <div key={d} className={cx(solved.has(d) && "opacity-50")}>
            <p className="mb-1.5 font-semibold text-danger">
              {fmtDate(d, { weekday: "long", day: "numeric", month: "short" })}
            </p>
            {solved.has(d) ? (
              <p className="text-sm text-success">Resuelto</p>
            ) : alts.length === 0 ? (
              <p className="text-sm text-ink-2">No hay otro horario con lugar ese día.</p>
            ) : (
              <div className="flex flex-wrap gap-2">
                {alts.map((s) => (
                  <button
                    key={s.id}
                    onClick={() => book.mutate(s)}
                    className="h-11 rounded-full border border-line px-4 text-[15px] font-semibold tabular-nums hover:bg-surface-2"
                  >
                    {fmtTime(s.start_at)} · {s.capacity - s.taken} lugares
                  </button>
                ))}
              </div>
            )}
          </div>
        );
      })}
      <Button variant="secondary" full onClick={onDone}>
        Terminar
      </Button>
    </div>
  );
}

/* ---------- Cambiar un día ---------- */
function ChangeSheet({ booking, onClose }: { booking: BookingOut | null; onClose: () => void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const range = booking ? weekRange(booking.session.date) : null;
  const sessions = useQuery({
    queryKey: ["sessions", range?.start, range?.end],
    queryFn: () => unwrap(api.GET("/api/schedule/sessions", { params: { query: range! } })),
    enabled: !!booking,
  });
  const change = useMutation({
    mutationFn: (s: SessionOut) =>
      unwrap(
        api.POST("/api/bookings/{booking_id}/change", {
          params: { path: { booking_id: booking!.id } },
          body: { session_id: s.id },
        }),
      ) as Promise<{ status: string }>,
    onSuccess: (r) => {
      toast(r.status === "changed" ? "Cambio hecho" : "Estás en lista de espera; conservas tu lugar actual");
      qc.invalidateQueries({ queryKey: ["bookings"] });
      qc.invalidateQueries({ queryKey: ["home"] });
      onClose();
    },
    onError: (e) => toast((e as Error).message, "error"),
  });

  const nowMs = Date.now();
  const opts = (sessions.data ?? []).filter(
    (s) => s.id !== booking?.session.id && new Date(s.start_at).getTime() > nowMs,
  );

  return (
    <Sheet open={!!booking} onClose={onClose} title="Cambiar día">
      {booking && (
        <div className="space-y-3">
          <p className="text-[15px] text-ink-2">
            Cambias <b className="text-ink">{fmtDate(booking.session.date, { weekday: "long", day: "numeric" })} {fmtTime(booking.session.start_at)}</b> por
            otro horario de la misma semana. Hasta 2 h antes.
          </p>
          {sessions.isLoading ? (
            <Spinner />
          ) : opts.length === 0 ? (
            <p className="text-[15px]">No hay otros horarios esta semana.</p>
          ) : (
            <div className="divide-y divide-line rounded-card border border-line">
              {opts.map((s) => {
                const full = s.taken >= s.capacity;
                return (
                  <button
                    key={s.id}
                    disabled={change.isPending}
                    onClick={() => change.mutate(s)}
                    className="flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-surface-2"
                  >
                    <Clock className="size-5 text-ink-2" />
                    <span className="flex-1">
                      <span className="block font-semibold first-letter:uppercase">
                        {WEEKDAYS[weekdayOf(s.date)]} {fmtTime(s.start_at)}
                      </span>
                      <span className="text-sm text-ink-2">{s.name}</span>
                    </span>
                    <span className={cx("flex items-center gap-1 text-sm font-semibold", full ? "text-danger" : "text-success")}>
                      <Users className="size-4" />
                      {full ? "Lleno · lista de espera" : `${s.capacity - s.taken} lugares`}
                    </span>
                  </button>
                );
              })}
            </div>
          )}
        </div>
      )}
    </Sheet>
  );
}
