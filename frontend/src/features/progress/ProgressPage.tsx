import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useSearchParams } from "react-router-dom";
import { CartesianGrid, Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Scale } from "lucide-react";
import { CompositionTab, MeasuresTab, useBodyLogs } from "./BodyTabs";
import { BmiCard } from "./BmiCard";
import { api, unwrap } from "@/api/client";
import type { BodySummary } from "@/api/types";
import { useSetMe } from "@/app/session";
import { Button, Card, EmptyState, ErrorBox, Field, Input, PageTitle, Sheet, Spinner, Tabs, cx } from "@/components/ui";
import { useToast } from "@/components/ui/toast";
import { fmtDate } from "@/lib/format";

type Tab = "peso" | "medidas" | "composicion";

export default function ProgressPage() {
  const [params, setParams] = useSearchParams();
  const raw = params.get("tab") as Tab | null;
  const tab: Tab = raw === "medidas" || raw === "composicion" ? raw : "peso";
  const { data } = useBodyLogs();
  const summary = data?.summary as unknown as BodySummary | undefined;
  const logs = (data?.logs ?? []) as { body_fat_pct?: string | null }[];
  const lastFat = [...logs].reverse().find((l) => l.body_fat_pct != null)?.body_fat_pct;
  return (
    <div>
      <PageTitle accent="progreso">Mi</PageTitle>
      {summary?.bmi && <BmiCard bmi={summary.bmi} bodyFat={lastFat != null ? Number(lastFat) : null} />}
      <Tabs
        className="mb-5"
        value={tab}
        onChange={(v) => setParams({ tab: v }, { replace: true })}
        options={[
          { value: "peso", label: "Peso" },
          { value: "medidas", label: "Medidas" },
          { value: "composicion", label: "Composición" },
        ]}
      />
      {tab === "peso" ? <WeightTab /> : tab === "medidas" ? <MeasuresTab /> : <CompositionTab />}
    </div>
  );
}

function WeightTab() {
  const qc = useQueryClient();
  const toast = useToast();
  const setMe = useSetMe();
  const [sheet, setSheet] = useState<"weight" | "target" | null>(null);
  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ["body"],
    queryFn: () => unwrap(api.GET("/api/progress/body")),
  });
  const log = useMutation({
    mutationFn: (weight: string) => unwrap(api.POST("/api/progress/body", { body: { weight_kg: weight } as never })),
    onSuccess: () => {
      toast("Peso registrado");
      setSheet(null);
      qc.invalidateQueries({ queryKey: ["body"] });
    },
    onError: (e) => toast((e as Error).message, "error"),
  });

  if (isLoading) return <Spinner />;
  if (error || !data) return <ErrorBox error={error} onRetry={refetch} />;
  const s = data.summary as unknown as BodySummary;
  const series = s.series.map((p) => ({ date: p.date, kg: Number(p.weight_kg) }));
  const change = s.change !== null ? Number(s.change) : null;

  return (
    <div className="space-y-4">
      <Card>
        <div className="flex items-end justify-between">
          <div>
            <p className="t-label">Peso actual</p>
            <p className="t-num mt-1">
              {s.current ?? "—"}
              <span className="ml-1 text-lg font-semibold text-ink-2">kg</span>
            </p>
          </div>
          <button onClick={() => setSheet("target")} className="text-right">
            <p className="t-label">Objetivo</p>
            <p className="text-xl font-bold text-orchid">{s.target ? `${s.target} kg` : "Definir"}</p>
          </button>
        </div>

        {series.length > 1 ? (
          <div className="mt-4 h-48 -ml-3">
            <ResponsiveContainer>
              <LineChart data={series} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
                <CartesianGrid stroke="var(--border)" vertical={false} />
                <XAxis
                  dataKey="date"
                  tickFormatter={(d) => fmtDate(d)}
                  tick={{ fill: "var(--text-2)", fontSize: 12 }}
                  axisLine={false}
                  tickLine={false}
                  minTickGap={24}
                />
                <YAxis
                  domain={["dataMin - 2", "dataMax + 2"]}
                  tick={{ fill: "var(--text-2)", fontSize: 12 }}
                  axisLine={false}
                  tickLine={false}
                  width={40}
                  allowDecimals={false}
                />
                <Tooltip
                  contentStyle={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 12 }}
                  labelFormatter={(d) => fmtDate(String(d), { day: "numeric", month: "long" })}
                  formatter={(v) => [`${v} kg`, "Peso"]}
                />
                {s.target && (
                  <ReferenceLine y={Number(s.target)} stroke="var(--orchid)" strokeDasharray="6 4" label={{ value: "Meta", fill: "var(--orchid)", fontSize: 12, position: "insideTopRight" }} />
                )}
                <Line type="monotone" dataKey="kg" stroke="var(--series-muscle)" strokeWidth={2} dot={{ r: 4, fill: "var(--series-muscle)", stroke: "var(--surface)", strokeWidth: 2 }} activeDot={{ r: 6 }} isAnimationActive={false} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        ) : (
          <EmptyState icon={Scale} text="Registra tu peso un par de veces para ver tu gráfica." />
        )}

        <div className="mt-4 grid grid-cols-3 gap-2 border-t border-line pt-4">
          <Mini label="Inicio" value={s.start} />
          <Mini label="Mínimo" value={s.min} />
          <div>
            <p className="t-label">Cambio</p>
            <p className={cx("text-lg font-bold tabular-nums", change !== null && change < 0 && "text-success", change !== null && change > 0 && "text-ink")}>
              {change === null ? "—" : `${change > 0 ? "+" : ""}${change} kg`}
            </p>
          </div>
        </div>
      </Card>

      <Button variant="dark" full icon={Scale} onClick={() => setSheet("weight")}>
        Registrar peso hoy
      </Button>

      <Sheet open={sheet === "weight"} onClose={() => setSheet(null)} title="Peso de hoy">
        <NumberForm label="Peso (kg)" initial={s.current ?? ""} busy={log.isPending} onSubmit={(v) => log.mutate(v)} />
      </Sheet>
      <Sheet open={sheet === "target"} onClose={() => setSheet(null)} title="Objetivo">
        <NumberForm
          label="Peso objetivo (kg)"
          initial={s.target ?? ""}
          busy={false}
          onSubmit={async (v) => {
            const next = await unwrap(api.PATCH("/api/me", { body: { target_weight_kg: v } as never }));
            setMe(next);
            setSheet(null);
            qc.invalidateQueries({ queryKey: ["body"] });
            toast("Objetivo guardado");
          }}
        />
      </Sheet>
    </div>
  );
}

function Mini({ label, value }: { label: string; value: string | null }) {
  return (
    <div>
      <p className="t-label">{label}</p>
      <p className="text-lg font-bold tabular-nums">{value ? `${value} kg` : "—"}</p>
    </div>
  );
}

function NumberForm({
  label,
  initial,
  busy,
  onSubmit,
}: {
  label: string;
  initial: string;
  busy: boolean;
  onSubmit: (v: string) => void;
}) {
  const [v, setV] = useState(initial);
  return (
    <form
      className="space-y-4"
      onSubmit={(e) => {
        e.preventDefault();
        if (v) onSubmit(v.replace(",", "."));
      }}
    >
      <Field label={label}>
        <Input
          autoFocus
          inputMode="decimal"
          value={v}
          onChange={(e) => setV(e.target.value)}
          className="h-14 text-center text-2xl font-bold"
        />
      </Field>
      <Button type="submit" full loading={busy}>
        Guardar
      </Button>
    </form>
  );
}
