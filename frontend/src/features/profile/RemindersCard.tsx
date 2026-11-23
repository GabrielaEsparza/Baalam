import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Bell, BellOff, ChevronDown, Share } from "lucide-react";
import { api, unwrap } from "@/api/client";
import { Button, Card, Stepper, Switch, cx } from "@/components/ui";
import { useToast } from "@/components/ui/toast";
import { currentSubscription, disablePush, enablePush, isIOS, isStandalone, pushSupported } from "@/lib/push";
import { disableFcm, fcmOn, fcmToken, isAndroidApp, syncFcm } from "@/lib/twa";
import { useMe } from "@/app/session";

type Prefs = {
  water: boolean;
  water_goal_ml: number | null;
  water_goal_auto_ml: number;
  workout: boolean;
  workout_hour: number;
  classes: boolean;
  measures: boolean;
  food: boolean;
  devices: number;
};
type Draft = Pick<Prefs, "water" | "water_goal_ml" | "workout" | "workout_hour" | "classes" | "measures" | "food">;
const KEY = ["me", "reminders"];
const HOURS = Array.from({ length: 18 }, (_, i) => i + 5); // 5 a 22 h
const fmtHour = (h: number) => `${h % 12 || 12}:00 ${h < 12 ? "am" : "pm"}`;
const toDraft = (p: Prefs): Draft => ({
  water: p.water,
  water_goal_ml: p.water_goal_ml,
  workout: p.workout,
  workout_hour: p.workout_hour,
  classes: p.classes,
  measures: p.measures,
  food: p.food,
});
const sameDraft = (a: Draft, b: Draft) => (Object.keys(a) as (keyof Draft)[]).every((k) => a[k] === b[k]);

/** Perfil → Avisos (desplegable): activar notificaciones en este celular y elegir cuáles recibir.
 *  Las preferencias se guardan con "Guardar cambios", que cierra el desplegable. */
