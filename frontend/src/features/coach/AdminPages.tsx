import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Megaphone, Pencil, Pin, Plus, Trash2 } from "lucide-react";
import { api, unwrap } from "@/api/client";
import type { Announcement, Plan, Settings } from "@/api/types";
import { Button, Card, EmptyState, ErrorBox, Field, Input, PageTitle, Sheet, Spinner, Stepper, Switch } from "@/components/ui";
import { useToast } from "@/components/ui/toast";
import { fmtDate, fmtMoney } from "@/lib/format";

/* ---------------- Planes ---------------- */
type PlanForm = Omit<Plan, "id" | "price_mxn"> & { id?: number; price_mxn: string };

export function PlansPage() {
  const { data, isLoading } = useQuery({ queryKey: ["coach", "plans"], queryFn: () => unwrap(api.GET("/api/coach/plans")) });
  const [edit, setEdit] = useState<PlanForm | null>(null);
  const qc = useQueryClient();
  const toast = useToast();
  const save = useMutation({
    mutationFn: ({ id, ...body }: PlanForm) =>
      unwrap(
        id
          ? api.PUT("/api/coach/plans/{plan_id}", { params: { path: { plan_id: id } }, body: body as never })
          : api.POST("/api/coach/plans", { body: body as never }),
      ),
    onSuccess: () => {
      toast("Plan guardado");
      qc.invalidateQueries({ queryKey: ["coach", "plans"] });
      qc.invalidateQueries({ queryKey: ["gym"] });
      setEdit(null);
    },
    onError: (e) => toast((e as Error).message, "error"),
  });

  return (
    <div>
      <PageTitle accent="pagos" sub="Los pagos se registran desde la ficha de cada miembro.">
        Planes y
      </PageTitle>
      {isLoading ? (
        <Spinner />
      ) : (
        <div className="space-y-3">
          {(data ?? []).map((p) => (
            <Card key={p.id} className={p.active ? "" : "opacity-50"}>
              <div className="flex items-start justify-between">
                <div>
                  <p className="t-h2">{p.name}</p>
                  <p className="text-xl font-extrabold">{fmtMoney(p.price_mxn)} <span className="text-sm font-medium text-ink-2">/ {p.duration_months} mes</span></p>
                </div>
                <Button variant="ghost" size="sm" icon={Pencil} onClick={() => setEdit({ ...p, price_mxn: String(p.price_mxn) })}>
                  Editar
                </Button>
              </div>
              <p className="mt-2 text-sm text-ink-2">
                {[p.includes_routine && "Rutina personalizada", p.includes_open_gym && "Piso libre", p.includes_classes && "Clases"].filter(Boolean).join(" · ")}
              </p>
            </Card>
          ))}
          <Button
            variant="secondary"
            full
            icon={Plus}
            onClick={() =>
              setEdit({
                name: "",
                price_mxn: "",
                duration_months: 1,
                includes_routine: false,
                includes_open_gym: false,
                includes_classes: false,
                default_sessions_per_week: 3,
                benefits: [],
                active: true,
              })
            }
          >
            Nuevo plan
          </Button>
        </div>
      )}
      <Sheet open={!!edit} onClose={() => setEdit(null)} title={edit?.id ? "Editar plan" : "Nuevo plan"}>
        {edit && (
          <div className="space-y-4">
            <Field label="Nombre">
              <Input value={edit.name} onChange={(e) => setEdit({ ...edit, name: e.target.value })} />
            </Field>
            <Field label="Precio mensual (MXN)">
              <Input inputMode="decimal" value={edit.price_mxn} onChange={(e) => setEdit({ ...edit, price_mxn: e.target.value })} />
            </Field>
            <div>
              <p className="t-label mb-1.5">Días por semana (por defecto)</p>
              <Stepper value={edit.default_sessions_per_week ?? 3} min={1} max={7} onChange={(v) => setEdit({ ...edit, default_sessions_per_week: v })} />
            </div>
            <Switch label="Rutina personalizada" checked={!!edit.includes_routine} onChange={(v) => setEdit({ ...edit, includes_routine: v })} />
            <Switch label="Turnos de piso libre" checked={!!edit.includes_open_gym} onChange={(v) => setEdit({ ...edit, includes_open_gym: v })} />
            <Switch label="Clases" checked={!!edit.includes_classes} onChange={(v) => setEdit({ ...edit, includes_classes: v })} />
            <Field label="Beneficios (uno por línea)">
              <textarea
                rows={3}
                value={(edit.benefits ?? []).join("\n")}
                onChange={(e) => setEdit({ ...edit, benefits: e.target.value.split("\n") })}
                className="w-full rounded-input border border-line bg-surface-2 p-3 text-base focus:border-orchid focus:outline-none"
              />
            </Field>
            <Switch label="Activo" checked={!!edit.active} onChange={(v) => setEdit({ ...edit, active: v })} />
            <Button
              full
              loading={save.isPending}
              disabled={!edit.name || !edit.price_mxn}
              onClick={() => save.mutate({ ...edit, benefits: (edit.benefits ?? []).map((b) => b.trim()).filter(Boolean) })}
            >
              Guardar
            </Button>
          </div>
        )}
      </Sheet>
    </div>
  );
}

