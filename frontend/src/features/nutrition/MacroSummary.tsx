import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Cell, Pie, PieChart } from "recharts";
import { SlidersHorizontal } from "lucide-react";
import { api, unwrap } from "@/api/client";
import { Button, Card, Field, Input, Sheet, Tabs, cx } from "@/components/ui";
import { useToast } from "@/components/ui/toast";
import {
  AMDR,
  GENERAL_IDEAL,
  MACROS,
  effectiveGoal,
  fmtN,
  gramsFromPct,
  pctFromGrams,
  type DaySummary,
  type MacroKey,
  type MacroPct,
} from "./nutri";

/* ---------- Resumen del día: dona de macros + ideal ---------- */
export function Summary({ d, onGoal }: { d: DaySummary; onGoal: () => void }) {
  const goal = effectiveGoal(d.goal);
  const kcal = d.totals.kcal ?? 0;
  const over = goal.kcal != null && kcal > goal.kcal;
  const remaining = goal.kcal != null ? goal.kcal - kcal : null;
  const sourceLabel =
    goal.source === "general" ? "Estimado general" : goal.source === "coach" ? "Objetivo de tu coach" : "Tu objetivo";

  return (
    <Card>
      {/* Calorías */}
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="t-label">Calorías</p>
          <p className="t-num mt-1">
            {fmtN(kcal, 0)}
            {goal.kcal != null && <span className="text-lg font-semibold text-ink-2"> / {fmtN(goal.kcal, 0)}</span>}
          </p>
        </div>
        {remaining != null && (
          <div className="text-right">
            <p className="t-label">{over ? "Te pasaste" : "Te quedan"}</p>
            <p className={cx("text-2xl font-extrabold tabular-nums", over && "text-warning")}>{fmtN(Math.abs(remaining), 0)}</p>
          </div>
        )}
      </div>
      {/* Real vs ideal: dos donas con los mismos colores */}
      <TwoDonuts totals={d.totals} kcal={kcal} goal={goal} />

      <div className="mt-4 flex items-center justify-between gap-2 border-t border-line pt-3">
        <p className="min-w-0 text-xs text-ink-2">
          <b className="font-semibold text-ink">Ideal: {sourceLabel.toLowerCase()}</b>
          {goal.source === "general" && " · referencia para un adulto promedio, no personalizada"}
        </p>
        <Button variant="secondary" size="sm" icon={SlidersHorizontal} onClick={onGoal} className="shrink-0 whitespace-nowrap">
          {goal.source === "general" ? "Ajustar" : "Editar"}
        </Button>
      </div>
    </Card>
  );
}

type Goal = ReturnType<typeof effectiveGoal>;

