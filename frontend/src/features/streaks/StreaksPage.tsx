import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Apple, Check, Dumbbell, Flame, HeartHandshake, Search, UserPlus, X } from "lucide-react";
import { api, unwrap } from "@/api/client";
import { Avatar } from "@/components/Avatar";
import { Button, Card, EmptyState, ErrorBox, Input, PageTitle, SectionTitle, Sheet, Spinner, cx } from "@/components/ui";
import { useToast } from "@/components/ui/toast";

export interface Person {
  id: number;
  full_name: string;
  avatar_url: string | null;
  label: string; // gym sis | gym bro | gym buddy
}
export interface Streaks {
  my_label: string;
  overall: { days: number; today_done: boolean }; // kcal y, si tocaba, entrenar
  kcal: { days: number; today_done: boolean };
  training: { days: number; today_done: boolean; today_is_training: boolean };
  wildcard: {
    available_for: string | null; // día que puede cubrir (hoy desde las 10 p. m., o ayer)
    recent: { date: string; status: "pending" | "approved" | "rejected"; reason: string } | null;
  };
  buddies: { id: number; person: Person; streak: { days: number; me_today: boolean; them_today: boolean } }[];
  invites_in: { id: number; person: Person }[];
  invites_out: { id: number; person: Person }[];
}

export const STREAKS_KEY = ["streaks"];
export const useStreaks = () =>
  useQuery({
    queryKey: STREAKS_KEY,
    queryFn: async () => (await unwrap(api.GET("/api/streaks"))) as unknown as Streaks,
  });

const first = (name: string) => name.split(" ")[0];
const days = (n: number) => (n === 1 ? "1 día" : `${n} días`);

