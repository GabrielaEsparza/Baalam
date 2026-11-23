import { Fragment, useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  ArrowDown,
  ArrowLeft,
  ArrowUp,
  Copy,
  Dumbbell,
  Link2,
  Pencil,
  Plus,
  Repeat,
  Trash2,
  Unlink,
} from "lucide-react";
import { api, unwrap } from "@/api/client";
import type { Exercise, RoutineDay, RoutineItem } from "@/api/types";
import { Avatar } from "@/components/Avatar";
import { ExerciseMedia } from "@/components/ExerciseMedia";
import {
  Button,
  Card,
  EmptyState,
  ErrorBox,
  Input,
  Sheet,
  Spinner,
  cx,
} from "@/components/ui";
import { useToast } from "@/components/ui/toast";
import { WD_SHORT, WEEKDAYS } from "@/lib/format";
import { tr } from "@/lib/exercise-i18n";
import { ExerciseLibrary } from "./ExerciseLibrary";
import {
  ExerciseDetailSheet,
  ItemSheet,
  itemSummary,
  newDraft,
  type ItemDraft,
} from "./ExerciseSheets";
import { putDay, routineKey, useMemberRoutine } from "./routineApi";
import { useMe } from "@/app/session";

type Draft = Omit<RoutineItem, "id" | "order"> & {
  id?: number;
  order?: number;
};

