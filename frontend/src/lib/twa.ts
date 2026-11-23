/** App de Android (Play Store): abre esta web a pantalla completa y le pasa, en la URL de inicio,
 *  `twa=1` y su identificador de Firebase (`fcm_token`) para recibir avisos nativos. */
import { api, unwrap } from "@/api/client";

const K_TWA = "baalam.twa";
const K_TOKEN = "baalam.fcm.token";
const K_ON = "baalam.fcm.on"; // la persona activó los avisos en la app
const K_SENT = "baalam.fcm.sent"; // `${userId}:${token}` ya registrado en el servidor

const get = (k: string) => {
  try {
    return localStorage.getItem(k);
  } catch {
    return null;
  }
};
const put = (k: string, v: string | null) => {
  try {
    if (v === null) localStorage.removeItem(k);
    else localStorage.setItem(k, v);
  } catch {
    /* almacenamiento bloqueado */
  }
};

/** Se llama una vez al cargar: guarda los parámetros de la app y los quita de la barra de dirección. */
export function captureLaunchParams() {
  const url = new URL(window.location.href);
  const twa = url.searchParams.get("twa");
  const token = url.searchParams.get("fcm_token");
  if (!twa && !token) return;
  if (twa === "1") put(K_TWA, "1");
  if (token) put(K_TOKEN, token);
  url.searchParams.delete("twa");
  url.searchParams.delete("fcm_token");
  window.history.replaceState(window.history.state, "", url.pathname + url.search + url.hash);
}

export const isAndroidApp = () => get(K_TWA) === "1" || document.referrer.startsWith("android-app://");
export const fcmToken = () => get(K_TOKEN);
export const fcmOn = () => get(K_ON) === "1";

/** Registra el celular en el servidor para esta cuenta (si cambió el token o la cuenta). */
export async function syncFcm(userId: number, force = false) {
  const token = fcmToken();
  if (!token || (!force && !fcmOn())) return false;
  const key = `${userId}:${token}`;
  if (!force && get(K_SENT) === key) return true;
  await unwrap(api.POST("/api/push/fcm", { body: { token } }));
  put(K_SENT, key);
  put(K_ON, "1");
  return true;
}

export async function disableFcm() {
  const token = fcmToken();
  put(K_ON, null);
  put(K_SENT, null);
  if (token) await unwrap(api.DELETE("/api/push/fcm", { body: { token } })).catch(() => {});
}
