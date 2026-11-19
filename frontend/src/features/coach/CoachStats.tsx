import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Bar, BarChart, CartesianGrid, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Table2, TrendingDown, TrendingUp } from "lucide-react";
import { api, unwrap } from "@/api/client";
import { Card, Spinner, cx } from "@/components/ui";
import { fmtMoney } from "@/lib/format";

interface MonthRow {
  month: string;
  checkins: number;
  members: number;
  payments_total: string | number | null;
  payments_count: number | null;
}
interface Stats {
  months: MonthRow[];
  day_of_month: number;
  prev_same_period: { checkins: number; payments_total: string | number | null };
}

const shortMonth = (key: string) => {
  const [y, m] = key.split("-").map(Number);
  return new Date(y, m - 1, 1).toLocaleDateString("es-MX", { month: "short" }).replace(".", "");
};
const longMonth = (key: string) => {
  const [y, m] = key.split("-").map(Number);
  return new Date(y, m - 1, 1).toLocaleDateString("es-MX", { month: "long", year: "numeric" });
};

const axis = { tick: { fill: "var(--text-2)", fontSize: 12 }, axisLine: false, tickLine: false } as const;
const tooltipStyle = { background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 12, color: "var(--text)" };

/** Gráficas del panel: asistencias y pagos por mes, comparando el mes en curso con el anterior al mismo día. */
export function CoachStats() {
  const { data, isLoading } = useQuery({
    queryKey: ["coach", "stats"],
    queryFn: async () => (await unwrap(api.GET("/api/coach/stats"))) as unknown as Stats,
  });
  if (isLoading) return <Spinner />;
  if (!data) return null;
  const rows = data.months;
  const showPayments = rows[0]?.payments_total !== null;

  return (
    <div className="grid gap-3 lg:grid-cols-2">
      <MonthChart
        title="Asistencias"
        rows={rows}
        value={(r) => r.checkins}
        format={(v) => String(v)}
        detail={(r) => `${r.checkins} asistencias · ${r.members} personas`}
        prev={data.prev_same_period.checkins}
        day={data.day_of_month}
        color="var(--series-muscle)"
      />
      {showPayments && (
        <MonthChart
          title="Pagos"
          rows={rows}
          value={(r) => Number(r.payments_total ?? 0)}
          format={(v) => fmtMoney(v)}
          detail={(r) => `${fmtMoney(Number(r.payments_total ?? 0))} · ${r.payments_count ?? 0} pagos`}
          prev={Number(data.prev_same_period.payments_total ?? 0)}
          day={data.day_of_month}
          color="var(--series-water)"
        />
      )}
    </div>
  );
}

function MonthChart({
  title,
  rows,
  value,
  format,
  detail,
  prev,
  day,
  color,
}: {
  title: string;
  rows: MonthRow[];
  value: (r: MonthRow) => number;
  format: (v: number) => string;
  detail: (r: MonthRow) => string;
  prev: number;
  day: number;
  color: string;
}) {
  const [table, setTable] = useState(false);
  const points = rows.map((r) => ({ key: r.month, label: shortMonth(r.month), v: value(r), row: r }));
  const current = points[points.length - 1];
  const delta = prev > 0 ? Math.round(((current.v - prev) / prev) * 100) : null;
  const up = delta !== null && delta >= 0;

  return (
    <Card>
      <div className="flex items-start justify-between gap-2">
        <div>
          <p className="t-label">{title} por mes</p>
          <p className="t-num mt-1 leading-none">{format(current.v)}</p>
          <p className="mt-1 text-sm text-ink-2">
            Este mes (al día {day})
            {delta !== null ? (
              <span className={cx("ml-1.5 inline-flex items-center gap-0.5 font-semibold", up ? "text-success" : "text-danger")}>
                {up ? <TrendingUp className="size-4" /> : <TrendingDown className="size-4" />}
                {up ? "+" : ""}
                {delta}%
              </span>
            ) : null}
            <span className="block">
              Mes pasado al mismo día: <b className="text-ink">{format(prev)}</b>
            </span>
          </p>
        </div>
        <button
          onClick={() => setTable((t) => !t)}
          aria-pressed={table}
          className="flex h-9 shrink-0 items-center gap-1.5 rounded-full px-3 text-sm font-semibold text-orchid hover:bg-surface-2"
        >
          <Table2 className="size-4" /> {table ? "Gráfica" : "Datos"}
        </button>
      </div>

      {table ? (
        <table className="mt-3 w-full text-[15px] tabular-nums">
          <tbody className="divide-y divide-line">
            {[...points].reverse().map((p) => (
              <tr key={p.key}>
                <td className="py-2 capitalize">{longMonth(p.key)}</td>
                <td className="py-2 text-right font-semibold">{detail(p.row)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <div className="-ml-2 mt-3 h-44" role="img" aria-label={`${title} de los últimos ${points.length} meses`}>
          <ResponsiveContainer>
            <BarChart data={points} margin={{ top: 8, right: 4, bottom: 0, left: 0 }} barCategoryGap="28%">
              <CartesianGrid stroke="var(--border)" vertical={false} />
              <XAxis dataKey="label" {...axis} />
              <YAxis width={48} allowDecimals={false} tickFormatter={(v) => (v >= 1000 ? `${Math.round(v / 1000)}k` : String(v))} {...axis} />
              <Tooltip
                cursor={{ fill: "var(--surface-2)" }}
                contentStyle={tooltipStyle}
                labelFormatter={(_, p) => (p?.[0] ? longMonth((p[0].payload as { key: string }).key) : "")}
                formatter={(_, __, item) => [detail((item.payload as { row: MonthRow }).row), ""]}
                separator=""
              />
              <Bar dataKey="v" radius={[4, 4, 0, 0]} isAnimationActive={false}>
                {points.map((p, i) => (
                  <Cell key={p.key} fill={color} fillOpacity={i === points.length - 1 ? 1 : 0.45} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}
      <p className="mt-1 text-xs text-ink-2">El mes actual va en curso (barra resaltada).</p>
    </Card>
  );
}
