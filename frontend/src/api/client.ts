import createClient, { type Middleware } from "openapi-fetch";
import type { paths } from "./schema";

function getCookie(name: string): string | null {
  const m = document.cookie.match(new RegExp(`(?:^|; )${name}=([^;]*)`));
  return m ? decodeURIComponent(m[1]) : null;
}

export class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
    public code?: string,
  ) {
    super(message);
  }
}

const csrf: Middleware = {
  async onRequest({ request }) {
    if (request.method !== "GET" && request.method !== "HEAD") {
      let token = getCookie("csrftoken");
      if (!token) {
        await fetch("/api/auth/csrf", { credentials: "include" });
        token = getCookie("csrftoken");
      }
      if (token) request.headers.set("X-CSRFToken", token);
    }
    return request;
  },
};

export const api = createClient<paths>({ baseUrl: "", credentials: "include" });
api.use(csrf);

type Result<T> = { data?: T; error?: unknown; response: Response };

/** Desenvuelve la respuesta de openapi-fetch o lanza ApiError con el mensaje del servidor. */
export async function unwrap<T>(p: Promise<Result<T>>): Promise<T> {
  let res: Result<T>;
  try {
    res = await p;
  } catch {
    throw new ApiError("Sin conexión. Revisa tu señal e intenta de nuevo.", 0, "offline");
  }
  if (res.error !== undefined || !res.response.ok) {
    const e = res.error as { detail?: unknown; code?: string } | undefined;
    let msg = "Algo salió mal. Intenta de nuevo.";
    if (typeof e?.detail === "string") msg = e.detail;
    else if (Array.isArray(e?.detail)) msg = "Revisa los datos del formulario.";
    throw new ApiError(msg, res.response.status, e?.code);
  }
  return res.data as T;
}

/** Subida de archivos (multipart) con sesión y CSRF. */
export async function upload<T>(url: string, file: File, method: "POST" | "PUT" = "POST"): Promise<T> {
  let token = getCookie("csrftoken");
  if (!token) {
    await fetch("/api/auth/csrf", { credentials: "include" });
    token = getCookie("csrftoken");
  }
  const fd = new FormData();
  fd.append("file", file);
  let res: Response;
  try {
    res = await fetch(url, { method, body: fd, credentials: "include", headers: token ? { "X-CSRFToken": token } : {} });
  } catch {
    throw new ApiError("Sin conexión. Revisa tu señal e intenta de nuevo.", 0, "offline");
  }
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(typeof body.detail === "string" ? body.detail : "No se pudo subir el archivo.", res.status, body.code);
  return body as T;
}
