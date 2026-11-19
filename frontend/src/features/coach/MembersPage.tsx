import { useState } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { ChevronRight, Search, Users } from "lucide-react";
import { api, unwrap } from "@/api/client";
import { Avatar } from "@/components/Avatar";
import { Card, EmptyState, ErrorBox, Input, PageTitle, Spinner, StatusBadge, cx } from "@/components/ui";
import { fmtDate } from "@/lib/format";

const FILTERS = [
  { value: "", label: "Todos" },
  { value: "active", label: "Activos" },
  { value: "expiring", label: "Por vencer" },
  { value: "expired", label: "Vencidos" },
  { value: "paused", label: "Pausados" },
  { value: "pending", label: "Pendientes" },
];

export default function MembersPage() {
  const [q, setQ] = useState("");
  const [status, setStatus] = useState("");
  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ["coach", "members", q, status],
    queryFn: () => unwrap(api.GET("/api/coach/members", { params: { query: { q, status } } })),
    placeholderData: (prev) => prev,
  });

  return (
    <div>
      <PageTitle>Miembros</PageTitle>
      <div className="relative mb-3">
        <Search className="pointer-events-none absolute left-3.5 top-1/2 size-5 -translate-y-1/2 text-ink-2" />
        <Input
          type="search"
          placeholder="Buscar por nombre, correo o teléfono"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          className="pl-11"
        />
      </div>
      <div className="-mx-4 mb-4 flex gap-2 overflow-x-auto px-4 pb-1">
        {FILTERS.map((f) => (
          <button
            key={f.value}
            onClick={() => setStatus(f.value)}
            className={cx(
              "h-10 shrink-0 rounded-full border px-4 text-sm font-semibold",
              status === f.value ? "border-fire bg-fire text-white" : "border-line bg-surface text-ink-2",
            )}
          >
            {f.label}
          </button>
        ))}
      </div>

      {isLoading ? (
        <Spinner />
      ) : error || !data ? (
        <ErrorBox error={error} onRetry={refetch} />
      ) : data.length === 0 ? (
        <EmptyState icon={Users} text="No hay miembros con ese filtro." />
      ) : (
        <Card className="divide-y divide-line p-0">
          {data.map((m) => (
            <Link key={m.id} to={`/coach/miembros/${m.id}`} className="flex items-center gap-3 px-4 py-3 hover:bg-surface-2">
              <Avatar url={m.avatar_url} name={m.full_name} size={40} />
              <div className="min-w-0 flex-1">
                <p className="truncate font-semibold">{m.full_name}</p>
                <p className="truncate text-sm text-ink-2">
                  {m.plan_name ?? "Sin plan"}
                  {m.last_checkin && ` · vino ${fmtDate(m.last_checkin)}`}
                </p>
              </div>
              <StatusBadge status={m.membership_status} />
              <ChevronRight className="size-5 shrink-0 text-ink-2" />
            </Link>
          ))}
        </Card>
      )}
    </div>
  );
}
