import { useState, type FormEvent, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Trash2 } from "lucide-react";
import { api, unwrap } from "@/api/client";
import { Button, Field, Input, PasswordInput } from "@/components/ui";
import { useToast } from "@/components/ui/toast";
import { waLink } from "@/lib/format";

const UPDATED = "23 de noviembre de 2026";

function useGym() {
  return useQuery({ queryKey: ["gym"], queryFn: () => unwrap(api.GET("/api/gym")) });
}

function LegalLayout({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="min-h-dvh bg-bg text-ink">
      <div className="mx-auto max-w-2xl px-4 pb-16 pt-4">
        <Link to="/" className="mb-4 inline-flex h-11 items-center gap-1 font-medium text-ink-2 hover:text-ink">
          <ArrowLeft className="size-5" /> BÁALAM GYM
        </Link>
        <h1 className="t-display mb-1 text-[36px]">{title}</h1>
        <p className="mb-8 text-sm text-ink-2">Última actualización: {UPDATED}</p>
        <div className="space-y-6 text-[15px] leading-relaxed [&_h2]:mb-2 [&_h2]:font-display [&_h2]:text-2xl [&_h2]:font-bold [&_h2]:uppercase [&_h2]:text-orchid [&_li]:ml-5 [&_li]:list-disc [&_ul]:space-y-1">
          {children}
        </div>
      </div>
    </div>
  );
}

function Contact() {
  const { data: gym } = useGym();
  const wa = gym?.whatsapp ? waLink(gym.whatsapp, "Hola, tengo una duda sobre mis datos en la app de BÁALAM GYM") : null;
  return (
    <p>
      Escríbenos por WhatsApp a recepción
      {wa && (
        <>
          {" "}
          (
          <a href={wa} target="_blank" rel="noreferrer" className="font-semibold text-orchid underline">
            abrir WhatsApp
          </a>
          )
        </>
      )}{" "}
      o acude a recepción en el gym. Respondemos en un máximo de 20 días hábiles.
    </p>
  );
}

/** /privacidad — Aviso de privacidad (lo exige Google Play y la LFPDPPP). */
export function PrivacyPage() {
  return (
    <LegalLayout title="Aviso de privacidad">
      <section>
        <h2>Quiénes somos</h2>
        <p>
          <b>BÁALAM GYM</b> es responsable del tratamiento de los datos personales que recabamos en esta app (web y
          Android). La app es desarrollada y operada por <b>Lumira Solutions Mx</b> por encargo del gym.
        </p>
      </section>

      <section>
        <h2>Qué datos recabamos</h2>
        <ul>
          <li><b>Cuenta:</b> nombre, correo, teléfono (WhatsApp) y contraseña (guardada cifrada; nadie puede verla).</li>
          <li>
            <b>Si entras con Google:</b> Google nos comparte tu nombre, correo y foto de perfil. No recibimos tu contraseña
            de Google ni otros datos de tu cuenta.
          </li>
          <li><b>Perfil (opcional):</b> foto, fecha de nacimiento, sexo, estatura, objetivo y peso meta.</li>
          <li><b>Membresía:</b> plan, fechas de vigencia y pagos registrados por recepción.</li>
          <li><b>Uso del gym:</b> asistencias (registro con QR), reservas de horarios y puntos del podio.</li>
          <li><b>Entrenamiento:</b> rutinas, series, pesos y repeticiones que registras, y calorías estimadas.</li>
          <li><b>Progreso (opcional):</b> peso, medidas corporales y fotos de progreso.</li>
          <li><b>Nutrición e hidratación (opcional):</b> alimentos que registras, metas de calorías y agua tomada.</li>
          <li><b>Avisos:</b> si los activas, un identificador del navegador o celular para enviarte notificaciones.</li>
          <li><b>Datos técnicos:</b> dirección IP y tipo de navegador, que se usan solo para que la app funcione y sea segura.</li>
        </ul>
        <p>
          Algunos de estos datos (peso, medidas, fotos, alimentación) son <b>datos de salud</b>. Solo los registras si tú
          quieres y se usan únicamente para mostrarte tu avance y para que tu coach te dé seguimiento.
        </p>
      </section>

      <section>
        <h2>Para qué los usamos</h2>
        <ul>
          <li>Darte acceso a la app, validar tu membresía y registrar tu asistencia.</li>
          <li>Que tu coach te asigne rutinas y metas y vea tu progreso.</li>
          <li>Mostrarte tu avance, tu IMC, tus calorías estimadas y tu podio.</li>
          <li>Enviarte avisos que tú elijas (agua, comidas, entrenamiento, sesiones, medidas) y correos para recuperar tu contraseña.</li>
          <li>Llevar la administración del gym (pagos, vencimientos y estadísticas de asistencia).</li>
        </ul>
        <p>
          <b>No vendemos ni rentamos tus datos</b>, no mostramos publicidad y no usamos tus datos para perfilarte con fines
          comerciales.
        </p>
      </section>

      <section>
        <h2>Quién más puede verlos</h2>
        <ul>
          <li><b>El personal del gym</b> (coach y recepción) ve tu perfil, membresía, asistencias, rutinas y progreso.</li>
          <li>
            <b>Otros miembros</b> solo ven tu nombre, foto y puntos en el podio (puedes ocultarte en Perfil), y tu nombre y
            foto el día de tu cumpleaños.
          </li>
        </ul>
        <p>Usamos estos proveedores para que la app funcione; solo reciben lo necesario para su servicio:</p>
        <ul>
          <li><b>Railway</b> (Estados Unidos): alojamiento del servidor y la base de datos.</li>
          <li><b>Servicios de notificaciones</b> de Google, Apple o Mozilla: entregan los avisos a tu celular.</li>
          <li><b>Google</b>: si eliges “Continuar con Google”, para comprobar tu identidad.</li>
          <li><b>Un proveedor de correo electrónico</b>: envío de correos para recuperar tu contraseña.</li>
          <li><b>Google Fonts</b>: tipografías de la app.</li>
          <li>
            <b>Open Food Facts</b> y <b>USDA FoodData Central</b>: cuando buscas un alimento, solo se envía el texto que
            buscaste, sin tus datos.
          </li>
        </ul>
        <p>
          Algunos de estos proveedores están fuera de México; al usar la app aceptas esa transferencia, que se hace con
          medidas de seguridad. No compartimos tus datos con nadie más, salvo que lo exija una autoridad.
        </p>
      </section>

      <section>
        <h2>Cómo los protegemos</h2>
        <p>
          Toda la comunicación va cifrada (HTTPS), las contraseñas se guardan cifradas y las fotos solo se pueden ver con
          sesión iniciada. Solo el personal autorizado del gym tiene acceso al panel de administración.
        </p>
      </section>

      <section>
        <h2>Cuánto tiempo los guardamos</h2>
        <p>
          Mientras tengas cuenta. Los registros de comida se borran automáticamente después de 30 días y los de agua y
          avisos después de 90. Si eliminas tu cuenta, borramos tus datos personales y de uso; solo conservamos, sin tu
          nombre ni datos de contacto, los pagos y asistencias que el gym necesita para su contabilidad.
        </p>
      </section>

      <section>
        <h2>Tus derechos</h2>
        <p>
          Puedes <b>acceder</b> a tus datos y <b>corregirlos</b> en la app (Perfil y Mi progreso), <b>borrar</b> registros
          concretos, desactivar avisos, ocultarte del podio y <b>eliminar tu cuenta</b> en{" "}
          <Link to="/eliminar-cuenta" className="font-semibold text-orchid underline">
            Eliminar mi cuenta
          </Link>
          . Para cualquier otra solicitud (por ejemplo, oponerte a algún uso o revocar tu consentimiento):
        </p>
        <Contact />
      </section>

      <section>
        <h2>Menores de edad</h2>
        <p>La app no está dirigida a menores de 13 años. Si eres menor de 18, úsala con permiso de tu madre, padre o tutor.</p>
      </section>

      <section>
        <h2>Cambios a este aviso</h2>
        <p>Si cambiamos este aviso, lo publicaremos en esta página con la nueva fecha de actualización.</p>
      </section>
    </LegalLayout>
  );
}

