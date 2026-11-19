/** Tipos y fórmulas de nutrición. La fórmula es la misma que en el backend
 *  (apps/nutrition/services.compute); el servidor recalcula al guardar. */

export type Meal = "breakfast" | "lunch" | "dinner" | "snack";
export const MEALS: { value: Meal; label: string }[] = [
  { value: "breakfast", label: "Desayuno" },
  { value: "lunch", label: "Comida" },
  { value: "dinner", label: "Cena" },
  { value: "snack", label: "Snacks" },
];
export const mealLabel = (m: Meal) => MEALS.find((x) => x.value === m)?.label ?? m;

export const NUTRIENTS = ["kcal", "protein_g", "carbs_g", "fat_g", "fiber_g", "sugars_g", "sodium_mg"] as const;
export type Nutrient = (typeof NUTRIENTS)[number];
export type Nutrients = Record<Nutrient, number | null>;

const DECIMALS: Record<Nutrient, number> = { kcal: 1, protein_g: 2, carbs_g: 2, fat_g: 2, fiber_g: 2, sugars_g: 2, sodium_mg: 0 };

export interface FoodItem extends Nutrients {
  id?: number;
  food_id?: number | null;
  source: "usda" | "off";
  external_id: string;
  barcode: string;
  name: string;
  brand: string;
  image_url: string;
  basis_unit: "g" | "ml";
  serving_qty: number | null;
  serving_label: string;
  normalized_from?: string;
  suspicious: boolean;
  is_mexican: boolean;
  kcal_mode: boolean;
  kcal_mode_reason: string;
  favorite?: boolean;
  last_amount?: number | null;
  last_meal?: Meal | null;
}

export interface FoodLog extends Nutrients {
  id: number;
  food_id: number | null;
  name: string;
  brand: string;
  image_url: string;
  meal: Meal;
  input_mode: "amount" | "kcal" | "manual";
  amount: number;
  unit: "g" | "ml";
  logged_at: string;
}

type Macro = "kcal" | "protein_g" | "carbs_g" | "fat_g";
export interface DaySummary {
  date: string;
  /** Primer día que se guarda; lo anterior se borra cada noche. */
  oldest: string;
  retention_days: number;
  goal: Record<Macro, number | null> & { set_by: "member" | "coach" | null; updated_at: string | null };
  totals: Nutrients;
  partial: Record<"fiber_g" | "sugars_g" | "sodium_mg", boolean>;
  remaining: Record<Macro, number | null>;
  meals: Record<Meal, FoodLog[]>;
  week: { date: string; kcal: number }[];
}

export interface SearchPage {
  items: FoodItem[];
  page: number;
  has_more: boolean;
  errors: Partial<Record<"usda" | "off", string>>;
}

const round = (v: number, d: number) => Math.round(v * 10 ** d) / 10 ** d;

/** valor = valor_por_100 × cantidad / 100   ·   cantidad = kcal / kcal_por_100 × 100 */
export function compute(food: Nutrients, input: { amount?: number; kcal?: number }) {
  let amount = input.amount ?? 0;
  if (input.kcal != null) {
    if (!food.kcal || food.kcal <= 0) return null;
    amount = (input.kcal / food.kcal) * 100;
  }
  if (!(amount > 0)) return null;
  const out = { amount: round(amount, 1) } as { amount: number } & Nutrients;
  for (const n of NUTRIENTS) {
    const v = food[n];
    out[n] = v == null ? null : round((v * amount) / 100, DECIMALS[n]);
  }
  if (input.kcal != null) out.kcal = round(input.kcal, 1);
  return out;
}

export const sourceLabel = (s: string) => (s === "usda" ? "USDA" : "Open Food Facts");

/** Número para mostrar; "—" si no hay dato (nunca un 0 inventado). */
export function fmtN(v: number | null | undefined, d = 1) {
  if (v == null) return "—";
  return Number(v.toFixed(d)).toLocaleString("es-MX", { maximumFractionDigits: d });
}

export function defaultMeal(): Meal {
  const h = new Date().getHours();
  if (h < 11) return "breakfast";
  if (h < 17) return "lunch";
  if (h < 22) return "dinner";
  return "snack";
}

/* ---------- Macros: colores, kcal por gramo y estimado general ---------- */
export type MacroKey = "protein_g" | "carbs_g" | "fat_g";
export const MACROS: { key: MacroKey; label: string; short: string; kcalPerG: number; color: string; bg: string }[] = [
  { key: "protein_g", label: "Proteína", short: "P", kcalPerG: 4, color: "var(--macro-protein)", bg: "bg-protein" },
  { key: "carbs_g", label: "Carbohidratos", short: "C", kcalPerG: 4, color: "var(--macro-carbs)", bg: "bg-carbs" },
  { key: "fat_g", label: "Grasa", short: "G", kcalPerG: 9, color: "var(--macro-fat)", bg: "bg-fat" },
];
export type MacroPct = Record<MacroKey, number>;

/** Referencia general para adultos, NO personalizada:
 *  - 2,000 kcal: valor de referencia de las etiquetas nutricionales (FDA).
 *  - Reparto dentro de los rangos AMDR del Institute of Medicine
 *    (proteína 10–35 %, carbohidratos 45–65 %, grasa 20–35 % de las kcal). */
export const GENERAL_IDEAL = { kcal: 2000, pct: { protein_g: 20, carbs_g: 50, fat_g: 30 } as MacroPct };
export const AMDR: Record<MacroKey, [number, number]> = { protein_g: [10, 35], carbs_g: [45, 65], fat_g: [20, 35] };

export const gramsFromPct = (kcal: number, pct: MacroPct) =>
  Object.fromEntries(MACROS.map((m) => [m.key, Math.round((kcal * pct[m.key]) / 100 / m.kcalPerG)])) as Record<MacroKey, number>;

/** % de las kcal que aporta cada macro (con 4/4/9 kcal por gramo). */
export function pctFromGrams(g: Partial<Record<MacroKey, number | null>>): MacroPct | null {
  const kc = MACROS.map((m) => (g[m.key] ?? 0) * m.kcalPerG);
  const total = kc.reduce((a, b) => a + b, 0);
  if (total <= 0) return null;
  return Object.fromEntries(MACROS.map((m, i) => [m.key, (kc[i] / total) * 100])) as MacroPct;
}

/** Objetivo a mostrar: el guardado (miembro o coach) o, si no hay, el estimado general. */
export function effectiveGoal(goal: DaySummary["goal"]) {
  if (goal.kcal != null || goal.protein_g != null || goal.carbs_g != null || goal.fat_g != null) {
    return { kcal: goal.kcal, protein_g: goal.protein_g, carbs_g: goal.carbs_g, fat_g: goal.fat_g, source: goal.set_by ?? "member" } as const;
  }
  return { kcal: GENERAL_IDEAL.kcal, ...gramsFromPct(GENERAL_IDEAL.kcal, GENERAL_IDEAL.pct), source: "general" } as const;
}
