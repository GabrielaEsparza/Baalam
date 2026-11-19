import { NavLink, Outlet } from "react-router-dom";
import { LogOut } from "lucide-react";
import { cx } from "@/components/ui";
import { useMe } from "@/app/session";
import { useLogout } from "@/features/auth/useLogout";
import { ExpiringBanner } from "@/features/membership/MembershipNotices";
import { buildNav, coachMore, coachNav, moreItems, type NavItem } from "./nav";


function BottomNav({ items }: { items: NavItem[] }) {
  return (
    <nav
      aria-label="Principal"
      className="safe-bottom fixed inset-x-0 bottom-0 z-40 border-t border-line bg-surface/95 backdrop-blur lg:hidden"
    >
      <ul className="mx-auto grid max-w-lg grid-cols-5">
        {items.map(({ to, label, icon: Icon, end }) => (
          <li key={to}>
            <NavLink
              to={to}
              end={end}
              className={({ isActive }) =>
                cx(
                  "flex h-16 flex-col items-center justify-center gap-1 text-[11px] font-semibold",
                  isActive ? "text-fire" : "text-ink-2",
                )
              }
            >
              <Icon className="size-6" strokeWidth={1.75} />
              {label}
            </NavLink>
          </li>
        ))}
      </ul>
    </nav>
  );
}

function SideLink({ to, label, icon: Icon, end }: NavItem) {
  return (
    <NavLink
      to={to}
      end={end}
      className={({ isActive }) =>
        cx(
          "flex h-11 items-center gap-3 rounded-btn px-3 text-[15px] font-medium transition",
          isActive ? "bg-fire/10 text-fire" : "text-ink-2 hover:bg-surface-2 hover:text-ink",
        )
      }
    >
      <Icon className="size-5" strokeWidth={1.75} />
      {label}
    </NavLink>
  );
}

function Sidebar({ main, extra, coach }: { main: NavItem[]; extra: NavItem[]; coach?: boolean }) {
  const logout = useLogout();
  return (
    <aside className="sticky top-0 hidden h-dvh w-64 shrink-0 flex-col border-r border-line bg-surface p-4 lg:flex">
      <div className="mb-6 flex items-center gap-3 px-1">
        <img src="/logo.webp" alt="" className="size-11 rounded-full" />
        <div>
          <p className="font-display text-xl font-bold uppercase leading-none">Báalam</p>
          <p className="text-xs font-semibold uppercase tracking-widest text-ink-2">{coach ? "Coach" : "Gym"}</p>
        </div>
      </div>
      <nav className="flex flex-1 flex-col gap-1 overflow-y-auto">
        {main
          .filter((i) => !i.to.endsWith("/mas"))
          .map((i) => (
            <SideLink key={i.to} {...i} />
          ))}
        <div className="my-3 border-t border-line" />
        {extra.map((i) => (
          <SideLink key={i.to} {...i} />
        ))}
      </nav>
      <button
        onClick={logout}
        className="flex h-11 items-center gap-3 rounded-btn px-3 text-[15px] font-medium text-ink-2 hover:bg-surface-2"
      >
        <LogOut className="size-5" strokeWidth={1.75} /> Cerrar sesión
      </button>
    </aside>
  );
}

export function AppShell() {
  const { data: me } = useMe();
  const f = me!.features;
  const items = buildNav(f);
  return (
    <div className="flex min-h-dvh">
      <Sidebar main={items} extra={moreItems(f).filter((i) => !items.some((x) => x.to === i.to))} />
      <main className="mx-auto w-full max-w-3xl flex-1 px-4 pb-28 pt-6 lg:px-8 lg:pb-12 lg:pt-10">
        <ExpiringBanner me={me!} />
        <Outlet />
      </main>
      <BottomNav items={items} />
    </div>
  );
}

export function CoachShell() {
  return (
    <div className="flex min-h-dvh">
      <Sidebar main={coachNav} extra={coachMore} coach />
      <main className="mx-auto w-full max-w-5xl flex-1 px-4 pb-28 pt-6 lg:px-8 lg:pb-12 lg:pt-10">
        <Outlet />
      </main>
      <BottomNav items={coachNav} />
    </div>
  );
}
