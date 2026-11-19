import { useEffect } from "react";
import { Link, Navigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { CalendarCheck, Clock, Dumbbell, MapPin, MessageCircle, TrendingUp, Trophy } from "lucide-react";
import { api, unwrap } from "@/api/client";
import { useMe } from "@/app/session";
import { fmtMoney, waLink } from "@/lib/format";

/** Frase de marca del hero: cámbiala aquí. La palabra en `accent` va en naranja. */
const HERO = { before: "Disciplina", accent: "sobre", after: "motivación" };

export default function Landing() {
  const { data: me } = useMe();
  const { data: gym } = useQuery({ queryKey: ["gym"], queryFn: () => unwrap(api.GET("/api/gym")) });

  // La landing siempre es oscura, sin importar el tema del usuario.
  useEffect(() => {
    const prev = document.documentElement.dataset.theme;
    document.documentElement.dataset.theme = "dark";
    return () => {
      if (prev) document.documentElement.dataset.theme = prev;
    };
  }, []);

  if (me) return <Navigate to="/app" replace />;
  const wa = gym?.whatsapp ? waLink(gym.whatsapp, "Hola, quiero información de BÁALAM GYM") : null;

  return (
    <div className="min-h-dvh bg-night text-white">
      {/* Hero */}
      <section className="relative overflow-hidden">
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 opacity-60"
          style={{
            background:
              "radial-gradient(60% 50% at 50% 30%, rgb(91 42 134 / 0.55), transparent 70%), radial-gradient(40% 30% at 80% 70%, rgb(224 90 0 / 0.18), transparent 70%)",
          }}
        />
        <div className="relative mx-auto flex min-h-[92dvh] max-w-5xl flex-col items-center justify-center px-4 py-12 text-center">
          <img
            src="/logo.webp"
            alt="BÁALAM GYM"
            width={720}
            height={720}
            className="w-[min(78vw,380px)] mix-blend-lighten"
          />
          <h1 className="t-display mt-4 text-[44px] lg:text-[72px]">
            {HERO.before} <span className="text-fire">{HERO.accent}</span> {HERO.after}
          </h1>
          <p className="mt-3 max-w-md text-[17px] text-[#B8AEC2]">
            Entrenamiento funcional con rutina hecha por tu coach. Llega, registra tu asistencia y mide tu avance.
          </p>
          <div className="mt-8 flex w-full max-w-sm flex-col gap-3">
            <Link
              to="/login"
              className="flex h-[52px] items-center justify-center rounded-btn bg-fire-600 text-[15px] font-semibold uppercase tracking-wide text-white hover:brightness-110"
            >
              Iniciar sesión
            </Link>
            {wa && (
              <a
                href={wa}
                target="_blank"
                rel="noreferrer"
                className="flex h-[52px] items-center justify-center gap-2 rounded-btn border border-[#3A2B48] text-[15px] font-semibold uppercase tracking-wide text-white hover:bg-[#1E1428]"
              >
                <MessageCircle className="size-5" strokeWidth={1.75} /> Escribir por WhatsApp
              </a>
            )}
            <Link to="/registro" className="py-2 text-[15px] font-medium text-[#D07BC0] underline-offset-4 hover:underline">
              ¿Nuevo? Crea tu cuenta
            </Link>
          </div>
        </div>
      </section>

      {/* Qué es */}
      <section className="mx-auto max-w-5xl px-4 py-14">
        <h2 className="t-h2 mb-6 text-[#D07BC0]">Cómo funciona</h2>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {[
            { icon: CalendarCheck, t: "Reserva tu mes", d: "Elige tus días y horario una sola vez." },
            { icon: Dumbbell, t: "Entrena tu rutina", d: "Tu coach te programa cada día, con video de cada ejercicio." },
            { icon: TrendingUp, t: "Mide tu avance", d: "Peso, medidas y marcas personales en una gráfica." },
            { icon: Trophy, t: "Gana el podio", d: "Los puntos premian la constancia, no solo el peso." },
          ].map(({ icon: Icon, t, d }) => (
            <div key={t} className="rounded-card border border-[#3A2B48] bg-[#1E1428] p-5">
              <Icon className="mb-3 size-7 text-fire" strokeWidth={1.75} />
              <p className="font-display text-xl font-bold uppercase">{t}</p>
              <p className="mt-1 text-[15px] text-[#B8AEC2]">{d}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Planes (informativo: no hay pagos en línea) */}
      {gym && gym.plans.length > 0 && (
        <section className="mx-auto max-w-5xl px-4 pb-14">
          <h2 className="t-h2 mb-6 text-[#D07BC0]">Planes</h2>
          <div className="grid gap-4 sm:grid-cols-2">
            {gym.plans.map((p) => (
              <div key={p.id} className="rounded-card border border-[#3A2B48] bg-[#1E1428] p-5">
                <p className="font-display text-2xl font-bold uppercase">{p.name}</p>
                <p className="mt-1">
                  <span className="t-num text-fire">{fmtMoney(p.price_mxn)}</span>
                  <span className="ml-1 text-[#B8AEC2]">/ mes</span>
                </p>
                <ul className="mt-4 space-y-1.5 text-[15px] text-[#F5F0F8]">
                  {p.benefits.map((b) => (
                    <li key={b} className="flex gap-2">
                      <span className="text-gold">●</span> {b}
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
          <p className="mt-3 text-sm text-[#B8AEC2]">El pago se hace directo en el gym, en efectivo o transferencia.</p>
        </section>
      )}

      {/* Horarios y ubicación */}
      <section className="mx-auto grid max-w-5xl gap-4 px-4 pb-16 sm:grid-cols-2">
        <div className="rounded-card border border-[#3A2B48] bg-[#1E1428] p-5">
          <Clock className="mb-2 size-6 text-fire" strokeWidth={1.75} />
          <p className="font-display text-xl font-bold uppercase">Horario</p>
          <p className="mt-1 whitespace-pre-line text-[15px] text-[#B8AEC2]">{gym?.hours || "Pregunta por WhatsApp."}</p>
        </div>
        <div className="rounded-card border border-[#3A2B48] bg-[#1E1428] p-5">
          <MapPin className="mb-2 size-6 text-fire" strokeWidth={1.75} />
          <p className="font-display text-xl font-bold uppercase">Ubicación</p>
          <p className="mt-1 text-[15px] text-[#B8AEC2]">{gym?.address || "Pregunta por WhatsApp."}</p>
          {gym?.maps_url && (
            <a href={gym.maps_url} target="_blank" rel="noreferrer" className="mt-3 inline-block font-semibold text-[#D07BC0] hover:underline">
              Abrir en el mapa →
            </a>
          )}
        </div>
      </section>

      <footer className="border-t border-[#3A2B48] px-4 py-8 text-center text-sm text-[#B8AEC2]">
        © {new Date().getFullYear()} BÁALAM GYM
      </footer>
    </div>
  );
}