/** /eliminar-cuenta — Cómo eliminar tu cuenta, con formulario (Google Play exige un enlace web). */
export function DeleteAccountPage() {
  const qc = useQueryClient();
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [confirm, setConfirm] = useState(false);

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    setBusy(true);
    try {
      await unwrap(api.POST("/api/auth/login", { body: { email: String(f.get("email")), password: String(f.get("password")) } }));
      await unwrap(api.POST("/api/me/delete", { body: { password: String(f.get("password")) } }));
      qc.clear();
      setDone(true);
    } catch (err) {
      toast((err as Error).message, "error");
    } finally {
      setBusy(false);
    }
  }

  return (
    <LegalLayout title="Eliminar mi cuenta">
      {done ? (
        <section>
          <h2>Cuenta eliminada</h2>
          <p>Tu cuenta de BÁALAM GYM se eliminó. Si algún día regresas, puedes crear una cuenta nueva con el mismo correo.</p>
        </section>
      ) : (
        <>
          <section>
            <h2>Desde la app</h2>
            <p>
              Entra a <b>Perfil</b> y, al final, toca <b>Eliminar mi cuenta</b>. También puedes hacerlo aquí con tu correo y
              contraseña. Si entras con Google (sin contraseña), hazlo desde la app.
            </p>
          </section>

          <section>
            <h2>Qué se borra</h2>
            <ul>
              <li>Tu nombre, correo, teléfono, foto, fecha de nacimiento y datos de perfil.</li>
              <li>Peso, medidas, fotos de progreso, comidas, agua, rutinas, entrenamientos, puntos y avisos.</li>
            </ul>
            <p>
              Los pagos y asistencias se conservan <b>sin tu nombre ni datos de contacto</b>, solo para la contabilidad del
              gym. Eliminar la cuenta no cancela ni reembolsa tu mensualidad; eso se ve en recepción.
            </p>
          </section>

          <form onSubmit={onSubmit} className="space-y-4 rounded-card border border-line bg-surface p-4">
            <Field label="Correo">
              <Input name="email" type="email" autoComplete="email" required />
            </Field>
            <Field label="Contraseña">
              <PasswordInput name="password" autoComplete="current-password" required />
            </Field>
            <label className="flex items-start gap-3 text-[15px]">
              <input type="checkbox" checked={confirm} onChange={(e) => setConfirm(e.target.checked)} className="mt-1 size-5 accent-[var(--danger)]" />
              Entiendo que esto no se puede deshacer.
            </label>
            <Button type="submit" variant="danger" full icon={Trash2} loading={busy} disabled={!confirm}>
              Eliminar mi cuenta
            </Button>
          </form>

          <section>
            <h2>¿No recuerdas tu contraseña?</h2>
            <p>
              <Link to="/recuperar" className="font-semibold text-orchid underline">
                Recupérala aquí
              </Link>{" "}
              o pide la eliminación a recepción:
            </p>
            <Contact />
          </section>
        </>
      )}
    </LegalLayout>
  );
}
