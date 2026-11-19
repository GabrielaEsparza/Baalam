import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CartesianGrid, LabelList, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Activity, Ruler, Table2 } from "lucide-react";
import { api, unwrap } from "@/api/client";
import { Button, Card, EmptyState, ErrorBox, Field, Input, Sheet, Spinner, cx } from "@/components/ui";
import { useToast } from "@/components/ui/toast";
import { fmtDate } from "@/lib/format";

/* ---------- Datos compartidos ---------- */
type Key =
  | "arm_flexed_cm"
  | "arm_cm"
  | "wrist_cm"
  | "waist_cm"
  | "hip_cm"
  | "leg_cm"
  | "calf_cm"
  | "water_pct"
  | "muscle_pct"
  | "body_fat_pct";
type Log = { date: string } & Partial<Record<Key | "weight_kg", string | null>>;

export function useBodyLogs() {
  return useQuery({
    queryKey: ["body"],
    queryFn: () => unwrap(api.GET("/api/progress/body")),
  });
}

function series(logs: Log[], key: Key) {
  return logs.filter((l) => l[key] != null).map((l) => ({ date: l.date, v: Number(l[key]) }));
}

function latestAndChange(logs: Log[], key: Key) {
  const s = series(logs, key);
  if (!s.length) return { last: null as number | null, change: null as number | null, date: null as string | null };
  const last = s[s.length - 1];
  return { last: last.v, change: s.length > 1 ? Math.round((last.v - s[0].v) * 10) / 10 : null, date: last.date };
}

const fmtChange = (c: number | null, unit: string) => (c === null ? "" : `${c > 0 ? "+" : ""}${c} ${unit} desde el inicio`);

const axisProps = {
  tick: { fill: "var(--text-2)", fontSize: 12 },
  axisLine: false,
  tickLine: false,
} as const;

const tooltipStyle = {
  background: "var(--surface)",
  border: "1px solid var(--border)",
  borderRadius: 12,
  color: "var(--text)",
};

function useLogBody(successMsg: string, onDone: () => void) {
  const qc = useQueryClient();
  const toast = useToast();
  return useMutation({
    mutationFn: (body: Partial<Record<Key, string>>) => unwrap(api.POST("/api/progress/body", { body: body as never })),
    onSuccess: () => {
      toast(successMsg);
      qc.invalidateQueries({ queryKey: ["body"] });
      qc.invalidateQueries({ queryKey: ["podium"] });
      onDone();
    },
    onError: (e) => toast((e as Error).message, "error"),
  });
}

/** Formulario de varios números a la vez (teclado decimal, 16 px, sin zoom en iPhone). */
function MultiNumberForm({
  fields,
  initial,
  busy,
  hint,
  onSubmit,
}: {
  fields: { key: Key; label: string; unit: string }[];
  initial: Partial<Record<Key, number | null>>;
  busy: boolean;
  hint?: string;
  onSubmit: (v: Partial<Record<Key, string>>) => void;
}) {
  const [v, setV] = useState<Partial<Record<Key, string>>>(() =>
    Object.fromEntries(fields.map((f) => [f.key, initial[f.key] != null ? String(initial[f.key]) : ""])),
  );
  return (
    <form
      className="space-y-4"
      onSubmit={(e) => {
        e.preventDefault();
        const out = Object.fromEntries(
          Object.entries(v)
            .filter(([, x]) => x && x.trim())
            .map(([k, x]) => [k, x!.replace(",", ".").trim()]),
        );
        onSubmit(out);
      }}
    >
      {hint && <p className="text-[15px] text-ink-2">{hint}</p>}
      <div className="grid grid-cols-2 gap-3">
        {fields.map((f) => (
          <Field key={f.key} label={`${f.label} (${f.unit})`}>
            <Input
              inputMode="decimal"
              value={v[f.key] ?? ""}
              placeholder="—"
              onChange={(e) => setV((s) => ({ ...s, [f.key]: e.target.value.replace(/[^\d.,]/g, "") }))}
              className="h-14 text-center text-xl font-bold tabular-nums"
            />
          </Field>
        ))}
      </div>
      <Button type="submit" full loading={busy} disabled={!Object.values(v).some((x) => x && x.trim())}>
        Guardar
      </Button>
      <p className="text-center text-sm text-ink-2">Solo llena lo que midas hoy; lo demás se queda igual.</p>
    </form>
  );
}

