import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ChevronRight, Search, UserPlus, Users } from "lucide-react";
import { api, unwrap } from "@/api/client";
import { Avatar } from "@/components/Avatar";
import { Button, Card, EmptyState, ErrorBox, Field, Input, PageTitle, Sheet, Spinner, StatusBadge, cx } from "@/components/ui";
import { useToast } from "@/components/ui/toast";
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
  const [adding, setAdding] = useState(false);
  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ["coach", "members", q, status],
    queryFn: () => unwrap(api.GET("/api/coach/members", { params: { query: { q, status } } })),
    placeholderData: (prev) => prev,
  });

  return (
    <div>
      <PageTitle>Miembros</PageTitle>
      <Button full icon={UserPlus} className="mb-4" onClick={() => setAdding(true)}>
        Agregar miembro
      </Button>
      <AddMemberSheet open={adding} onClose={() => setAdding(false)} />
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
              status === f.value ? "border-fire-fill bg-fire-fill text-on-fire" : "border-line bg-surface text-ink-2",
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

/** Alta desde recepción: nombre, correo y teléfono. La persona crea su contraseña con un enlace. */
function AddMemberSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const nav = useNavigate();
  const qc = useQueryClient();
  const toast = useToast();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");

  const create = useMutation({
    mutationFn: async () =>
      (await unwrap(
        api.POST("/api/coach/members", { body: { full_name: name.trim(), email: email.trim(), phone: phone.trim() } }),
      )) as unknown as { id: number; access_link: string },
    onSuccess: (r) => {
      qc.invalidateQueries({ queryKey: ["coach", "members"] });
      toast("Miembro agregado");
      setName("");
      setEmail("");
      setPhone("");
      onClose();
      nav(`/coach/miembros/${r.id}`, { state: { justCreated: true, accessLink: r.access_link } });
    },
    onError: (e) => toast((e as Error).message, "error"),
  });

  const validEmail = /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email.trim());
  return (
    <Sheet open={open} onClose={onClose} title="Agregar miembro">
      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          if (name.trim().length >= 2 && validEmail) create.mutate();
        }}
      >
        <Field label="Nombre completo">
          <Input value={name} onChange={(e) => setName(e.target.value)} autoComplete="off" required minLength={2} />
        </Field>
        <Field label="Correo" hint="Con este correo entrará a la app.">
          <Input
            type="email"
            inputMode="email"
            autoComplete="off"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
          />
        </Field>
        <Field label="WhatsApp (10 dígitos)" hint="Para mandarle su acceso.">
          <Input
            type="tel"
            inputMode="tel"
            value={phone}
            onChange={(e) => setPhone(e.target.value.replace(/[^\d]/g, "").slice(0, 13))}
          />
        </Field>
        <Button type="submit" full loading={create.isPending} disabled={name.trim().length < 2 || !validEmail}>
          Crear cuenta
        </Button>
        <p className="text-sm text-ink-2">
          Después registras su pago y le mandas por WhatsApp un enlace para que cree su contraseña. Tú nunca la conoces.
        </p>
      </form>
    </Sheet>
  );
}
