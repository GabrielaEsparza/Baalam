import { lazy, Suspense, type ReactNode } from "react";
import { createBrowserRouter, Navigate, Outlet } from "react-router-dom";
import { Spinner } from "@/components/ui";
import { AppShell, CoachShell } from "@/layout/AppShell";
import { RequireAuth, RequireFeature, RequireMember, RequireRole, ThemeSync } from "./session";
import Landing from "@/features/public/Landing";
import { DeleteAccountPage, PrivacyPage } from "@/features/public/LegalPages";
import { LoginPage, RecoverPage, RegisterPage } from "@/features/auth/AuthPages";
import HomePage from "@/features/home/HomePage";

const CheckinPage = lazy(() => import("@/features/checkin/CheckinPage"));
const TrainPage = lazy(() => import("@/features/workout/TrainPage"));
const ProgressPage = lazy(() => import("@/features/progress/ProgressPage"));
const PodiumPage = lazy(() => import("@/features/podium/PodiumPage"));
const StreaksPage = lazy(() => import("@/features/streaks/StreaksPage"));
const SchedulePage = lazy(() => import("@/features/schedule/SchedulePage"));
const MembershipPage = lazy(() => import("@/features/membership/MembershipPage"));
const ProfilePage = lazy(() => import("@/features/profile/ProfilePage"));
const NutritionPage = lazy(() => import("@/features/nutrition/NutritionPage"));
const MorePage = lazy(() => import("@/features/more/MorePage"));
const CoachMorePage = lazy(() => import("@/features/more/MorePage").then((m) => ({ default: m.CoachMorePage })));
const dash = () => import("@/features/coach/DashboardPage");
const DashboardPage = lazy(dash);
const StatsPage = lazy(() => dash().then((m) => ({ default: m.StatsPage })));
const TodayPage = lazy(() => dash().then((m) => ({ default: m.TodayPage })));
const DuePage = lazy(() => dash().then((m) => ({ default: m.DuePage })));
const MembersPage = lazy(() => import("@/features/coach/MembersPage"));
const MemberDetailPage = lazy(() => import("@/features/coach/MemberDetailPage"));
const ClassesPage = lazy(() => import("@/features/coach/ClassesPage"));
const QrScreen = lazy(() => import("@/features/coach/QrScreen"));
const admin = () => import("@/features/coach/AdminPages");
const PlansPage = lazy(() => admin().then((m) => ({ default: m.PlansPage })));
const AnnouncementsPage = lazy(() => admin().then((m) => ({ default: m.AnnouncementsPage })));
const SettingsPage = lazy(() => admin().then((m) => ({ default: m.SettingsPage })));
const RoutinesPage = lazy(() => import("@/features/coach/routines/RoutinesPage"));
const RoutineEditor = lazy(() => import("@/features/coach/routines/RoutineEditor"));

const S = ({ children }: { children: ReactNode }) => <Suspense fallback={<Spinner />}>{children}</Suspense>;

function Root() {
  return (
    <>
      <ThemeSync />
      <Outlet />
    </>
  );
}

export const router = createBrowserRouter([
  {
    element: <Root />,
    children: [
      { path: "/", element: <Landing /> },
      { path: "/login", element: <LoginPage /> },
      { path: "/registro", element: <RegisterPage /> },
      { path: "/recuperar", element: <RecoverPage /> },
      { path: "/privacidad", element: <PrivacyPage /> },
      { path: "/eliminar-cuenta", element: <DeleteAccountPage /> },
      {
        path: "/app/checkin",
        element: (
          <RequireAuth>
            <RequireMember>
              <S>
                <CheckinPage />
              </S>
            </RequireMember>
          </RequireAuth>
        ),
      },
      {
        path: "/app",
        element: (
          <RequireAuth>
            <RequireMember>
              <AppShell />
            </RequireMember>
          </RequireAuth>
        ),
        children: [
          { index: true, element: <HomePage /> },
          {
            path: "entrenar",
            element: (
              <RequireFeature feature="routine">
                <S>
                  <TrainPage />
                </S>
              </RequireFeature>
            ),
          },
          {
            path: "mi-rutina",
            element: (
              <RequireFeature feature="self_routine">
                <S>
                  <RoutineEditor self />
                </S>
              </RequireFeature>
            ),
          },
          { path: "progreso", element: <S><ProgressPage /></S> },
          { path: "podio", element: <S><PodiumPage /></S> },
          { path: "rachas", element: <S><StreaksPage /></S> },
          { path: "horarios", element: <S><SchedulePage /></S> },
          { path: "membresia", element: <S><MembershipPage /></S> },
          { path: "nutricion", element: <S><NutritionPage /></S> },
          { path: "perfil", element: <S><ProfilePage /></S> },
          { path: "mas", element: <S><MorePage /></S> },
        ],
      },
      {
        path: "/coach/qr",
        element: (
          <RequireAuth>
            <RequireRole role="coach">
              <S>
                <QrScreen />
              </S>
            </RequireRole>
          </RequireAuth>
        ),
      },
      {
        path: "/coach",
        element: (
          <RequireAuth>
            <RequireRole role="coach">
              <CoachShell />
            </RequireRole>
          </RequireAuth>
        ),
        children: [
          { index: true, element: <S><DashboardPage /></S> },
          { path: "estadisticas", element: <S><StatsPage /></S> },
          { path: "asistencias", element: <S><TodayPage /></S> },
          { path: "vencimientos", element: <S><DuePage /></S> },
          { path: "miembros", element: <S><MembersPage /></S> },
          { path: "miembros/:id", element: <S><MemberDetailPage /></S> },
          { path: "rutinas", element: <S><RoutinesPage /></S> },
          { path: "rutinas/:id", element: <S><RoutineEditor /></S> },
          { path: "clases", element: <S><ClassesPage /></S> },
          { path: "avisos", element: <S><AnnouncementsPage /></S> },
          { path: "mas", element: <S><CoachMorePage /></S> },
          { path: "perfil", element: <S><ProfilePage /></S> },
          {
            path: "membresias",
            element: (
              <RequireRole role="admin">
                <S><PlansPage /></S>
              </RequireRole>
            ),
          },
          {
            path: "ajustes",
            element: (
              <RequireRole role="admin">
                <S><SettingsPage /></S>
              </RequireRole>
            ),
          },
        ],
      },
      { path: "*", element: <Navigate to="/" replace /> },
    ],
  },
]);
