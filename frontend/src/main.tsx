import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { RouterProvider } from "react-router-dom";
import { ApiError } from "@/api/client";
import { router } from "@/app/router";
import { ToastProvider } from "@/components/ui/toast";
import "@/styles/tokens.css";
import { captureLaunchParams } from "@/lib/twa";

captureLaunchParams(); // parámetros que manda la app de Android (antes de que el router lea la URL)

// Tras publicar una versión nueva, una pestaña abierta (o el service worker) puede pedir
// chunks que ya no existen. Recargamos una sola vez para tomar el index.html nuevo.
window.addEventListener("vite:preloadError", (event) => {
  const KEY = "baalam:chunk-reload";
  try {
    const last = Number(sessionStorage.getItem(KEY) ?? 0);
    if (Date.now() - last < 10_000) return; // ya lo intentamos: deja ver el error
    sessionStorage.setItem(KEY, String(Date.now()));
  } catch {
    /* sin storage: recarga igual */
  }
  event.preventDefault();
  window.location.reload();
});

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      retry: (count, e) => !(e instanceof ApiError && e.status >= 400 && e.status < 500) && count < 2,
    },
  },
});

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <ToastProvider>
        <RouterProvider router={router} />
      </ToastProvider>
    </QueryClientProvider>
  </StrictMode>,
);
