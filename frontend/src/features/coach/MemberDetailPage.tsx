import { useState } from "react";
import { Link, useLocation, useNavigate, useParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Banknote, CalendarCog, Copy, KeyRound, Send, ClipboardList, MessageCircle, Pause, Play, ShieldCheck, Trash2, UserCheck, UserX } from "lucide-react";
import { Avatar } from "@/components/Avatar";
import { CoachNutritionCard } from "@/features/nutrition/CoachNutritionCard";
import { api, unwrap } from "@/api/client";
import { useMe } from "@/app/session";
import { Button, Card, ErrorBox, Field, Input, SectionTitle, Sheet, Spinner, StatusBadge, Stepper, Switch, Tabs } from "@/components/ui";
import { useToast } from "@/components/ui/toast";
import { fmtDate, fmtMoney, fmtTime, isoDate, methodLabel, waLink } from "@/lib/format";

export default function MemberDetailPage() {
  const id = Number(useParams().id);
  const { data: me } = useMe();
  const isAdmin = !!me?.features.admin;
  const isOwner = !!me?.features.owner; // la cuenta principal del gym
  const qc = useQueryClient();
  const toast = useToast();
  const loc = useLocation() as { state?: { justCreated?: boolean; accessLink?: string } };
  const justCreated = !!loc.state?.justCreated;
  const [paySheet, setPaySheet] = useState(justCreated && !!me?.features.admin);
  const [fixSheet, setFixSheet] = useState(false);
  const [delPay, setDelPay] = useState<number | null>(null);
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
    mutationFn: (body: { coach_notes?: string; sessions_per_week?: number; role?: "member" | "coach"; self_routine?: boolean }) =>
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

  const removePayment = useMutation({
    mutationFn: (pid: number) => unwrap(api.DELETE("/api/coach/payments/{payment_id}", { params: { path: { payment_id: pid } } })),
    onSuccess: () => {
      toast("Pago borrado del historial");
      setDelPay(null);
      refresh();
      qc.invalidateQueries({ queryKey: ["coach", "stats"] });
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
          {m.uses_google && <p className="text-sm font-medium text-ink-2">Entra con Google</p>}
          {m.phone && (
            <a href={waLink(m.phone.length === 10 ? `52${m.phone}` : m.phone, "")} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-[15px] font-semibold text-orchid">
              <MessageCircle className="size-4" /> {m.phone}
            </a>
          )}
        </div>
      </div>

      {m.needs_access_link && <AccessCard memberId={id} name={m.full_name} phone={m.phone} initialLink={loc.state?.accessLink} />}

      {/* Membresía */}
      <Card className="space-y-4">
        <div className="flex items-start justify-between">
          <div>
            <p className="t-label">Membresía</p>
            <p className="t-h2">{m.plan_name ?? "Sin plan"}</p>
            {m.start_date && m.end_date && (
              <p className="text-[15px] text-ink-2">
                {fmtDate(m.start_date, { day: "numeric", month: "short" })} → vence{" "}
                {fmtDate(m.end_date, { day: "numeric", month: "long", year: "numeric" })}
              </p>
            )}
          </div>
          <StatusBadge status={m.membership_status} />
        </div>
        {isAdmin && (
          <div className="space-y-2">
            <Button full icon={Banknote} onClick={() => setPaySheet(true)}>
              Registrar pago
            </Button>
            {m.membership_id && (
              <Button full variant="secondary" size="sm" icon={CalendarCog} onClick={() => setFixSheet(true)}>
                Corregir fechas o quitar membresía
              </Button>
            )}
          </div>
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

      {m.includes_routine && m.role === "member" && (
        <Link to={`/coach/rutinas/${id}`} className="mt-3 block">
          <Button variant="dark" full icon={ClipboardList}>
            Armar su rutina
          </Button>
        </Link>
      )}
      {m.includes_routine && m.role === "member" && isOwner && (
        <Card className="mt-3">
          <Switch
            label="Puede armar su propia rutina"
            checked={m.self_routine}
            onChange={(v) => patch.mutate({ self_routine: v })}
          />
          <p className="text-sm text-ink-2">Desde Entrenar podrá elegir sus ejercicios. Tú también puedes seguir editándola.</p>
        </Card>
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
                <div key={p.id} className="px-4 py-3">
                  <div className="flex items-center justify-between gap-2">
                    <span>
                      <b>{fmtMoney(p.amount_mxn)}</b> <span className="text-ink-2">· {methodLabel[p.method]}</span>
                    </span>
                    <span className="flex items-center gap-1">
                      <span className="text-sm text-ink-2">{fmtDate(p.paid_at, { day: "numeric", month: "short", year: "numeric" })}</span>
                      <button
                        aria-label="Borrar pago"
                        onClick={() => setDelPay(delPay === p.id ? null : p.id)}
                        className="grid size-9 place-items-center rounded-full text-ink-2 hover:bg-surface-2 hover:text-danger"
                      >
                        <Trash2 className="size-4" />
                      </button>
                    </span>
                  </div>
                  {delPay === p.id && (
                    <div className="mt-2 space-y-2 rounded-input bg-danger/10 p-3 text-[15px]">
                      <p>¿Borrar este pago? Se quita del historial y de las gráficas. Las fechas de la membresía no cambian (corrígelas aparte si hace falta).</p>
                      <div className="grid grid-cols-2 gap-2">
                        <Button size="sm" variant="secondary" onClick={() => setDelPay(null)}>
                          No
                        </Button>
                        <Button size="sm" variant="danger" loading={removePayment.isPending} onClick={() => removePayment.mutate(p.id)}>
                          Sí, borrar
                        </Button>
                      </div>
                    </div>
                  )}
                </div>
              ))}
            </Card>
          )}
        </>
      )}

      {m.membership_id && m.start_date && m.end_date && (
        <FixMembershipSheet
          key={`${m.start_date}-${m.end_date}`}
          open={fixSheet}
          onClose={() => setFixSheet(false)}
          membershipId={m.membership_id}
          start={m.start_date}
          end={m.end_date}
          name={m.full_name.split(" ")[0]}
          onDone={() => {
            setFixSheet(false);
            refresh();
          }}
        />
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

      {isOwner && m.id !== me?.id && <DeleteMemberButton memberId={id} name={m.full_name} />}
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
  const todayIso = isoDate(new Date());
  const [paidAt, setPaidAt] = useState(todayIso);
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
            paid_at: paidAt || todayIso,
          } as never,
        }),
      ),
    onSuccess: () => {
      toast("Pago registrado. La vigencia se extendió.");
      setAmount("");
      setNote("");
      setPaidAt(todayIso);
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
          <Field label="Fecha en que pagó">
            <Input type="date" value={paidAt} max={todayIso} onChange={(e) => setPaidAt(e.target.value)} />
          </Field>
          <Field label="Nota (opcional)">
            <Input value={note} onChange={(e) => setNote(e.target.value)} maxLength={200} />
          </Field>
          <Button full loading={pay.isPending} onClick={() => pay.mutate()}>
            Registrar {fmtMoney(amount || plan.price_mxn)}
          </Button>
          <p className="text-sm text-ink-2">
            Mismo plan y vigente ese día: suma {plan.duration_months} mes desde el vencimiento. Si estaba vencida o cambia de plan, la mensualidad empieza el día en que pagó.
          </p>
        </div>
      )}
    </Sheet>
  );
}

