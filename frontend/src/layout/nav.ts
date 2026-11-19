import {
  CalendarDays,
  CreditCard,
  Dumbbell,
  Home,
  Megaphone,
  Menu,
  QrCode,
  Settings,
  Trophy,
  TrendingUp,
  User,
  Users,
  ClipboardList,
  BarChart3,
  UserCheck,
  AlertTriangle,
  Apple,
  type LucideIcon,
} from "lucide-react";
import type { Me } from "@/api/types";

export interface NavItem {
  to: string;
  label: string;
  icon: LucideIcon;
  end?: boolean;
}

/** Las 5 pestañas de la barra inferior según el plan activo. */
export function buildNav(f: Me["features"]): NavItem[] {
  const second: NavItem = f.routine
    ? { to: "/app/entrenar", label: "Entrenar", icon: Dumbbell }
    : f.classes
      ? { to: "/app/horarios", label: "Clases", icon: CalendarDays }
      : { to: "/app/membresia", label: "Membresía", icon: CreditCard };
  return [
    { to: "/app", label: "Inicio", icon: Home, end: true },
    second,
    { to: "/app/progreso", label: "Progreso", icon: TrendingUp },
    { to: "/app/podio", label: "Podio", icon: Trophy },
    { to: "/app/mas", label: "Más", icon: Menu },
  ];
}

/** Lo que vive en "Más" (en desktop se muestra en el sidebar). */
export function moreItems(f: Me["features"]): NavItem[] {
  const items: NavItem[] = [
    { to: "/app/perfil", label: "Mi perfil", icon: User },
    { to: "/app/nutricion", label: "Nutrición", icon: Apple },
  ];
  if (f.open_gym || f.classes) items.push({ to: "/app/horarios", label: "Horarios", icon: CalendarDays });
  items.push({ to: "/app/membresia", label: "Membresía", icon: CreditCard });
  return items;
}

export const coachNav: NavItem[] = [
  { to: "/coach", label: "Inicio", icon: Home, end: true },
  { to: "/coach/miembros", label: "Miembros", icon: Users },
  { to: "/coach/rutinas", label: "Rutinas", icon: ClipboardList },
  { to: "/coach/clases", label: "Clases", icon: CalendarDays },
  { to: "/coach/mas", label: "Más", icon: Menu },
];

export const coachMore: NavItem[] = [
  { to: "/coach/estadisticas", label: "Cómo va el gym", icon: BarChart3 },
  { to: "/coach/asistencias", label: "Asistencias de hoy", icon: UserCheck },
  { to: "/coach/vencimientos", label: "Vencimientos", icon: AlertTriangle },
  { to: "/coach/perfil", label: "Mi perfil", icon: User },
  { to: "/coach/membresias", label: "Planes y pagos", icon: CreditCard },
  { to: "/coach/avisos", label: "Avisos", icon: Megaphone },
  { to: "/coach/qr", label: "QR de entrada", icon: QrCode },
  { to: "/coach/ajustes", label: "Ajustes del gym", icon: Settings },
];
