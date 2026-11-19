import { useState, type FormEvent, type ReactNode } from "react";
import { Link, Navigate, useLocation, useNavigate, useSearchParams } from "react-router-dom";
import { ArrowLeft } from "lucide-react";
import { api, unwrap } from "@/api/client";
import { useMe, useSetMe } from "@/app/session";
import { Button, Field, Input } from "@/components/ui";

function AuthLayout({ title, accent, children }: { title: string; accent?: string; children: ReactNode }) {
  return (
    <div className="min-h-dvh bg-bg">
      <div className="mx-auto flex min-h-dvh max-w-md flex-col px-4 pb-8 pt-4">
        <Link to="/" aria-label="Volver" className="grid size-11 place-items-center rounded-full hover:bg-surface-2">
          <ArrowLeft className="size-5" />
        </Link>
        <img src="/logo.webp" alt="BÁALAM GYM" className="mx-auto mt-2 size-28 rounded-full" />
        <h1 className="t-display mt-6 text-center">
          {title} {accent && <span className="text-fire">{accent}</span>}
        </h1>
        <div className="mt-8 flex-1">{children}</div>
      </div>
    </div>
  );
}

function FormError({ msg }: { msg: string | null }) {
  if (!msg) return null;
  return (
    <p role="alert" className="rounded-input bg-danger/10 px-3.5 py-3 text-[15px] font-medium text-danger">
      {msg}
    </p>
  );
}

export function LoginPage() {
  const { data: me } = useMe();
  const setMe = useSetMe();
  const nav = useNavigate();
  const loc = useLocation() as { state?: { from?: string; msg?: string } };
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (me) return <Navigate to="/app" replace />;

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    setBusy(true);
    setErr(null);
    try {
      const me = await unwrap(
        api.POST("/api/auth/login", {
          body: { email: String(fd.get("email")), password: String(fd.get("password")) },
        }),
      );
      setMe(me);
      nav(me.features.coach ? "/coach" : (loc.state?.from ?? "/app"), { replace: true });
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <AuthLayout title="Hola de" accent="nuevo">
      <form onSubmit={submit} className="space-y-4">
        <Field label="Correo">
          <Input name="email" type="email" autoComplete="email" required inputMode="email" />
        </Field>
        <Field label="Contraseña">
          <Input name="password" type="password" autoComplete="current-password" required />
        </Field>
        {loc.state?.msg && !err && (
          <p role="status" className="rounded-input bg-success/10 px-3 py-2 text-[15px] font-medium text-success">
            {loc.state.msg}
          </p>
        )}
        <FormError msg={err} />
        <Button type="submit" full loading={busy}>
          Entrar
        </Button>
        <div className="flex justify-between pt-2 text-[15px]">
          <Link to="/recuperar" className="font-medium text-orchid hover:underline">
            Olvidé mi contraseña
          </Link>
          <Link to="/registro" className="font-medium text-orchid hover:underline">
            Crear cuenta
          </Link>
        </div>
      </form>
    </AuthLayout>
  );
}

export function RegisterPage() {
  const setMe = useSetMe();
  const nav = useNavigate();
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    setBusy(true);
    setErr(null);
    try {
      const me = await unwrap(
        api.POST("/api/auth/register", {
          body: {
            full_name: String(fd.get("full_name")),
            email: String(fd.get("email")),
            phone: String(fd.get("phone")).replace(/\D/g, ""),
            password: String(fd.get("password")),
          },
        }),
      );
      setMe(me);
      nav("/app", { replace: true });
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <AuthLayout title="Crea tu" accent="cuenta">
      <form onSubmit={submit} className="space-y-4">
        <Field label="Nombre completo">
          <Input name="full_name" autoComplete="name" required minLength={2} />
        </Field>
        <Field label="Correo">
          <Input name="email" type="email" autoComplete="email" required inputMode="email" />
        </Field>
        <Field label="Teléfono (WhatsApp)">
          <Input name="phone" type="tel" autoComplete="tel" required inputMode="tel" minLength={10} />
        </Field>
        <Field label="Contraseña" hint="Mínimo 8 caracteres.">
          <Input name="password" type="password" autoComplete="new-password" required minLength={8} />
        </Field>
        <FormError msg={err} />
        <Button type="submit" full loading={busy}>
          Crear cuenta
        </Button>
        <p className="text-center text-sm text-ink-2">Tu coach aprobará tu cuenta cuando registres tu primer pago.</p>
      </form>
    </AuthLayout>
  );
}

export function RecoverPage() {
  const [params] = useSearchParams();
  const uid = params.get("uid");
  const token = params.get("token");
  const isNew = params.get("nuevo") === "1";
  const nav = useNavigate();
  const [err, setErr] = useState<string | null>(null);
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    setBusy(true);
    setErr(null);
    try {
      if (uid && token) {
        await unwrap(
          api.POST("/api/auth/password-reset/confirm", {
            body: { uid, token, password: String(fd.get("password")) },
          }),
        );
        nav("/login", { replace: true, state: { msg: isNew ? "¡Listo! Ya puedes entrar con tu correo y tu contraseña." : "Contraseña guardada. Ya puedes entrar." } });
      } else {
        await unwrap(api.POST("/api/auth/password-reset", { body: { email: String(fd.get("email")) } }));
        setSent(true);
      }
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <AuthLayout title={isNew ? "Crea tu" : "Recupera tu"} accent={isNew ? "contraseña" : "acceso"}>
      {sent ? (
        <p className="text-center text-[15px] text-ink-2">
          Si el correo existe, te enviamos un enlace para crear una nueva contraseña. Revisa tu bandeja y spam.
        </p>
      ) : (
        <form onSubmit={submit} className="space-y-4">
          {uid && token ? (
            <Field label={isNew ? "Tu contraseña" : "Nueva contraseña"} hint="Mínimo 8 caracteres.">
              <Input name="password" type="password" autoComplete="new-password" required minLength={8} />
            </Field>
          ) : (
            <Field label="Correo">
              <Input name="email" type="email" autoComplete="email" required inputMode="email" />
            </Field>
          )}
          <FormError msg={err} />
          <Button type="submit" full loading={busy}>
            {uid ? (isNew ? "Crear contraseña" : "Guardar contraseña") : "Enviar enlace"}
          </Button>
        </form>
      )}
    </AuthLayout>
  );
}
