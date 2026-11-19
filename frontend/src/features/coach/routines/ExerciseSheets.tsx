import { useEffect, useRef, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { api, unwrap, upload } from "@/api/client";
import type { Exercise } from "@/api/types";
import { ExerciseMedia } from "@/components/ExerciseMedia";
import { Button, Field, Input, Sheet, Stepper, Switch, Tabs } from "@/components/ui";
import { useToast } from "@/components/ui/toast";
import { tr, trList } from "@/lib/exercise-i18n";
import { fmtReps } from "@/lib/format";

/** Lo que el coach configura por ejercicio. */
export interface ItemDraft {
  exercise: Exercise;
  sets: number;
  reps: number | null;
  reps_max: number | null;
  duration_s: number | null;
  target_weight_kg: string | null;
  rest_s: number;
  superset_group: string;
  notes: string;
}


export const newDraft = (exercise: Exercise): ItemDraft => ({
  exercise,
  sets: 3,
  reps: 10,
  reps_max: null,
  duration_s: null,
  target_weight_kg: null,
  rest_s: 90,
  superset_group: "",
  notes: "",
});

export function itemSummary(i: {
  sets: number;
  reps: number | null;
  reps_max?: number | null;
  duration_s: number | null;
  target_weight_kg: string | null;
  rest_s: number;
}) {
  const work = i.duration_s ? `${i.sets} × ${i.duration_s} s` : `${i.sets} × ${fmtReps(i.reps, i.reps_max)}`;
  const kg = i.target_weight_kg && Number(i.target_weight_kg) > 0 ? ` · ${Number(i.target_weight_kg)} kg` : "";
  return `${work}${kg} · descanso ${i.rest_s} s`;
}

/** Configurar series, repeticiones (o rango, o tiempo), peso sugerido y descanso.
 *  Botones +/−; al tocar el número se puede escribir. */
export function ItemSheet({
  draft,
  onClose,
  onSave,
  saving,
  saveLabel = "Agregar a la rutina",
}: {
  draft: ItemDraft | null;
  onClose: () => void;
  onSave: (d: ItemDraft) => void;
  saving?: boolean;
  saveLabel?: string;
}) {
  const [d, setD] = useState<ItemDraft | null>(draft);
  useEffect(() => setD(draft), [draft]);
  if (!d) return null;
  const set = (p: Partial<ItemDraft>) => setD({ ...d, ...p });
  const timed = d.duration_s !== null;
  const kg = Number(d.target_weight_kg ?? 0);

  return (
    <Sheet open={!!draft} onClose={onClose} title="Configurar">
      <div className="space-y-4">
        <div className="flex items-center gap-3">
          <ExerciseMedia ex={d.exercise} className="!w-20 shrink-0" />
          <div className="min-w-0">
            <p className="font-display text-xl font-bold uppercase leading-tight">{d.exercise.name}</p>
            <p className="text-sm text-ink-2">{trList(d.exercise.target_muscles) || tr(d.exercise.muscle_group)}</p>
          </div>
        </div>

        <div>
          <p className="t-label mb-1.5">Series</p>
          <Stepper value={d.sets} min={1} max={10} onChange={(v) => set({ sets: v })} />
        </div>

        <Tabs
          value={timed ? "time" : "reps"}
          onChange={(v) =>
            set(v === "time" ? { duration_s: d.duration_s ?? 30, reps: null, reps_max: null } : { duration_s: null, reps: d.reps ?? 10 })
          }
          options={[
            { value: "reps", label: "Repeticiones" },
            { value: "time", label: "Tiempo" },
          ]}
        />
        {timed ? (
          <Stepper value={d.duration_s ?? 30} min={5} max={600} step={5} suffix="s" onChange={(v) => set({ duration_s: v })} />
        ) : (
          <div className="space-y-2">
            <Switch
              label="Rango (ej. 8–10)"
              checked={d.reps_max != null}
              onChange={(on) => set({ reps_max: on ? (d.reps ?? 8) + 2 : null })}
            />
            {d.reps_max != null ? (
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <p className="t-label mb-1">Desde</p>
                  <Stepper
                    value={d.reps ?? 8}
                    min={1}
                    max={99}
                    label="Repeticiones mínimas"
                    onChange={(v) => set({ reps: v, reps_max: Math.max(d.reps_max ?? v + 1, v + 1) })}
                  />
                </div>
                <div>
                  <p className="t-label mb-1">Hasta</p>
                  <Stepper
                    value={d.reps_max}
                    min={2}
                    max={100}
                    label="Repeticiones máximas"
                    onChange={(v) => set({ reps_max: v, reps: Math.min(d.reps ?? v - 1, v - 1) })}
                  />
                </div>
              </div>
            ) : (
              <Stepper value={d.reps ?? 10} min={1} max={100} suffix="reps" onChange={(v) => set({ reps: v })} />
            )}
          </div>
        )}

        <div>
          <p className="t-label mb-1.5">Peso sugerido</p>
          <Stepper
            value={kg}
            min={0}
            max={500}
            step={2.5}
            label="Peso sugerido en kg"
            suffix={kg ? "kg" : "sin peso"}
            onChange={(v) => set({ target_weight_kg: v ? String(v) : null })}
          />
        </div>

        <div>
          <p className="t-label mb-1.5">Descanso</p>
          <Stepper value={d.rest_s} min={0} max={900} step={15} suffix="s" label="Descanso en segundos" onChange={(v) => set({ rest_s: v })} />
          {d.superset_group && (
            <p className="mt-1 text-sm text-ink-2">Va alternado con otro ejercicio: el descanso se toma al terminar cada ronda.</p>
          )}
        </div>

        <Field label="Nota para el miembro (opcional)">
          <Input value={d.notes} maxLength={200} placeholder="Ej. baja controlado en 3 s" onChange={(e) => set({ notes: e.target.value })} />
        </Field>

        <Button full loading={saving} onClick={() => onSave(d)}>
          {saveLabel}
        </Button>
      </div>
    </Sheet>
  );
}

/** Vista grande: GIF en bucle, músculos, equipo e instrucciones paso a paso. */
export function ExerciseDetailSheet({
  ex,
  onClose,
  action,
  editable,
}: {
  ex: Exercise | null;
  onClose: () => void;
  action?: React.ReactNode;
  editable?: boolean;
}) {
  const qc = useQueryClient();
  const toast = useToast();
  const [name, setName] = useState("");
  const [tips, setTips] = useState("");
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  async function replaceMedia(f?: File) {
    if (!f || !ex) return;
    setUploading(true);
    try {
      await upload(`/api/coach/exercises/${ex.id}/media`, f);
      toast("Archivo actualizado");
      qc.invalidateQueries({ queryKey: ["coach", "library"] });
      qc.invalidateQueries({ queryKey: ["coach", "routine"] });
      onClose();
    } catch (e) {
      toast((e as Error).message, "error");
    } finally {
      setUploading(false);
    }
  }
  useEffect(() => {
    setName(ex?.name ?? "");
    setTips(ex?.instructions_es ?? "");
  }, [ex]);
  const save = useMutation({
    mutationFn: () =>
      unwrap(
        api.PATCH("/api/coach/exercises/{exercise_id}", {
          params: { path: { exercise_id: ex!.id } },
          body: { name_es: name, instructions_es: tips },
        }),
      ),
    onSuccess: () => {
      toast("Ejercicio guardado");
      qc.invalidateQueries({ queryKey: ["coach", "library"] });
      qc.invalidateQueries({ queryKey: ["coach", "routine"] });
    },
    onError: (e) => toast((e as Error).message, "error"),
  });

  return (
    <Sheet open={!!ex} onClose={onClose} title="Ejercicio">
      {ex && (
        <div className="space-y-4">
          <ExerciseMedia ex={ex} preferVideo className="mx-auto max-w-sm" />
          {editable && ex.source === "custom" && (
            <>
              <Button variant="secondary" full size="sm" loading={uploading} onClick={() => fileRef.current?.click()}>
                Cambiar foto, GIF o video
              </Button>
              <input
                ref={fileRef}
                type="file"
                accept="image/*,video/mp4,video/webm,video/quicktime"
                className="hidden"
                onChange={(e) => replaceMedia(e.target.files?.[0])}
              />
            </>
          )}
          {editable && ex.id > 0 ? (
            <Field label="Nombre en tu biblioteca" hint={ex.name_en ? `Original: ${ex.name_en}` : undefined}>
              <Input value={name} onChange={(e) => setName(e.target.value)} />
            </Field>
          ) : (
            <div>
              <p className="font-display text-2xl font-bold uppercase leading-tight">{ex.name}</p>
              {ex.name_en && ex.name_en !== ex.name && <p className="text-sm text-ink-2">{ex.name_en}</p>}
            </div>
          )}
          <dl className="grid grid-cols-2 gap-3 text-[15px]">
            <Info label="Grupo" value={tr(ex.muscle_group)} />
            <Info label="Equipo" value={tr(ex.equipment)} />
            <Info label="Músculos" value={trList(ex.target_muscles)} />
            <Info label="Secundarios" value={trList(ex.secondary_muscles)} />
          </dl>
          {editable && ex.id > 0 ? (
            <Field label="Tus indicaciones (las ve el miembro)">
              <textarea
                rows={3}
                value={tips}
                onChange={(e) => setTips(e.target.value)}
                placeholder="2–3 indicaciones cortas de técnica"
                className="w-full rounded-input border border-line bg-surface-2 p-3 text-base focus:border-orchid focus:outline-none"
              />
            </Field>
          ) : (
            ex.instructions_es && <p className="whitespace-pre-line rounded-input bg-surface-2 p-3 text-[15px]">{ex.instructions_es}</p>
          )}
          {ex.instructions.length > 0 && (
            <div>
              <p className="t-label mb-1.5">Paso a paso (catálogo)</p>
              <ol className="list-decimal space-y-1.5 pl-5 text-[15px] text-ink-2">
                {ex.instructions.map((s, i) => (
                  <li key={i}>{s}</li>
                ))}
              </ol>
            </div>
          )}
          {editable && ex.id > 0 && (name !== ex.name || tips !== (ex.instructions_es ?? "")) && (
            <Button variant="dark" full loading={save.isPending} disabled={name.trim().length < 2} onClick={() => save.mutate()}>
              Guardar cambios
            </Button>
          )}
          {action}
        </div>
      )}
    </Sheet>
  );
}

function Info({ label, value }: { label: string; value: string }) {
  if (!value) return null;
  return (
    <div>
      <dt className="t-label">{label}</dt>
      <dd className="font-medium">{value}</dd>
    </div>
  );
}
