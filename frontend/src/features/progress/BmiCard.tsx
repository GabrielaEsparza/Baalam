import { useState } from "react";
import { Link } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { Info, Ruler } from "lucide-react";
import { api, unwrap } from "@/api/client";
import type { Bmi, BmiCategory } from "@/api/types";
import { useSetMe } from "@/app/session";
import { Button, Card, Field, Input, Sheet, cx } from "@/components/ui";
import { useToast } from "@/components/ui/toast";

/* Escala de la rueda: de 15 a 42 de IMC. */
const MIN = 15;
const MAX = 42;
const BANDS: { key: BmiCategory; from: number; to: number; color: string; short: string; range: string }[] = [
  { key: "under", from: MIN, to: 18.5, color: "#2b9ed6", short: "Bajo", range: "<18.5" },
  { key: "normal", from: 18.5, to: 25, color: "#1fa45a", short: "Saludable", range: "18.5–24.9" },
  { key: "over", from: 25, to: 30, color: "#e0a32e", short: "Sobrepeso", range: "25–29.9" },
  { key: "obese1", from: 30, to: 35, color: "#ee7a1f", short: "Ob. I", range: "30–34.9" },
  { key: "obese2", from: 35, to: 40, color: "#e0482e", short: "Ob. II", range: "35–39.9" },
  { key: "obese3", from: 40, to: MAX, color: "#b3261e", short: "Ob. III", range: "40+" },
];

const CX = 120;
const CY = 118;
const R = 92;
const STROKE = 22;

/** 15 → izquierda (180°), 42 → derecha (0°). */
function angleFor(v: number) {
  const t = (Math.min(MAX, Math.max(MIN, v)) - MIN) / (MAX - MIN);
  return Math.PI * (1 - t);
}
function point(a: number, r = R) {
  return { x: CX + r * Math.cos(a), y: CY - r * Math.sin(a) };
}
function arc(from: number, to: number) {
  const a0 = angleFor(from);
  const a1 = angleFor(to);
  const p0 = point(a0);
  const p1 = point(a1);
  return `M ${p0.x} ${p0.y} A ${R} ${R} 0 0 1 ${p1.x} ${p1.y}`;
}

const MESSAGES: Record<BmiCategory, string> = {
  under: "Estás por debajo del rango saludable. Platica con tu coach para ganar masa de forma sana.",
  normal: "Estás en el rango saludable. ¡Sigue así!",
  over: "Estás un poco arriba del rango saludable. Si tienes mucho músculo, puede ser normal.",
  obese1: "Tu IMC está en obesidad grado I. Con constancia y buena alimentación se baja paso a paso.",
  obese2: "Tu IMC está en obesidad grado II. Tu coach puede ayudarte con un plan a tu medida.",
  obese3: "Tu IMC está en obesidad grado III. Te recomendamos acompañarlo con un profesional de salud.",
};