/* ================= MEDIDAS ================= */
const MEASURES: { key: Key; label: string }[] = [
  { key: "arm_flexed_cm", label: "Brazo contraído" },
  { key: "arm_cm", label: "Brazo relajado" },
  { key: "wrist_cm", label: "Muñeca" },
  { key: "waist_cm", label: "Cintura" },
  { key: "hip_cm", label: "Cadera" },
  { key: "leg_cm", label: "Cuádriceps" },
  { key: "calf_cm", label: "Pantorrilla" },
];

export function MeasuresTab() {
  const { data, isLoading, error, refetch } = useBodyLogs();
  const [selected, setSelected] = useState<Key>("waist_cm");
  const [sheet, setSheet] = useState(false);
  const log = useLogBody("Medidas registradas", () => setSheet(false));

  if (isLoading) return <Spinner />;
  if (error || !data) return <ErrorBox error={error} onRetry={refetch} />;
  const logs = data.logs as unknown as Log[];
  const stats = Object.fromEntries(MEASURES.map((m) => [m.key, latestAndChange(logs, m.key)]));
  const any = MEASURES.some((m) => stats[m.key].last !== null);
  const sel = MEASURES.find((m) => m.key === selected)!;
  const pts = series(logs, selected);

  return (
    <div className="space-y-4">
      {!any ? (
        <Card>
          <EmptyState icon={Ruler} text="Registra tus medidas con una cinta métrica para ver cómo cambian con el tiempo." />
        </Card>
      ) : (
        <>
          <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
            {MEASURES.map((m) => {
              const s = stats[m.key];
              return (
                <button
                  key={m.key}
                  onClick={() => setSelected(m.key)}
                  aria-pressed={selected === m.key}
                  className={cx(
                    "card p-3 text-left transition",
                    selected === m.key ? "!border-purple ring-2 ring-purple/30" : "hover:bg-surface-2",
                  )}
                >
                  <p className="t-label leading-tight">{m.label}</p>
                  <p className="mt-1 text-xl font-extrabold tabular-nums">
                    {s.last ?? "—"}
                    {s.last !== null && <span className="ml-0.5 text-sm font-semibold text-ink-2">cm</span>}
                  </p>
                  {s.change !== null && (
                    <p className="text-xs font-semibold tabular-nums text-ink-2">
                      {s.change > 0 ? "+" : ""}
                      {s.change}
                    </p>
                  )}
                </button>
              );
            })}
          </div>

          <Card>
            <p className="t-label">{sel.label}</p>
            <p className="text-sm text-ink-2">{fmtChange(stats[selected].change, "cm") || "Registra otra vez para ver la tendencia."}</p>
            {pts.length > 1 ? (
              <div className="-ml-3 mt-3 h-48" role="img" aria-label={`Gráfica de ${sel.label} en centímetros`}>
                <ResponsiveContainer>
                  <LineChart data={pts} margin={{ top: 8, right: 12, bottom: 0, left: 0 }}>
                    <CartesianGrid stroke="var(--border)" vertical={false} />
                    <XAxis dataKey="date" tickFormatter={(d) => fmtDate(d)} minTickGap={24} {...axisProps} />
                    <YAxis domain={["dataMin - 2", "dataMax + 2"]} width={40} allowDecimals={false} {...axisProps} />
                    <Tooltip
                      contentStyle={tooltipStyle}
                      labelFormatter={(d) => fmtDate(String(d), { day: "numeric", month: "long" })}
                      formatter={(v) => [`${v} cm`, sel.label]}
                    />
                    <Line type="monotone" dataKey="v" stroke="var(--series-muscle)" strokeWidth={2} dot={{ r: 4, fill: "var(--series-muscle)", stroke: "var(--surface)", strokeWidth: 2 }} activeDot={{ r: 6 }} isAnimationActive={false} />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            ) : (
              <p className="mt-3 rounded-input bg-surface-2 p-3 text-sm text-ink-2">Con dos registros aparece la gráfica.</p>
            )}
          </Card>
        </>
      )}

      <Button variant="dark" full icon={Ruler} onClick={() => setSheet(true)}>
        Registrar medidas
      </Button>

      <Sheet open={sheet} onClose={() => setSheet(false)} title="Medidas de hoy">
        <MultiNumberForm
          fields={MEASURES.map((m) => ({ ...m, unit: "cm" }))}
          initial={Object.fromEntries(MEASURES.map((m) => [m.key, stats[m.key]?.last ?? null]))}
          busy={log.isPending}
          hint="Mide siempre en el mismo punto y a la misma hora (mejor en la mañana)."
          onSubmit={(v) => log.mutate(v)}
        />
      </Sheet>
    </div>
  );
}