/** `self`: el miembro arma su propia rutina (si la cuenta principal se lo permite). */
export default function RoutineEditor({ self = false }: { self?: boolean }) {
  const { data: me } = useMe();
  const param = Number(useParams().id);
  const memberId = self ? (me?.id ?? 0) : param;
  const qc = useQueryClient();
  const toast = useToast();
  const { data, isLoading, error, refetch } = useMemberRoutine(memberId);
  const [weekday, setWeekday] = useState<number | null>(null);
  const [picker, setPicker] = useState(false);
  const [editing, setEditing] = useState<{
    draft: ItemDraft;
    index: number | null;
  } | null>(null);
  const [detail, setDetail] = useState<Exercise | null>(null);
  const [copyOpen, setCopyOpen] = useState(false);

  // Día inicial: el primer día que reservó (o hoy).
  useEffect(() => {
    if (data && weekday === null)
      setWeekday(data.booked_weekdays[0] ?? (new Date().getDay() + 6) % 7);
  }, [data, weekday]);

  const day: RoutineDay = useMemo(
    () =>
      (data && weekday !== null && data.days[String(weekday)]) || {
        weekday: weekday ?? 0,
        label: "",
        focus: "",
        items: [],
      },
    [data, weekday],
  );
  const [label, setLabel] = useState("");
  const [focus, setFocus] = useState("");
  useEffect(() => {
    setLabel(day.label);
    setFocus(day.focus);
  }, [day.label, day.focus, weekday]);

  const save = useMutation({
    mutationFn: (items: Draft[]) =>
      putDay(qc, memberId, weekday!, { label, focus, items }).then((r) => {
        if (self) qc.invalidateQueries({ queryKey: ["workout-today"] });
        return r;
      }),
    onError: (e) => {
      toast((e as Error).message, "error");
      qc.invalidateQueries({ queryKey: routineKey(memberId) });
    },
  });
  const copy = useMutation({
    mutationFn: (to: number) =>
      unwrap(
        api.POST("/api/coach/routines/{member_id}/copy", {
          params: { path: { member_id: memberId } },
          body: { from_weekday: weekday!, to_weekday: to },
        }),
      ),
    onSuccess: (_, to) => {
      toast(`Copiado al ${WEEKDAYS[to].toLowerCase()}`);
      setCopyOpen(false);
      qc.invalidateQueries({ queryKey: routineKey(memberId) });
      qc.invalidateQueries({ queryKey: ["coach", "routine-members"] });
      if (self) qc.invalidateQueries({ queryKey: ["workout-today"] });
    },
    onError: (e) => toast((e as Error).message, "error"),
  });

  if (isLoading || weekday === null) return <Spinner />;
  if (error || !data) return <ErrorBox error={error} onRetry={refetch} />;

  const items = day.items as Draft[];
  const commit = (next: Draft[], msg?: string) =>
    save.mutate(next, { onSuccess: () => msg && toast(msg) });
  const move = (i: number, dir: -1 | 1) => {
    const next = [...items];
    [next[i], next[i + dir]] = [next[i + dir], next[i]];
    commit(next);
  };
  const first = data.member.full_name.split(" ")[0];

  // Superseries: ejercicios seguidos con la misma letra se alternan serie por serie.
  const grp = (i: number) => items[i]?.superset_group || "";
  const linked = (i: number) => !!grp(i) && grp(i) === grp(i + 1);
  function toggleLink(i: number) {
    const links = items.map((_, k) => k < items.length - 1 && linked(k));
    links[i] = !links[i];
    let g = 0;
    const next = items.map((it, k) => {
      const inGroup = links[k] || (k > 0 && links[k - 1]);
      if (inGroup && !(k > 0 && links[k - 1])) g += 1;
      return { ...it, superset_group: inGroup ? `g${g}` : "" };
    });
    commit(
      next,
      links[i] ? "Se alternan serie por serie" : "Ya no se alternan",
    );
  }

  return (
    <div>
      <Link
        to={self ? "/app/entrenar" : "/coach/rutinas"}
        className="mb-2 inline-flex h-11 items-center gap-1 font-medium text-ink-2 hover:text-ink"
      >
        <ArrowLeft className="size-5" /> {self ? "Entrenar" : "Rutinas"}
      </Link>
      {self ? (
        <header className="mb-5">
          <p className="t-label">Arma tu</p>
          <h1 className="t-h2 text-orchid">Rutina</h1>
        </header>
      ) : (
      <header className="mb-5 flex items-center gap-3">
        <Avatar
          url={data.member.avatar_url}
          name={data.member.full_name}
          size={56}
        />
        <div className="min-w-0">
          <p className="t-label">Rutina de</p>
          <h1 className="t-h2 truncate text-orchid">{data.member.full_name}</h1>
        </div>
      </header>
      )}

      {/* Selector de día */}
      <div className="mb-1 grid grid-cols-7 gap-1.5">
        {WD_SHORT.map((d, i) => {
          const n = data.days[String(i)]?.items.length ?? 0;
          const booked = data.booked_weekdays.includes(i);
          return (
            <button
              key={i}
              onClick={() => setWeekday(i)}
              aria-pressed={weekday === i}
              aria-label={`${WEEKDAYS[i]}${booked ? ", reservado" : ""}, ${n} ejercicios`}
              className={cx(
                "relative flex h-16 flex-col items-center justify-center rounded-btn border font-bold transition",
                weekday === i
                  ? "border-fire-fill bg-fire-fill text-on-fire"
                  : booked
                    ? "border-purple bg-purple/10 text-ink"
                    : "border-line text-ink-2",
              )}
            >
              <span className="text-base">{d}</span>
              <span
                className={cx(
                  "text-[11px] font-semibold",
                  weekday === i ? "text-on-fire/75" : "text-ink-2",
                )}
              >
                {n ? `${n} ej.` : "—"}
              </span>
              {booked && (
                <span
                  className={cx(
                    "absolute right-1 top-1 size-1.5 rounded-full",
                    weekday === i ? "bg-on-fire" : "bg-fire",
                  )}
                />
              )}
            </button>
          );
        })}
      </div>
      <p className="mb-4 text-sm text-ink-2">
        {data.booked_weekdays.length
          ? `${self ? "Reservaste" : `${first} reservó`}: ${data.booked_weekdays.map((d) => WEEKDAYS[d]).join(", ")}.`
          : self
            ? "Aún no reservas tu mes; puedes armar cualquier día."
            : `${first} aún no reserva su mes; puedes armar cualquier día.`}
      </p>

      <Card className="space-y-3">
        <div className="flex items-center justify-between">
          <p className="t-h2">{WEEKDAYS[weekday]}</p>
          {!data.booked_weekdays.includes(weekday) && (
            <span className="text-xs font-semibold text-ink-2">
              No reservó este día
            </span>
          )}
        </div>
        <div className="grid grid-cols-2 gap-2">
          <Input
            value={label}
            placeholder="Nombre (Día A)"
            maxLength={40}
            onChange={(e) => setLabel(e.target.value)}
            onBlur={() =>
              label !== day.label && items.length > 0 && commit(items)
            }
          />
          <Input
            value={focus}
            placeholder="Enfoque (Pierna)"
            maxLength={60}
            onChange={(e) => setFocus(e.target.value)}
            onBlur={() =>
              focus !== day.focus && items.length > 0 && commit(items)
            }
          />
        </div>

        {items.length === 0 ? (
          <EmptyState
            icon={Dumbbell}
            text={`Sin ejercicios el ${WEEKDAYS[weekday].toLowerCase()}.`}
          />
        ) : (
          <ol>
            {items.map((it, i) => (
              <Fragment key={`${it.exercise.id}-${i}`}>
                {grp(i) && grp(i) !== grp(i - 1) && (
                  <li className="flex items-center gap-1.5 pt-3 text-xs font-bold uppercase tracking-wide text-orchid">
                    <Repeat className="size-4" /> Alternados · serie por serie
                  </li>
                )}
                <li
                  className={cx(
                    "flex items-center gap-3 py-3",
                    grp(i) && "border-l-4 border-orchid pl-2",
                  )}
                >
                  <button
                    onClick={() => setDetail(it.exercise)}
                    className="w-16 shrink-0"
                    aria-label={`Ver ${it.exercise.name}`}
                  >
                    <ExerciseMedia
                      ex={it.exercise}
                      className="!rounded-[10px]"
                    />
                  </button>
                  <div className="min-w-0 flex-1">
                    <p className="line-clamp-2 font-semibold first-letter:uppercase leading-snug">
                      <span className="mr-1 text-ink-2">{i + 1}.</span>
                      {it.exercise.name}
                    </p>
                    <p className="text-sm text-ink-2">{itemSummary(it)}</p>
                    {it.notes && (
                      <p className="truncate text-xs text-ink-2">
                        “{it.notes}”
                      </p>
                    )}
                    {!it.notes && it.exercise.muscle_group && (
                      <p className="text-xs text-ink-2">
                        {tr(it.exercise.muscle_group)}
                      </p>
                    )}
                  </div>
                  <div className="grid shrink-0 grid-cols-2 gap-1">
                    <IconBtn
                      label="Subir"
                      disabled={i === 0}
                      onClick={() => move(i, -1)}
                      icon={ArrowUp}
                    />
                    <IconBtn
                      label="Editar"
                      onClick={() =>
                        setEditing({
                          draft: { ...it, notes: it.notes ?? "" },
                          index: i,
                        })
                      }
                      icon={Pencil}
                    />
                    <IconBtn
                      label="Bajar"
                      disabled={i === items.length - 1}
                      onClick={() => move(i, 1)}
                      icon={ArrowDown}
                    />
                    <IconBtn
                      label="Quitar"
                      danger
                      onClick={() =>
                        commit(
                          items.filter((_, j) => j !== i),
                          "Ejercicio quitado",
                        )
                      }
                      icon={Trash2}
                    />
                  </div>
                </li>
                {i < items.length - 1 && (
                  <li
                    className={cx(
                      "flex justify-center py-0.5",
                      linked(i) && "border-l-4 border-orchid",
                    )}
                  >
                    <button
                      type="button"
                      onClick={() => toggleLink(i)}
                      disabled={save.isPending}
                      className={cx(
                        "flex h-8 items-center gap-1.5 rounded-full px-3 text-xs font-semibold transition",
                        linked(i)
                          ? "text-ink-2 hover:bg-surface-2"
                          : "text-orchid hover:bg-orchid/10",
                      )}
                    >
                      {linked(i) ? (
                        <Unlink className="size-3.5" />
                      ) : (
                        <Link2 className="size-3.5" />
                      )}
                      {linked(i) ? "Separar" : "Alternar con el siguiente"}
                    </button>
                  </li>
                )}
              </Fragment>
            ))}
          </ol>
        )}

        <Button full icon={Plus} onClick={() => setPicker(true)}>
          Agregar ejercicio
        </Button>
        {items.length > 0 && (
          <Button
            variant="secondary"
            full
            icon={Copy}
            onClick={() => setCopyOpen(true)}
          >
            Copiar este día a otro
          </Button>
        )}
      </Card>

      {/* Elegir ejercicio */}
      <Sheet
        open={picker}
        onClose={() => setPicker(false)}
        title="Agregar ejercicio"
      >
        <ExerciseLibrary
          coach={!self}
          onPick={(ex) => {
            setPicker(false);
            setEditing({ draft: newDraft(ex), index: null });
          }}
        />
      </Sheet>

      {/* Configurar series/reps/peso/descanso */}
      <ItemSheet
        draft={editing?.draft ?? null}
        saving={save.isPending}
        saveLabel={
          editing?.index == null
            ? `Agregar al ${WEEKDAYS[weekday].toLowerCase()}`
            : "Guardar"
        }
        onClose={() => setEditing(null)}
        onSave={(d) => {
          const next = [...items];
          if (editing?.index == null) next.push(d);
          else next[editing.index] = { ...next[editing.index], ...d };
          save.mutate(next, {
            onSuccess: () => {
              toast(
                editing?.index == null
                  ? "Ejercicio agregado"
                  : "Cambios guardados",
              );
              setEditing(null);
            },
          });
        }}
      />

      <ExerciseDetailSheet
        ex={detail}
        editable={!self}
        onClose={() => setDetail(null)}
      />

      <Sheet
        open={copyOpen}
        onClose={() => setCopyOpen(false)}
        title="Copiar a…"
      >
        <p className="mb-3 text-[15px] text-ink-2">
          Reemplaza lo que haya en el día elegido.
        </p>
        <div className="grid grid-cols-2 gap-2">
          {WEEKDAYS.map((name, i) =>
            i === weekday ? null : (
              <button
                key={i}
                disabled={copy.isPending}
                onClick={() => copy.mutate(i)}
                className={cx(
                  "flex h-12 items-center justify-between rounded-btn border px-3 font-semibold hover:bg-surface-2",
                  data.booked_weekdays.includes(i)
                    ? "border-purple bg-purple/10"
                    : "border-line",
                )}
              >
                {name}
                <span className="text-xs text-ink-2">
                  {data.days[String(i)]?.items.length
                    ? `${data.days[String(i)].items.length} ej.`
                    : ""}
                </span>
              </button>
            ),
          )}
        </div>
      </Sheet>
    </div>
  );
}

function IconBtn({
  label,
  icon: Icon,
  onClick,
  disabled,
  danger,
}: {
  label: string;
  icon: typeof Pencil;
  onClick: () => void;
  disabled?: boolean;
  danger?: boolean;
}) {
  return (
    <button
      aria-label={label}
      title={label}
      disabled={disabled}
      onClick={onClick}
      className={cx(
        "grid size-9 place-items-center rounded-full hover:bg-surface-2 disabled:opacity-25",
        danger ? "text-danger" : "text-ink-2",
      )}
    >
      <Icon className="size-[18px]" />
    </button>
  );
}
