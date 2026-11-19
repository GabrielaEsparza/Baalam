import { useEffect, type ReactNode } from "react";
import { Navigate, useLocation } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api, unwrap, ApiError } from "@/api/client";
import type { Me } from "@/api/types";
import { Spinner } from "@/components/ui";
import { InactiveScreen, isUsable } from "@/features/membership/MembershipNotices";

export const meKey = ["me"] as const;

export function useMe() {
  return useQuery({
    queryKey: meKey,
    queryFn: async () => {
      try {
        return await unwrap(api.GET("/api/me"));
      } catch (e) {
        if (e instanceof ApiError && (e.status === 401 || e.status === 403)) return null; 
        throw e;
      }
    },
    staleTime: 60_000,
  });
}

export function useSetMe() {
  const qc = useQueryClient();
  return (me: Me | null) => qc.setQueryData(meKey, me);
}

export function applyTheme(theme: "light" | "dark") {
  document.documentElement.dataset.theme = theme;
  try {
    localStorage.setItem("baalam-theme", theme);
  } catch {
    /* private mode */
  }
}

export function ThemeSync() {
  const { data: me } = useMe();
  useEffect(() => {
    if (me) applyTheme(me.theme);
  }, [me]);
  return null;
}

export function RequireAuth({ children }: { children: ReactNode }) {
  const { data: me, isLoading } = useMe();
  const loc = useLocation();
  if (isLoading) return <Spinner className="min-h-dvh" />;
  if (!me) return <Navigate to="/login" replace state={{ from: loc.pathname + loc.search }} />;
  return <>{children}</>;
}

/** Pantallas de miembro: el coach no reserva, no hace check-in ni entrena aquí. */
export function RequireMember({ children }: { children: ReactNode }) {
  const { data: me } = useMe();
  if (me?.features.coach) return <Navigate to="/coach" replace />;
  // Sin mensualidad vigente la app no se usa: solo info para renovar.
  if (me && !isUsable(me)) return <InactiveScreen me={me} />;
  return <>{children}</>;
}

export function RequireRole({ role, children }: { role: "coach" | "admin"; children: ReactNode }) {
  const { data: me } = useMe();
  const ok = role === "admin" ? me?.features.admin : me?.features.coach;
  if (!ok) return <Navigate to="/app" replace />;
  return <>{children}</>;
}

export function RequireFeature({
  feature,
  children,
}: {
  feature: "routine" | "open_gym" | "classes";
  children: ReactNode;
}) {
  const { data: me } = useMe();
  if (!me?.features[feature]) return <Navigate to="/app" replace />;
  return <>{children}</>;
}
