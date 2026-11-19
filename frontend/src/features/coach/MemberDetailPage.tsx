import { useState } from "react";
import { Link, useParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Banknote, ClipboardList, MessageCircle, Pause, Play, ShieldCheck, UserCheck } from "lucide-react";
import { Avatar } from "@/components/Avatar";
import { CoachNutritionCard } from "@/features/nutrition/CoachNutritionCard";
import { api, unwrap } from "@/api/client";
import { useMe } from "@/app/session";
import { Button, Card, ErrorBox, Field, Input, SectionTitle, Sheet, Spinner, StatusBadge, Stepper, Tabs } from "@/components/ui";
import { useToast } from "@/components/ui/toast";
import { fmtDate, fmtMoney, fmtTime, methodLabel, waLink } from "@/lib/format";

export default function MemberDetailPage() {
  const id = Number(useParams().id);
  const { data: me } = useMe();
  const isAdmin = !!me?.features.admin;
  const qc = useQueryClient();
  const toast = useToast();
  const [paySheet, setPaySheet] = useState(false);
  const [notes, setNotes] = useState<string | null>(null);

  const key = ["coach", "member", id];
  const { data: m, isLoading, error, refetch } = useQuery({
    queryKey: key,
    queryFn: () => unwrap(api.GET("/api/coach/members/{member_id}", { params: { path: { member_id: id } } })),
  });
  const refresh = () => {
    qc.invalidateQueries({ queryKey: key });
    qc.invalidateQueries({ queryKey: ["coach", "dashboard"] });
    qc.invalidateQueries({ queryKey: ["coach", "members"] });
  };
  const onErr = (e: unknown) => toast((e as Error).message, "error");

  const patch = useMutation({
    mutationFn: (body: { coach_notes?: string; sessions_per_week?: number; role?: "member" | "coach" }) =>
      unwrap(api.PATCH("/api/coach/members/{member_id}", { params: { path: { member_id: id } }, body })),
    onSuccess: () => {
      toast("Guardado");
      refresh();
    },
    onError: onErr,
  });
  const approve = useMutation({
    mutationFn: () => unwrap(api.POST("/api/coach/members/{member_id}/approve", { params: { path: { member_id: id } } })),
    onSuccess: () => {
      toast("Miembro aprobado");
      refresh();
    },
    onError: onErr,
  });
  const checkin = useMutation({
    mutationFn: () => unwrap(api.POST("/api/coach/members/{member_id}/checkin", { params: { path: { member_id: id } } })),
    onSuccess: () => {
      toast("Asistencia registrada");
      refresh();
    },
    onError: onErr,
  });
  const pauseResume = useMutation({
    mutationFn: (action: "pause" | "resume") =>
      unwrap(
        action === "pause"
          ? api.POST("/api/coach/memberships/{membership_id}/pause", { params: { path: { membership_id: m!.membership_id! } } })
          : api.POST("/api/coach/memberships/{membership_id}/resume", { params: { path: { membership_id: m!.membership_id! } } }),
      ),
    onSuccess: () => {
      toast("Membresía actualizada");
      refresh();
    },
    onError: onErr,
  });

  if (isLoading) return <Spinner />;
  if (error || !m) return <ErrorBox error={error} onRetry={refetch} />;
  const payments = m.payments as unknown as { id: number; amount_mxn: string; method: string; paid_at: string; note: string }[];

  return (
    <div>
      <Link to="/coach/miembros" className="mb-2 inline-flex h-11 items-center gap-1 font-medium text-ink-2 hover:text-ink">
        <ArrowLeft className="size-5" /> Miembros
      </Link>
      <div className="mb-5 flex items-center gap-4">
        <Avatar url={m.avatar_url} name={m.full_name} size={64} />
        <div className="min-w-0">
          <h1 className="t-h2 truncate text-orchid">{m.full_name}</h1>
          <p className="truncate text-[15px] text-ink-2">{m.email}</p>
          {m.phone && (
            <a href={waLink(m.phone.length === 10 ? `52${m.phone}` : m.phone, "")} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-[15px] font-semibold text-orchid">
              <MessageCircle className="size-4" /> {m.phone}
            </a>
          )}
        </div>
      </div>

      {/* Membresía */}
      <Card className="space-y-4">
        <div className="flex items-start justify-between">
          <div>
            <p className="t-label">Membresía</p>
            <p className="t-h2">{m.plan_name ?? "Sin plan"}</p>
            {m.end_date && <p className="text-[15px] text-ink-2">Vence {fmtDate(m.end_date, { day: "numeric", month: "long", year: "numeric" })}</p>}
          </div>
          <StatusBadge status={m.membership_status} />
        </div>
        {isAdmin && (
          <Button full icon={Banknote} onClick={() => setPaySheet(true)}>
            Registrar pago
          </Button>
        )}
        <div className="grid grid-cols-2 gap-2">
          <Button variant="secondary" size="sm" icon={UserCheck} loading={checkin.isPending} onClick={() => checkin.mutate()}>
            Check-in manual
          </Button>
          {m.status === "pending" ? (
            <Button variant="secondary" size="sm" loading={approve.isPending} onClick={() => approve.mutate()}>
              Aprobar
            </Button>
          ) : (
            isAdmin &&
            m.membership_id &&
            (m.membership_status === "paused" ? (
              <Button variant="secondary" size="sm" icon={Play} onClick={() => pauseResume.mutate("resume")}>
                Reanudar
              </Button>
            ) : (
              <Button variant="secondary" size="sm" icon={Pause} onClick={() => pauseResume.mutate("pause")}>
                Pausar
              </Button>
            ))
          )}
        </div>
      </Card>

      {m.plan_name && m.role === "member" && (
        <Link to={`/coach/rutinas/${id}`} className="mt-3 block">
          <Button variant="dark" full icon={ClipboardList}>
            Armar su rutina
          </Button>
        </Link>
      )}

      {m.sessions_per_week !== null && (
        <>
          <SectionTitle>Días por semana</SectionTitle>
          <Card>
            <Stepper
              value={m.sessions_per_week}
              min={1}
              max={7}
              suffix="días"
              onChange={(v) => patch.mutate({ sessions_per_week: v })}
            />
            <p className="mt-2 text-sm text-ink-2">Aplica a sus próximas reservas.</p>
          </Card>
        </>
      )}

      {isAdmin && (
        <>
          <SectionTitle>Rol</SectionTitle>
          <Card className="space-y-2">
            <Tabs
              value={m.role === "member" ? "member" : "coach"}
              onChange={(role) => {
                if (role === "coach" && !confirm(`¿Dar acceso de coach a ${m.full_name}? Podrá ver miembros, pagos y ajustes.`)) return;
                patch.mutate({ role });
              }}
              options={[
                { value: "member", label: "Miembro" },
                { value: "coach", label: "Coach" },
              ]}
            />
            <p className="flex items-start gap-2 text-sm text-ink-2">
              <ShieldCheck className="mt-0.5 size-4 shrink-0" />
              El coach tiene permisos de administrador: pagos, planes, ajustes y el panel de respaldo.
            </p>
          </Card>
        </>
      )}

      {m.role === "member" && <CoachNutritionCard memberId={id} />}

      <SectionTitle>Notas privadas</SectionTitle>
      <Card className="space-y-3">
        <textarea
          rows={3}
          value={notes ?? m.coach_notes}
          onChange={(e) => setNotes(e.target.value)}
          placeholder="Lesiones, objetivos, lo que tengas que recordar. Solo tú las ves."
          className="w-full rounded-input border border-line bg-surface-2 p-3 text-base focus:border-orchid focus:outline-none"
        />
        {notes !== null && notes !== m.coach_notes && (
          <Button variant="dark" size="sm" onClick={() => patch.mutate({ coach_notes: notes })}>
            Guardar notas
          </Button>
        )}
      </Card>

      <SectionTitle>Últimas asistencias</SectionTitle>
      {m.recent_checkins.length === 0 ? (
        <p className="text-[15px] text-ink-2">Sin asistencias todavía.</p>
      ) : (
        <div className="flex flex-wrap gap-2">
          {m.recent_checkins.slice(0, 14).map((at) => (
            <span key={at} className="rounded-full bg-surface-2 px-3 py-1.5 text-sm font-medium">
              {fmtDate(at)} · {fmtTime(at)}
            </span>
          ))}
        </div>
      )}

      {isAdmin && (
        <>
          <SectionTitle>Pagos</SectionTitle>
          {payments.length === 0 ? (
            <p className="text-[15px] text-ink-2">Sin pagos.</p>
          ) : (
            <Card className="divide-y divide-line p-0">
              {payments.map((p) => (
                <div key={p.id} className="flex justify-between px-4 py-3">
                  <span>
                    <b>{fmtMoney(p.amount_mxn)}</b> <span className="text-ink-2">· {methodLabel[p.method]}</span>
                  </span>
                  <span className="text-sm text-ink-2">{fmtDate(p.paid_at, { day: "numeric", month: "short", year: "numeric" })}</span>
                </div>
              ))}
            </Card>
          )}
        </>
      )}

      <PaymentSheet
        open={paySheet}
        onClose={() => setPaySheet(false)}
        memberId={id}
        currentPlan={m.plan_name}
        onDone={() => {
          setPaySheet(false);
          refresh();
        }}
      />
    </div>
  );
}

