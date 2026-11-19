import { useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { api } from "@/api/client";

export function useLogout() {
  const qc = useQueryClient();
  const nav = useNavigate();
  return async () => {
    try {
      await api.POST("/api/auth/logout");
    } finally {
      qc.clear();
      qc.setQueryData(["me"], null);
      nav("/login", { replace: true });
    }
  };
}
