const TZ_OPTS: Intl.DateTimeFormatOptions = {};

export const fmtDate = (d: string | Date, opts: Intl.DateTimeFormatOptions = { day: "numeric", month: "short" }) =>
  new Date(typeof d === "string" && d.length === 10 ? `${d}T12:00:00` : d).toLocaleDateString("es-MX", {
    ...TZ_OPTS,
    ...opts,
  });

export const fmtTime = (d: string | Date) =>
  new Date(d).toLocaleTimeString("es-MX", { hour: "2-digit", minute: "2-digit", hour12: false });

export const fmtMoney = (n: number | string) =>
  Number(n).toLocaleString("es-MX", { style: "currency", currency: "MXN", maximumFractionDigits: 0 });

export const WEEKDAYS = ["Lunes", "Martes", "Miércoles", "Jueves", "Viernes", "Sábado", "Domingo"];
export const WD_SHORT = ["L", "M", "X", "J", "V", "S", "D"];

export const monthKey = (d = new Date()) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;

export const monthLabel = (key: string) => {
  const [y, m] = key.split("-").map(Number);
  return new Date(y, m - 1, 1).toLocaleDateString("es-MX", { month: "long", year: "numeric" });
};

export const isoDate = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

/** Lunes=0 … Domingo=6 (como el backend). */
export const weekdayOf = (iso: string) => (new Date(`${iso}T12:00:00`).getDay() + 6) % 7;

export function waLink(phone: string, text: string) {
  return `https://wa.me/${phone.replace(/\D/g, "")}?text=${encodeURIComponent(text)}`;
}

export const methodLabel: Record<string, string> = { cash: "Efectivo", transfer: "Transferencia", other: "Otro" };

/** Repeticiones: "8–10" si hay rango; si no, el número. */
export const fmtReps = (reps: number | null | undefined, max?: number | null) =>
  reps == null ? "—" : max && max > reps ? `${reps}–${max}` : String(reps);

/** Duración legible: "45 s", "50 min", "1 min 30 s". */
export function fmtDuration(seconds: number | null | undefined) {
  if (!seconds) return "—";
  if (seconds < 60) return `${seconds} s`;
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return s ? `${m} min ${s} s` : `${m} min`;
}
