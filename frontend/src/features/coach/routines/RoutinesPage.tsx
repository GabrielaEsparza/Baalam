import { useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { ChevronRight, ClipboardList } from "lucide-react";
import type { Exercise } from "@/api/types";
import { Avatar } from "@/components/Avatar";
import { Card, EmptyState, ErrorBox, PageTitle, Sheet, Spinner, Tabs, cx } from "@/components/ui";
import { useToast } from "@/components/ui/toast";
import { WD_SHORT, WEEKDAYS } from "@/lib/format";
import { ExerciseLibrary } from "./ExerciseLibrary";
import { ItemSheet, newDraft, type ItemDraft } from "./ExerciseSheets";
import { useAppendToDay, useRoutineMembers } from "./routineApi";

export default function RoutinesPage() {
  const [params, setParams] = useSearchParams();
  const tab = params.get("tab") === "biblioteca" ? "biblioteca" : "inscritos";
  return (
    <div>
      <PageTitle accent="rutinas">Las</PageTitle>
      <Tabs
        className="mb-5"
        value={tab}
        onChange={(v) => setParams(v === "biblioteca" ? { tab: v } : {}, { replace: true })}
        options={[
          { value: "inscritos", label: "Rutina personalizada" },
          { value: "biblioteca", label: "Biblioteca" },
        ]}
      />
      {tab === "inscritos" ? <EnrolledList /> : <LibraryTab />}
    </div>
  );
}

/** Inscritos en Plan Rutina, con los días que reservaron y los que ya tienen ejercicios. */
function EnrolledList() {
  const { data, isLoading, error, refetch } = useRoutineMembers();
  if (isLoading) return <Spinner />;
  if (error || !data) return <ErrorBox error={error} onRetry={refetch} />;
  if (data.length === 0)
    return <EmptyState icon={ClipboardList} text="Nadie tiene Plan Rutina activo todavía. Cuando registres un pago de ese plan, aparecerá aquí." />;

  return (
    <>
      <p className="mb-3 text-[15px] text-ink-2">
        Toca un nombre para agregar sus ejercicios por día. <span className="font-semibold text-ink">●</span> = día que reservó.
      </p>
      <Card className="divide-y divide-line p-0">
        {data.map((m) => {
          const pending = m.booked_weekdays.filter((d) => !m.routine_weekdays.includes(d)).length;
          return (
            <Link key={m.id} to={`/coach/rutinas/${m.id}`} className="flex items-center gap-3 px-4 py-3 hover:bg-surface-2">
              <Avatar url={m.avatar_url} name={m.full_name} size={44} />
              <div className="min-w-0 flex-1">
                <p className="truncate font-semibold">{m.full_name}</p>
                <WeekDots booked={m.booked_weekdays} done={m.routine_weekdays} />
                <p className={cx("mt-2 text-xs font-semibold", pending ? "text-warning" : "text-ink-2")}>
                  {m.routine_weekdays.length === 0
                    ? "Sin rutina todavía"
                    : pending
                      ? `Falta${pending > 1 ? "n" : ""} ${pending} día${pending > 1 ? "s" : ""} por armar`
                      : `${m.routine_weekdays.length} días armados`}
                </p>
              </div>
              <ChevronRight className="size-5 shrink-0 text-ink-2" />
            </Link>
          );
        })}
      </Card>
    </>
  );
}

/** L M X J V S D: relleno morado = tiene ejercicios; punto = día reservado. */
export function WeekDots({ booked, done }: { booked: number[]; done: number[] }) {
  return (
    <div className="mt-1 flex gap-1">
      {WD_SHORT.map((d, i) => (
        <span
          key={i}
          title={WEEKDAYS[i]}
          className={cx(
            "relative grid size-6 place-items-center rounded-full text-[11px] font-bold",
            done.includes(i) ? "bg-purple text-white" : "bg-surface-2 text-ink-2",
          )}
        >
          {d}
          {booked.includes(i) && <span className="absolute -bottom-1 size-1.5 rounded-full bg-fire" />}
        </span>
      ))}
    </div>
  );
}

/** Biblioteca: buscar → ver GIF → "Agregar a rutina" (elige persona y día). */
function LibraryTab() {
  const toast = useToast();
  const members = useRoutineMembers();
  const append = useAppendToDay();
  const [ex, setEx] = useState<Exercise | null>(null);
  const [memberId, setMemberId] = useState<number | null>(null);
  const [weekday, setWeekday] = useState<number | null>(null);
  const [draft, setDraft] = useState<ItemDraft | null>(null);

  const reset = () => {
    setEx(null);
    setMemberId(null);
    setWeekday(null);
    setDraft(null);
  };
  const member = members.data?.find((m) => m.id === memberId);

  return (
    <>
      <ExerciseLibrary pickLabel="A rutina" onPick={setEx} />

      <Sheet open={!!ex && !draft} onClose={reset} title={member ? "¿Qué día?" : "¿Para quién?"}>
        {!member ? (
          members.isLoading ? (
            <Spinner />
          ) : (members.data ?? []).length === 0 ? (
            <p className="text-[15px] text-ink-2">No hay inscritos en rutina personalizada.</p>
          ) : (
            <div className="divide-y divide-line rounded-card border border-line">
              {members.data!.map((m) => (
                <button key={m.id} onClick={() => setMemberId(m.id)} className="flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-surface-2">
                  <Avatar url={m.avatar_url} name={m.full_name} size={40} />
                  <span className="flex-1 font-semibold">{m.full_name}</span>
                  <ChevronRight className="size-5 text-ink-2" />
                </button>
              ))}
            </div>
          )
        ) : (
          <div className="space-y-2">
            <p className="text-[15px] text-ink-2">
              {member.full_name} · <span className="text-fire">●</span> días que reservó
            </p>
            <div className="grid grid-cols-2 gap-2">
              {WEEKDAYS.map((name, i) => (
                <button
                  key={i}
                  onClick={() => {
                    setWeekday(i);
                    setDraft(newDraft(ex!));
                  }}
                  className={cx(
                    "flex h-12 items-center justify-between rounded-btn border px-3 font-semibold",
                    member.booked_weekdays.includes(i) ? "border-purple bg-purple/10" : "border-line",
                  )}
                >
                  {name}
                  {member.booked_weekdays.includes(i) && <span className="text-fire">●</span>}
                </button>
              ))}
            </div>
            <button onClick={() => setMemberId(null)} className="pt-2 text-sm font-semibold text-orchid">
              ← Elegir otra persona
            </button>
          </div>
        )}
      </Sheet>

      <ItemSheet
        draft={draft}
        onClose={reset}
        saving={append.isPending}
        saveLabel={member && weekday !== null ? `Agregar al ${WEEKDAYS[weekday].toLowerCase()} de ${member.full_name.split(" ")[0]}` : "Agregar"}
        onSave={(d) =>
          append.mutate(
            { memberId: memberId!, weekday: weekday!, draft: d },
            {
              onSuccess: () => {
                toast(`Agregado a la rutina de ${member?.full_name.split(" ")[0]}`);
                reset();
              },
              onError: (e) => toast((e as Error).message, "error"),
            },
          )
        }
      />
    </>
  );
}