/* ---------------- Avisos ---------------- */
export function AnnouncementsPage() {
  const qc = useQueryClient();
  const toast = useToast();
  const { data, isLoading } = useQuery({
    queryKey: ["coach", "announcements"],
    queryFn: () => unwrap(api.GET("/api/coach/announcements")),
  });
  const [edit, setEdit] = useState<Announcement | null>(null);
  const done = () => {
    qc.invalidateQueries({ queryKey: ["coach", "announcements"] });
    qc.invalidateQueries({ queryKey: ["announcements"] });
    qc.invalidateQueries({ queryKey: ["home"] });
  };
  const save = useMutation({
    mutationFn: (a: Announcement) =>
      unwrap(
        a.id
          ? api.PUT("/api/coach/announcements/{ann_id}", { params: { path: { ann_id: a.id } }, body: a })
          : api.POST("/api/coach/announcements", { body: a }),
      ),
    onSuccess: () => {
      toast("Aviso publicado");
      setEdit(null);
      done();
    },
    onError: (e) => toast((e as Error).message, "error"),
  });
  const del = useMutation({
    mutationFn: (id: number) => unwrap(api.DELETE("/api/coach/announcements/{ann_id}", { params: { path: { ann_id: id } } })),
    onSuccess: () => {
      toast("Aviso borrado");
      setEdit(null);
      done();
    },
  });

  return (
    <div>
      <PageTitle>Avisos</PageTitle>
      <Button full icon={Plus} onClick={() => setEdit({ title: "", body: "", pinned: false })}>
        Nuevo aviso
      </Button>
      <div className="mt-4 space-y-3">
        {isLoading ? (
          <Spinner />
        ) : (data ?? []).length === 0 ? (
          <EmptyState icon={Megaphone} text="Publica un aviso: aparece arriba en el Inicio de todos hasta que lo borres." />
        ) : (
          data!.map((a) => (
            <button key={a.id} onClick={() => setEdit(a)} className="card block w-full text-left hover:bg-surface-2">
              <p className="flex items-center gap-1.5 text-sm text-ink-2">
                {a.pinned && <Pin className="size-4 text-fire" />}
                {a.publish_at && fmtDate(a.publish_at, { day: "numeric", month: "short" })}
              </p>
              <p className="font-semibold">{a.title}</p>
            </button>
          ))
        )}
      </div>
      <Sheet open={!!edit} onClose={() => setEdit(null)} title={edit?.id ? "Editar aviso" : "Nuevo aviso"}>
        {edit && (
          <div className="space-y-4">
            <Field label="Título">
              <Input value={edit.title} onChange={(e) => setEdit({ ...edit, title: e.target.value })} maxLength={120} />
            </Field>
            <Field label="Mensaje">
              <textarea
                rows={4}
                value={edit.body ?? ""}
                onChange={(e) => setEdit({ ...edit, body: e.target.value })}
                className="w-full rounded-input border border-line bg-surface-2 p-3 text-base focus:border-orchid focus:outline-none"
              />
            </Field>
            <Switch label="Fijar arriba" checked={!!edit.pinned} onChange={(v) => setEdit({ ...edit, pinned: v })} />
            <Button full loading={save.isPending} disabled={!edit.title} onClick={() => save.mutate(edit)}>
              Publicar
            </Button>
            {edit.id && (
              <Button variant="danger" full icon={Trash2} onClick={() => del.mutate(edit.id!)}>
                Borrar
              </Button>
            )}
          </div>
        )}
      </Sheet>
    </div>
  );
}

