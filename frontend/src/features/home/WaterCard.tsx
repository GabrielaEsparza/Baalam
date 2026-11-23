import { Link } from "react-router-dom";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Droplet, Minus } from "lucide-react";
import { api, unwrap } from "@/api/client";
import { Card, cx } from "@/components/ui";
import { useToast } from "@/components/ui/toast";

type Water = { ml: number; goal_ml: number };
const fmtMl = (ml: number) => (ml >= 1000 ? `${(ml / 1000).toLocaleString("es-MX", { maximumFractionDigits: 2 })} L` : `${ml} ml`);

/** Agua del día: barra hacia la meta y botones rápidos. Responde al instante (optimista). */
export function WaterCard({ water }: { water: Water }) {
  const qc = useQueryClient();
  const toast = useToast();
  const add = useMutation({
    mutationFn: async (delta_ml: number) => (await unwrap(api.POST("/api/water", { body: { delta_ml } }))) as unknown as Water,
    onMutate: (delta) => {
      qc.setQueryData(["home"], (old: { water?: Water } | undefined) =>
        old?.water ? { ...old, water: { ...old.water, ml: Math.max(0, old.water.ml + delta) } } : old,
      );
    },
    onSuccess: (w, delta) => {
      qc.setQueryData(["home"], (old: object | undefined) => (old ? { ...old, water: w } : old));
      if (delta > 0 && w.ml >= w.goal_ml && w.ml - delta < w.goal_ml) toast("¡Meta de agua cumplida! 💧");
    },
    onError: (e) => {
      toast((e as Error).message, "error");
      qc.invalidateQueries({ queryKey: ["home"] });
    },
  });

  const pct = Math.min(100, (water.ml / water.goal_ml) * 100);
  const done = water.ml >= water.goal_ml;
  return (
    <Card className="space-y-3">
      <div className="flex items-center gap-3">
        <div className={cx("grid size-12 shrink-0 place-items-center rounded-full", done ? "bg-success/15 text-success" : "bg-sky-500/15 text-sky-600 dark:text-sky-400")}>
          <Droplet className="size-6" strokeWidth={1.75} fill={done ? "currentColor" : "none"} />
        </div>
        <div className="min-w-0 flex-1">
          <p className="t-label">Agua hoy</p>
          <p className="text-xl font-extrabold tabular-nums">
            {fmtMl(water.ml)} <span className="text-base font-semibold text-ink-2">/ {fmtMl(water.goal_ml)}</span>
          </p>
        </div>
        <button
          type="button"
          aria-label="Quitar 250 ml"
          disabled={water.ml === 0}
          onClick={() => add.mutate(-250)}
          className="grid size-10 shrink-0 place-items-center rounded-full text-ink-2 hover:bg-surface-2 disabled:opacity-30"
        >
          <Minus className="size-5" />
        </button>
      </div>
      <div
        className="h-2.5 overflow-hidden rounded-full bg-surface-2"
        role="progressbar"
        aria-valuenow={water.ml}
        aria-valuemax={water.goal_ml}
        aria-label="Agua tomada hoy"
      >
        <div className={cx("h-full rounded-full transition-[width] duration-300", done ? "bg-success" : "bg-sky-500")} style={{ width: `${pct}%` }} />
      </div>
      <div className="grid grid-cols-2 gap-2">
        {[250, 500].map((ml) => (
          <button
            key={ml}
            type="button"
            onClick={() => add.mutate(ml)}
            className="h-11 rounded-btn border border-line font-semibold transition hover:bg-surface-2 active:scale-[0.98]"
          >
            + {ml} ml {ml === 250 ? "· vaso" : "· botella"}
          </button>
        ))}
      </div>
      <Link to="/app/perfil#avisos" className="block text-sm font-medium text-orchid hover:underline">
        Cambiar meta o avisos de agua
      </Link>
    </Card>
  );
}
