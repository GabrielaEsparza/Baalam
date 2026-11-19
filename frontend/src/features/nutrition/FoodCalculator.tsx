import { useEffect, useMemo, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, Apple, Star, Trash2 } from "lucide-react";
import { api, unwrap } from "@/api/client";
import { Button, Input, Sheet, cx } from "@/components/ui";
import { useToast } from "@/components/ui/toast";
import { MEALS, compute, fmtN, mealLabel, sourceLabel, type FoodItem, type FoodLog, type Meal } from "./nutri";

type Mode = "amount" | "kcal";

export function FoodThumb({ url, size = 48 }: { url?: string; size?: number }) {
  const [broken, setBroken] = useState(false);
  if (url && !broken)
    return (
      <img
        src={url}
        alt=""
        loading="lazy"
        onError={() => setBroken(true)}
        style={{ width: size, height: size }}
        className="shrink-0 rounded-[10px] bg-white object-contain"
      />
    );
  return (
    <span style={{ width: size, height: size }} className="grid shrink-0 place-items-center rounded-[10px] bg-surface-2 text-ink-2">
      <Apple className="size-1/2" strokeWidth={1.75} />
    </span>
  );
}

/**
 * Calculadora: el usuario escribe gramos (o ml) o calorías y ve al instante los
 * macros. Si el alimento no tiene kcal válidas, el modo calorías se desactiva y se explica.
 */
