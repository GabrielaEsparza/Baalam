import { Link } from "react-router-dom";
import { ChevronRight, LogOut } from "lucide-react";
import { useMe } from "@/app/session";
import { Card, PageTitle } from "@/components/ui";
import { useLogout } from "@/features/auth/useLogout";
import { coachMore, moreItems, type NavItem } from "@/layout/nav";

export function LinkList({ items }: { items: NavItem[] }) {
  return (
    <Card className="divide-y divide-line p-0">
      {items.map(({ to, label, icon: Icon }) => (
        <Link key={to} to={to} className="flex h-14 items-center gap-3 px-4 hover:bg-surface-2">
          <Icon className="size-5 text-purple dark:text-orchid" strokeWidth={1.75} />
          <span className="flex-1 text-[15px] font-medium">{label}</span>
          <ChevronRight className="size-5 text-ink-2" />
        </Link>
      ))}
    </Card>
  );
}

export default function MorePage() {
  const { data: me } = useMe();
  const logout = useLogout();
  if (!me) return null;
  return (
    <div className="space-y-4">
      <PageTitle>Más</PageTitle>
      <LinkList items={moreItems(me.features)} />
      <button onClick={logout} className="card flex h-14 w-full items-center gap-3 px-4 text-danger hover:bg-surface-2">
        <LogOut className="size-5" /> <span className="text-[15px] font-medium">Cerrar sesión</span>
      </button>
    </div>
  );
}

export function CoachMorePage() {
  const { data: me } = useMe();
  const logout = useLogout();
  return (
    <div className="space-y-4">
      <PageTitle>Más</PageTitle>
      <LinkList items={coachMore.filter((i) => me?.features.admin || !["/coach/membresias", "/coach/ajustes"].includes(i.to))} />
      <button onClick={logout} className="card flex h-14 w-full items-center gap-3 px-4 text-danger hover:bg-surface-2">
        <LogOut className="size-5" /> <span className="text-[15px] font-medium">Cerrar sesión</span>
      </button>
      <p className="px-1 text-sm text-ink-2">
        ¿Algo que aún no está en la app? Usa el{" "}
        <a href="/admin/" className="font-semibold text-orchid underline">
          panel de respaldo
        </a>
        .
      </p>
    </div>
  );
}
