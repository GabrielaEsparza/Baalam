import { useQuery } from "@tanstack/react-query";
import { Info, Receipt } from "lucide-react";
import { api, unwrap } from "@/api/client";
import { useMe } from "@/app/session";
import { Card, EmptyState, ErrorBox, PageTitle, SectionTitle, Spinner, StatusBadge, cx } from "@/components/ui";
import { fmtDate, fmtMoney, methodLabel } from "@/lib/format";
import { WhatsAppButton } from "./MembershipNotices";

export default function MembershipPage() {
  const { data: me } = useMe();
  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ["membership"],
    queryFn: () => unwrap(api.GET("/api/membership")),
  });
  const { data: gym } = useQuery({ queryKey: ["gym"], queryFn: () => unwrap(api.GET("/api/gym")) });
  if (isLoading) return <Spinner />;
  if (error || !data) return <ErrorBox error={error} onRetry={refetch} />;
  const m = data.membership as null | {
    plan_name: string;
    status: string;
    start_date: string;
    end_date: string;
    days_left: number | null;
  };
  const first = (me?.full_name ?? "").split(" ")[0];

  return (
    <div>
      <PageTitle accent="membresía">Mi</PageTitle>

      {m ? (
        <Card className="space-y-4">
          <div className="flex items-start justify-between">
            <div>
              <p className="t-label">Plan actual</p>
              <p className="t-h2">{m.plan_name}</p>
            </div>
            <StatusBadge status={m.status} />
          </div>
          <div className="grid grid-cols-3 gap-2 border-t border-line pt-4">
            <Stat label="Inicio" value={fmtDate(m.start_date)} />
            <Stat label="Vence" value={fmtDate(m.end_date)} />
            <Stat
              label="Días"
              value={m.days_left !== null && m.days_left >= 0 ? String(m.days_left) : "0"}
              big
            />
          </div>
        </Card>
      ) : (
        <Card>
          <EmptyState icon={Receipt} text="Aún no tienes membresía. Tu coach la activa cuando registra tu pago en el gym." />
        </Card>
      )}

      {/* Renovar o cambiar de plan: solo en recepción */}
      <Card className="mt-4 space-y-3">
        <div className="flex gap-3">
          <Info className="mt-0.5 size-5 shrink-0 text-orchid" />
          <div className="text-[15px]">
            <p className="font-semibold">¿Quieres renovar o cambiar de plan?</p>
            <p className="text-ink-2">Acércate a recepción para cambiar o renovar tu plan. Ahí registran tu pago al momento.</p>
          </div>
        </div>
        <WhatsAppButton variant="secondary" text={`Hola, soy ${first}. Tengo una duda sobre mi mensualidad de BÁALAM.`} />
      </Card>

      {gym && gym.plans.length > 0 && (
        <>
          <SectionTitle>Planes disponibles</SectionTitle>
          <div className="space-y-2">
            {gym.plans.map((p) => (
              <Card key={p.id} className="flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <p className="font-semibold">
                    {p.name}
                    {p.name === m?.plan_name && <span className="ml-2 text-sm font-medium text-orchid">· tu plan</span>}
                  </p>
                  {p.benefits.length > 0 && <p className="text-sm text-ink-2">{p.benefits.join(" · ")}</p>}
                </div>
                <p className="shrink-0 font-bold">{fmtMoney(p.price_mxn)}</p>
              </Card>
            ))}
          </div>
        </>
      )}

      <SectionTitle>Pagos registrados</SectionTitle>
      {data.payments.length === 0 ? (
        <p className="text-[15px] text-ink-2">Sin pagos todavía.</p>
      ) : (
        <Card className="divide-y divide-line p-0">
          {data.payments.map((p) => (
            <div key={p.id} className="flex items-center justify-between px-4 py-3">
              <div>
                <p className="font-semibold">{fmtMoney(p.amount_mxn)}</p>
                <p className="text-sm text-ink-2">
                  {methodLabel[p.method]}
                  {p.note && ` · ${p.note}`}
                </p>
              </div>
              <p className="text-sm text-ink-2">{fmtDate(p.paid_at, { day: "numeric", month: "short", year: "numeric" })}</p>
            </div>
          ))}
        </Card>
      )}

    </div>
  );
}

function Stat({ label, value, big }: { label: string; value: string; big?: boolean }) {
  return (
    <div>
      <p className="t-label">{label}</p>
      <p className={cx("font-bold tabular-nums", big ? "text-2xl" : "text-[17px]")}>{value}</p>
    </div>
  );
}
