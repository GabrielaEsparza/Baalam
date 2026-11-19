import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ChevronLeft, ChevronRight, Flame, Pencil, Plus, Trash2 } from "lucide-react";
import { api, unwrap } from "@/api/client";
import { Button, Card, ErrorBox, PageTitle, Spinner } from "@/components/ui";
import { useToast } from "@/components/ui/toast";
import { fmtDate, isoDate } from "@/lib/format";
import { FoodCalculator, FoodThumb } from "./FoodCalculator";
import { FoodSearchSheet } from "./FoodSearch";
import { GoalSheet, Summary } from "./MacroSummary";
import { ManualSheet } from "./ManualSheet";
import { MACROS, MEALS, defaultMeal, fmtN, mealLabel, type DaySummary, type FoodItem, type FoodLog, type Meal } from "./nutri";

const shift = (iso: string, days: number) => {
  const d = new Date(`${iso}T12:00:00`);
  d.setDate(d.getDate() + days);
  return isoDate(d);
};

export default function NutritionPage() {
  const qc = useQueryClient();
  const toast = useToast();
  const todayIso = isoDate(new Date());
  const [date, setDate] = useState(todayIso);
  const [searchMeal, setSearchMeal] = useState<Meal | null>(null);
  const [calc, setCalc] = useState<{ food: FoodItem; meal: Meal; editing?: FoodLog } | null>(null);
  const [goalOpen, setGoalOpen] = useState(false);
  const [manual, setManual] = useState<{ meal: Meal; editing?: FoodLog } | null>(null);

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ["nutrition", "day", date],
    queryFn: async () => (await unwrap(api.GET("/api/nutrition/day", { params: { query: { date } } }))) as unknown as DaySummary,
  });

  const quickAdd = useMutation({
    mutationFn: (f: FoodItem) =>
      unwrap(api.POST("/api/nutrition/logs", { body: { food_id: f.id!, meal: searchMeal ?? defaultMeal(), date, amount: f.last_amount! } as never })),
    onSuccess: (_, f) => {
      toast(`${f.name} agregado (${fmtN(f.last_amount ?? 0)} ${f.basis_unit})`);
      qc.invalidateQueries({ queryKey: ["nutrition"] });
      setSearchMeal(null);
    },
    onError: (e) => toast((e as Error).message, "error"),
  });

  const restore = useMutation({
    mutationFn: (l: FoodLog) =>
      l.input_mode === "manual"
        ? unwrap(
            api.POST("/api/nutrition/logs/manual", {
              body: { meal: l.meal, date, name: l.name, kcal: l.kcal, protein_g: l.protein_g, carbs_g: l.carbs_g, fat_g: l.fat_g } as never,
            }),
          )
        : unwrap(api.POST("/api/nutrition/logs", { body: { food_id: l.food_id!, meal: l.meal, date, amount: l.amount } as never })),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["nutrition"] }),
    onError: (e) => toast((e as Error).message, "error"),
  });
  const remove = useMutation({
    mutationFn: (l: FoodLog) => unwrap(api.DELETE("/api/nutrition/logs/{log_id}", { params: { path: { log_id: l.id } } })),
    onSuccess: (_, l) => {
      qc.invalidateQueries({ queryKey: ["nutrition"] });
      toast(`Quitaste ${l.name} de ${mealLabel(l.meal).toLowerCase()}`, "ok", l.food_id || l.input_mode === "manual" ? { label: "Deshacer", onClick: () => restore.mutate(l) } : undefined);
    },
    onError: (e) => toast((e as Error).message, "error"),
  });

  async function openLog(l: FoodLog) {
    if (l.input_mode === "manual") return setManual({ meal: l.meal, editing: l });
    if (!l.food_id) return toast("Este alimento ya no está disponible; bórralo y agrégalo de nuevo.", "error");
    try {
      const food = (await unwrap(api.GET("/api/nutrition/foods/{food_id}", { params: { path: { food_id: l.food_id } } }))) as unknown as FoodItem;
      setCalc({ food, meal: l.meal, editing: l });
    } catch (e) {
      toast((e as Error).message, "error");
    }
  }

  const isToday = date === todayIso;

  return (
    <div>
      <PageTitle accent="nutrición">Mi</PageTitle>

      {/* Día */}
      <div className="mb-4 flex items-center justify-between">
        <button
          aria-label="Día anterior"
          disabled={!!data && date <= data.oldest}
          onClick={() => setDate(shift(date, -1))}
          className="grid size-11 place-items-center rounded-full hover:bg-surface-2 disabled:opacity-30"
        >
          <ChevronLeft className="size-5" />
        </button>
        <button onClick={() => setDate(todayIso)} className="text-center">
          <p className="font-semibold first-letter:uppercase">
            {isToday ? "Hoy" : date === shift(todayIso, -1) ? "Ayer" : fmtDate(date, { weekday: "long" })}
          </p>
          <p className="text-sm text-ink-2">{fmtDate(date, { day: "numeric", month: "long" })}</p>
        </button>
        <button
          aria-label="Día siguiente"
          disabled={isToday}
          onClick={() => setDate(shift(date, 1))}
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
        <div className="space-y-4">
          {date <= data.oldest && (
            <p className="rounded-input bg-surface-2 px-3 py-2 text-sm text-ink-2">
              Solo se guardan los últimos {data.retention_days} días. Mañana se borra lo de este día.
            </p>
          )}
          <Summary d={data} onGoal={() => setGoalOpen(true)} />

          {MEALS.map((m) => {
            const logs = data.meals[m.value];
            const kcal = logs.reduce((a, l) => a + (l.kcal ?? 0), 0);
            return (
              <Card key={m.value} className="p-0">
                <div className="flex items-center justify-between px-4 pb-2 pt-3">
                  <div>
                    <p className="t-h2 text-[20px]">{m.label}</p>
                    <p className="text-sm tabular-nums text-ink-2">{logs.length ? `${fmtN(kcal, 0)} kcal` : "Sin registros"}</p>
                  </div>
                  <button
                    onClick={() => setSearchMeal(m.value)}
                    aria-label={`Agregar a ${m.label}`}
                    className="grid size-11 place-items-center rounded-full border border-line text-ink hover:bg-surface-2"
                  >
                    <Plus className="size-5" />
                  </button>
                </div>
                {logs.length > 0 && (
                  <ul className="divide-y divide-line border-t border-line">
                    {logs.map((l) => (
                      <li key={l.id} className="flex items-center">
                        <button onClick={() => openLog(l)} className="flex min-w-0 flex-1 items-center gap-3 py-2.5 pl-4 pr-2 text-left hover:bg-surface-2">
                          {l.input_mode === "manual" ? (
                            <span className="grid size-10 shrink-0 place-items-center rounded-input bg-fire/10 text-fire" aria-hidden>
                              <Flame className="size-5" />
                            </span>
                          ) : (
                            <FoodThumb url={l.image_url} size={40} />
                          )}
                          <span className="min-w-0 flex-1">
                            <span className="block truncate font-medium first-letter:uppercase">{l.name}</span>
                            <span className="flex flex-wrap gap-x-2 text-xs tabular-nums text-ink-2">
                              <span>{l.input_mode === "manual" ? "Solo calorías" : `${fmtN(l.amount)} ${l.unit}`}</span>
                              {MACROS.map((m) => (
                                <span key={m.key} className="inline-flex items-center gap-1">
                                  <span className={`size-2 rounded-full ${m.bg}`} aria-hidden />
                                  {m.short} {fmtN(l[m.key])}
                                </span>
                              ))}
                            </span>
                          </span>
                          <span className="shrink-0 text-right">
                            <span className="block font-bold tabular-nums">{fmtN(l.kcal, 0)}</span>
                            <span className="block text-xs text-ink-2">kcal</span>
                          </span>
                        </button>
                        <button
                          onClick={() => openLog(l)}
                          aria-label={`Editar ${l.name}`}
                          className="grid size-11 shrink-0 place-items-center rounded-full text-ink-2 hover:bg-surface-2 hover:text-ink"
                        >
                          <Pencil className="size-[18px]" />
                        </button>
                        <button
                          onClick={() => remove.mutate(l)}
                          disabled={remove.isPending && remove.variables?.id === l.id}
                          aria-label={`Eliminar ${l.name}`}
                          className="mr-1 grid size-11 shrink-0 place-items-center rounded-full text-ink-2 hover:bg-surface-2 hover:text-danger disabled:opacity-40"
                        >
                          <Trash2 className="size-[18px]" />
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </Card>
            );
          })}

          <div className="space-y-2">
            <Button full icon={Plus} onClick={() => setSearchMeal(defaultMeal())}>
              Agregar alimento
            </Button>
            <Button variant="secondary" full icon={Flame} onClick={() => setManual({ meal: defaultMeal() })}>
              Agregar solo calorías
            </Button>
          </div>
        </div>
      )}

      <FoodSearchSheet
        open={!!searchMeal && !calc}
        meal={searchMeal ?? "breakfast"}
        onClose={() => setSearchMeal(null)}
        onPick={(food) => setCalc({ food, meal: searchMeal ?? defaultMeal() })}
        onQuickAdd={(f) => quickAdd.mutate(f)}
        onManual={() => {
          setManual({ meal: searchMeal ?? defaultMeal() });
          setSearchMeal(null);
        }}
      />
      <ManualSheet
        open={!!manual}
        meal={manual?.meal ?? "breakfast"}
        editing={manual?.editing}
        date={date}
        onClose={() => setManual(null)}
      />
      <FoodCalculator
        food={calc?.food ?? null}
        meal={calc?.meal ?? "breakfast"}
        editing={calc?.editing}
        date={date}
        onClose={() => setCalc(null)}
        onSaved={() => setSearchMeal(null)}
      />
      {data && <GoalSheet open={goalOpen} onClose={() => setGoalOpen(false)} goal={data.goal} />}
    </div>
  );
}
