import { useState } from "react";
import { cx } from "./ui";

/** Foto de perfil o inicial sobre morado (el morado del anillo es el color de avatares). */
export function Avatar({ url, name, size = 40, className }: { url?: string | null; name: string; size?: number; className?: string }) {
  const [broken, setBroken] = useState(false);
  const style = { width: size, height: size, fontSize: Math.round(size * 0.42) };
  if (url && !broken) {
    return (
      <img
        src={url}
        alt=""
        style={style}
        onError={() => setBroken(true)}
        className={cx("shrink-0 rounded-full object-cover", className)}
      />
    );
  }
  return (
    <span style={style} className={cx("grid shrink-0 place-items-center rounded-full bg-purple font-bold text-white", className)}>
      {(name || "?").trim().slice(0, 1).toUpperCase()}
    </span>
  );
}