export function RemindersCard() {
  const qc = useQueryClient();
  const toast = useToast();
  const { data: p } = useQuery({
    queryKey: KEY,
    queryFn: async () => (await unwrap(api.GET("/api/me/reminders"))) as unknown as Prefs,
  });
  const [open, setOpen] = useState(() => window.location.hash === "#avisos");
  const [draft, setDraft] = useState<Draft | null>(null);
  const [on, setOn] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);
  const { data: me } = useMe();
  // En la app de Android (Play Store) los avisos van por Firebase, como app nativa.
  const nativeApp = isAndroidApp() && !!fcmToken();
  const supported = nativeApp || pushSupported();
  const iosBrowser = isIOS() && !isStandalone();
  const denied = supported && Notification.permission === "denied";

  useEffect(() => {
    if (nativeApp) {
      setOn(fcmOn() && Notification.permission === "granted");
      return;
    }
    currentSubscription()
      .then((s) => setOn(!!s && Notification.permission === "granted"))
      .catch(() => setOn(false));
  }, [nativeApp]);

  // Al abrir, el borrador parte de lo guardado; al cerrar sin guardar, se descarta.
  // (Si los datos se recargan con el desplegable abierto, no se pisan los cambios.)
  useEffect(() => {
    if (!open) setDraft(null);
    else if (p && !draft) setDraft(toDraft(p));
  }, [open, p, draft]);

  // Si llegó desde "Cambiar meta o avisos de agua" (#avisos), bajar hasta aquí.
  useEffect(() => {
    if (p && window.location.hash === "#avisos") document.getElementById("avisos")?.scrollIntoView({ behavior: "smooth" });
  }, [p]);

  const save = useMutation({
    mutationFn: async (d: Draft) => {
      const body = { ...d, water_goal_auto: d.water_goal_ml == null };
      return (await unwrap(api.PUT("/api/me/reminders", { body: body as never }))) as unknown as Prefs;
    },
    onSuccess: (r) => {
      qc.setQueryData(KEY, r);
      qc.invalidateQueries({ queryKey: ["home"] });
      toast("Avisos guardados");
      setOpen(false);
    },
    onError: (e) => toast((e as Error).message, "error"),
  });

  async function toggle() {
    setBusy(true);
    try {
      if (nativeApp) {
        if (on) {
          await disableFcm();
          setOn(false);
          toast("Avisos desactivados en este celular");
        } else {
          // El permiso lo concede la app (Android lo pide una vez); luego se registra en Firebase.
          const perm = await Notification.requestPermission();
          if (perm !== "granted") {
            toast("No diste permiso para avisos. Puedes activarlo en los ajustes del celular.", "error");
            return;
          }
          await syncFcm(me!.id, true);
          await disablePush().catch(() => {}); // sin avisos web repetidos en este celular
          setOn(true);
          toast("¡Avisos activados!");
          await unwrap(api.POST("/api/push/test")).catch(() => {});
        }
        return;
      }
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
    } catch (e) {
      toast((e as Error).message, "error");
    } finally {
      setBusy(false);
    }
  }

  if (!p) return null;
  const d = draft ?? toDraft(p);
  const set = (patch: Partial<Draft>) => setDraft({ ...d, ...patch });
  const dirty = !sameDraft(d, toDraft(p));
  const goal = d.water_goal_ml ?? p.water_goal_auto_ml;
  const activeCount = [p.water, p.food, p.workout, p.classes, p.measures].filter(Boolean).length;
  const summary = on ? `Activados en este celular · ${activeCount} de 5 avisos` : "Desactivados en este celular";

  return (
    <Card className="mt-6 scroll-mt-20 p-0" id="avisos">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="flex w-full items-center gap-3 p-4 text-left"
      >
        <span
          className={cx(
            "grid size-11 shrink-0 place-items-center rounded-full",
            on ? "bg-orchid/15 text-orchid" : "bg-surface-2 text-ink-2",
          )}
        >
          {on ? <Bell className="size-5" /> : <BellOff className="size-5" />}
        </span>
        <span className="min-w-0 flex-1">
          <span className="t-h2 block text-orchid">Avisos</span>
          <span className="block text-sm text-ink-2">{on === null ? "…" : summary}</span>
        </span>
        <ChevronDown className={cx("size-5 shrink-0 text-ink-2 transition", open && "rotate-180")} />
      </button>

      {open && (
        <div className="space-y-4 border-t border-line p-4">
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

          <p className="text-xs text-ink-2">
            {nativeApp ? "Avisos de la app (nativos)" : isAndroidApp() ? "App de Android · ábrela de nuevo para activar los avisos nativos" : "Avisos del navegador"}
          </p>

          <div className="divide-y divide-line">
            <Pref label="💧 Tomar agua" hint="Cada 2 horas, hasta llegar a tu meta" checked={d.water} onChange={(v) => set({ water: v })} />
            <Pref
              label="🍽️ Registrar mis comidas"
              hint="3 p. m. si falta desayuno o comida · 9 p. m. si falta la cena"
              checked={d.food}
              onChange={(v) => set({ food: v })}
            />
            <Pref
              label="🏋️ Si no has registrado tu entrenamiento"
              hint="Solo de lunes a viernes, los días que tienes rutina"
              checked={d.workout}
              onChange={(v) => set({ workout: v })}
            />
            {d.workout && (
              <label className="flex min-h-12 items-center justify-between gap-4 pb-2">
                <span className="text-[15px] text-ink-2">Avisarme a las</span>
                <select
                  value={d.workout_hour}
                  onChange={(e) => set({ workout_hour: Number(e.target.value) })}
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
            <Pref
              label="📅 Mis sesiones"
              hint="1 hora antes · y el viernes, si te faltó un día y aún hay lugar"
              checked={d.classes}
              onChange={(v) => set({ classes: v })}
            />
            <Pref
              label="📏 Peso y medidas"
              hint="Diario hasta que las registres; después, cada mes"
              checked={d.measures}
              onChange={(v) => set({ measures: v })}
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
              onChange={(v) => set({ water_goal_ml: v })}
            />
            <p className="mt-1 text-sm text-ink-2">
              {d.water_goal_ml == null ? (
                "Automática: 35 ml por kg de tu último peso registrado (2 L si no lo has registrado)."
              ) : (
                <button
                  type="button"
                  className="font-semibold text-orchid hover:underline"
                  onClick={() => set({ water_goal_ml: null })}
                >
                  Usar la meta automática ({p.water_goal_auto_ml.toLocaleString("es-MX")} ml)
                </button>
              )}
            </p>
          </div>

          {dirty && (
            <Button full loading={save.isPending} onClick={() => save.mutate(d)}>
              Guardar cambios
            </Button>
          )}
        </div>
      )}
    </Card>
  );
}

/** Interruptor con una línea de explicación (cuándo llega el aviso). */
function Pref({ label, hint, checked, onChange }: { label: string; hint: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <div className="py-1">
      <Switch label={label} checked={checked} onChange={onChange} />
      <p className="-mt-2 pb-2 pr-16 text-sm text-ink-2">{hint}</p>
    </div>
  );
}
