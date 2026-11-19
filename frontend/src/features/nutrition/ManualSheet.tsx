import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Trash2 } from "lucide-react";
import { api, unwrap } from "@/api/client";
import { Button, Field, Input, Sheet, cx } from "@/components/ui";
import { useToast } from "@/components/ui/toast";
import { MACROS, MEALS, mealLabel, type FoodLog, type MacroKey, type Meal } from "./nutri";

/** Calorías sin alimento: por si lo que comiste no está en la lista.
 *  Las kcal son obligatorias; los macros, opcionales (si no se escriben quedan sin dato, no en 0). */
export function ManualSheet({
  open,
  meal: initialMeal,
  date,
  editing,
  onClose,
  onSaved,
}: {
  open: boolean;
  meal: Meal;
  date: string;
  editing?: FoodLog | null;
  onClose: () => void;
  onSaved?: () => void;
}) {
  const qc = useQueryClient();
  const toast = useToast();
  const [name, setName] = useState("");
  const [kcal, setKcal] = useState("");
  const [macros, setMacros] = useState<Record<MacroKey, string>>({ protein_g: "", carbs_g: "", fat_g: "" });
  const [meal, setMeal] = useState<Meal>(initialMeal);
  const [lastOpen, setLastOpen] = useState(false);
  if (open !== lastOpen) {
    setLastOpen(open);
    if (open) {
      setName(editing && editing.name !== "Calorías rápidas" ? editing.name : "");
      setKcal(editing?.kcal != null ? String(editing.kcal) : "");
      setMacros(Object.fromEntries(MACROS.map((m) => [m.key, editing?.[m.key] != null ? String(editing[m.key]) : ""])) as Record<MacroKey, string>);
      setMeal(editing?.meal ?? initialMeal);
    }
  }

  const num = (s: string) => (s.trim() === "" ? null : Number(s));
  const kcalN = num(kcal);
  const valid = kcalN != null && kcalN > 0 && kcalN <= 5000;
  const decimal = (s: string) => s.replace(",", ".").replace(/[^\d.]/g, "").replace(/(\..*)\./g, "$1");

  const done = (msg: string) => {
    toast(msg);
    qc.invalidateQueries({ queryKey: ["nutrition"] });
    onSaved?.();
    onClose();
  };

  const save = useMutation({
    mutationFn: () => {
      const body = {
        meal,
        name: name.trim() || null,
        kcal: kcalN!,
        ...Object.fromEntries(MACROS.map((m) => [m.key, num(macros[m.key])])),
      };
      return editing
        ? unwrap(api.PATCH("/api/nutrition/logs/{log_id}/manual", { params: { path: { log_id: editing.id } }, body: body as never }))
        : unwrap(api.POST("/api/nutrition/logs/manual", { body: { ...body, date } as never }));
    },
    onSuccess: () => done(editing ? "Registro actualizado" : `${kcalN} kcal agregadas a ${mealLabel(meal).toLowerCase()}`),
    onError: (e) => toast((e as Error).message, "error"),
  });
  const del = useMutation({
    mutationFn: () => unwrap(api.DELETE("/api/nutrition/logs/{log_id}", { params: { path: { log_id: editing!.id } } })),
    onSuccess: () => done("Registro eliminado"),
    onError: (e) => toast((e as Error).message, "error"),
  });

  return (
    <Sheet open={open} onClose={onClose} title={editing ? "Editar calorías" : "Agregar solo calorías"}>
      <div className="space-y-4">
        {!editing && <p className="text-[15px] text-ink-2">Para cuando lo que comiste no está en la lista. Solo las calorías son obligatorias.</p>}

        <Field label="Calorías (kcal)">
          <Input
            inputMode="decimal"
            autoFocus
            value={kcal}
            onChange={(e) => setKcal(decimal(e.target.value).slice(0, 6))}
            className="h-16 text-center text-3xl font-extrabold tabular-nums"
            placeholder="0"
          />
        </Field>

        <Field label="¿Qué fue? (opcional)">
          <Input value={name} maxLength={200} onChange={(e) => setName(e.target.value)} placeholder="Ej. Tacos de la esquina" />
        </Field>

        <div>
          <p className="t-label mb-1.5">Macros (opcional)</p>
          <div className="grid grid-cols-3 gap-2">
            {MACROS.map((m) => (
              <label key={m.key} className="block">
                <span className="mb-1 flex items-center gap-1.5 text-sm font-medium">
                  <span className={cx("size-2.5 rounded-full", m.bg)} aria-hidden />
                  {m.label === "Carbohidratos" ? "Carbos" : m.label}
                </span>
                <span className="relative block">
                  <Input
                    inputMode="decimal"
                    value={macros[m.key]}
                    onChange={(e) => setMacros((s) => ({ ...s, [m.key]: decimal(e.target.value).slice(0, 6) }))}
                    className="pr-7 text-center font-bold tabular-nums"
                    placeholder="—"
                    aria-label={`${m.label} en gramos`}
                  />
                  <span className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-sm text-ink-2">g</span>
                </span>
              </label>
            ))}
          </div>
        </div>

        <div>
          <p className="t-label mb-1.5">Agregar a</p>
          <div className="grid grid-cols-4 gap-1.5">
            {MEALS.map((m) => (
              <button
                key={m.value}
                onClick={() => setMeal(m.value)}
                aria-pressed={meal === m.value}
                className={cx("h-11 rounded-btn border text-sm font-semibold", meal === m.value ? "border-purple bg-purple text-white" : "border-line text-ink")}
              >
                {m.label}
              </button>
            ))}
          </div>
        </div>

        <Button full loading={save.isPending} disabled={!valid} onClick={() => save.mutate()}>
          {editing ? "Guardar cambios" : `Agregar a ${mealLabel(meal).toLowerCase()}`}
        </Button>
        {editing && (
          <Button variant="danger" full icon={Trash2} loading={del.isPending} onClick={() => del.mutate()}>
            Eliminar
          </Button>
        )}
      </div>
    </Sheet>
  );
}
