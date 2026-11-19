import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { QRCodeSVG } from "qrcode.react";
import { Clock, Maximize, Users, X } from "lucide-react";
import { api, unwrap } from "@/api/client";
import type { QrToken } from "@/api/types";
import { Avatar } from "@/components/Avatar";
import { fmtTime } from "@/lib/format";

/**
 * Pantalla para la tablet de recepción.
 * - El QR cambia cada 60 s (una foto enviada por WhatsApp no sirve desde casa).
 * - El servidor solo acepta a quien tiene reserva en un horario abierto ahora
 *   (desde 30 min antes del inicio hasta que termina).
 * - Se actualiza cada 15 s con quién va llegando (solo mientras la pantalla está visible).
 */
export default function QrScreen() {
  const nav = useNavigate();
  const { data } = useQuery({
    queryKey: ["coach", "qr"],
    queryFn: async () => (await unwrap(api.GET("/api/coach/qr"))) as unknown as QrToken,
    // Cada 15 s (o justo al cambiar el código). Con la pantalla apagada no consulta:
    // al volver a verse se actualiza sola. El servidor acepta el código actual y el anterior.
    refetchInterval: (q) => Math.min(15_000, ((q.state.data?.expires_in ?? 15) * 1000) + 300),
    refetchIntervalInBackground: false,
    refetchOnWindowFocus: "always",
  });
  const [left, setLeft] = useState(60);

  useEffect(() => {
    if (!data) return;
    setLeft(data.expires_in);
    const i = setInterval(() => setLeft((s) => Math.max(0, s - 1)), 1000);
    return () => clearInterval(i);
  }, [data]);

  // Pantalla siempre encendida en la tablet
  useEffect(() => {
    let lock: WakeLockSentinel | null = null;
    const req = () => navigator.wakeLock?.request("screen").then((l) => (lock = l)).catch(() => {});
    req();
    const onVis = () => document.visibilityState === "visible" && req();
    document.addEventListener("visibilitychange", onVis);
    return () => {
      document.removeEventListener("visibilitychange", onVis);
      lock?.release().catch(() => {});
    };
  }, []);

  const url = data ? `${window.location.origin}/app/checkin?t=${data.token}` : "";
  const open = data?.open_sessions ?? [];

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto bg-night text-white">
      <div className="absolute right-3 top-3 flex gap-2">
        <button
          aria-label="Pantalla completa"
          onClick={() => document.documentElement.requestFullscreen?.().catch(() => {})}
          className="grid size-12 place-items-center rounded-full hover:bg-white/10"
        >
          <Maximize className="size-6" />
        </button>
        <button aria-label="Cerrar" onClick={() => nav("/coach")} className="grid size-12 place-items-center rounded-full hover:bg-white/10">
          <X className="size-6" />
        </button>
      </div>

      <div className="mx-auto flex min-h-full max-w-5xl flex-col items-center justify-center gap-6 p-6 pt-16 lg:flex-row lg:items-center lg:gap-12">
        {/* QR + código */}
        <section className="flex flex-col items-center gap-5">
          <div className="flex items-center gap-3">
            <img src="/logo.webp" alt="" className="size-14 rounded-full" />
            <h1 className="t-display text-[40px] lg:text-[56px]">
              Registra tu <span className="text-fire">asistencia</span>
            </h1>
          </div>
          <div className="rounded-[24px] bg-white p-5">
            {data ? (
              <QRCodeSVG value={url} size={Math.min(window.innerWidth * 0.7, window.innerHeight * 0.45, 380)} level="M" fgColor="#120A1C" />
            ) : (
              <div className="size-64 animate-pulse rounded-card bg-[#F3EEF5]" />
            )}
          </div>
          <div className="text-center">
            <p className="text-xs font-semibold uppercase tracking-[0.08em] text-[#B8AEC2]">¿No funciona la cámara? Código</p>
            <p className="mt-1 font-extrabold tabular-nums tracking-[0.25em] text-gold" style={{ fontSize: "clamp(40px, 8vw, 80px)" }}>
              {data?.code ?? "······"}
            </p>
            <div className="mx-auto mt-3 h-1.5 w-64 overflow-hidden rounded-full bg-[#2A1D36]">
              <div className="h-full bg-fire transition-[width] duration-1000 ease-linear" style={{ width: `${(left / 60) * 100}%` }} />
            </div>
            <p className="mt-2 text-sm tabular-nums text-[#B8AEC2]">Cambia en {left} s</p>
          </div>
        </section>

        {/* Horario abierto ahora + llegadas */}
        <section className="w-full max-w-md space-y-4">
          <div className="rounded-card border border-[#3A2B48] bg-[#1E1428] p-4">
            <p className="text-xs font-semibold uppercase tracking-[0.08em] text-[#B8AEC2]">Abierto para registrar ahora</p>
            {open.length === 0 ? (
              <div className="mt-2">
                <p className="text-lg font-semibold">Ningún horario abierto</p>
                {data?.next_session && (
                  <p className="mt-1 flex items-center gap-1.5 text-[15px] text-[#B8AEC2]">
                    <Clock className="size-4" />
                    Siguiente: {data.next_session.name} a las {fmtTime(data.next_session.start_at)} (abre {fmtTime(data.next_session.opens_at)})
                  </p>
                )}
              </div>
            ) : (
              <ul className="mt-2 space-y-3">
                {open.map((s) => (
                  <li key={s.id}>
                    <div className="flex items-baseline justify-between gap-3">
                      <p className="font-display text-2xl font-bold uppercase">{s.name}</p>
                      <p className="shrink-0 tabular-nums text-[#B8AEC2]">
                        {fmtTime(s.start_at)}–{fmtTime(s.end_at)}
                      </p>
                    </div>
                    <div className="mt-1.5 flex items-center gap-3">
                      <div className="h-2 flex-1 overflow-hidden rounded-full bg-[#2A1D36]">
                        <div className="h-full bg-[#3DCB7A]" style={{ width: `${s.booked ? (s.attended / s.booked) * 100 : 0}%` }} />
                      </div>
                      <span className="flex items-center gap-1 text-sm font-semibold tabular-nums">
                        <Users className="size-4" /> {s.attended}/{s.booked} llegaron
                      </span>
                    </div>
                    {!s.requires_reservation && <p className="mt-1 text-xs text-[#F2B33D]">No requiere reserva</p>}
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className="rounded-card border border-[#3A2B48] bg-[#1E1428] p-4">
            <p className="text-xs font-semibold uppercase tracking-[0.08em] text-[#B8AEC2]">
              Llegadas de hoy · {data?.today_count ?? 0}
            </p>
            {(data?.recent ?? []).length === 0 ? (
              <p className="mt-2 text-[15px] text-[#B8AEC2]">Todavía nadie.</p>
            ) : (
              <ul className="mt-2 space-y-2">
                {data!.recent.map((r, i) => (
                  <li key={i} className={`flex items-center gap-3 ${i === 0 ? "animate-slide-up" : ""}`}>
                    <Avatar url={r.avatar_url} name={r.name} size={36} />
                    <span className="flex-1 truncate font-medium">{r.name}</span>
                    <span className="text-sm tabular-nums text-[#B8AEC2]">{fmtTime(r.at)}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </section>
      </div>
    </div>
  );
}
