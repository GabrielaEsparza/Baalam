import { useState } from "react";
import { Dumbbell } from "lucide-react";
import { cx } from "./ui";

export interface ExerciseLike {
  name: string;
  gif_url?: string | null;
  video_url?: string | null;
  image_urls?: string[] | null;
}

function youtubeId(url: string) {
  const m = url.match(/(?:youtu\.be\/|v=|shorts\/|embed\/)([\w-]{11})/);
  return m?.[1] ?? null;
}

/** GIF en bucle (lazy). Si el coach subió video, el video tiene prioridad.
 *  Si el GIF no carga, se muestra un respaldo. Nunca se modifica la URL del GIF. */
export function ExerciseMedia({
  ex,
  className,
  preferVideo = false,
}: {
  ex: ExerciseLike;
  className?: string;
  preferVideo?: boolean;
}) {
  const [broken, setBroken] = useState(false);
  const yt = preferVideo && ex.video_url ? youtubeId(ex.video_url) : null;

  if (yt) {
    return (
      <iframe
        className={cx("aspect-square w-full rounded-card bg-black", className)}
        src={`https://www.youtube-nocookie.com/embed/${yt}?rel=0&playsinline=1`}
        title={ex.name}
        allow="encrypted-media; picture-in-picture"
        allowFullScreen
      />
    );
  }
  if (preferVideo && ex.video_url && !yt) {
    return <video className={cx("aspect-square w-full rounded-card bg-black object-cover", className)} src={ex.video_url} autoPlay loop muted playsInline />;
  }
  const src = ex.gif_url || ex.image_urls?.[0];
  if (!src || broken) {
    return (
      <div className={cx("grid aspect-square w-full place-items-center rounded-card bg-surface-2 text-ink-2", className)} aria-label={ex.name}>
        <Dumbbell className="size-1/3 max-h-12 max-w-12" strokeWidth={1.5} />
      </div>
    );
  }
  return (
    // Fondo blanco: los GIF del catálogo vienen sobre blanco, así no "brillan" en modo oscuro como un recorte raro.
    <img
      src={src}
      alt={ex.name}
      loading="lazy"
      decoding="async"
      onError={() => setBroken(true)}
      className={cx("aspect-square w-full rounded-card bg-white object-contain", className)}
    />
  );
}