function FixMembershipSheet({
  open,
  onClose,
  membershipId,
  start,
  end,
  name,
  onDone,
}: {
  open: boolean;
  onClose: () => void;
  membershipId: number;
  start: string;
  end: string;
  name: string;
  onDone: () => void;
}) {
  const toast = useToast();
  const [s, setS] = useState(start);
  const [e, setE] = useState(end);
  const [confirm, setConfirm] = useState(false);
  const onError = (err: unknown) => toast((err as Error).message, "error");

  const save = useMutation({
    mutationFn: () =>
      unwrap(
        api.PATCH("/api/coach/memberships/{membership_id}", {
          params: { path: { membership_id: membershipId } },
          body: { start_date: s, end_date: e },
        }),
      ),
    onSuccess: () => {
      toast("Fechas corregidas");
      onDone();
    },
    onError,
  });
  const remove = useMutation({
    mutationFn: () =>
      unwrap(api.POST("/api/coach/memberships/{membership_id}/remove", { params: { path: { membership_id: membershipId } } })),
    onSuccess: () => {
      toast("Membresía quitada");
      setConfirm(false);
      onDone();
    },
    onError,
  });

  return (
    <Sheet open={open} onClose={onClose} title="Corregir membresía">
      <div className="space-y-5">
        <div className="space-y-3">
          <p className="text-[15px] text-ink-2">Si se registró con la fecha equivocada, ajústala aquí.</p>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Inicio">
              <Input type="date" value={s} onChange={(ev) => setS(ev.target.value)} />
            </Field>
            <Field label="Vence">
              <Input type="date" value={e} min={s} onChange={(ev) => setE(ev.target.value)} />
            </Field>
          </div>
          <Button full variant="dark" loading={save.isPending} disabled={!s || !e || (s === start && e === end)} onClick={() => save.mutate()}>
            Guardar fechas
          </Button>
        </div>

        <div className="border-t border-line pt-5">
          {confirm ? (
            <div className="space-y-2 rounded-card border border-danger/40 bg-danger/10 p-4">
              <p className="text-[15px] font-medium">
                ¿Quitarle la membresía a {name}? Queda vencida desde ayer, sin días de gracia, y ya no podrá usar la app. Sus pagos y su progreso se conservan.
              </p>
              <div className="grid grid-cols-2 gap-2">
                <Button variant="secondary" onClick={() => setConfirm(false)}>
                  No
                </Button>
                <Button variant="danger" loading={remove.isPending} onClick={() => remove.mutate()}>
                  Sí, quitar
                </Button>
              </div>
            </div>
          ) : (
            <Button full variant="danger" icon={UserX} onClick={() => setConfirm(true)}>
              Quitar membresía
            </Button>
          )}
        </div>
      </div>
    </Sheet>
  );
}

