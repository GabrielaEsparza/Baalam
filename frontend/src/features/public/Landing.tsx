import { useEffect } from "react";
import { Link, Navigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { CalendarCheck, ChevronRight, Clock, Dumbbell, MapPin, MessageCircle, TrendingUp, Trophy } from "lucide-react";
import { api, unwrap } from "@/api/client";
import { useMe } from "@/app/session";
import { cx } from "@/components/ui";
import { fmtMoney, waLink } from "@/lib/format";

/** Frase del hero: cada línea con su color. Cámbiala aquí. */
const QUOTE: [string, string][] = [
  ["No busques", "text-white"],
  ["motivación.", "text-fire"],
  ["Construye", "text-white"],
  ["disciplina.", "text-orchid"],
];
const QUOTE_AUTHOR = "Melissa Zacarías";

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
      <section className="relative isolate overflow-hidden">
        {/* Fondo: logo difuminado + brillo naranja abajo */}
        <div aria-hidden className="pointer-events-none absolute inset-0 -z-10">
          <img
            src="/logo.webp"
            alt=""
            className="absolute left-1/2 top-[52%] w-[min(130vw,760px)] max-w-none -translate-x-1/2 -translate-y-1/2 opacity-[0.13] blur-[1px] grayscale-[35%]"
          />
          <div
            className="absolute inset-0"
            style={{
              background:
                "linear-gradient(180deg, rgb(18 10 28 / 0.55) 0%, rgb(18 10 28 / 0.2) 45%, rgb(18 10 28 / 0.75) 80%), radial-gradient(90% 35% at 50% 105%, rgb(224 90 0 / 0.38), transparent 70%), radial-gradient(70% 45% at 30% 20%, rgb(91 42 134 / 0.35), transparent 70%)",
            }}
          />
        </div>

        <div className="mx-auto flex min-h-dvh max-w-xl flex-col justify-center px-6 py-12">
          <div className="mb-10 size-24 overflow-hidden rounded-full bg-black shadow-[0_0_40px_rgb(176_79_155_/_0.35)] ring-2 ring-orchid/70 ring-offset-4 ring-offset-night">
            <img src="/logo.webp" alt="BÁALAM GYM" width={720} height={720} className="size-full scale-[0.97] object-cover" />
          </div>

          <p className="flex items-center gap-3 text-xs font-semibold uppercase tracking-[0.25em] text-fire">
            <span aria-hidden className="h-0.5 w-8 rounded-full bg-fire" /> Entrenamiento funcional
          </p>

          <h1 className="mt-5 text-[44px] leading-[1.02] font-normal uppercase tracking-tight sm:text-[56px]">
            {QUOTE.map(([text, tone]) => (
              <span key={text} className={cx("block", tone)}>
                {text}
              </span>
            ))}
          </h1>
          <p className="mt-4 text-[15px] font-semibold text-orchid">— {QUOTE_AUTHOR}</p>

          <p className="mt-6 max-w-md text-[17px] leading-relaxed text-[#C9B8D6]">
            Entrenamiento funcional, nutrición y comunidad para convertir tus objetivos en hábitos.
          </p>

          <div className="mt-10 flex w-full max-w-sm flex-col gap-3">
            <Link
              to="/login"
              className="flex h-[56px] items-center justify-center gap-2 rounded-btn border border-white/10 bg-white/10 text-[15px] font-bold uppercase tracking-wide text-white backdrop-blur-sm transition hover:bg-white/15"
            >
              Iniciar sesión <ChevronRight className="size-5" strokeWidth={2} />
            </Link>
            <div className="flex items-center justify-between gap-3 px-1">
              <Link to="/registro" className="py-2 text-[15px] font-medium text-orchid underline-offset-4 hover:underline">
                ¿Nuevo? Crea tu cuenta
              </Link>
              {wa && (
                <a
                  href={wa}
                  target="_blank"
                  rel="noreferrer"
                  className="flex items-center gap-1.5 py-2 text-[15px] font-medium text-[#C9B8D6] hover:text-white"
                >
                  <MessageCircle className="size-4" strokeWidth={1.75} /> WhatsApp
                </a>
              )}
            </div>
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
