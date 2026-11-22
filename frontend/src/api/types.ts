import type { components } from "./schema";

type S = components["schemas"];
export type Me = S["MeOut"];
export type Home = S["HomeOut"];
export type MembershipBrief = S["MembershipBrief"];
export type Plan = S["PlanOut"];
export type MemberRow = S["MemberRow"];
export type MemberDetail = S["MemberDetail"];
export type Dashboard = S["DashboardOut"];
export type ScheduleIO = S["ScheduleIO"];
export type SessionOut = S["SessionOut"];
export type GymInfo = S["PublicGymOut"];
export type Settings = S["SettingsIO"];
export type Announcement = S["AnnouncementIO"];

/* Respuestas tipo dict en el backend */
export interface BookingOut {
  id: number;
  status: "booked" | "attended" | "missed" | "moved" | "cancelled";
  session: SessionOut;
}
export interface MonthBookings {
  month: string;
  open: boolean;
  bookings: BookingOut[];
  waitlist: { id: number; from_booking_id: number; target: SessionOut }[];
}
export interface BookMonthResult {
  created: BookingOut[];
  conflicts: { date: string; schedule_id: number; reason: string }[];
}
export interface TodayWorkout {
  id: number;
  title: string;
  focus: string;
  exercises: number;
  est_minutes: number;
  status: string;
}
export interface PodiumRow {
  member_id: number;
  name: string;
  avatar_url?: string | null;
  points: number;
  checkins: number;
  position: number;
}
export interface Podium {
  month: string;
  top: PodiumRow[];
  rest: PodiumRow[];
  me: { position: number | null; points: number };
  rules: Record<string, number>;
}
export interface BodySummary {
  current: string | null;
  start: string | null;
  min: string | null;
  change: string | null;
  target: string | null;
  series: { date: string; weight_kg: string }[];
  bmi: Bmi;
}
export type BmiCategory = "under" | "normal" | "over" | "obese1" | "obese2" | "obese3";
export interface Bmi {
  value: string | null;
  category: BmiCategory | null;
  label: string | null;
  height_cm: string | null;
  weight_kg: string | null;
  sex: "f" | "m" | null;
  age: number | null;
  minor: boolean;
  fat_range: { min: number; max: number } | null;
  healthy_kg?: { min: string; max: string };
}
export interface QrToken {
  token: string;
  code: string;
  expires_in: number;
  open_sessions: {
    id: number;
    name: string;
    type: string;
    start_at: string;
    end_at: string;
    capacity: number;
    booked: number;
    attended: number;
    requires_reservation: boolean;
  }[];
  next_session: { name: string; start_at: string; opens_at: string } | null;
  recent: { name: string; avatar_url: string | null; at: string; session: string | null }[];
  today_count: number;
}
export type CoachSession = SessionOut & { cancelled: boolean; edited: boolean; extra: boolean; past: boolean };
export interface Occupancy {
  week_start: string;
  sessions: CoachSession[];
  not_booked: { id: number; name: string }[];
  missed: { member_id: number; name: string; date: string; session: string }[];
}

/* ---------- Entrenamiento ---------- */
export interface Exercise {
  id: number;
  name: string;
  name_en: string;
  gif_url: string;
  video_url: string;
  image_urls: string[];
  muscle_group: string;
  equipment: string;
  target_muscles: string[];
  secondary_muscles: string[];
  instructions: string[];
  instructions_es: string;
  source: string;
  external_id: string;
}
export interface CatalogItem {
  external_id: string;
  name: string;
  gif_url: string;
  body_parts: string[];
  equipments: string[];
  target_muscles: string[];
  secondary_muscles: string[];
  instructions: string[];
  library_id: number | null;
}
export interface CatalogPage {
  items: CatalogItem[];
  total: number | null;
  next_cursor: string | null;
}
export interface RoutineItem {
  id: number;
  exercise: Exercise;
  order: number;
  sets: number;
  reps: number | null;
  /** Rango de repeticiones: reps–reps_max (8–10). */
  reps_max: number | null;
  duration_s: number | null;
  target_weight_kg: string | null;
  rest_s: number;
  /** Misma letra en ejercicios seguidos = se alternan serie por serie. */
  superset_group: string;
  notes: string;
}
export interface RoutineDay {
  weekday: number;
  label: string;
  focus: string;
  items: RoutineItem[];
}
export interface RoutineMember {
  id: number;
  full_name: string;
  avatar_url: string | null;
  membership_status: string;
  sessions_per_week: number;
  booked_weekdays: number[];
  routine_weekdays: number[];
}
export interface MemberRoutine {
  member: { id: number; full_name: string; avatar_url: string | null };
  booked_weekdays: number[];
  routine_id: number | null;
  days: Record<string, RoutineDay>;
}
export interface LoggedSet {
  set_number: number;
  weight_kg: string | null;
  reps: number | null;
  done: boolean;
  is_pr: boolean;
}
export interface TodayItem extends RoutineItem {
  last_weight_kg: string | null;
  logged: LoggedSet[];
}
export interface SwapOption {
  weekday: number;
  label: string;
  focus: string;
  exercises: number;
}
export interface TodayWorkoutFull {
  weekday: number;
  routine_weekdays: number[];
  options: SwapOption[];
  swapped_from: number | null;
  day: { id: number; label: string; focus: string; items: TodayItem[] } | null;
  session: { id: number; started_at: string; finished_at: string | null } | null;
}
export interface FinishResult {
  /** Estimación conservadora (30 % abajo del promedio), redondeada a 5. */
  kcal_estimate: number;
  kcal_weight_kg: number | null;
  duration_min: number;
  sets_done: number;
  sets_planned: number;
  volume_kg: string;
  prs: number;
  points: number;
  completed: boolean;
}