export default function StreaksPage() {
  const qc = useQueryClient();
  const toast = useToast();
  const { data, isLoading, error, refetch } = useStreaks();
  const [inviting, setInviting] = useState(false);
  const [confirmRemove, setConfirmRemove] = useState<number | null>(null);

  const done = (msg: string) => () => {
    toast(msg);
    qc.invalidateQueries({ queryKey: STREAKS_KEY });
  };
  const onErr = (e: unknown) => toast((e as Error).message, "error");
  const accept = useMutation({
    mutationFn: (id: number) => unwrap(api.POST("/api/buddies/{buddy_id}/accept", { params: { path: { buddy_id: id } } })),
    onSuccess: done("¡Listo! Empiecen su racha hoy 🔥"),
    onError: onErr,
  });
  const remove = useMutation({
    mutationFn: (id: number) => unwrap(api.DELETE("/api/buddies/{buddy_id}", { params: { path: { buddy_id: id } } })),
    onSuccess: () => {
      setConfirmRemove(null);
      done("Hecho")();
    },
    onError: onErr,
  });
  const nudge = useMutation({
    mutationFn: (id: number) => unwrap(api.POST("/api/buddies/{buddy_id}/nudge", { params: { path: { buddy_id: id } } })),
    onSuccess: () => toast("Le recordamos sus kcal 🍽️"),
    onError: onErr,
  });

  if (isLoading) return <Spinner />;
  if (error || !data) return <ErrorBox error={error} onRetry={refetch} />;

  return (
    <div>
      <PageTitle accent="rachas" sub="Cumple cada día y no rompas la racha.">
        Tus
      </PageTitle>

      {/* Racha individual */}
      <Card className="mb-3 flex items-center gap-4">
        <BigFlame days={data.overall.days} />
        <p className="text-[15px] text-ink-2">
          {data.overall.today_done
            ? "Hoy ya cumpliste ✓"
            : "Cumple hoy: registra tus kcal sin pasarte y, si te toca, entrena."}
        </p>
      </Card>
      <div className="grid grid-cols-2 gap-3">
        <StreakTile
          icon={Apple}
          n={data.kcal.days}
          title="Kcal"
          hint={data.kcal.today_done ? "Hoy ya cuenta ✓" : "Registra tus comidas sin pasarte más de 10 % de tu meta"}
          done={data.kcal.today_done}
        />
        <StreakTile
          icon={Dumbbell}
          n={data.training.days}
          title="Entrenamientos"
          hint={
            data.training.today_done
              ? "Hoy ya cuenta ✓"
              : data.training.today_is_training
                ? "Hoy te toca: registra tu entrenamiento"
                : "Hoy descansas: no rompe tu racha"
          }
          done={data.training.today_done}
        />
      </div>

      <WildcardCard w={data.wildcard} />

      {/* Invitaciones recibidas */}
      {data.invites_in.length > 0 && (
        <>
          <SectionTitle>Te invitaron</SectionTitle>
          <Card className="divide-y divide-line p-0">
            {data.invites_in.map((i) => (
              <div key={i.id} className="flex items-center gap-3 px-4 py-3">
                <Avatar url={i.person.avatar_url} name={i.person.full_name} size={44} />
                <p className="min-w-0 flex-1 text-[15px]">
                  <b>{first(i.person.full_name)}</b> te invita a ser su {data.my_label}
                </p>
                <button
                  aria-label="Rechazar"
                  onClick={() => remove.mutate(i.id)}
                  className="grid size-11 place-items-center rounded-full text-ink-2 hover:bg-surface-2"
                >
                  <X className="size-5" />
                </button>
                <Button size="sm" icon={Check} loading={accept.isPending && accept.variables === i.id} onClick={() => accept.mutate(i.id)}>
                  Aceptar
                </Button>
              </div>
            ))}
          </Card>
        </>
      )}

      {/* Gym sis / gym bros */}
      <SectionTitle
        right={
          <Button size="sm" variant="secondary" icon={UserPlus} onClick={() => setInviting(true)}>
            Invitar
          </Button>
        }
      >
        Gym sis y gym bros
      </SectionTitle>
      {data.buddies.length === 0 ? (
        <Card>
          <EmptyState
            icon={HeartHandshake}
            text="Invita a alguien del gym a ser tu gym sis o gym bro. Cada día que los dos cumplan, su racha juntos crece."
          />
        </Card>
      ) : (
        <div className="space-y-3">
          {data.buddies.map((b) => (
            <Card key={b.id} className="space-y-3">
              <div className="flex items-center gap-3">
                <Avatar url={b.person.avatar_url} name={b.person.full_name} size={48} />
                <div className="min-w-0 flex-1">
                  <p className="t-label">Tu {b.person.label}</p>
                  <p className="truncate font-semibold">{b.person.full_name}</p>
                </div>
                <div className="text-right">
                  <p className={cx("t-num flex items-center gap-1", b.streak.days > 0 ? "text-fire" : "text-ink-2")}>
                    <Flame className="size-6" /> {b.streak.days}
                  </p>
                  <p className="text-xs text-ink-2">juntos</p>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-2 text-sm">
                <TodayChip ok={b.streak.me_today} label="Tú hoy" />
                <TodayChip ok={b.streak.them_today} label={`${first(b.person.full_name)} hoy`} />
              </div>
              <div className="flex gap-2">
                <Button
                  size="sm"
                  variant="secondary"
                  icon={Apple}
                  className="flex-1"
                  loading={nudge.isPending && nudge.variables === b.id}
                  onClick={() => nudge.mutate(b.id)}
                >
                  Recordarle sus kcal
                </Button>
                {confirmRemove === b.id ? (
                  <Button size="sm" variant="danger" loading={remove.isPending} onClick={() => remove.mutate(b.id)}>
                    ¿Quitar?
                  </Button>
                ) : (
                  <button
                    aria-label={`Dejar de ser ${b.person.label} de ${b.person.full_name}`}
                    onClick={() => setConfirmRemove(b.id)}
                    className="grid size-11 place-items-center rounded-full text-ink-2 hover:bg-surface-2"
                  >
                    <X className="size-5" />
                  </button>
                )}
              </div>
            </Card>
          ))}
        </div>
      )}

      {data.invites_out.length > 0 && (
        <>
          <SectionTitle>Esperando respuesta</SectionTitle>
          <Card className="divide-y divide-line p-0">
            {data.invites_out.map((i) => (
              <div key={i.id} className="flex items-center gap-3 px-4 py-3">
                <Avatar url={i.person.avatar_url} name={i.person.full_name} size={40} />
                <p className="min-w-0 flex-1 truncate text-[15px]">{i.person.full_name}</p>
                <Button size="sm" variant="ghost" onClick={() => remove.mutate(i.id)}>
                  Cancelar
                </Button>
              </div>
            ))}
          </Card>
        </>
      )}

      <p className="mt-6 text-sm text-ink-2">
        Un día cuenta para la racha juntos cuando los dos registran sus kcal sin pasarse más de 10 % y, si les tocaba,
        entrenan. Cuando entrenas, tus compas reciben un aviso.
      </p>

      <InviteSheet open={inviting} onClose={() => setInviting(false)} />
    </div>
  );
}