export function FoodCalculator({
  food,
  date,
  meal: initialMeal,
  editing,
  onClose,
  onSaved,
}: {
  food: FoodItem | null;
  date: string;
  meal: Meal;
  editing?: FoodLog | null;
  onClose: () => void;
  onSaved?: () => void;
}) {
  const qc = useQueryClient();
  const toast = useToast();
  const [mode, setMode] = useState<Mode>("amount");
  const [value, setValue] = useState("");
  const [meal, setMeal] = useState<Meal>(initialMeal);
  const [fav, setFav] = useState(false);

  useEffect(() => {
    if (!food) return;
    setMeal(editing?.meal ?? initialMeal);
    setFav(!!food.favorite);
    if (editing) {
      setMode(editing.input_mode === "kcal" && food.kcal_mode ? "kcal" : "amount");
      setValue(String(editing.input_mode === "kcal" && food.kcal_mode ? editing.kcal : editing.amount));
    } else {
      setMode("amount");
      setValue(food.last_amount ? String(food.last_amount) : food.serving_qty ? String(food.serving_qty) : "100");
    }
  }, [food, editing, initialMeal]);

  const unit = food?.basis_unit ?? "g";
  const num = Number(value.replace(",", "."));
  const result = useMemo(() => {
    if (!food || !(num > 0)) return null;
    return compute(food, mode === "kcal" ? { kcal: num } : { amount: num });
  }, [food, num, mode]);
  const tooBig = num > 5000;

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["nutrition", "day"] });
    qc.invalidateQueries({ queryKey: ["nutrition", "quick"] });
  };

  const save = useMutation({
    mutationFn: async () => {
      const qty = mode === "kcal" ? { kcal: num } : { amount: num };
      if (editing)
        return unwrap(
          api.PATCH("/api/nutrition/logs/{log_id}", { params: { path: { log_id: editing.id } }, body: { ...qty, meal } as never }),
        );
      return unwrap(api.POST("/api/nutrition/logs", { body: { food_id: food!.id!, meal, date, ...qty } as never }));
    },
    onSuccess: () => {
      toast(editing ? "Cambios guardados" : `Agregado a ${mealLabel(meal).toLowerCase()}`);
      invalidate();
      onSaved?.();
      onClose();
    },
    onError: (e) => toast((e as Error).message, "error"),
  });

  const del = useMutation({
    mutationFn: () => unwrap(api.DELETE("/api/nutrition/logs/{log_id}", { params: { path: { log_id: editing!.id } } })),
    onSuccess: () => {
      toast("Alimento eliminado");
      invalidate();
      onClose();
    },
  });

  const toggleFav = useMutation({
    mutationFn: (on: boolean) =>
      unwrap(
        on
          ? api.PUT("/api/nutrition/favorites/{food_id}", { params: { path: { food_id: food!.id! } } })
          : api.DELETE("/api/nutrition/favorites/{food_id}", { params: { path: { food_id: food!.id! } } }),
      ),
    onMutate: (on) => setFav(on),
    onSuccess: (_, on) => {
      toast(on ? "Guardado en favoritos" : "Quitado de favoritos");
      qc.invalidateQueries({ queryKey: ["nutrition", "quick"] });
    },
    onError: (_, on) => setFav(!on),
  });

  if (!food) return null;
  const quick =
    mode === "kcal"
      ? [100, 150, 200, 300]
      : [...(food.serving_qty ? [food.serving_qty] : []), 50, 100, 150, 200].filter((v, i, a) => a.indexOf(v) === i).slice(0, 4);

  return (
    <Sheet open={!!food} onClose={onClose} title={editing ? "Editar" : "Calcular"}>
      <div className="space-y-4">
        {/* Encabezado */}
        <div className="flex items-start gap-3">
          <FoodThumb url={food.image_url} size={56} />
          <div className="min-w-0 flex-1">
            <p className="font-semibold leading-snug first-letter:uppercase">{food.name}</p>
            <p className="text-sm text-ink-2">
              {food.brand && `${food.brand} · `}
              {sourceLabel(food.source)}
              {food.is_mexican && " · México"}
            </p>
          </div>
          {food.id && (
            <button
              onClick={() => toggleFav.mutate(!fav)}
              aria-label={fav ? "Quitar de favoritos" : "Guardar en favoritos"}
              aria-pressed={fav}
              className="grid size-11 shrink-0 place-items-center rounded-full hover:bg-surface-2"
            >
              <Star className={cx("size-6", fav ? "fill-gold text-gold" : "text-ink-2")} />
            </button>
          )}
        </div>

        {/* Por 100 */}
        <div className="grid grid-cols-4 gap-2 rounded-input bg-surface-2 p-3 text-center">
          <Per100 label="kcal" v={food.kcal} d={0} />
          <Per100 label="Prot." v={food.protein_g} />
          <Per100 label="Carb." v={food.carbs_g} />
          <Per100 label="Grasa" v={food.fat_g} />
          <p className="col-span-4 text-xs text-ink-2">
            por 100 {unit}
            {food.normalized_from === "serving" && " · convertido desde la porción del empaque"}
          </p>
        </div>
        {food.suspicious && (
          <p className="flex gap-2 rounded-input border border-warning/50 bg-warning/10 p-3 text-sm">
            <AlertTriangle className="mt-0.5 size-4 shrink-0 text-warning" />
            Las calorías de este producto no cuadran con sus macros. Puede tener un error en la base de datos; revisa la etiqueta.
          </p>
        )}

        {/* Modo */}
        <div role="tablist" className="flex gap-1 rounded-btn bg-surface-2 p-1">
          {(["amount", "kcal"] as Mode[]).map((m) => {
            const disabled = m === "kcal" && !food.kcal_mode;
            return (
              <button
                key={m}
                role="tab"
                aria-selected={mode === m}
                aria-disabled={disabled}
                onClick={() => {
                  if (disabled) return toast(food.kcal_mode_reason, "error");
                  if (m === mode) return;
                  // Convertir lo escrito al otro modo para no perder la cuenta
                  if (result) setValue(String(m === "kcal" ? Math.round(result.kcal ?? 0) : result.amount));
                  setMode(m);
                }}
                className={cx(
                  "h-10 flex-1 rounded-[9px] text-sm font-semibold transition",
                  mode === m ? "bg-fire text-white" : "text-ink-2",
                  disabled && "opacity-40",
                )}
              >
                {m === "amount" ? (unit === "ml" ? "Mililitros" : "Gramos") : "Calorías"}
              </button>
            );
          })}
        </div>
        {!food.kcal_mode && <p className="-mt-2 text-sm text-ink-2">{food.kcal_mode_reason}</p>}

        {/* Entrada */}
        <div>
          <div className="relative">
            <Input
              inputMode="decimal"
              autoFocus
              value={value}
              onChange={(e) => setValue(e.target.value.replace(/[^\d.,]/g, ""))}
              aria-label={mode === "kcal" ? "Calorías" : `Cantidad en ${unit}`}
              className="h-16 pr-16 text-center text-3xl font-extrabold tabular-nums"
            />
            <span className="pointer-events-none absolute right-4 top-1/2 -translate-y-1/2 text-lg font-semibold text-ink-2">
              {mode === "kcal" ? "kcal" : unit}
            </span>
          </div>
          <div className="mt-2 flex flex-wrap gap-2">
            {quick.map((q) => (
              <button
                key={q}
                onClick={() => setValue(String(q))}
                className={cx(
                  "h-9 rounded-full border px-3 text-sm font-semibold tabular-nums",
                  num === q ? "border-purple bg-purple text-white" : "border-line text-ink",
                )}
              >
                {mode === "amount" && q === food.serving_qty ? `1 porción (${q} ${unit})` : `${q} ${mode === "kcal" ? "kcal" : unit}`}
              </button>
            ))}
          </div>
          {tooBig && <p className="mt-1 text-sm font-medium text-danger">Máximo 5000.</p>}
        </div>

        {/* Resultado */}
        <div className="rounded-card border border-line p-4" aria-live="polite">
          <div className="flex items-end justify-between">
            <div>
              <p className="t-label">Total</p>
              <p className="t-num">
                {fmtN(result?.kcal ?? null, 1)} <span className="text-lg font-semibold text-ink-2">kcal</span>
              </p>
            </div>
            <p className="text-right text-[15px] font-semibold tabular-nums text-ink-2">
              {result ? `${fmtN(result.amount)} ${unit}` : "—"}
            </p>
          </div>
          <div className="mt-3 grid grid-cols-3 gap-2 border-t border-line pt-3">
            <Macro label="Proteína" v={result?.protein_g} />
            <Macro label="Carbohidratos" v={result?.carbs_g} />
            <Macro label="Grasa" v={result?.fat_g} />
          </div>
          <dl className="mt-3 grid grid-cols-3 gap-2 text-sm">
            <Small label="Fibra" v={result?.fiber_g} unit="g" />
            <Small label="Azúcares" v={result?.sugars_g} unit="g" />
            <Small label="Sodio" v={result?.sodium_mg} unit="mg" d={0} />
          </dl>
          {result && [result.fiber_g, result.sugars_g, result.sodium_mg].some((v) => v == null) && (
            <p className="mt-2 text-xs text-ink-2">— = la fuente no reporta ese dato.</p>
          )}
        </div>

        {/* Comida */}
        <div>
          <p className="t-label mb-1.5">Agregar a</p>
          <div className="grid grid-cols-4 gap-1.5">
            {MEALS.map((m) => (
              <button
                key={m.value}
                onClick={() => setMeal(m.value)}
                aria-pressed={meal === m.value}
                className={cx(
                  "h-11 rounded-btn border text-sm font-semibold",
                  meal === m.value ? "border-purple bg-purple text-white" : "border-line text-ink",
                )}
              >
                {m.label}
              </button>
            ))}
          </div>
        </div>

        <Button full loading={save.isPending} disabled={!result || tooBig || !food.id} onClick={() => save.mutate()}>
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

function Per100({ label, v, d = 1 }: { label: string; v: number | null; d?: number }) {
  return (
    <div>
      <p className="text-lg font-extrabold tabular-nums">{fmtN(v, d)}</p>
      <p className="text-xs font-semibold text-ink-2">{label}</p>
    </div>
  );
}

function Macro({ label, v }: { label: string; v: number | null | undefined }) {
  return (
    <div>
      <p className="text-xl font-extrabold tabular-nums">
        {fmtN(v ?? null, 2)}
        {v != null && <span className="text-sm font-semibold text-ink-2"> g</span>}
      </p>
      <p className="text-xs font-semibold text-ink-2">{label}</p>
    </div>
  );
}

function Small({ label, v, unit, d = 1 }: { label: string; v: number | null | undefined; unit: string; d?: number }) {
  return (
    <div>
      <dt className="text-xs text-ink-2">{label}</dt>
      <dd className="font-semibold tabular-nums">{v == null ? "—" : `${fmtN(v, d)} ${unit}`}</dd>
    </div>
  );
}