/* ================= COMPOSICIÓN CORPORAL ================= */
const COMP: { key: Key; label: string; color: string }[] = [
  { key: "water_pct", label: "Agua", color: "var(--series-water)" },
  { key: "muscle_pct", label: "Músculo", color: "var(--series-muscle)" },
  { key: "body_fat_pct", label: "Grasa", color: "var(--series-fat)" },
];

export function CompositionTab() {
  const { data, isLoading, error, refetch } = useBodyLogs();
  const [sheet, setSheet] = useState(false);
  const [table, setTable] = useState(false);
  const log = useLogBody("Composición registrada", () => setSheet(false));

  const logs = (data?.logs ?? []) as unknown as Log[];
  const rows = useMemo(
    () =>
      logs
        .filter((l) => COMP.some((c) => l[c.key] != null))
        .map((l) => ({
          date: l.date,
          water_pct: l.water_pct != null ? Number(l.water_pct) : null,
          muscle_pct: l.muscle_pct != null ? Number(l.muscle_pct) : null,
          body_fat_pct: l.body_fat_pct != null ? Number(l.body_fat_pct) : null,
        })),
    [logs],
  );

  if (isLoading) return <Spinner />;
  if (error || !data) return <ErrorBox error={error} onRetry={refetch} />;
  const stats = Object.fromEntries(COMP.map((c) => [c.key, latestAndChange(logs, c.key)]));
  const lastIdx = rows.length - 1;

  return (
    <div className="space-y-4">
      {rows.length === 0 ? (
        <Card>
          <EmptyState icon={Activity} text="Registra tu % de agua, músculo y grasa (de la báscula de bioimpedancia) para ver tu composición corporal." />
        </Card>
      ) : (
        <>
          {/* Últimos valores: el color solo acompaña; el texto va en tinta normal */}
          <div className="grid grid-cols-3 gap-2">
            {COMP.map((c) => {
              const s = stats[c.key];
              return (
                <Card key={c.key} className="p-3">
                  <p className="t-label flex items-center gap-1.5">
                    <span className="size-2.5 shrink-0 rounded-full" style={{ background: c.color }} aria-hidden />
                    {c.label}
                  </p>
                  <p className="mt-1 text-2xl font-extrabold tabular-nums">
                    {s.last ?? "—"}
                    {s.last !== null && <span className="text-base font-semibold text-ink-2">%</span>}
                  </p>
                  {s.change !== null && (
                    <p className="text-xs font-semibold tabular-nums text-ink-2">
                      {s.change > 0 ? "+" : ""}
                      {s.change} pts
                    </p>
                  )}
                </Card>
              );
            })}
          </div>

          <Card>
            <div className="flex items-start justify-between gap-2">
              <div>
                <p className="t-label">Composición corporal</p>
                <p className="text-sm text-ink-2">% del peso corporal</p>
              </div>
              <button
                onClick={() => setTable((t) => !t)}
                className="flex h-9 items-center gap-1.5 rounded-full px-3 text-sm font-semibold text-orchid hover:bg-surface-2"
                aria-pressed={table}
              >
                <Table2 className="size-4" /> {table ? "Ver gráfica" : "Ver datos"}
              </button>
            </div>

            {/* Leyenda (siempre, con 2+ series) */}
            <ul className="mt-3 flex flex-wrap gap-x-4 gap-y-1" aria-label="Leyenda">
              {COMP.map((c) => (
                <li key={c.key} className="flex items-center gap-1.5 text-sm font-medium text-ink">
                  <span className="h-0.5 w-4 rounded-full" style={{ background: c.color }} aria-hidden />
                  {c.label}
                </li>
              ))}
            </ul>

            {table ? (
              <div className="mt-3 overflow-x-auto">
                <table className="w-full text-[15px] tabular-nums">
                  <thead>
                    <tr className="t-label text-left">
                      <th className="py-2 font-semibold">Fecha</th>
                      {COMP.map((c) => (
                        <th key={c.key} className="py-2 text-right font-semibold">
                          {c.label}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-line">
                    {[...rows].reverse().map((r) => (
                      <tr key={r.date}>
                        <td className="py-2">{fmtDate(r.date, { day: "numeric", month: "short", year: "2-digit" })}</td>
                        {COMP.map((c) => (
                          <td key={c.key} className="py-2 text-right font-semibold">
                            {r[c.key as "water_pct"] != null ? `${r[c.key as "water_pct"]}%` : "—"}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : rows.length > 1 ? (
              <div className="-ml-3 mt-2 h-60" role="img" aria-label="Gráfica de agua, músculo y grasa en porcentaje">
                <ResponsiveContainer>
                  <LineChart data={rows} margin={{ top: 12, right: 44, bottom: 0, left: 0 }}>
                    <CartesianGrid stroke="var(--border)" vertical={false} />
                    <XAxis dataKey="date" tickFormatter={(d) => fmtDate(d)} minTickGap={24} {...axisProps} />
                    <YAxis
                      domain={[(min: number) => Math.max(0, Math.floor((min - 5) / 5) * 5), (max: number) => Math.min(100, Math.ceil((max + 5) / 5) * 5)]}
                      tickFormatter={(v) => `${v}%`}
                      width={44}
                      {...axisProps}
                    />
                    <Tooltip
                      contentStyle={tooltipStyle}
                      labelFormatter={(d) => fmtDate(String(d), { day: "numeric", month: "long", year: "numeric" })}
                      formatter={(v, name) => [`${v}%`, COMP.find((c) => c.key === name)?.label ?? name]}
                      itemSorter={(i) => COMP.findIndex((c) => c.key === i.dataKey)}
                    />
                    {COMP.map((c) => (
                      <Line
                        key={c.key}
                        type="monotone"
                        dataKey={c.key}
                        name={c.key}
                        stroke={c.color}
                        strokeWidth={2}
                        connectNulls
                        dot={{ r: 4, fill: c.color, stroke: "var(--surface)", strokeWidth: 2 }}
                        activeDot={{ r: 6, stroke: "var(--surface)", strokeWidth: 2 }}
                        isAnimationActive={false}
                      >
                        {/* Etiqueta directa solo en el último punto */}
                        <LabelList
                          dataKey={c.key}
                          content={(p) => {
                            const { x, y, index, value } = p as { x: number; y: number; index: number; value: number | null };
                            if (index !== lastIdx || value == null) return null;
                            return (
                              <text x={x + 8} y={y + 4} fontSize={12} fontWeight={700} fill="var(--text)">
                                {value}%
                              </text>
                            );
                          }}
                        />
                      </Line>
                    ))}
                  </LineChart>
                </ResponsiveContainer>
              </div>
            ) : (
              <p className="mt-3 rounded-input bg-surface-2 p-3 text-sm text-ink-2">Con dos registros aparece la gráfica.</p>
            )}
          </Card>
        </>
      )}

      <Button variant="dark" full icon={Activity} onClick={() => setSheet(true)}>
        Registrar composición
      </Button>

      <Sheet open={sheet} onClose={() => setSheet(false)} title="Composición de hoy">
        <MultiNumberForm
          fields={COMP.map((c) => ({ key: c.key, label: c.label, unit: "%" }))}
          initial={Object.fromEntries(COMP.map((c) => [c.key, stats[c.key]?.last ?? null]))}
          busy={log.isPending}
          hint="Copia los valores de la báscula de bioimpedancia. Mídete en ayunas para comparar mejor."
          onSubmit={(v) => log.mutate(v)}
        />
      </Sheet>
    </div>
  );
}
