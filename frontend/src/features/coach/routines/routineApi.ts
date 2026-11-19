import { useMutation, useQuery, useQueryClient, type QueryClient } from "@tanstack/react-query";
import { api, unwrap } from "@/api/client";
import type { MemberRoutine, RoutineDay, RoutineItem, RoutineMember } from "@/api/types";
import type { ItemDraft } from "./ExerciseSheets";

export const routineKey = (memberId: number) => ["coach", "routine", memberId] as const;

export function useRoutineMembers() {
  return useQuery({
    queryKey: ["coach", "routine-members"],
    queryFn: async () => (await unwrap(api.GET("/api/coach/routines"))) as unknown as RoutineMember[],
  });
}

export function useMemberRoutine(memberId: number) {
  return useQuery({
    queryKey: routineKey(memberId),
    queryFn: async () =>
      (await unwrap(api.GET("/api/coach/routines/{member_id}", { params: { path: { member_id: memberId } } }))) as unknown as MemberRoutine,
  });
}

type ItemLike = Pick<RoutineItem, "sets" | "reps" | "duration_s" | "target_weight_kg" | "rest_s" | "notes"> & {
  exercise: { id: number };
};

const toIn = (i: ItemLike) => ({
  exercise_id: i.exercise.id,
  sets: i.sets,
  reps: i.reps,
  duration_s: i.duration_s,
  target_weight_kg: i.target_weight_kg,
  rest_s: i.rest_s,
  notes: i.notes ?? "",
});

export async function putDay(qc: QueryClient, memberId: number, weekday: number, day: { label: string; focus: string; items: ItemLike[] }) {
  const saved = (await unwrap(
    api.PUT("/api/coach/routines/{member_id}/days/{weekday}", {
      params: { path: { member_id: memberId, weekday } },
      body: { label: day.label, focus: day.focus, items: day.items.map(toIn) } as never,
    }),
  )) as unknown as RoutineDay;
  qc.setQueryData<MemberRoutine>(routineKey(memberId), (old) => {
    if (!old) return old;
    const days = { ...old.days };
    if (saved.items.length || saved.label || saved.focus) days[String(weekday)] = saved;
    else delete days[String(weekday)];
    return { ...old, days };
  });
  qc.invalidateQueries({ queryKey: ["coach", "routine-members"] });
  return saved;
}

/** Agrega un ejercicio al final de un día (lee la rutina actual primero). */
export function useAppendToDay() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ memberId, weekday, draft }: { memberId: number; weekday: number; draft: ItemDraft }) => {
      const r = await qc.fetchQuery({
        queryKey: routineKey(memberId),
        queryFn: async () =>
          (await unwrap(api.GET("/api/coach/routines/{member_id}", { params: { path: { member_id: memberId } } }))) as unknown as MemberRoutine,
      });
      const day = r.days[String(weekday)] ?? { label: "", focus: "", items: [] };
      return putDay(qc, memberId, weekday, { ...day, items: [...day.items, draft] });
    },
  });
}