/* ---------------- Ajustes del gym ---------------- */
export function SettingsPage() {
  const toast = useToast();
  const qc = useQueryClient();
  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ["coach", "settings"],
    queryFn: () => unwrap(api.GET("/api/coach/settings")),
  });
  const [s, setS] = useState<Settings | null>(null);
  const cur = s ?? data;
  const save = useMutation({
    mutationFn: (body: Settings) => unwrap(api.PUT("/api/coach/settings", { body })),
    onSuccess: () => {
      toast("Ajustes guardados");
      qc.invalidateQueries({ queryKey: ["gym"] });
      setS(null);
      refetch();
    },
    onError: (e) => toast((e as Error).message, "error"),
  });
  if (isLoading) return <Spinner />;
  if (error || !cur) return <ErrorBox error={error} onRetry={refetch} />;
  const set = (p: Partial<Settings>) => setS({ ...cur, ...p });

  return (
    <div className="space-y-4">
      <PageTitle accent="gym">Ajustes del</PageTitle>
      <Field label="Nombre">
        <Input value={cur.name} onChange={(e) => set({ name: e.target.value })} />
      </Field>
      <Field label="WhatsApp" hint="Con lada de país, solo números. Ej. 5216691234567">
        <Input inputMode="tel" value={cur.whatsapp} onChange={(e) => set({ whatsapp: e.target.value.replace(/\D/g, "") })} />
      </Field>
      <Field label="Dirección">
        <Input value={cur.address} onChange={(e) => set({ address: e.target.value })} />
      </Field>
      <Field label="Link de Google Maps">
        <Input type="url" value={cur.maps_url} onChange={(e) => set({ maps_url: e.target.value })} />
      </Field>
      <Field label="Horario de apertura">
        <textarea
          rows={2}
          value={cur.hours}
          onChange={(e) => set({ hours: e.target.value })}
          className="w-full rounded-input border border-line bg-surface-2 p-3 text-base focus:border-orchid focus:outline-none"
        />
      </Field>
      <Card className="space-y-4">
        <Row label="Días de gracia tras vencer">
          <Stepper value={cur.grace_days} min={0} max={15} onChange={(v) => set({ grace_days: v })} />
        </Row>
        <Row label="Aviso de 'por vencer' (días antes)">
          <Stepper value={cur.expiring_days} min={1} max={15} onChange={(v) => set({ expiring_days: v })} />
        </Row>
        <Row label="Cambios de reserva hasta (horas antes)">
          <Stepper value={cur.change_deadline_hours} min={0} max={24} onChange={(v) => set({ change_deadline_hours: v })} />
        </Row>
        <Row label="Check-in desde (minutos antes)">
          <Stepper value={cur.checkin_early_min} min={0} max={120} step={5} onChange={(v) => set({ checkin_early_min: v })} />
        </Row>
        <Row label="Día que abre la reserva del mes siguiente">
          <Stepper value={cur.booking_open_day} min={1} max={28} onChange={(v) => set({ booking_open_day: v })} />
        </Row>
      </Card>
      <Button full loading={save.isPending} disabled={!s} onClick={() => s && save.mutate(s)}>
        Guardar ajustes
      </Button>
    </div>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <p className="text-[15px] font-medium">{label}</p>
      {children}
    </div>
  );
}
