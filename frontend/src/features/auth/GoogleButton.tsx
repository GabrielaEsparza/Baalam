import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { api, unwrap } from "@/api/client";
import { useSetMe } from "@/app/session";

/** Lo mínimo de Google Identity Services que usamos. */
type Gis = {
  accounts: {
    id: {
      initialize: (o: { client_id: string; callback: (r: { credential: string }) => void; ux_mode?: string; context?: string }) => void;
      renderButton: (el: HTMLElement, o: Record<string, unknown>) => void;
    };
  };
};
declare global {
  interface Window {
    google?: Gis;
  }
}

const SRC = "https://accounts.google.com/gsi/client";
let loading: Promise<void> | null = null;
function loadGis() {
  if (window.google?.accounts) return Promise.resolve();
  loading ??= new Promise<void>((resolve, reject) => {
    const s = document.createElement("script");
    s.src = SRC;
    s.async = true;
    s.onload = () => resolve();
    s.onerror = () => {
      loading = null;
      reject(new Error("No se pudo cargar Google."));
    };
    document.head.appendChild(s);
  });
  return loading;
}

/** Botón oficial "Continuar con Google". Si el gym no lo tiene configurado, no se muestra. */
export function GoogleButton({ context = "signin", onError }: { context?: "signin" | "signup"; onError: (msg: string | null) => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const setMe = useSetMe();
  const nav = useNavigate();
  const [busy, setBusy] = useState(false);
  const { data: gym } = useQuery({ queryKey: ["gym"], queryFn: () => unwrap(api.GET("/api/gym")) });
  const clientId = gym?.google_client_id;

  useEffect(() => {
    if (!clientId || !ref.current) return;
    let cancelled = false;
    loadGis()
      .then(() => {
        if (cancelled || !ref.current || !window.google) return;
        window.google.accounts.id.initialize({
          client_id: clientId,
          context,
          ux_mode: "popup",
          callback: async ({ credential }) => {
            setBusy(true);
            onError(null);
            try {
              const me = await unwrap(api.POST("/api/auth/google", { body: { credential } }));
              setMe(me);
              nav(me.features.coach ? "/coach" : "/app", { replace: true });
            } catch (e) {
              onError((e as Error).message);
            } finally {
              setBusy(false);
            }
          },
        });
        window.google.accounts.id.renderButton(ref.current, {
          type: "standard",
          theme: document.documentElement.dataset.theme === "dark" ? "filled_black" : "outline",
          size: "large",
          shape: "pill",
          text: context === "signup" ? "signup_with" : "continue_with",
          logo_alignment: "center",
          locale: "es-419",
          width: Math.min(400, ref.current.offsetWidth || 320),
        });
      })
      .catch((e: Error) => onError(e.message));
    return () => {
      cancelled = true;
    };
  }, [clientId, context, nav, onError, setMe]);

  if (!clientId) return null;
  return (
    <div className="space-y-4">
      <div ref={ref} className={busy ? "pointer-events-none opacity-60" : ""} style={{ minHeight: 44 }} aria-busy={busy} />
      <div className="flex items-center gap-3 text-sm text-ink-2" aria-hidden>
        <span className="h-px flex-1 bg-line" /> o con tu correo <span className="h-px flex-1 bg-line" />
      </div>
    </div>
  );
}