/** El fueguito grande: "5 días de racha". Gris si está en 0. */
export function BigFlame({ days: n, size = "lg" }: { days: number; size?: "lg" | "sm" }) {
  const lit = n > 0;
  return (
    <div className="flex shrink-0 items-center gap-2">
      <Flame
        className={cx(size === "lg" ? "size-12" : "size-7", lit ? "fill-fire-fill text-fire" : "text-ink-2")}
        strokeWidth={1.75}
        aria-hidden
      />
      <div className="leading-none">
        <p className={cx("font-display font-bold", size === "lg" ? "text-4xl" : "text-2xl", lit ? "text-fire" : "text-ink-2")}>
          {n}
        </p>
        <p className="mt-1 text-xs font-semibold uppercase tracking-wide text-ink-2">{n === 1 ? "día de racha" : "días de racha"}</p>
      </div>
    </div>
  );
}

function StreakTile({
  icon: Icon,
  n,
  title,
  hint,
  done,
}: {
  icon: typeof Flame;
  n: number;
  title: string;
  hint: string;
  done: boolean;
}) {
  return (
    <Card className="space-y-1">
      <p className="t-label flex items-center gap-1.5">
        <Icon className="size-4" /> {title}
      </p>
      <p className={cx("t-num flex items-center gap-1", n > 0 ? "text-fire" : "text-ink-2")}>
        <Flame className="size-7" /> {n}
      </p>
      <p className="text-xs font-medium text-ink-2">{days(n)} seguidos</p>
      <p className={cx("text-sm", done ? "font-semibold text-success" : "text-ink-2")}>{hint}</p>
    </Card>
  );
}

function TodayChip({ ok, label }: { ok: boolean; label: string }) {
  return (
    <span
      className={cx(
        "flex h-9 items-center justify-center gap-1.5 rounded-full px-3 font-semibold",
        ok ? "bg-success/15 text-success" : "bg-surface-2 text-ink-2",
      )}
    >
      {ok ? <Check className="size-4" /> : <span className="size-2 rounded-full bg-current" />} {label}
    </span>
  );
}

function useDebounced<T>(v: T, ms = 350) {
  const [d, setD] = useState(v);
  useEffect(() => {
    const t = setTimeout(() => setD(v), ms);
    return () => clearTimeout(t);
  }, [v, ms]);
  return d;
}

type Found = Person & { status: "pending" | "accepted" | null };

function InviteSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const [q, setQ] = useState("");
  const dq = useDebounced(q.trim());
  const results = useQuery({
    queryKey: ["buddy-search", dq],
    queryFn: async () =>
      (await unwrap(api.GET("/api/buddies/search", { params: { query: { q: dq } } }))) as unknown as Found[],
    enabled: open && dq.length >= 2,
  });
  const invite = useMutation({
    mutationFn: (p: Found) => unwrap(api.POST("/api/buddies", { body: { user_id: p.id } })),
    onSuccess: (_, p) => {
      toast(`Invitación enviada a ${first(p.full_name)}`);
      qc.invalidateQueries({ queryKey: STREAKS_KEY });
      qc.invalidateQueries({ queryKey: ["buddy-search"] });
    },
    onError: (e) => toast((e as Error).message, "error"),
  });

  return (
    <Sheet open={open} onClose={onClose} title="Invitar gym sis o gym bro">
      <div className="relative mb-3">
        <Search className="pointer-events-none absolute left-3.5 top-1/2 size-5 -translate-y-1/2 text-ink-2" />
        <Input
          type="search"
          autoFocus
          placeholder="Busca por nombre"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          className="pl-11"
        />
      </div>
      {dq.length < 2 ? (
        <p className="text-[15px] text-ink-2">Escribe al menos 2 letras del nombre.</p>
      ) : results.isLoading ? (
        <Spinner />
      ) : !results.data?.length ? (
        <p className="text-[15px] text-ink-2">No encontramos a nadie con ese nombre.</p>
      ) : (
        <div className="divide-y divide-line">
          {results.data.map((p) => (
            <div key={p.id} className="flex items-center gap-3 py-2.5">
              <Avatar url={p.avatar_url} name={p.full_name} size={40} />
              <p className="min-w-0 flex-1 truncate font-medium">{p.full_name}</p>
              {p.status === "accepted" ? (
                <span className="text-sm font-semibold text-success">Tu {p.label}</span>
              ) : p.status === "pending" ? (
                <span className="text-sm text-ink-2">Pendiente</span>
              ) : (
                <Button size="sm" icon={UserPlus} loading={invite.isPending && invite.variables?.id === p.id} onClick={() => invite.mutate(p)}>
                  Invitar
                </Button>
              )}
            </div>
          ))}
        </div>
      )}
    </Sheet>
  );
}

