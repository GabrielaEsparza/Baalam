import { useCallback, useEffect, useRef, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, CheckCircle2, Keyboard, XCircle } from "lucide-react";
import { api, unwrap, ApiError } from "@/api/client";
import { Button, Input } from "@/components/ui";
import { fmtTime } from "@/lib/format";

type State =
  | { kind: "scan" }
  | { kind: "code" }
  | { kind: "sending" }
  | { kind: "ok"; points: number; warning?: string | null; session?: { name: string; start_at: string } | null }
  | { kind: "error"; msg: string; code?: string };

/** El QR de recepción codifica una URL /app/checkin?t=TOKEN (también funciona con la cámara del sistema). */
function tokenFrom(text: string): string {
  try {
    return new URL(text).searchParams.get("t") ?? text;
  } catch {
    return text.trim();
  }
}

export default function CheckinPage() {
  const [params] = useSearchParams();
  const urlToken = params.get("t");
  const [state, setState] = useState<State>({ kind: urlToken ? "sending" : "scan" });
  const qc = useQueryClient();
  const nav = useNavigate();
  const sentRef = useRef(false);

  const send = useCallback(
    async (body: { token?: string; code?: string }) => {
      if (sentRef.current) return;
      sentRef.current = true;
      setState({ kind: "sending" });
      try {
        const res = (await unwrap(api.POST("/api/checkin", { body }))) as {
          points: number;
          warning?: string | null;
          session?: { name: string; start_at: string } | null;
        };
        navigator.vibrate?.(120);
        setState({ kind: "ok", points: res.points, warning: res.warning, session: res.session });
        qc.invalidateQueries({ queryKey: ["home"] });
      } catch (e) {
        setState({ kind: "error", msg: (e as Error).message, code: e instanceof ApiError ? e.code : undefined });
      }
    },
    [qc],
  );

  useEffect(() => {
    if (urlToken) send({ token: urlToken });
  }, [urlToken, send]);

  // Cámara
  useEffect(() => {
    if (state.kind !== "scan") return;
    let scanner: import("html5-qrcode").Html5Qrcode | null = null;
    let stopped = false;
    import("html5-qrcode").then(({ Html5Qrcode }) => {
      if (stopped) return;
      scanner = new Html5Qrcode("qr-reader", { verbose: false });
      scanner
        .start(
          { facingMode: "environment" },
          { fps: 10, qrbox: (w, h) => ({ width: Math.min(w, h) * 0.7, height: Math.min(w, h) * 0.7 }) },
          (text) => {
            scanner?.stop().catch(() => {});
            send({ token: tokenFrom(text) });
          },
          () => {},
        )
        .catch(() => setState({ kind: "code" })); // sin permiso de cámara → código de 6 dígitos
    });
    return () => {
      stopped = true;
      if (scanner?.isScanning) scanner.stop().catch(() => {});
    };
  }, [state.kind, send]);

  const retry = () => {
    sentRef.current = false;
    setState({ kind: "scan" });
  };

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-night text-white">
      <header className="flex items-center gap-2 p-3">
        <button aria-label="Volver" onClick={() => nav("/app")} className="grid size-11 place-items-center rounded-full hover:bg-white/10">
          <ArrowLeft className="size-6" />
        </button>
        <h1 className="t-h2">Registrar asistencia</h1>
      </header>

      <div className="flex flex-1 flex-col items-center justify-center px-4">
        {state.kind === "scan" && (
          <>
            <div className="relative aspect-square w-full max-w-sm overflow-hidden rounded-card bg-black">
              <div id="qr-reader" className="size-full [&_video]:size-full [&_video]:object-cover" />
              <div className="pointer-events-none absolute inset-[15%] rounded-card border-4 border-fire" />
            </div>
            <p className="mt-4 text-center text-[15px] text-[#B8AEC2]">Apunta al QR de la pantalla de recepción.</p>
          </>
        )}

        {state.kind === "code" && <CodeForm onSubmit={(code) => send({ code })} />}

        {state.kind === "sending" && <p className="t-h2 animate-pulse">Registrando…</p>}

        {state.kind === "ok" && (
          <div className="animate-pop text-center">
            <CheckCircle2 className="mx-auto size-24 text-[#3DCB7A]" strokeWidth={1.5} />
            <p className="t-display mt-4">¡Listo!</p>
            {state.session && (
              <p className="mt-1 text-lg text-[#B8AEC2]">
                {state.session.name} · {fmtTime(state.session.start_at)}
              </p>
            )}
            {state.points > 0 && (
              <p className="mt-2 inline-block rounded-full bg-gold px-4 py-1.5 text-lg font-extrabold text-night">
                +{state.points} puntos
              </p>
            )}
            {state.warning && <p className="mt-4 max-w-xs text-[15px] text-[#F2B33D]">{state.warning}</p>}
          </div>
        )}

        {state.kind === "error" && (
          <div className="text-center">
            <XCircle className="mx-auto size-20 text-[#FF6B6B]" strokeWidth={1.5} />
            <p className="mt-4 max-w-xs text-lg font-semibold">{state.msg}</p>
            {(state.code === "no_booking" || state.code === "too_late") && (
              <Link to="/app/horarios" className="mt-3 inline-block font-semibold text-[#D07BC0] underline">
                Reservar un horario de hoy
              </Link>
            )}
          </div>
        )}
      </div>

      <footer className="safe-bottom space-y-2 p-4">
        {state.kind === "scan" && (
          <Button variant="dark" full icon={Keyboard} onClick={() => setState({ kind: "code" })} className="border border-white/15">
            Ingresar código de 6 dígitos
          </Button>
        )}
        {state.kind === "ok" && (
          <Button full onClick={() => nav("/app")}>
            Ir a inicio
          </Button>
        )}
        {state.kind === "error" && state.code !== "already" && (
          <Button full onClick={retry}>
            Intentar de nuevo
          </Button>
        )}
        {state.kind === "error" && state.code === "already" && (
          <Button full onClick={() => nav("/app")}>
            Ir a inicio
          </Button>
        )}
      </footer>
    </div>
  );
}

function CodeForm({ onSubmit }: { onSubmit: (code: string) => void }) {
  const [code, setCode] = useState("");
  return (
    <form
      className="w-full max-w-sm space-y-4"
      onSubmit={(e) => {
        e.preventDefault();
        if (code.length === 6) onSubmit(code);
      }}
    >
      <p className="text-center text-[15px] text-[#B8AEC2]">Escribe el código que aparece debajo del QR.</p>
      <Input
        autoFocus
        inputMode="numeric"
        autoComplete="one-time-code"
        maxLength={6}
        value={code}
        onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
        className="h-16 border-[#3A2B48] bg-[#1E1428] text-center text-3xl font-extrabold tracking-[0.4em] text-white"
        aria-label="Código de 6 dígitos"
      />
      <Button type="submit" full disabled={code.length !== 6}>
        Registrar
      </Button>
    </form>
  );
}
