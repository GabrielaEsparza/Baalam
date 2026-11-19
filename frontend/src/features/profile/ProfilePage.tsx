import { useRef, useState, type FormEvent } from "react";
import { Camera, Loader2 } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import { api, unwrap, upload } from "@/api/client";
import { Avatar } from "@/components/Avatar";
import type { Me } from "@/api/types";
import { applyTheme, useMe, useSetMe } from "@/app/session";
import { Button, Card, Field, Input, PageTitle, SectionTitle, Switch, Tabs } from "@/components/ui";
import { useToast } from "@/components/ui/toast";
import { useLogout } from "@/features/auth/useLogout";

type Patch = Partial<Pick<Me, "full_name" | "phone" | "goal" | "greeting" | "theme" | "show_in_podium" | "share_achievements" | "sex">> & {
  height_cm?: string | null;
  birth_date?: string | null;
};

export default function ProfilePage() {
  const { data: me } = useMe();
  const setMe = useSetMe();
  const qc = useQueryClient();
  const toast = useToast();
  const logout = useLogout();
  const [busy, setBusy] = useState(false);
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  if (!me) return null;
  const coach = me.features.coach;

  async function onPhoto(file?: File) {
    if (!file) return;
    setUploading(true);
    try {
      setMe(await upload<Me>("/api/me/avatar", file));
      toast("Foto actualizada");
    } catch (e) {
      toast((e as Error).message, "error");
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  async function removePhoto() {
    try {
      setMe(await unwrap(api.DELETE("/api/me/avatar")));
      toast("Foto eliminada");
    } catch (e) {
      toast((e as Error).message, "error");
    }
  }

  async function save(patch: Patch, quiet = false) {
    try {
      const next = await unwrap(api.PATCH("/api/me", { body: patch as never }));
      setMe(next);
      qc.invalidateQueries({ queryKey: ["body"] });
      qc.invalidateQueries({ queryKey: ["home"] });
      if (!quiet) toast("Perfil guardado");
    } catch (e) {
      toast((e as Error).message, "error");
    }
  }

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    setBusy(true);
    await save({
      full_name: String(fd.get("full_name")),
      phone: String(fd.get("phone")),
      birth_date: fd.get("birth_date") ? String(fd.get("birth_date")) : null,
      ...(coach
        ? {}
        : {
            goal: String(fd.get("goal")),
            height_cm: fd.get("height_cm") ? String(fd.get("height_cm")).replace(",", ".") : null,
          }),
    });
    setBusy(false);
  }

  return (
    <div>
      <PageTitle accent="perfil">Mi</PageTitle>
      <div className="mb-6 flex items-center gap-4">
        <button
          type="button"
          onClick={() => fileRef.current?.click()}
          className="relative shrink-0 rounded-full"
          aria-label="Cambiar foto de perfil"
        >
          <Avatar url={me.avatar_url} name={me.full_name} size={88} />
          <span className="absolute -bottom-0.5 -right-0.5 grid size-9 place-items-center rounded-full border-2 border-bg bg-night text-white">
            {uploading ? <Loader2 className="size-4 animate-spin" /> : <Camera className="size-4" />}
          </span>
        </button>
        <input
          ref={fileRef}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={(e) => onPhoto(e.target.files?.[0])}
        />
        <div className="min-w-0">
          <p className="truncate text-lg font-semibold text-orchid">{me.full_name}</p>
          <p className="truncate text-[15px] text-ink-2">{me.email}</p>
          <div className="mt-1 flex gap-3 text-sm font-semibold">
            <button type="button" onClick={() => fileRef.current?.click()} className="text-orchid hover:underline">
              {me.avatar_url ? "Cambiar foto" : "Subir foto"}
            </button>
            {me.avatar_url && (
              <button type="button" onClick={removePhoto} className="text-ink-2 hover:underline">
                Quitar
              </button>
            )}
          </div>
        </div>
      </div>

      <form onSubmit={submit} className="space-y-4">
        <Field label="Nombre">
          <Input name="full_name" defaultValue={me.full_name} required />
        </Field>
        <Field label="Teléfono">
          <Input name="phone" type="tel" inputMode="tel" defaultValue={me.phone} />
        </Field>
        {coach ? (
          <Field label="Cumpleaños">
            <Input name="birth_date" type="date" defaultValue={me.birth_date ?? ""} max={new Date().toISOString().slice(0, 10)} />
          </Field>
        ) : (
          <>
        <Field label="Objetivo">
          <Input name="goal" defaultValue={me.goal} placeholder="Ej. bajar 5 kg, correr 10 km" />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Estatura (cm)">
            <Input name="height_cm" inputMode="decimal" defaultValue={me.height_cm ?? ""} placeholder="165" />
          </Field>
          <Field label="Cumpleaños">
            <Input name="birth_date" type="date" defaultValue={me.birth_date ?? ""} max={new Date().toISOString().slice(0, 10)} />
          </Field>
        </div>
        <div className="space-y-2">
          <p className="t-label">Sexo</p>
          <Tabs
            value={me.sex || ""}
            onChange={(v) => save({ sex: v as Me["sex"] }, true)}
            options={[
              { value: "f", label: "Mujer" },
              { value: "m", label: "Hombre" },
            ]}
          />
          <p className="text-sm text-ink-2">Solo para calcular tus rangos de salud en Progreso. Tu cumpleaños aparece en Inicio ese día.</p>
        </div>
          </>
        )}
        <Button type="submit" full loading={busy}>
          Guardar
        </Button>
      </form>

      <SectionTitle>Preferencias</SectionTitle>
      <Card className="space-y-5">
        <div className="space-y-2">
          <p className="t-label">¿Cómo te saludamos?</p>
          <Tabs
            value={me.greeting}
            onChange={(v) => save({ greeting: v }, true)}
            options={[
              { value: "a", label: "Bienvenida" },
              { value: "o", label: "Bienvenido" },
              { value: "x", label: "Bienvenidx" },
            ]}
          />
        </div>
        <div className="space-y-2">
          <p className="t-label">Tema</p>
          <Tabs
            value={me.theme}
            onChange={(v) => {
              applyTheme(v);
              save({ theme: v }, true);
            }}
            options={[
              { value: "light", label: "Claro" },
              { value: "dark", label: "Oscuro" },
            ]}
          />
        </div>
        {!me.features.coach && (
          <Switch label="Aparecer en el podio público" checked={me.show_in_podium} onChange={(v) => save({ show_in_podium: v }, true)} />
        )}
      </Card>

      <Button variant="danger" full className="mt-6" onClick={logout}>
        Cerrar sesión
      </Button>
    </div>
  );
}