function TwoDonuts({ totals, kcal, goal }: { totals: DaySummary["totals"]; kcal: number; goal: Goal }) {
  const [active, setActive] = useState<number | null>(null);
  const ideal = MACROS.map((m) => ({ ...m, grams: goal[m.key] ?? 0, kcal: (goal[m.key] ?? 0) * m.kcalPerG }));
  const realMacros = MACROS.map((m) => ({ ...m, grams: totals[m.key] ?? 0, kcal: (totals[m.key] ?? 0) * m.kcalPerG }));
  // Calorías sin macros (p. ej. "solo calorías" sin desglose): rebanada gris para no inflar los macros.
  // Umbral para ignorar el ruido normal entre la etiqueta y 4/4/9 (fibra, alcohol, redondeos).
  const unknownKcal = kcal - realMacros.reduce((a, x) => a + x.kcal, 0);
  const hasUnknown = unknownKcal > Math.max(20, kcal * 0.15);
  const real = hasUnknown
    ? [...realMacros, { key: "unknown", label: "Sin desglose", short: "?", kcalPerG: 0, color: "var(--unknown-slice)", bg: "", grams: 0, kcal: unknownKcal }]
    : realMacros;
  const share = (xs: { kcal: number }[]) => {
    const t = xs.reduce((a, x) => a + x.kcal, 0);
    return xs.map((x) => (t > 0 ? (x.kcal / t) * 100 : null));
  };
  const realPct = share(real);
  const idealPct = share(ideal);
  const toggle = (i: number) => setActive((a) => (a === i ? null : i));

  return (
    <div className="mt-5">
      <div className="grid grid-cols-2 gap-2">
        <Donut title="Real" data={real} pct={realPct} centerValue={fmtN(kcal, 0)} active={active} onActive={setActive} onToggle={toggle} />
        <Donut
          title="Ideal"
          data={ideal}
          pct={idealPct}
          centerValue={goal.kcal != null ? fmtN(goal.kcal, 0) : "—"}
          active={active}
          onActive={setActive}
          onToggle={toggle}
        />
      </div>

      {/* Leyenda compartida = tabla de valores (la identidad nunca depende solo del color) */}
      <table className="mt-4 w-full text-sm tabular-nums">
        <thead>
          <tr className="text-xs text-ink-2">
            <th className="pb-1 text-left font-medium">
              <span className="sr-only">Macro</span>
            </th>
            <th className="pb-1 text-right font-medium">Real</th>
            <th className="pb-1 text-right font-medium">Ideal</th>
          </tr>
        </thead>
        <tbody>
          {MACROS.map((m, i) => (
            <tr
              key={m.key}
              onClick={() => toggle(i)}
              onMouseEnter={() => setActive(i)}
              onMouseLeave={() => setActive(null)}
              className={cx("cursor-pointer transition-colors", active === i && "bg-surface-2")}
            >
              <td className="rounded-l-input py-1.5 pl-1.5">
                <span className="flex items-center gap-2 font-medium">
                  <span className={cx("size-3 shrink-0 rounded-full", m.bg)} aria-hidden />
                  {m.label}
                </span>
              </td>
              <td className="py-1.5 text-right">
                <b>{fmtN(real[i].grams, 0)} g</b>
              </td>
              <td className="rounded-r-input py-1.5 pr-1.5 text-right">
                <b>{goal[m.key] != null ? `${fmtN(ideal[i].grams, 0)} g` : "—"}</b>
              </td>
            </tr>
          ))}
          {hasUnknown && (
            <tr
              onClick={() => toggle(3)}
              onMouseEnter={() => setActive(3)}
              onMouseLeave={() => setActive(null)}
              className={cx("cursor-pointer transition-colors", active === 3 && "bg-surface-2")}
            >
              <td className="rounded-l-input py-1.5 pl-1.5">
                <span className="flex items-center gap-2 font-medium">
                  <span className="size-3 shrink-0 rounded-full" style={{ background: "var(--unknown-slice)" }} aria-hidden />
                  Sin desglose
                </span>
              </td>
              <td className="py-1.5 text-right">
                <b>{fmtN(unknownKcal, 0)} kcal</b>
              </td>
              <td className="rounded-r-input py-1.5 pr-1.5 text-right text-ink-2">—</td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

function Donut({
  title,
  data,
  pct,
  centerValue,
  active,
  onActive,
  onToggle,
}: {
  title: string;
  data: { key: string; label: string; color: string; kcal: number }[];
  pct: (number | null)[];
  centerValue: string;
  active: number | null;
  onActive: (i: number | null) => void;
  onToggle: (i: number) => void;
}) {
  const empty = data.every((x) => x.kcal <= 0);
  const sel = active != null && !empty ? active : null;
  const size = 140;
  return (
    <figure className="flex flex-col items-center">
      <figcaption className="t-label mb-1">{title}</figcaption>
      <div className="relative" style={{ width: size, height: size }}>
        <PieChart width={size} height={size} accessibilityLayer={false}>
          {empty ? (
            <Pie data={[{ v: 1 }]} dataKey="v" innerRadius={46} outerRadius={66} stroke="none" fill="var(--surface-2)" isAnimationActive={false} />
          ) : (
            <Pie
              data={data}
              dataKey="kcal"
              innerRadius={46}
              outerRadius={66}
              startAngle={90}
              endAngle={-270}
              stroke="var(--surface)"
              strokeWidth={2}
              isAnimationActive={false}
              onMouseEnter={(_, i) => onActive(i)}
              onMouseLeave={() => onActive(null)}
              onClick={(_, i) => onToggle(i)}
            >
              {data.map((x, i) => (
                <Cell key={x.key} fill={x.color} opacity={active == null || active === i ? 1 : 0.35} className="cursor-pointer outline-none" />
              ))}
            </Pie>
          )}
        </PieChart>
        <div className="pointer-events-none absolute inset-0 grid place-items-center text-center">
          {sel != null ? (
            <div>
              <p className="text-xl font-extrabold tabular-nums">{fmtN(pct[sel], 0)}%</p>
              <p className="text-[11px] text-ink-2">{data[sel].label}</p>
            </div>
          ) : (
            <div>
              <p className="text-xl font-extrabold tabular-nums">{centerValue}</p>
              <p className="text-[11px] text-ink-2">kcal</p>
            </div>
          )}
        </div>
      </div>
    </figure>
  );
}

/* ---------- Ajustar el ideal (por % o por gramos) ---------- */
/** Redondea los % a enteros que sumen exactamente 100 (mayor residuo). */
function roundTo100(p: MacroPct): MacroPct {
  const base = MACROS.map((m) => ({ k: m.key, f: Math.floor(p[m.key]), r: p[m.key] % 1 }));
  let left = 100 - base.reduce((a, x) => a + x.f, 0);
  for (const x of [...base].sort((a, b) => b.r - a.r)) if (left-- > 0) x.f += 1;
  return Object.fromEntries(base.map((x) => [x.k, x.f])) as MacroPct;
}
const toStr = (p: MacroPct) => Object.fromEntries(MACROS.map((m) => [m.key, String(p[m.key])])) as Record<MacroKey, string>;
type Mode = "pct" | "grams";

export function GoalSheet({ open, onClose, goal }: { open: boolean; onClose: () => void; goal: DaySummary["goal"] }) {
  const qc = useQueryClient();
  const toast = useToast();
  const [mode, setMode] = useState<Mode>("pct");
  const [kcal, setKcal] = useState("");
  const [pct, setPct] = useState<Record<MacroKey, string>>({ protein_g: "", carbs_g: "", fat_g: "" });
  const [grams, setGrams] = useState<Record<MacroKey, string>>({ protein_g: "", carbs_g: "", fat_g: "" });
  const [lastOpen, setLastOpen] = useState(false);
  // Reparto de macros (en % de las kcal) que se respeta al cambiar las calorías en modo gramos.
  const [split, setSplit] = useState<MacroPct | null>(null);

  function load(src: { kcal: number | null } & Partial<Record<MacroKey, number | null>>) {
    setKcal(src.kcal?.toString() ?? "");
    const g = Object.fromEntries(MACROS.map((m) => [m.key, src[m.key]?.toString() ?? ""])) as Record<MacroKey, string>;
    setGrams(g);
    const p = pctFromGrams(src);
    setSplit(p);
    setPct(p ? toStr(roundTo100(p)) : { protein_g: "", carbs_g: "", fat_g: "" });
  }
  if (open !== lastOpen) {
    setLastOpen(open);
    if (open) load(effectiveGoal(goal));
  }

  const kcalN = Number(kcal) || 0;
  const pctN = Object.fromEntries(MACROS.map((m) => [m.key, Number(pct[m.key]) || 0])) as MacroPct;
  const pctSum = MACROS.reduce((a, m) => a + pctN[m.key], 0);
  const fromPct = gramsFromPct(kcalN, pctN);
  const gramsN = Object.fromEntries(MACROS.map((m) => [m.key, Number(grams[m.key]) || 0])) as Record<MacroKey, number>;
  const kcalFromGrams = MACROS.reduce((a, m) => a + gramsN[m.key] * m.kcalPerG, 0);
  const canSave = mode === "pct" ? kcalN > 0 && pctSum === 100 : MACROS.some((m) => gramsN[m.key] > 0) || kcalN > 0;

  const save = useMutation({
    mutationFn: () => {
      const body =
        mode === "pct"
          ? { kcal: kcalN, ...fromPct }
          : { kcal: kcalN || null, ...Object.fromEntries(MACROS.map((m) => [m.key, gramsN[m.key] || null])) };
      return unwrap(api.PUT("/api/nutrition/goals", { body: body as never }));
    },
    onSuccess: () => {
      toast("Objetivo guardado");
      qc.invalidateQueries({ queryKey: ["nutrition", "day"] });
      onClose();
    },
    onError: (e) => toast((e as Error).message, "error"),
  });

  const digits = (s: string) => s.replace(/\D/g, "");

  return (
    <Sheet open={open} onClose={onClose} title="Tu ideal diario">
      <div className="space-y-4">
        <p className="text-[15px] text-ink-2">
          De entrada usamos una referencia general para adultos: {GENERAL_IDEAL.kcal.toLocaleString("es-MX")} kcal con{" "}
          {GENERAL_IDEAL.pct.protein_g}% proteína, {GENERAL_IDEAL.pct.carbs_g}% carbohidratos y {GENERAL_IDEAL.pct.fat_g}% grasa. Ajústalo a ti
          o pídele a tu coach o nutriólogo tus números.
          {goal.set_by === "coach" && " Tu coach ya definió este objetivo; si lo cambias, lo reemplazas."}
        </p>

        <Tabs<Mode>
          value={mode}
          onChange={(m) => {
            // Al cambiar de modo, llevamos los números del otro lado para no perder lo escrito.
            if (m === "grams" && mode === "pct" && pctSum > 0) setSplit(pctN);
            if (m === "grams" && mode === "pct" && kcalN > 0)
              setGrams(Object.fromEntries(MACROS.map((x) => [x.key, String(fromPct[x.key])])) as Record<MacroKey, string>);
            if (m === "pct" && mode === "grams") {
              const p = pctFromGrams(gramsN);
              if (p) setPct(toStr(roundTo100(p)));
              if (!kcalN && kcalFromGrams) setKcal(String(Math.round(kcalFromGrams)));
            }
            setMode(m);
          }}
          options={[
            { value: "pct", label: "Por porcentaje" },
            { value: "grams", label: "Por gramos" },
          ]}
        />

        <Field label="Calorías al día (kcal)">
          <Input
            inputMode="numeric"
            value={kcal}
            onChange={(e) => {
              const v = digits(e.target.value).slice(0, 5);
              setKcal(v);
              // Por gramos: al cambiar las kcal, los gramos se ajustan con el mismo reparto.
              if (mode === "grams" && Number(v) > 0) {
                const g = gramsFromPct(Number(v), split ?? GENERAL_IDEAL.pct);
                setGrams(Object.fromEntries(MACROS.map((m) => [m.key, String(g[m.key])])) as Record<MacroKey, string>);
              }
            }}
            className="h-14 text-center text-xl font-bold tabular-nums"
            placeholder="—"
          />
        </Field>

        <div className="space-y-3">
          {MACROS.map((m) => {
            const [lo, hi] = AMDR[m.key];
            const p = pctN[m.key];
            const outside = mode === "pct" && pct[m.key] !== "" && (p < lo || p > hi);
            return (
              <div key={m.key} className="flex items-center gap-3">
                <span className={cx("size-3 shrink-0 rounded-full", m.bg)} aria-hidden />
                <div className="min-w-0 flex-1">
                  <p className="font-medium">{m.label}</p>
                  <p className={cx("text-xs tabular-nums", outside ? "text-warning" : "text-ink-2")}>
                    {mode === "pct"
                      ? `${kcalN ? `${fromPct[m.key]} g` : "— g"} · rango general ${lo}–${hi}%`
                      : `${fmtN(gramsN[m.key] * m.kcalPerG, 0)} kcal`}
                  </p>
                </div>
                <div className="relative w-28">
                  <Input
                    aria-label={`${m.label} en ${mode === "pct" ? "porcentaje" : "gramos"}`}
                    inputMode="numeric"
                    value={mode === "pct" ? pct[m.key] : grams[m.key]}
                    onChange={(e) =>
                      mode === "pct"
                        ? setPct((s) => ({ ...s, [m.key]: digits(e.target.value).slice(0, 3) }))
                        : (() => {
                            // Por gramos: las kcal son la suma de los macros.
                            const next = { ...grams, [m.key]: digits(e.target.value).slice(0, 4) };
                            setGrams(next);
                            setSplit(pctFromGrams(Object.fromEntries(MACROS.map((x) => [x.key, Number(next[x.key]) || 0]))));
                            const total = MACROS.reduce((a, x) => a + (Number(next[x.key]) || 0) * x.kcalPerG, 0);
                            setKcal(total > 0 ? String(Math.round(total)) : "");
                          })()
                    }
                    className="h-12 pr-8 text-center text-lg font-bold tabular-nums"
                    placeholder="—"
                  />
                  <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-sm text-ink-2">{mode === "pct" ? "%" : "g"}</span>
                </div>
              </div>
            );
          })}
        </div>

        {mode === "pct" ? (
          <p className={cx("text-sm tabular-nums", pctSum === 100 ? "text-ink-2" : "font-semibold text-warning")}>
            Suma: {pctSum}% {pctSum !== 100 && "· debe dar 100%"}
          </p>
        ) : (
          kcalFromGrams > 0 && (
            <p className="text-sm tabular-nums text-ink-2">
              Proteína y carbohidratos aportan 4 kcal por gramo; la grasa, 9. Si cambias las calorías, los gramos se ajustan solos.
            </p>
          )
        )}

        <button
          type="button"
          onClick={() => load({ kcal: GENERAL_IDEAL.kcal, ...gramsFromPct(GENERAL_IDEAL.kcal, GENERAL_IDEAL.pct) })}
          className="text-sm font-semibold text-orchid hover:underline"
        >
          Volver al estimado general
        </button>

        <Button full loading={save.isPending} disabled={!canSave} onClick={() => save.mutate()}>
          Guardar
        </Button>
      </div>
    </Sheet>
  );
}