/** La persona aún no crea su contraseña: mandarle su enlace de acceso. */
function AccessCard({ memberId, name, phone, initialLink }: { memberId: number; name: string; phone: string; initialLink?: string }) {
  const toast = useToast();
  const [link, setLink] = useState<string | null>(initialLink ?? null);
  const gen = useMutation({
    mutationFn: async () =>
      (
        (await unwrap(
          api.POST("/api/coach/members/{member_id}/access-link", { params: { path: { member_id: memberId } } }),
        )) as unknown as { access_link: string }
      ).access_link,
    onError: (e) => toast((e as Error).message, "error"),
  });
  const getLink = async (): Promise<string> => {
    if (link) return link;
    const l = await gen.mutateAsync();
    setLink(l);
    return l;
  };
  const first = name.split(" ")[0];
  const message = (l: string) =>
    `¡Hola ${first}! Bienvenid@ a BÁALAM GYM 💪\nCrea tu contraseña aquí para entrar a la app:\n${l}\n\nTu usuario es tu correo. El enlace vale 7 días.`;

  async function sendWa() {
    const l = await getLink();
    const to = phone.replace(/\D/g, "");
    window.open(waLink(to.length === 10 ? `52${to}` : to, message(l)), "_blank", "noopener");
  }
  async function copy() {
    const l = await getLink();
    try {
      await navigator.clipboard.writeText(message(l));
      toast("Mensaje copiado");
    } catch {
      toast(l);
    }
  }

  return (
    <Card className="mb-4 space-y-3 border-gold bg-gold/15">
      <p className="flex items-center gap-2 font-semibold">
        <KeyRound className="size-5 text-warning" /> Aún no crea su contraseña
      </p>
      <p className="text-[15px] text-ink-2">
        Mándale su enlace de acceso. Con él crea su contraseña y entra con su correo. Vale 7 días; si caduca, mándalo de nuevo.
      </p>
      <div className="grid grid-cols-2 gap-2">
        <Button size="sm" icon={Send} loading={gen.isPending} disabled={!phone} onClick={sendWa}>
          WhatsApp
        </Button>
        <Button size="sm" variant="secondary" icon={Copy} loading={gen.isPending} onClick={copy}>
          Copiar mensaje
        </Button>
      </div>
      {!phone && <p className="text-sm text-ink-2">No tiene teléfono: copia el mensaje y mándalo como prefieras.</p>}
    </Card>
  );
}


/** Eliminar la cuenta de un miembro: hay que escribir ELIMINAR para confirmar. */
function DeleteMemberButton({ memberId, name }: { memberId: number; name: string }) {
  const nav = useNavigate();
  const qc = useQueryClient();
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const ok = text.trim().toUpperCase() === "ELIMINAR";
  const del = useMutation({
    mutationFn: () =>
      unwrap(
        api.POST("/api/coach/members/{member_id}/delete", {
          params: { path: { member_id: memberId } },
          body: { confirm: text.trim() },
        }),
      ),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["coach"] });
      toast(`Se eliminó la cuenta de ${name}`);
      nav("/coach/miembros", { replace: true });
    },
    onError: (e) => toast((e as Error).message, "error"),
  });

  return (
    <div className="mt-10 border-t border-line pt-6">
      <Button variant="danger" full icon={Trash2} onClick={() => setOpen(true)}>
        Eliminar cuenta
      </Button>
      <Sheet
        open={open}
        onClose={() => {
          setOpen(false);
          setText("");
        }}
        title="¿Estás segura de que quieres eliminar esta cuenta?"
      >
        <div className="space-y-4 text-[15px]">
          <p>
            Vas a eliminar la cuenta de <b>{name}</b>. Se borran su perfil, foto, peso, medidas, comidas, rutinas,
            entrenamientos, puntos y avisos, y ya no podrá entrar a la app. <b>No se puede deshacer.</b>
          </p>
          <p className="text-ink-2">
            Sus pagos y asistencias se conservan como “Cuenta eliminada” para las cuentas del gym. Si vuelve, puede
            registrarse de nuevo con el mismo correo.
          </p>
          <Field label="Para confirmar, escribe ELIMINAR">
            <Input value={text} onChange={(e) => setText(e.target.value)} autoComplete="off" autoCapitalize="characters" placeholder="ELIMINAR" />
          </Field>
          <Button variant="danger" full icon={Trash2} loading={del.isPending} disabled={!ok} onClick={() => del.mutate()}>
            Eliminar definitivamente
          </Button>
        </div>
      </Sheet>
    </div>
  );
}
