import { useCallback, useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { get as idbGet, set as idbSet } from "idb-keyval";
import { ArrowLeftRight, Check, ChevronDown, CloudOff, Dumbbell, Flag, Flame, Repeat, RotateCcw, Timer, Trophy, X } from "lucide-react";
import type { ReactNode } from "react";
import { api, unwrap, ApiError } from "@/api/client";
import type { FinishResult, SwapOption, TodayItem, TodayWorkoutFull } from "@/api/types";
import { ExerciseMedia } from "@/components/ExerciseMedia";
import { Button, Card, EmptyState, ErrorBox, PageTitle, Sheet, Spinner, cx } from "@/components/ui";
import { useToast } from "@/components/ui/toast";
import { trList } from "@/lib/exercise-i18n";
import { WD_SHORT, fmtDuration, fmtReps } from "@/lib/format";

const KEY = ["workout-today"];
const QUEUE = "baalam-set-queue";
type SetBody = { item_id: number; set_number: number; weight_kg: string | null; reps: number | null; done: boolean };

/** Agrupa ejercicios seguidos con la misma superserie (se alternan serie por serie). */
function toBlocks(items: TodayItem[]): TodayItem[][] {
  const out: TodayItem[][] = [];
  for (const it of items) {
    const last = out.at(-1);
    if (last && it.superset_group && last[0].superset_group === it.superset_group) last.push(it);
    else out.push([it]);
  }
  return out;
}
const doneSets = (it: TodayItem) => it.logged.filter((l) => l.done).length;
const workLabel = (it: TodayItem) => (it.duration_s ? fmtDuration(it.duration_s) : `${fmtReps(it.reps, it.reps_max)} reps`);
/** Ejercicios largos por tiempo (bici, caminadora): se anotan en minutos, no en segundos. */
const inMinutes = (it: TodayItem) => !!it.duration_s && it.duration_s >= 120;

/* ---------- Cola sin conexión: las series se guardan local y se reenvían con señal ---------- */
async function enqueue(b: SetBody) {
  try {
    const q: SetBody[] = (await idbGet(QUEUE)) ?? [];
    const rest = q.filter((x) => !(x.item_id === b.item_id && x.set_number === b.set_number));
    await idbSet(QUEUE, [...rest, b]);
  } catch {
    /* almacenamiento bloqueado: no hay cola */
  }
}
async function flushQueue(): Promise<number> {
  let q: SetBody[] = [];
  try {
    q = (await idbGet(QUEUE)) ?? [];
  } catch {
    return 0;
  }
  const left: SetBody[] = [];
  for (const b of q) {
    try {
      await unwrap(api.POST("/api/workouts/today/sets", { body: b as never }));
    } catch (e) {
      if (e instanceof ApiError && e.code === "offline") left.push(b);
    }
  }
  try {
    await idbSet(QUEUE, left);
  } catch {
    /* nada */
  }
  return q.length - left.length;
}

export default function TrainPage() {
  const qc = useQueryClient();
  const toast = useToast();
  const { data, isLoading, error, refetch } = useQuery({
    queryKey: KEY,
    queryFn: async () => (await unwrap(api.GET("/api/workouts/today"))) as unknown as TodayWorkoutFull,
  });
  const [rest, setRest] = useState<{ total: number; until: number } | null>(null);
  const [summary, setSummary] = useState<FinishResult | null>(null);
  const [pending, setPending] = useState(0);
  const [open, setOpen] = useState<number | null>(null);
  const [picker, setPicker] = useState(false);

  const swap = useMutation({
    mutationFn: async (weekday: number | null) =>
      (await unwrap(
        weekday === null
          ? api.DELETE("/api/workouts/today/swap")
          : api.POST("/api/workouts/today/swap", { body: { weekday } }),
      )) as unknown as TodayWorkoutFull,
    onSuccess: (w) => {
      qc.setQueryData(KEY, w);
      qc.invalidateQueries({ queryKey: ["home"] });
      qc.invalidateQueries({ queryKey: ["podium"] });
      setPicker(false);
      setOpen(null);
      toast(w.swapped_from === null ? "Volviste a la rutina de hoy" : `Hoy haces la rutina del ${WD_LONG[w.swapped_from]}`);
    },
    onError: (e) => toast((e as Error).message, "error"),
  });

  // Reenviar la cola al abrir y al volver la señal.
  useEffect(() => {
    const go = () =>
      flushQueue().then((n) => {
        if (n) {
          toast(`${n} series sincronizadas`);
          qc.invalidateQueries({ queryKey: KEY });
        }
        idbGet(QUEUE).then((q: SetBody[] | undefined) => setPending(q?.length ?? 0)).catch(() => {});
      });
    go();
    window.addEventListener("online", go);
    return () => window.removeEventListener("online", go);
  }, [qc, toast]);

  // Pantalla siempre encendida durante el entrenamiento.
  const hasDay = !!data?.day;
  useEffect(() => {
    if (!hasDay) return;
    let lock: WakeLockSentinel | null = null;
    const req = () => navigator.wakeLock?.request("screen").then((l) => (lock = l)).catch(() => {});
    req();
    const onVis = () => document.visibilityState === "visible" && req();
    document.addEventListener("visibilitychange", onVis);
    return () => {
      document.removeEventListener("visibilitychange", onVis);
      lock?.release().catch(() => {});
    };
  }, [hasDay]);

  const logSet = useMutation({
    mutationFn: (b: SetBody) => unwrap(api.POST("/api/workouts/today/sets", { body: b as never })) as Promise<{ is_pr: boolean; points: number }>,
    onMutate: (b) => {
      // Actualización optimista: el ✓ responde al instante aunque no haya señal.
      qc.setQueryData<TodayWorkoutFull>(KEY, (old) => {
        if (!old?.day) return old;
        return {
          ...old,
          day: {
            ...old.day,
            items: old.day.items.map((it) =>
              it.id !== b.item_id
                ? it
                : {
                    ...it,
                    logged: [
                      ...it.logged.filter((l) => l.set_number !== b.set_number),
                      { set_number: b.set_number, weight_kg: b.weight_kg, reps: b.reps, done: b.done, is_pr: false },
                    ],
                  },
            ),
          },
        };
      });
    },
    onSuccess: (r) => {
      if (r.is_pr) toast(`¡Nuevo PR! +${r.points} puntos`);
    },
    onError: async (e, b) => {
      if (e instanceof ApiError && e.code === "offline") {
        await enqueue(b);
        setPending((n) => n + 1);
      } else {
        toast((e as Error).message, "error");
        qc.invalidateQueries({ queryKey: KEY });
      }
    },
  });

  const finish = useMutation({
    mutationFn: async () => (await unwrap(api.POST("/api/workouts/today/finish"))) as unknown as FinishResult,
    onSuccess: (r) => {
      setSummary(r);
      navigator.vibrate?.([80, 60, 160]);
      qc.invalidateQueries({ queryKey: KEY });
      qc.invalidateQueries({ queryKey: ["home"] });
      qc.invalidateQueries({ queryKey: ["podium"] });
    },
    onError: (e) => toast((e as Error).message, "error"),
  });

  const blocks = toBlocks(data?.day?.items ?? []);
  const onSetDone = useCallback(
    (item: TodayItem, b: SetBody) => {
      logSet.mutate(b);
      if (!b.done) return;
      // En ejercicios alternados, sin descanso hasta terminar la ronda: pasa directo al siguiente.
      const block = blocks.find((bl) => bl.some((x) => x.id === item.id)) ?? [item];
      const pendingInRound = block.some(
        (x) => x.id !== item.id && x.sets >= b.set_number && !x.logged.some((l) => l.set_number === b.set_number && l.done),
      );
      if (pendingInRound) return;
      if (item.rest_s > 0) setRest({ total: item.rest_s, until: Date.now() + item.rest_s * 1000 });
    },
    [logSet, blocks],
  );

  if (isLoading) return <Spinner />;
  if (error || !data) return <ErrorBox error={error} onRetry={refetch} />;

  const items = data.day?.items ?? [];
  const planned = items.reduce((a, i) => a + i.sets, 0);
  const done = items.reduce((a, i) => a + i.logged.filter((l) => l.done).length, 0);
  const firstOpen = blocks.findIndex((bl) => bl.some((i) => doneSets(i) < i.sets));
  const openIdx = open ?? (firstOpen === -1 ? null : firstOpen);

  return (
    <div>
      <WeekStrip today={data.weekday} days={data.routine_weekdays} />

      {data.swapped_from !== null && (
        <div role="status" className="mb-4 flex items-start gap-3 rounded-card border border-gold bg-gold/15 px-4 py-3">
          <ArrowLeftRight className="mt-0.5 size-5 shrink-0 text-warning" />
          <div className="flex-1 text-[15px]">
            <p className="font-medium">
              Hoy repones la rutina del <b>{WD_LONG[data.swapped_from]}</b>.
            </p>
            <p className="text-ink-2">Este día no suma puntos por asistir a tu horario reservado.</p>
            <button
              onClick={() => swap.mutate(null)}
              disabled={swap.isPending}
              className="mt-1 flex items-center gap-1 font-semibold text-orchid underline-offset-2 hover:underline"
            >
              <RotateCcw className="size-4" /> Volver a la rutina de hoy
            </button>
          </div>
        </div>
      )}

      {!data.day ? (
        <>
          <PageTitle accent="hoy">Entrena</PageTitle>
          <Card>
            {data.routine_weekdays.length ? (
              <>
                <EmptyState icon={Dumbbell} text="Hoy es día de descanso. Recupera, hidrátate y vuelve con todo." />
                {data.options.length > 0 && (
                  <div className="mt-2 border-t border-line pt-4">
                    <p className="font-semibold">¿Quieres reponer un día?</p>
                    <p className="mb-3 text-[15px] text-ink-2">Elige qué rutina hacer hoy. No suma puntos de asistencia.</p>
                    <SwapOptions options={data.options} today={data.weekday} busy={swap.isPending} onPick={(w) => swap.mutate(w)} />
                  </div>
                )}
              </>
            ) : (
              <EmptyState icon={Dumbbell} text="Aún no tienes rutina. Tu coach te asignará una pronto." />
            )}
          </Card>
        </>
      ) : (
        <>
          <header className="mb-4">
            <div className="flex items-center justify-between gap-2">
              <p className="t-label">Hoy</p>
              {data.options.length > 1 && (
                <button
                  onClick={() => setPicker(true)}
                  className="flex h-9 items-center gap-1.5 rounded-full px-3 text-sm font-semibold text-orchid hover:bg-surface-2"
                >
                  <ArrowLeftRight className="size-4" /> Cambiar día
                </button>
              )}
            </div>
            <h1 className="t-display">
              {data.day.label || "Entrenamiento"} {data.day.focus && <span className="text-fire">· {data.day.focus}</span>}
            </h1>
            <div className="mt-3 flex items-center gap-3">
              <div className="h-2.5 flex-1 overflow-hidden rounded-full bg-surface-2">
                <div className="h-full rounded-full bg-purple transition-[width] duration-200" style={{ width: `${planned ? (done / planned) * 100 : 0}%` }} />
              </div>
              <span className="text-sm font-bold tabular-nums">
                {done}/{planned} series
              </span>
            </div>
            {pending > 0 && (
              <p className="mt-2 flex items-center gap-1.5 text-sm font-medium text-warning">
                <CloudOff className="size-4" /> {pending} series guardadas sin conexión; se enviarán al volver la señal.
              </p>
            )}
          </header>

          <div className="space-y-3">
            {blocks.map((bl, idx) => {
              const number = blocks.slice(0, idx).reduce((a, x) => a + x.length, 0) + 1;
              const toggle = () => setOpen(openIdx === idx ? -1 : idx);
              return bl.length > 1 ? (
                <SupersetCard key={bl[0].id} items={bl} number={number} expanded={openIdx === idx} onToggle={toggle} onSet={onSetDone} />
              ) : (
                <ExerciseCard
                  key={bl[0].id}
                  item={bl[0]}
                  index={number - 1}
                  expanded={openIdx === idx}
                  onToggle={toggle}
                  onSet={(b) => onSetDone(bl[0], b)}
                />
              );
            })}
          </div>

          <Button full className="mt-6" icon={Flag} loading={finish.isPending} disabled={done === 0} onClick={() => finish.mutate()}>
            {data.session?.finished_at ? "Actualizar resumen" : "Terminar entrenamiento"}
          </Button>
          {done > 0 && done < planned * 0.8 && (
            <p className="mt-2 text-center text-sm text-ink-2">Completa al menos el 80 % de las series para sumar puntos.</p>
          )}
        </>
      )}

      {rest && <RestTimer rest={rest} onDone={() => setRest(null)} />}

      <Sheet open={picker} onClose={() => setPicker(false)} title="¿Qué rutina haces hoy?">
        <p className="mb-3 text-[15px] text-ink-2">
          Se guarda solo para hoy. Si cambias de día, hoy no sumas puntos por asistir a tu horario reservado.
        </p>
        <SwapOptions
          options={data.options}
          today={data.weekday}
          current={data.swapped_from ?? data.weekday}
          busy={swap.isPending}
          onPick={(w) => swap.mutate(w === data.weekday ? null : w)}
        />
      </Sheet>

      <Sheet open={!!summary} onClose={() => setSummary(null)} title="¡Entrenamiento listo!">
        {summary && (
          <div className="animate-pop space-y-4 text-center">
            <Trophy className="mx-auto size-16 text-gold" strokeWidth={1.5} />
            <div className="grid grid-cols-2 gap-3">
              <Stat label="Duración" value={`${summary.duration_min} min`} />
              <Stat label="Series" value={`${summary.sets_done}/${summary.sets_planned}`} />
              <Stat label="Volumen" value={`${Math.round(Number(summary.volume_kg))} kg`} />
              <Stat label="PRs" value={String(summary.prs)} />
            </div>
            {summary.kcal_estimate > 0 && (
              <div className="rounded-card bg-surface-2 p-3 text-left">
                <p className="flex items-center gap-2">
                  <Flame className="size-6 shrink-0 text-fire" />
                  <span className="text-2xl font-extrabold tabular-nums">≈ {summary.kcal_estimate} kcal</span>
                  <span className="text-sm text-ink-2">quemadas</span>
                </p>
              </div>
            )}
            {summary.points > 0 ? (
              <p className="inline-block rounded-full bg-gold px-5 py-2 text-xl font-extrabold text-night">+{summary.points} puntos</p>
            ) : (
              !summary.completed && <p className="text-[15px] text-ink-2">Te faltó llegar al 80 % de las series para sumar puntos.</p>
            )}
            <Button full onClick={() => setSummary(null)}>
              Listo
            </Button>
          </div>
        )}
      </Sheet>
    </div>
  );
}

const WD_LONG = ["lunes", "martes", "miércoles", "jueves", "viernes", "sábado", "domingo"];

function SwapOptions({
  options,
  today,
  current,
  busy,
  onPick,
}: {
  options: SwapOption[];
  today: number;
  current?: number;
  busy: boolean;
  onPick: (weekday: number) => void;
}) {
  return (
    <ul className="space-y-2">
      {options.map((o) => {
        const active = o.weekday === current;
        return (
          <li key={o.weekday}>
            <button
              disabled={busy || active}
              onClick={() => onPick(o.weekday)}
              className={cx(
                "flex w-full items-center gap-3 rounded-card border px-3 py-3 text-left transition",
                active ? "border-purple bg-purple/10" : "border-line hover:bg-surface-2",
              )}
            >
              <span
                className={cx(
                  "grid size-11 shrink-0 place-items-center rounded-btn font-display text-lg font-bold",
                  o.weekday === today ? "bg-fire text-white" : "bg-surface-2 text-ink",
                )}
              >
                {WD_SHORT[o.weekday]}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate font-semibold capitalize">
                  {WD_LONG[o.weekday]}
                  {o.weekday === today && " · hoy"}
                </span>
                <span className="block truncate text-sm text-ink-2">
                  {o.label || "Entrenamiento"}
                  {o.focus && ` · ${o.focus}`} · {o.exercises} ejercicios
                </span>
              </span>
              {active && <Check className="size-5 shrink-0 text-purple dark:text-orchid" />}
            </button>
          </li>
        );
      })}
    </ul>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-card bg-surface-2 p-3">
      <p className="t-label">{label}</p>
      <p className="text-2xl font-extrabold tabular-nums">{value}</p>
    </div>
  );
}

/** Tira de la semana: punto morado = día con rutina; hoy en naranja. */
function WeekStrip({ today, days }: { today: number; days: number[] }) {
  return (
    <div className="mb-5 grid grid-cols-7 gap-1.5">
      {WD_SHORT.map((d, i) => (
        <div
          key={i}
          className={cx(
            "flex h-14 flex-col items-center justify-center gap-1 rounded-btn text-sm font-bold",
            i === today ? "bg-fire text-white" : "bg-surface-2 text-ink-2",
          )}
        >
          {d}
          <span className={cx("size-1.5 rounded-full", days.includes(i) ? (i === today ? "bg-white" : "bg-purple") : "bg-transparent")} />
        </div>
      ))}
    </div>
  );
}

function ExerciseCard({
  item,
  index,
  expanded,
  onToggle,
  onSet,
}: {
  item: TodayItem;
  index: number;
  expanded: boolean;
  onToggle: () => void;
  onSet: (b: SetBody) => void;
}) {
  const [full, setFull] = useState(false);
  const doneCount = item.logged.filter((l) => l.done).length;
  const complete = doneCount >= item.sets;
  const ex = item.exercise;
  const suggested = item.logged.at(-1)?.weight_kg ?? item.last_weight_kg ?? item.target_weight_kg;
  const work = workLabel(item);

  function completeAll() {
    for (let n = 1; n <= item.sets; n++) {
      const l = item.logged.find((x) => x.set_number === n);
      if (l?.done) continue;
      onSet({ item_id: item.id, set_number: n, weight_kg: l?.weight_kg ?? suggested ?? null, reps: l?.reps ?? item.reps, done: true });
    }
  }

  return (
    <Card className={cx("p-0", complete && "border-success/50")}>
      <button onClick={onToggle} className="flex w-full items-center gap-3 p-3 text-left" aria-expanded={expanded}>
        <div className="w-16 shrink-0">
          <ExerciseMedia ex={ex} className="!rounded-[10px]" />
        </div>
        <div className="min-w-0 flex-1">
          <p className="line-clamp-2 font-semibold first-letter:uppercase leading-snug">
            <span className="mr-1 text-ink-2">{index + 1}.</span>
            {ex.name}
          </p>
          <p className="text-sm text-ink-2">
            {item.sets} × {work}
            {suggested && Number(suggested) > 0 ? ` · ${Number(suggested)} kg` : ""}
          </p>
        </div>
        {complete ? (
          <span className="grid size-9 shrink-0 place-items-center rounded-full bg-success text-white">
            <Check className="size-5" />
          </span>
        ) : (
          <span className="shrink-0 text-sm font-bold tabular-nums text-ink-2">
            {doneCount}/{item.sets}
          </span>
        )}
        <ChevronDown className={cx("size-5 shrink-0 text-ink-2 transition", expanded && "rotate-180")} />
      </button>

      {expanded && (
        <div className="space-y-3 border-t border-line p-3">
          <button onClick={() => setFull(true)} className="mx-auto block w-full max-w-[220px]" aria-label="Ver en grande (toca para pantalla completa)">
            <ExerciseMedia ex={ex} preferVideo />
          </button>
          <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm">
            {ex.target_muscles.length > 0 && <span className="text-ink-2">Trabaja: <b className="text-ink">{trList(ex.target_muscles)}</b></span>}
            <span className="text-ink-2">Descanso: <b className="text-ink">{item.rest_s} s</b></span>
          </div>
          {(item.notes || ex.instructions_es) && (
            <div className="rounded-input bg-surface-2 p-3 text-[15px]">
              {item.notes && <p className="font-semibold">{item.notes}</p>}
              {ex.instructions_es && <p className="whitespace-pre-line text-ink-2">{ex.instructions_es}</p>}
            </div>
          )}

          <div className="space-y-2">
            <div className="grid grid-cols-[48px_1fr_1fr_56px] gap-2 px-1 text-xs font-semibold uppercase tracking-wide text-ink-2">
              <span>Serie</span>
              <span className="text-center">Kg</span>
              <span className="text-center">{inMinutes(item) ? "Min" : item.duration_s ? "Seg" : "Reps"}</span>
              <span />
            </div>
            {Array.from({ length: item.sets }, (_, k) => k + 1).map((n) => (
              <SetRow key={n} n={n} item={item} suggested={suggested} onSet={onSet} />
            ))}
          </div>

          {!complete && (
            <Button variant="secondary" full size="sm" icon={Check} onClick={completeAll}>
              Marcar ejercicio completo
            </Button>
          )}
        </div>
      )}

      <Sheet open={full} onClose={() => setFull(false)} title={ex.name}>
        <ExerciseMedia ex={ex} preferVideo className="mx-auto max-w-md" />
        {ex.instructions.length > 0 && (
          <ol className="mt-4 list-decimal space-y-1.5 pl-5 text-[15px] text-ink-2">
            {ex.instructions.map((s, i) => (
              <li key={i}>{s}</li>
            ))}
          </ol>
        )}
      </Sheet>
    </Card>
  );
}

/** Ejercicios alternados: se hacen por rondas (A, B, A, B…) hasta completar las series de cada uno. */
function SupersetCard({
  items,
  number,
  expanded,
  onToggle,
  onSet,
}: {
  items: TodayItem[];
  number: number;
  expanded: boolean;
  onToggle: () => void;
  onSet: (item: TodayItem, b: SetBody) => void;
}) {
  const [view, setView] = useState<TodayItem | null>(null);
  const letters = items.map((_, k) => String.fromCharCode(65 + k));
  const total = items.reduce((a, i) => a + i.sets, 0);
  const done = items.reduce((a, i) => a + Math.min(doneSets(i), i.sets), 0);
  const complete = done >= total;
  const rounds = Math.max(...items.map((i) => i.sets));
  const suggestedOf = (it: TodayItem) => it.logged.at(-1)?.weight_kg ?? it.last_weight_kg ?? it.target_weight_kg;
  const restAfter = items.at(-1)?.rest_s ?? 0;

  function completeAll() {
    for (let n = 1; n <= rounds; n++)
      for (const it of items) {
        if (n > it.sets) continue;
        const l = it.logged.find((x) => x.set_number === n);
        if (l?.done) continue;
        onSet(it, { item_id: it.id, set_number: n, weight_kg: l?.weight_kg ?? suggestedOf(it) ?? null, reps: l?.reps ?? it.reps, done: true });
      }
  }

  return (
    <Card className={cx("border-l-4 border-l-orchid p-0", complete && "border-success/50")}>
      <button onClick={onToggle} className="flex w-full items-center gap-3 p-3 text-left" aria-expanded={expanded}>
        <div className="relative w-16 shrink-0">
          <ExerciseMedia ex={items[0].exercise} className="!rounded-[10px]" />
          <span className="absolute -bottom-1 -right-1 grid size-6 place-items-center rounded-full bg-orchid text-white">
            <Repeat className="size-3.5" />
          </span>
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-xs font-bold uppercase tracking-wide text-orchid">Alternados · {rounds} rondas</p>
          {items.map((it, k) => (
            <p key={it.id} className="truncate font-semibold first-letter:uppercase leading-snug">
              <span className="mr-1 text-ink-2">
                {number + k}.
              </span>
              {it.exercise.name}
            </p>
          ))}
        </div>
        {complete ? (
          <span className="grid size-9 shrink-0 place-items-center rounded-full bg-success text-white">
            <Check className="size-5" />
          </span>
        ) : (
          <span className="shrink-0 text-sm font-bold tabular-nums text-ink-2">
            {done}/{total}
          </span>
        )}
        <ChevronDown className={cx("size-5 shrink-0 text-ink-2 transition", expanded && "rotate-180")} />
      </button>

      {expanded && (
        <div className="space-y-4 border-t border-line p-3">
          <p className="text-[15px] text-ink-2">
            Haz una serie de cada uno, en orden, sin descansar entre ellos. Al terminar la ronda descansa
            {restAfter > 0 ? ` ${restAfter} s` : ""} y repite.
          </p>
          <ul className="space-y-2">
            {items.map((it, k) => {
              const sug = suggestedOf(it);
              return (
                <li key={it.id}>
                  <button onClick={() => setView(it)} className="flex w-full items-center gap-3 rounded-input bg-surface-2 p-2 text-left">
                    <span className="grid size-8 shrink-0 place-items-center rounded-full bg-orchid font-bold text-white">{letters[k]}</span>
                    <div className="w-12 shrink-0">
                      <ExerciseMedia ex={it.exercise} className="!rounded-[8px]" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="truncate font-semibold first-letter:uppercase">{it.exercise.name}</p>
                      <p className="text-sm text-ink-2">
                        {it.sets} × {workLabel(it)}
                        {sug && Number(sug) > 0 ? ` · ${Number(sug)} kg` : ""}
                      </p>
                      {it.notes && <p className="truncate text-xs text-ink-2">“{it.notes}”</p>}
                    </div>
                  </button>
                </li>
              );
            })}
          </ul>

          {Array.from({ length: rounds }, (_, r) => r + 1).map((n) => {
            const inRound = items.filter((it) => it.sets >= n);
            const roundDone = inRound.every((it) => it.logged.some((l) => l.set_number === n && l.done));
            return (
              <div key={n} className="space-y-2">
                <p className={cx("t-label flex items-center gap-1.5", roundDone && "text-success")}>
                  Ronda {n} {roundDone && <Check className="size-4" />}
                </p>
                <div className="grid grid-cols-[48px_1fr_1fr_56px] gap-2 px-1 text-xs font-semibold uppercase tracking-wide text-ink-2">
                  <span />
                  <span className="text-center">Kg</span>
                  <span className="text-center">Reps / seg</span>
                  <span />
                </div>
                {inRound.map((it) => (
                  <SetRow
                    key={it.id}
                    n={n}
                    item={it}
                    suggested={suggestedOf(it)}
                    onSet={(b) => onSet(it, b)}
                    tag={<span className="text-orchid">{letters[items.indexOf(it)]}</span>}
                  />
                ))}
              </div>
            );
          })}

          {!complete && (
            <Button variant="secondary" full size="sm" icon={Check} onClick={completeAll}>
              Marcar todo completo
            </Button>
          )}
        </div>
      )}

      <Sheet open={!!view} onClose={() => setView(null)} title={view?.exercise.name ?? ""}>
        {view && (
          <div className="space-y-3">
            <ExerciseMedia ex={view.exercise} preferVideo className="mx-auto max-w-md" />
            {(view.notes || view.exercise.instructions_es) && (
              <div className="rounded-input bg-surface-2 p-3 text-[15px]">
                {view.notes && <p className="font-semibold">{view.notes}</p>}
                {view.exercise.instructions_es && <p className="whitespace-pre-line text-ink-2">{view.exercise.instructions_es}</p>}
              </div>
            )}
          </div>
        )}
      </Sheet>
    </Card>
  );
}

function SetRow({
  n,
  item,
  suggested,
  onSet,
  tag,
}: {
  n: number;
  item: TodayItem;
  suggested: string | null;
  onSet: (b: SetBody) => void;
  tag?: ReactNode;
}) {
  const logged = item.logged.find((l) => l.set_number === n);
  const [kg, setKg] = useState(logged?.weight_kg != null ? String(Number(logged.weight_kg)) : suggested ? String(Number(suggested)) : "");
  // Con rango (8–10) no se pre-llena: cada quien escribe cuántas hizo.
  const ranged = !item.duration_s && item.reps_max != null;
  const mins = inMinutes(item);
  const initial = logged?.reps ?? (ranged ? null : (item.reps ?? item.duration_s ?? null));
  const [reps, setReps] = useState(initial == null ? "" : String(mins ? Math.round(initial / 60) : initial));
  const done = !!logged?.done;
  // Si la serie anterior cambió de peso, las siguientes sin registrar lo heredan.
  const prev = useRef(suggested);
  useEffect(() => {
    if (!logged && suggested !== prev.current) {
      setKg(suggested ? String(Number(suggested)) : "");
      prev.current = suggested;
    }
  }, [suggested, logged]);

  const toggle = () =>
    onSet({
      item_id: item.id,
      set_number: n,
      weight_kg: kg ? kg.replace(",", ".") : null,
      reps: reps ? (mins ? Number(reps) * 60 : Number(reps)) : null,
      done: !done,
    });

  const inputCls = cx(
    "h-14 w-full rounded-input border text-center text-xl font-bold tabular-nums focus:border-orchid focus:outline-none",
    done ? "border-success/40 bg-success/10" : "border-line bg-surface-2",
  );
  return (
    <div className="grid grid-cols-[48px_1fr_1fr_56px] items-center gap-2">
      <span className="text-center text-lg font-extrabold tabular-nums text-ink-2">
        {tag ?? n}
        {logged?.is_pr && <span className="ml-0.5 text-xs text-gold">PR</span>}
      </span>
      <input aria-label={`Peso serie ${n}`} inputMode="decimal" value={kg} onChange={(e) => setKg(e.target.value)} className={inputCls} placeholder="—" />
      <input aria-label={`Repeticiones serie ${n}`} inputMode="numeric" value={reps} onChange={(e) => setReps(e.target.value.replace(/\D/g, ""))} className={inputCls} placeholder={ranged ? fmtReps(item.reps, item.reps_max) : "—"} />
      <button
        onClick={toggle}
        aria-label={done ? `Desmarcar serie ${n}` : `Marcar serie ${n}`}
        aria-pressed={done}
        className={cx(
          "grid h-14 place-items-center rounded-input transition duration-150",
          done ? "animate-pop bg-success text-white" : "border-2 border-line text-ink-2 hover:border-success",
        )}
      >
        <Check className="size-7" strokeWidth={2.5} />
      </button>
    </div>
  );
}

/** Timer de descanso: arranca al marcar una serie y vibra al terminar. */
function RestTimer({ rest, onDone }: { rest: { total: number; until: number }; onDone: () => void }) {
  const [left, setLeft] = useState(Math.ceil((rest.until - Date.now()) / 1000));
  useEffect(() => {
    const t = setInterval(() => {
      const s = Math.ceil((rest.until - Date.now()) / 1000);
      setLeft(s);
      if (s <= 0) {
        clearInterval(t);
        navigator.vibrate?.([200, 100, 200]);
        onDone();
      }
    }, 250);
    return () => clearInterval(t);
  }, [rest, onDone]);
  const mm = Math.floor(Math.max(0, left) / 60);
  const ss = String(Math.max(0, left) % 60).padStart(2, "0");
  return (
    <div className="animate-slide-up fixed inset-x-0 bottom-[calc(72px+env(safe-area-inset-bottom))] z-40 px-4 lg:bottom-6">
      <div className="mx-auto flex max-w-md items-center gap-3 rounded-card bg-night p-3 pl-4 text-white shadow-lg">
        <Timer className="size-6 text-fire" />
        <div className="flex-1">
          <p className="text-xs font-semibold uppercase tracking-[0.08em] text-[#B8AEC2]">Descanso</p>
          <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-white/15">
            <div className="h-full bg-fire transition-[width] duration-200" style={{ width: `${(Math.max(0, left) / rest.total) * 100}%` }} />
          </div>
        </div>
        <span className="t-num text-[32px] text-fire">
          {mm}:{ss}
        </span>
        <button onClick={onDone} aria-label="Saltar descanso" className="grid size-11 place-items-center rounded-full hover:bg-white/10">
          <X className="size-5" />
        </button>
      </div>
    </div>
  );
}