function PaymentSheet({
  open,
  onClose,
  memberId,
  currentPlan,
  onDone,
}: {
  open: boolean;
  onClose: () => void;
  memberId: number;
  currentPlan: string | null;
  onDone: () => void;
}) {
  const toast = useToast();
  const plans = useQuery({ queryKey: ["coach", "plans"], queryFn: () => unwrap(api.GET("/api/coach/plans")), enabled: open });
  const active = (plans.data ?? []).filter((p) => p.active);
  const [planId, setPlanId] = useState<number | null>(null);
  const [method, setMethod] = useState<"cash" | "transfer" | "other">("cash");
  const [amount, setAmount] = useState("");
  const [note, setNote] = useState("");
  const plan = active.find((p) => p.id === planId) ?? active.find((p) => p.name === currentPlan) ?? active[0];

  const pay = useMutation({
    mutationFn: () =>
      unwrap(
        api.POST("/api/coach/payments", {
          body: {
            member_id: memberId,
            plan_id: plan!.id,
            amount_mxn: amount || String(plan!.price_mxn),
            method,
            note,
          } as never,
        }),
      ),
    onSuccess: () => {
      toast("Pago registrado. La vigencia se extendió.");
      setAmount("");
      setNote("");
      onDone();
    },
    onError: (e) => toast((e as Error).message, "error"),
  });

  return (
    <Sheet open={open} onClose={onClose} title="Registrar pago">
      {plans.isLoading || !plan ? (
        <Spinner />
      ) : (
        <div className="space-y-4">
          <div className="space-y-2">
            <p className="t-label">Plan</p>
            <Tabs
              value={String(plan.id)}
              onChange={(v) => {
                setPlanId(Number(v));
                setAmount("");
              }}
              options={active.map((p) => ({ value: String(p.id), label: p.name }))}
            />
          </div>
          <Field label="Monto (MXN)">
            <Input
              inputMode="decimal"
              value={amount || String(Number(plan.price_mxn))}
              onChange={(e) => setAmount(e.target.value.replace(/[^\d.]/g, ""))}
              className="h-14 text-center text-2xl font-bold"
            />
          </Field>
          <div className="space-y-2">
            <p className="t-label">Método</p>
            <Tabs
              value={method}
              onChange={setMethod}
              options={[
                { value: "cash", label: "Efectivo" },
                { value: "transfer", label: "Transferencia" },
                { value: "other", label: "Otro" },
              ]}
            />
          </div>
          <Field label="Nota (opcional)">
            <Input value={note} onChange={(e) => setNote(e.target.value)} maxLength={200} />
          </Field>
          <Button full loading={pay.isPending} onClick={() => pay.mutate()}>
            Registrar {fmtMoney(amount || plan.price_mxn)}
          </Button>
          <p className="text-sm text-ink-2">
            Mismo plan y vigente: suma {plan.duration_months} mes desde el vencimiento. Vencida o cambio de plan: empieza hoy.
          </p>
        </div>
      )}
    </Sheet>
  );
}
