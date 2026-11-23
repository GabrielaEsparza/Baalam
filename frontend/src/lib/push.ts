/** Avisos al celular (Web Push): permiso, suscripción y detección de plataforma. */
import { api, unwrap } from "@/api/client";

export const pushSupported = () =>
  typeof window !== "undefined" && "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;

export const isIOS = () =>
  /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);

/** En iPhone los avisos solo funcionan con la app instalada en la pantalla de inicio. */
export const isStandalone = () =>
  window.matchMedia?.("(display-mode: standalone)").matches ||
  (navigator as unknown as { standalone?: boolean }).standalone === true;

function keyToBytes(base64: string) {
  const pad = "=".repeat((4 - (base64.length % 4)) % 4);
  const raw = atob((base64 + pad).replace(/-/g, "+").replace(/_/g, "/"));
  return Uint8Array.from(raw, (c) => c.charCodeAt(0));
}

export async function currentSubscription(): Promise<PushSubscription | null> {
  if (!pushSupported()) return null;
  const reg = await navigator.serviceWorker.getRegistration();
  return (await reg?.pushManager.getSubscription()) ?? null;
}

/** Pide permiso y registra este dispositivo. Devuelve el permiso final. */
export async function enablePush(): Promise<NotificationPermission> {
  const permission = await Notification.requestPermission();
  if (permission !== "granted") return permission;
  const { key } = (await unwrap(api.GET("/api/push/key"))) as { key: string | null };
  if (!key) throw new Error("Los avisos aún no están disponibles. Intenta más tarde.");
  const reg = await navigator.serviceWorker.ready;
  const sub =
    (await reg.pushManager.getSubscription()) ??
    (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyToBytes(key) }));
  const json = sub.toJSON();
  await unwrap(
    api.POST("/api/push/subscriptions", {
      body: { endpoint: sub.endpoint, p256dh: json.keys?.p256dh ?? "", auth: json.keys?.auth ?? "" },
    }),
  );
  return permission;
}

export async function disablePush() {
  const sub = await currentSubscription();
  if (!sub) return;
  await unwrap(api.DELETE("/api/push/subscriptions", { body: { endpoint: sub.endpoint } })).catch(() => {});
  await sub.unsubscribe();
}
