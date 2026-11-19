import { useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { ImagePlus, X } from "lucide-react";
import { api, unwrap, upload } from "@/api/client";
import type { Exercise } from "@/api/types";
import { Button, Field, Input, Sheet } from "@/components/ui";
import { useToast } from "@/components/ui/toast";
import { tr } from "@/lib/exercise-i18n";

// Se guardan con las mismas claves del catálogo para que filtros y traducciones coincidan.
const BODY_PARTS = ["chest", "back", "shoulders", "upper arms", "lower arms", "upper legs", "lower legs", "waist", "cardio"];
const EQUIPMENT = [
  "body weight",
  "dumbbell",
  "barbell",
  "kettlebell",
  "cable",
  "leverage machine",
  "smith machine",
  "resistance band",
  "medicine ball",
  "stability ball",
  "rope",
  "tire",
  "sled machine",
];

/** Crear un ejercicio que no está en el catálogo. Devuelve el ejercicio ya guardado. */
export function CustomExerciseSheet({
  open,
  initialName = "",
  onClose,
  onCreated,
}: {
  open: boolean;
  initialName?: string;
  onClose: () => void;
  onCreated: (ex: Exercise) => void;
}) {
  const qc = useQueryClient();
  const toast = useToast();
  const fileRef = useRef<HTMLInputElement>(null);
  const [name, setName] = useState(initialName);
  const [muscle, setMuscle] = useState("");
  const [equipment, setEquipment] = useState("body weight");
  const [tips, setTips] = useState("");
  const [video, setVideo] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [lastOpen, setLastOpen] = useState(false);
  if (open !== lastOpen) {
    setLastOpen(open);
    if (open) {
      setName(initialName);
      setMuscle("");
      setEquipment("body weight");
      setTips("");
      setVideo("");
      setFile(null);
      setPreview(null);
    }
  }

  function pickFile(f?: File) {
    if (!f) return;
    setFile(f);
    setPreview(URL.createObjectURL(f));
  }

  async function save() {
    setBusy(true);
    try {
      let ex = (await unwrap(
        api.POST("/api/coach/exercises", {
          body: { name: name.trim(), muscle_group: muscle, equipment, instructions_es: tips, video_url: video.trim() },
        }),
      )) as unknown as Exercise;
      if (file) ex = await upload<Exercise>(`/api/coach/exercises/${ex.id}/media`, file);
      qc.invalidateQueries({ queryKey: ["coach", "library"] });
      toast("Ejercicio creado en tu biblioteca");
      onCreated(ex);
    } catch (e) {
      toast((e as Error).message, "error");
    } finally {
      setBusy(false);
    }
  }

  const isVideo = file?.type.startsWith("video/");

  return (
    <Sheet open={open} onClose={onClose} title="Ejercicio propio">
      <div className="space-y-4">
        <p className="text-[15px] text-ink-2">Para lo que no encuentres en el catálogo. Se guarda en tu biblioteca.</p>
        <Field label="Nombre">
          <Input value={name} maxLength={120} placeholder="Ej. Burpee con salto al cajón" onChange={(e) => setName(e.target.value)} />
        </Field>

        <div className="grid grid-cols-2 gap-3">
          <Field label="Grupo">
            <select
              value={muscle}
              onChange={(e) => setMuscle(e.target.value)}
              className="h-12 w-full rounded-input border border-line bg-surface-2 px-3 text-base text-ink"
            >
              <option value="">—</option>
              {BODY_PARTS.map((b) => (
                <option key={b} value={b}>
                  {tr(b)}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Equipo">
            <select
              value={equipment}
              onChange={(e) => setEquipment(e.target.value)}
              className="h-12 w-full rounded-input border border-line bg-surface-2 px-3 text-base text-ink"
            >
              {EQUIPMENT.map((b) => (
                <option key={b} value={b}>
                  {tr(b)}
                </option>
              ))}
            </select>
          </Field>
        </div>

        <div className="space-y-1.5">
          <span className="t-label">Foto, GIF o video corto (opcional)</span>
          {preview ? (
            <div className="relative mx-auto w-40">
              {isVideo ? (
                <video src={preview} className="aspect-square w-full rounded-card bg-black object-cover" autoPlay loop muted playsInline />
              ) : (
                <img src={preview} alt="" className="aspect-square w-full rounded-card bg-white object-contain" />
              )}
              <button
                aria-label="Quitar archivo"
                onClick={() => {
                  setFile(null);
                  setPreview(null);
                }}
                className="absolute -right-2 -top-2 grid size-8 place-items-center rounded-full bg-night text-white"
              >
                <X className="size-4" />
              </button>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => fileRef.current?.click()}
              className="flex h-24 w-full flex-col items-center justify-center gap-1 rounded-card border-2 border-dashed border-line text-ink-2 hover:bg-surface-2"
            >
              <ImagePlus className="size-6" />
              <span className="text-sm font-medium">Subir archivo</span>
            </button>
          )}
          <input
            ref={fileRef}
            type="file"
            accept="image/*,video/mp4,video/webm,video/quicktime"
            className="hidden"
            onChange={(e) => pickFile(e.target.files?.[0])}
          />
        </div>

        <Field label="Link de YouTube (opcional)" hint="Si lo pones, se muestra en lugar de la foto.">
          <Input type="url" inputMode="url" value={video} placeholder="https://youtu.be/…" onChange={(e) => setVideo(e.target.value)} />
        </Field>

        <Field label="Indicaciones de técnica (opcional)">
          <textarea
            rows={3}
            value={tips}
            onChange={(e) => setTips(e.target.value)}
            placeholder="2–3 indicaciones cortas"
            className="w-full rounded-input border border-line bg-surface-2 p-3 text-base focus:border-orchid focus:outline-none"
          />
        </Field>

        <Button full loading={busy} disabled={name.trim().length < 2} onClick={save}>
          Crear ejercicio
        </Button>
      </div>
    </Sheet>
  );
}
