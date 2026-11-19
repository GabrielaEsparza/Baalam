import { useEffect, useState } from "react";
import { X } from "lucide-react";
import { Avatar } from "@/components/Avatar";
import { Confetti } from "@/components/Confetti";
import type { Home } from "@/api/types";

const SHOW_MS = 7000;

function seenKey() {
  const d = new Date();
  return `baalam-bday-${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
}

function joinNames(names: string[]) {
  if (names.length <= 1) return names[0] ?? "";
  return `${names.slice(0, -1).join(", ")} y ${names.at(-1)}`;
}

/** Aviso de cumpleaños del día: aparece una vez al día, con confeti, y se va solo. */
export function BirthdayToast({ people }: { people: Home["birthdays"] }) {
  const [open, setOpen] = useState(false);

  const close = () => {
    setOpen(false);
    try {
      localStorage.setItem(seenKey(), "1");
    } catch {
      /* sin almacenamiento: se vuelve a mostrar la próxima vez */
    }
  };

  useEffect(() => {
    if (!people.length) return;
    try {
      if (localStorage.getItem(seenKey()) === "1") return;
    } catch {
      /* sin almacenamiento: se muestra */
    }
    setOpen(true);
    const t = setTimeout(close, SHOW_MS);
    return () => clearTimeout(t);
  }, [people.length]);

  if (!open || !people.length) return null;

  const me = people.find((p) => p.is_me);
  const others = people.filter((p) => !p.is_me);
  const shown = people.slice(0, 3);

  return (
    <>
      <Confetti duration={SHOW_MS - 1500} />
      <div
        role="status"
        aria-live="polite"
        className="fixed inset-x-0 top-0 z-[61] flex justify-center px-4 pt-[max(12px,env(safe-area-inset-top))]"
      >
        <div className="animate-pop relative w-full max-w-md overflow-hidden rounded-card border border-gold/60 bg-surface shadow-xl">
          <div className="flex items-center gap-3 p-4 pr-12">
            <div className="flex shrink-0 -space-x-3">
              {shown.map((p) => (
                <Avatar key={p.id} url={p.avatar_url} name={p.first_name} size={56} className="ring-2 ring-gold" />
              ))}
            </div>
            <div className="min-w-0">
              <p className="t-label text-fire">🎂 Cumpleaños</p>
              {me ? (
                <>
                  <p className="font-display text-xl font-bold uppercase leading-tight">¡Feliz cumpleaños, {me.first_name}!</p>
                  <p className="text-[15px] text-ink-2">
                    Todo BÁALAM te manda un abrazo.
                    {others.length > 0 && ` También cumple ${joinNames(others.map((o) => o.first_name))}.`}
                  </p>
                </>
              ) : (
                <>
                  <p className="font-display text-xl font-bold uppercase leading-tight">
                    Hoy {others.length > 1 ? "cumplen" : "cumple"} {joinNames(others.map((o) => o.first_name))}
                  </p>
                  <p className="text-[15px] text-ink-2">¡Felicítale cuando le veas en el gym!</p>
                </>
              )}
            </div>
          </div>
          <button
            onClick={close}
            aria-label="Cerrar"
            className="absolute right-2 top-2 grid size-9 place-items-center rounded-full text-ink-2 hover:bg-surface-2"
          >
            <X className="size-5" />
          </button>
          {/* Barra de tiempo restante */}
          <div className="h-1 bg-surface-2">
            <div className="h-full bg-gold" style={{ animation: `bday-shrink ${SHOW_MS}ms linear forwards` }} />
          </div>
        </div>
      </div>
      <style>{`@keyframes bday-shrink { from { width: 100%; } to { width: 0%; } }`}</style>
    </>
  );
}
