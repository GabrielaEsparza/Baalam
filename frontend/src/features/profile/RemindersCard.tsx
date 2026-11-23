import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Bell, BellOff, Share } from "lucide-react";
import { api, unwrap } from "@/api/client";
import { Button, Card, Stepper, Switch } from "@/components/ui";
import { useToast } from "@/components/ui/toast";
import { currentSubscription, disablePush, enablePush, isIOS, isStandalone, pushSupported } from "@/lib/push";

type Prefs = {
  water: boolean;
  water_goal_ml: number | null;
  water_goal_auto_ml: number;
  workout: boolean;
  workout_hour: number;
  classes: boolean;
  measures: boolean;
  devices: number;
};
const KEY = ["me", "reminders"];
const HOURS = Array.from({ length: 18 }, (_, i) => i + 5); // 5 a 22 h
const fmtHour = (h: number) => `${h % 12 || 12}:00 ${h < 12 ? "am" : "pm"}`;

/** Perfil → Avisos: activar notificaciones en este celular y elegir cuáles recibir. */
export function RemindersCard() {
  const qc = useQueryClient();
  const toast = useToast();
  const { data: p } = useQuery({
    queryKey: KEY,
    queryFn: async () => (await unwrap(api.GET("/api/me/reminders"))) as unknown as Prefs,
  });
  const [on, setOn] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);
  const supported = pushSupported();
  const iosBrowser = isIOS() && !isStandalone();
  const denied = supported && Notification.permission === "denied";

  useEffect(() => {
    currentSubscription()
      .then((s) => setOn(!!s && Notification.permission === "granted"))
      .catch(() => setOn(false));
  }, []);

  const save = useMutation({
    mutationFn: async (body: Partial<Prefs> & { water_goal_auto?: boolean }) =>
      (await unwrap(api.PUT("/api/me/reminders", { body: body as never }))) as unknown as Prefs,
    onMutate: (body) => qc.setQueryData<Prefs>(KEY, (old) => (old ? { ...old, ...body } : old)),
    onSuccess: (r) => {
      qc.setQueryData(KEY, r);
      qc.invalidateQueries({ queryKey: ["home"] });
    },
    onError: (e) => {
      toast((e as Error).message, "error");
      qc.invalidateQueries({ queryKey: KEY });
    },
  });

  async function toggle() {
    setBusy(true);
    try {
      if (on) {
        await disablePush();
        setOn(false);
        toast("Avisos desactivados en este celular");
      } else {
        const perm = await enablePush();
        if (perm === "granted") {
          setOn(true);
          toast("¡Avisos activados!");
          await unwrap(api.POST("/api/push/test")).catch(() => {});
        } else {
          toast("No diste permiso para avisos. Puedes activarlo en los ajustes del celular.", "error");
        }
      }
      qc.invalidateQueries({ queryKey: KEY });
    } catch (e) {
      toast((e as Error).message, "error");
    } finally {
      setBusy(false);
    }
  }

  // Si llegó desde "Cambiar meta o avisos de agua" (#avisos), bajar hasta aquí.
  useEffect(() => {
    if (p && window.location.hash === "#avisos") document.getElementById("avisos")?.scrollIntoView({ behavior: "smooth" });
  }, [p]);

  if (!p) return null;
  const goal = p.water_goal_ml ?? p.water_goal_auto_ml;

  return (
    <Card className="scroll-mt-20 space-y-4" id="avisos">
      {iosBrowser ? (
        <div className="space-y-2 rounded-input bg-surface-2 p-3 text-[15px]">
          <p className="font-semibold">Para recibir avisos en iPhone, instala la app:</p>
          <ol className="list-decimal space-y-1 pl-5 text-ink-2">
            <li>
              Toca <Share className="inline size-4 align-text-bottom" /> <b>Compartir</b> en Safari.
            </li>
            <li>
              Elige <b>“Agregar a pantalla de inicio”</b>.
            </li>
            <li>Abre BÁALAM desde el ícono y vuelve aquí.</li>
          </ol>
        </div>
      ) : !supported ? (
        <p className="text-[15px] text-ink-2">Este navegador no permite avisos. Prueba con Chrome o instala la app.</p>
      ) : denied ? (
        <p className="text-[15px] text-ink-2">
          Bloqueaste los avisos para BÁALAM. Actívalos en los ajustes del celular (Notificaciones) y regresa aquí.
        </p>
      ) : (
        <Button
          full
          variant={on ? "secondary" : "primary"}
          icon={on ? BellOff : Bell}
          loading={busy || on === null}
          onClick={toggle}
        >
          {on ? "Desactivar avisos en este celular" : "Activar avisos en este celular"}
        </Button>
      )}

      <div className="divide-y divide-line">
        <Switch label="💧 Tomar agua (cada 2 horas)" checked={p.water} onChange={(v) => save.mutate({ water: v })} />
        <Switch
          label="🏋️ Si no has registrado tu entrenamiento"
          checked={p.workout}
          onChange={(v) => save.mutate({ workout: v })}
        />
        {p.workout && (
          <label className="flex min-h-12 items-center justify-between gap-4 pb-2">
            <span className="text-[15px] text-ink-2">Avisarme a las</span>
            <select
              value={p.workout_hour}
              onChange={(e) => save.mutate({ workout_hour: Number(e.target.value) })}
              className="h-11 rounded-input border border-line bg-surface-2 px-3 font-semibold focus:border-orchid focus:outline-none"
            >
              {HOURS.map((h) => (
                <option key={h} value={h}>
                  {fmtHour(h)}
                </option>
              ))}
            </select>
          </label>
        )}
        <Switch
          label="📅 1 hora antes de mi sesión reservada"
          checked={p.classes}
          onChange={(v) => save.mutate({ classes: v })}
        />
        <Switch
          label="📏 Cada mes, actualizar peso y medidas"
          checked={p.measures}
          onChange={(v) => save.mutate({ measures: v })}
        />
      </div>

      <div>
        <p className="t-label mb-1.5">Meta de agua al día</p>
        <Stepper
          value={goal}
          min={500}
          max={6000}
          step={250}
          suffix="ml"
          label="Meta de agua en ml"
          onChange={(v) => save.mutate({ water_goal_ml: v })}
        />
        <p className="mt-1 text-sm text-ink-2">
          {p.water_goal_ml == null ? (
            "Automática: 35 ml por kg de tu último peso registrado (2 L si no lo has registrado)."
          ) : (
            <button
              type="button"
              className="font-semibold text-orchid hover:underline"
              onClick={() => save.mutate({ water_goal_auto: true })}
            >
              Usar la meta automática ({p.water_goal_auto_ml.toLocaleString("es-MX")} ml)
            </button>
          )}
        </p>
      </div>
    </Card>
  );
}
