import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, unwrap } from "@/api/client";
import { Button, Card, Input, SectionTitle } from "@/components/ui";
import { useToast } from "@/components/ui/toast";
import { GENERAL_IDEAL, MACROS, fmtN, gramsFromPct, pctFromGrams, type DaySummary, type MacroPct } from "./nutri";

const FIELDS = [
  ["kcal", "kcal"],
  ["protein_g", "Prot. g"],
  ["carbs_g", "Carb. g"],
  ["fat_g", "Grasa g"],
] as const;

/** En la ficha del miembro: lo que registró hoy + objetivos que pone la coach. */
export function CoachNutritionCard({ memberId }: { memberId: number }) {
  const qc = useQueryClient();
  const toast = useToast();
  const key = ["coach", "nutrition", memberId];
  const { data } = useQuery({
    queryKey: key,
    queryFn: async () =>
      (await unwrap(api.GET("/api/coach/members/{member_id}/nutrition", { params: { path: { member_id: memberId } } }))) as unknown as DaySummary,
  });
  const [v, setV] = useState<Record<string, string>>({});
  // Reparto de macros que se respeta al cambiar las kcal (los gramos nunca exceden las calorías).
  const [split, setSplit] = useState<MacroPct | null>(null);
  useEffect(() => {
    if (data) {
      setV(Object.fromEntries(FIELDS.map(([k]) => [k, data.goal[k]?.toString() ?? ""])));
      setSplit(pctFromGrams(data.goal));
    }
  }, [data]);

  function change(k: string, raw: string) {
    const val = raw.replace(/\D/g, "").slice(0, k === "kcal" ? 5 : 4);
    if (k === "kcal") {
      const g = Number(val) > 0 ? gramsFromPct(Number(val), split ?? GENERAL_IDEAL.pct) : null;
      setV((s) => ({ ...s, kcal: val, ...(g ? Object.fromEntries(MACROS.map((m) => [m.key, String(g[m.key])])) : {}) }));
      return;
    }
    const next = { ...v, [k]: val };
    const grams = Object.fromEntries(MACROS.map((m) => [m.key, Number(next[m.key]) || 0]));
    const total = MACROS.reduce((a, m) => a + grams[m.key] * m.kcalPerG, 0);
    setSplit(pctFromGrams(grams));
    setV({ ...next, kcal: total > 0 ? String(Math.round(total)) : next.kcal });
  }

  const save = useMutation({
    mutationFn: () =>
      unwrap(
        api.PUT("/api/coach/members/{member_id}/nutrition-goals", {
          params: { path: { member_id: memberId } },
          body: Object.fromEntries(Object.entries(v).map(([k, x]) => [k, x ? Number(x) : null])) as never,
        }),
      ),
    onSuccess: () => {
      toast("Objetivo nutricional guardado");
      qc.invalidateQueries({ queryKey: key });
    },
    onError: (e) => toast((e as Error).message, "error"),
  });

  if (!data) return null;
  const changed = FIELDS.some(([k]) => (v[k] ?? "") !== (data.goal[k]?.toString() ?? ""));
  const logged = Object.values(data.meals).reduce((a, l) => a + l.length, 0);

  return (
    <>
      <SectionTitle>Nutrición</SectionTitle>
      <Card className="space-y-3">
        <p className="text-[15px]">
          Hoy: <b className="tabular-nums">{fmtN(data.totals.kcal, 0)} kcal</b>
          <span className="text-ink-2">
            {" "}
            · P {fmtN(data.totals.protein_g, 0)} · C {fmtN(data.totals.carbs_g, 0)} · G {fmtN(data.totals.fat_g, 0)} g
            {logged === 0 && " (sin registros)"}
          </span>
        </p>
        <p className="t-label">Objetivo diario</p>
        <div className="grid grid-cols-4 gap-2">
          {FIELDS.map(([k, label]) => (
            <label key={k} className="space-y-1">
              <span className="block text-center text-xs font-semibold text-ink-2">{label}</span>
              <Input
                inputMode="numeric"
                value={v[k] ?? ""}
                placeholder="—"
                onChange={(e) => change(k, e.target.value)}
                className="!h-12 !px-1 text-center font-bold tabular-nums"
              />
            </label>
          ))}
        </div>
        {changed && (
          <Button variant="dark" full size="sm" loading={save.isPending} onClick={() => save.mutate()}>
            Guardar objetivo
          </Button>
        )}
      </Card>
    </>
  );
}
