import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { Trash2 } from "lucide-react";
import { api, unwrap } from "@/api/client";
import { useMe } from "@/app/session";
import { Button, Field, PasswordInput, Sheet } from "@/components/ui";
import { useToast } from "@/components/ui/toast";

/** Perfil → "Eliminar mi cuenta" (requisito de Google Play). Pide la contraseña para confirmar. */
export function DeleteAccount() {
  const nav = useNavigate();
  const qc = useQueryClient();
  const toast = useToast();
  const { data: me } = useMe();
  const [open, setOpen] = useState(false);
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const needsPassword = !!me;

  async function confirm() {
    setBusy(true);
    try {
      await unwrap(api.POST("/api/me/delete", { body: { password } }));
      qc.clear();
      toast("Tu cuenta se eliminó");
      nav("/", { replace: true });
    } catch (e) {
      toast((e as Error).message, "error");
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <button type="button" onClick={() => setOpen(true)} className="font-medium text-danger hover:underline">
        Eliminar mi cuenta
      </button>
      <Sheet open={open} onClose={() => setOpen(false)} title="Eliminar mi cuenta">
        <div className="space-y-4 text-[15px]">
          <p>
            Se borran tu perfil, foto, peso, medidas, fotos de progreso, comidas, agua, rutinas, entrenamientos, puntos y
            avisos. <b>No se puede deshacer.</b>
          </p>
          <p className="text-ink-2">
            Tus pagos y asistencias se conservan sin tu nombre, solo para la contabilidad del gym. Eliminar la cuenta no
            cancela ni reembolsa tu mensualidad.
          </p>
          {needsPassword && (
            <Field label="Escribe tu contraseña para confirmar">
              <PasswordInput value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" />
            </Field>
          )}
          <Button variant="danger" full icon={Trash2} loading={busy} disabled={needsPassword && !password} onClick={confirm}>
            Eliminar definitivamente
          </Button>
        </div>
      </Sheet>
    </>
  );
}
