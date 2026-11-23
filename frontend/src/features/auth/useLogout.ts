import { useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { api } from "@/api/client";
import { disablePush } from "@/lib/push";
import { disableFcm, fcmOn } from "@/lib/twa";

export function useLogout() {
  const qc = useQueryClient();
  const nav = useNavigate();
  return async () => {
    try {
      // Este celular deja de recibir los avisos de esta cuenta (por si entra otra persona).
      if (fcmOn()) await disableFcm();
      await disablePush().catch(() => {});
      await api.POST("/api/auth/logout");
    } finally {
      qc.clear();
      qc.setQueryData(["me"], null);
      nav("/login", { replace: true });
    }
  };
}