export function BmiCard({ bmi, bodyFat }: { bmi: Bmi; bodyFat: number | null }) {
  const [sheet, setSheet] = useState(false);
  const value = bmi.value != null ? Number(bmi.value) : null;
  const band = BANDS.find((b) => b.key === bmi.category);

  return (
    <Card className="mb-5">
      <div className="flex items-start justify-between gap-2">
        <div>
          <p className="t-label">Tu IMC</p>
          <p className="text-sm text-ink-2">Índice de masa corporal</p>
        </div>
        {bmi.height_cm && (
          <button onClick={() => setSheet(true)} className="text-right text-sm font-semibold text-orchid hover:underline">
            {Number(bmi.height_cm)} cm
          </button>
        )}
      </div>

      {/* Rueda */}
      <div className="relative mx-auto mt-2 w-full max-w-[300px]">
        <svg viewBox="0 0 240 140" className="w-full" role="img" aria-label={value ? `IMC ${value}: ${bmi.label}` : "IMC sin calcular"}>
          {BANDS.map((b) => (
            <path
              key={b.key}
              d={arc(b.from + 0.15, b.to - 0.15)}
              fill="none"
              stroke={b.color}
              strokeWidth={STROKE}
              opacity={!band || band.key === b.key ? 1 : 0.28}
            />
          ))}
          {/* Marcas de los límites */}
          {[18.5, 25, 30, 35, 40].map((v) => {
            const p = point(angleFor(v), R + STROKE / 2 + 8);
            return (
              <text key={v} x={p.x} y={p.y} fontSize="9" fontWeight={700} textAnchor="middle" dominantBaseline="middle" fill="var(--text-2)">
                {v}
              </text>
            );
          })}
          {value != null && (
            <g>
              {(() => {
                const a = angleFor(value);
                const tip = point(a, R - STROKE / 2 - 4);
                const base1 = point(a + Math.PI / 2, 5);
                const base2 = point(a - Math.PI / 2, 5);
                return (
                  <>
                    <polygon points={`${tip.x},${tip.y} ${base1.x},${base1.y} ${base2.x},${base2.y}`} fill="var(--text)" />
                    <circle cx={CX} cy={CY} r={8} fill="var(--text)" />
                    <circle cx={CX} cy={CY} r={3} fill="var(--surface)" />
                  </>
                );
              })()}
            </g>
          )}
        </svg>
        <div className="-mt-1 text-center">
          {value != null ? (
            <>
              <p className="t-num leading-none">{value}</p>
              <span
                className="mt-2 inline-block rounded-full px-3 py-1 text-sm font-bold text-white"
                style={{ background: band?.color }}
              >
                {bmi.label}
              </span>
            </>
          ) : (
            <p className="text-[15px] font-medium text-ink-2">
              {!bmi.height_cm ? "Agrega tu estatura para calcularlo." : "Registra tu peso para calcularlo."}
            </p>
          )}
        </div>
      </div>

      {/* Leyenda de colores */}
      <ul className="mt-4 grid grid-cols-3 gap-x-2 gap-y-1.5 text-xs font-semibold text-ink-2">
        {BANDS.map((b) => (
          <li key={b.key} className={cx("flex items-center gap-1.5", band?.key === b.key && "text-ink")}>
            <span className="size-2.5 shrink-0 rounded-full" style={{ background: b.color }} aria-hidden />
            {b.short} {b.range}
          </li>
        ))}
      </ul>

      {!bmi.height_cm && (
        <Button full variant="secondary" icon={Ruler} className="mt-4" onClick={() => setSheet(true)}>
          Agregar mi estatura
        </Button>
      )}

      {/* Lo que significa para ti */}
      {value != null && bmi.category && (
        <div className="mt-4 space-y-2 border-t border-line pt-4 text-[15px]">
          <p className="font-medium">{MESSAGES[bmi.category]}</p>
          {bmi.healthy_kg && (
            <p className="text-ink-2">
              Para tu estatura, el peso saludable va de <b className="text-ink">{Number(bmi.healthy_kg.min)}</b> a{" "}
              <b className="text-ink">{Number(bmi.healthy_kg.max)} kg</b>.
            </p>
          )}
          {bmi.minor && (
            <p className="text-ink-2">En menores de 18 años el IMC se lee con tablas por edad: tómalo solo como guía.</p>
          )}
        </div>
      )}

      {/* Grasa corporal según sexo y edad */}
      {bmi.fat_range ? (
        <div className="mt-3 rounded-input bg-surface-2 p-3 text-[15px]">
          <p>
            Grasa saludable para {bmi.sex === "f" ? "mujeres" : "hombres"}
            {bmi.age ? ` de tu edad` : ""}:{" "}
            <b>
              {bmi.fat_range.min}–{bmi.fat_range.max}%
            </b>
          </p>
          {bodyFat != null ? (
            <p className="text-ink-2">
              La tuya: <b className="text-ink">{bodyFat}%</b>{" "}
              {bodyFat < bmi.fat_range.min ? "· por debajo" : bodyFat > bmi.fat_range.max ? "· por arriba" : "· dentro del rango ✓"}
            </p>
          ) : (
            <p className="text-ink-2">Registra tu % de grasa en Composición para compararla.</p>
          )}
        </div>
      ) : (
        !bmi.sex && (
          <p className="mt-3 text-sm text-ink-2">
            <Link to="/app/perfil" className="font-semibold text-orchid hover:underline">
              Indica tu sexo y cumpleaños
            </Link>{" "}
            para ver tu rango de grasa ideal.
          </p>
        )
      )}

      <p className="mt-4 flex gap-1.5 text-xs text-ink-2">
        <Info className="mt-px size-3.5 shrink-0" />
        <span>
          Referencia general de la OMS. El IMC no distingue músculo de grasa: tu composición corporal dice más de tu salud
          que lo que pesas.
        </span>
      </p>

      <Sheet open={sheet} onClose={() => setSheet(false)} title="Tu estatura">
        <HeightForm initial={bmi.height_cm ?? ""} onDone={() => setSheet(false)} />
      </Sheet>
    </Card>
  );
}

function HeightForm({ initial, onDone }: { initial: string; onDone: () => void }) {
  const [v, setV] = useState(initial ? String(Number(initial)) : "");
  const [busy, setBusy] = useState(false);
  const setMe = useSetMe();
  const qc = useQueryClient();
  const toast = useToast();
  return (
    <form
      className="space-y-4"
      onSubmit={async (e) => {
        e.preventDefault();
        if (!v) return;
        setBusy(true);
        try {
          setMe(await unwrap(api.PATCH("/api/me", { body: { height_cm: v.replace(",", ".") } as never })));
          qc.invalidateQueries({ queryKey: ["body"] });
          toast("Estatura guardada");
          onDone();
        } catch (err) {
          toast((err as Error).message, "error");
        } finally {
          setBusy(false);
        }
      }}
    >
      <Field label="Estatura (cm)">
        <Input
          autoFocus
          inputMode="decimal"
          value={v}
          placeholder="165"
          onChange={(e) => setV(e.target.value.replace(/[^\d.,]/g, ""))}
          className="h-14 text-center text-2xl font-bold"
        />
      </Field>
      <Button type="submit" full loading={busy}>
        Guardar
      </Button>
    </form>
  );
}