const REASONS = ["Enfermedad", "Lesión", "Trabajo o escuela", "Viaje", "Otro"];

/** Comodín: 1 por semana para un entrenamiento que no pudo hacer. Lo aprueba la coach. */
function WildcardCard({ w }: { w: Streaks["wildcard"] }) {
  const qc = useQueryClient();
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [detail, setDetail] = useState("");
  const send = useMutation({
    mutationFn: () =>
      unwrap(api.POST("/api/wildcards", { body: { reason: detail.trim() ? `${reason}: ${detail.trim()}` : reason } })),
    onSuccess: () => {
      toast("Comodín enviado a tu coach 🃏");
      setOpen(false);
      qc.invalidateQueries({ queryKey: STREAKS_KEY });
    },
    onError: (e) => toast((e as Error).message, "error"),
  });

  const r = w.recent;
  if (!w.available_for && !r) return null;
  const dayLabel = (d: string) => {
    const today = new Date();
    const iso = (x: Date) => `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, "0")}-${String(x.getDate()).padStart(2, "0")}`;
    return d === iso(today) ? "hoy" : "ayer";
  };

  return (
    <>
      {w.available_for ? (
        <Card className="mt-3 flex items-center gap-3 border-gold bg-gold/15">
          <span className="text-3xl" aria-hidden>🃏</span>
          <div className="min-w-0 flex-1">
            <p className="font-semibold">¿No pudiste entrenar {dayLabel(w.available_for)}?</p>
            <p className="text-sm text-ink-2">Pide tu comodín (1 por semana). Si tu coach lo aprueba, tu racha sigue.</p>
          </div>
          <Button size="sm" onClick={() => setOpen(true)}>
            Pedir
          </Button>
        </Card>
      ) : r ? (
        <p
          className={cx(
            "mt-3 rounded-card px-4 py-3 text-[15px]",
            r.status === "approved" ? "bg-success/15" : r.status === "rejected" ? "bg-danger/10" : "bg-surface-2",
          )}
        >
          🃏 Comodín ({r.reason}):{" "}
          <b>{r.status === "approved" ? "aprobado, tu racha sigue" : r.status === "rejected" ? "no aprobado" : "esperando a tu coach"}</b>
        </p>
      ) : null}

      <Sheet open={open} onClose={() => setOpen(false)} title="Pedir comodín">
        <p className="mb-3 text-[15px] text-ink-2">¿Por qué no pudiste entrenar? Tu coach lo revisa.</p>
        <div className="mb-3 flex flex-wrap gap-2">
          {REASONS.map((x) => (
            <button
              key={x}
              onClick={() => setReason(x)}
              aria-pressed={reason === x}
              className={cx(
                "h-10 rounded-full border px-4 text-sm font-semibold",
                reason === x ? "border-fire-fill bg-fire-fill text-on-fire" : "border-line bg-surface text-ink-2",
              )}
            >
              {x}
            </button>
          ))}
        </div>
        <Input placeholder="Algo más (opcional)" value={detail} maxLength={120} onChange={(e) => setDetail(e.target.value)} />
        <Button full className="mt-4" disabled={!reason} loading={send.isPending} onClick={() => send.mutate()}>
          Enviar a mi coach
        </Button>
      </Sheet>
    </>
  );
}
