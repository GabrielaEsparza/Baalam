import { useEffect, useState } from "react";
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { BookOpen, Check, Info, PencilLine, Plus, Search, SearchX } from "lucide-react";
import { api, unwrap } from "@/api/client";
import type { CatalogItem, CatalogPage, Exercise } from "@/api/types";
import { ExerciseMedia } from "@/components/ExerciseMedia";
import { Button, EmptyState, ErrorBox, Input, Spinner, Tabs, cx } from "@/components/ui";
import { useToast } from "@/components/ui/toast";
import { tr, trList } from "@/lib/exercise-i18n";
import { CustomExerciseSheet } from "./CustomExerciseSheet";
import { ExerciseDetailSheet } from "./ExerciseSheets";

type Source = "catalog" | "library";

function useDebounced<T>(v: T, ms = 450) {
  const [d, setD] = useState(v);
  useEffect(() => {
    const t = setTimeout(() => setD(v), ms);
    return () => clearTimeout(t);
  }, [v, ms]);
  return d;
}

/** Convierte un resultado del catálogo en un "Exercise" para mostrarlo con los mismos componentes. */
export function catalogToExercise(c: CatalogItem): Exercise {
  return {
    id: c.library_id ?? -1,
    name: c.name,
    name_en: c.name,
    gif_url: c.gif_url,
    video_url: "",
    image_urls: [],
    muscle_group: c.body_parts[0] ?? "",
    equipment: c.equipments[0] ?? "",
    target_muscles: c.target_muscles,
    secondary_muscles: c.secondary_muscles,
    instructions: c.instructions,
    instructions_es: "",
    source: "exercisedb",
    external_id: c.external_id,
  };
}

/** Importa a la biblioteca (si hace falta) y devuelve el ejercicio con id propio. */
export function useEnsureInLibrary() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (c: CatalogItem): Promise<Exercise> => {
      const ex = (await unwrap(
        api.POST("/api/coach/exercises/import", {
          body: {
            external_id: c.external_id,
            name_es: "",
            name: c.name,
            gif_url: c.gif_url,
            body_parts: c.body_parts,
            equipments: c.equipments,
            target_muscles: c.target_muscles,
            secondary_muscles: c.secondary_muscles,
            instructions: c.instructions,
          },
        }),
      )) as unknown as Exercise;
      return ex;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["coach", "library"] });
      qc.invalidateQueries({ queryKey: ["coach", "catalog"] });
    },
  });
}

/**
 * Biblioteca de ejercicios.
 * - "Catálogo": ExerciseDB a través de nuestro backend (con caché).
 * - "Mi biblioteca": los que ya usaste o importaste (lo que leen los miembros).
 * `onPick` se llama con un ejercicio YA guardado en la biblioteca (con id propio).
 */
/** `coach=false`: el miembro que arma su propia rutina (busca y agrega, pero no crea ni edita ejercicios del gym). */
export function ExerciseLibrary({
  onPick,
  pickLabel = "Agregar",
  coach = true,
}: {
  onPick: (ex: Exercise) => void;
  pickLabel?: string;
  coach?: boolean;
}) {
  const toast = useToast();
  const [source, setSource] = useState<Source>("catalog");
  const [q, setQ] = useState("");
  const [bodyPart, setBodyPart] = useState("");
  const [equipment, setEquipment] = useState("");
  const [detail, setDetail] = useState<{ ex: Exercise; cat?: CatalogItem } | null>(null);
  const [custom, setCustom] = useState(false);
  const dq = useDebounced(q);
  const ensure = useEnsureInLibrary();

  const filters = useQuery({
    queryKey: ["coach", "catalog-filters"],
    queryFn: async () => (await unwrap(api.GET("/api/coach/exercises/filters"))) as unknown as { body_parts: string[]; equipments: string[] },
    staleTime: Infinity,
    enabled: source === "catalog",
  });

  const catalog = useInfiniteQuery({
    queryKey: ["coach", "catalog", dq, bodyPart, equipment],
    queryFn: async ({ pageParam }) =>
      (await unwrap(
        api.GET("/api/coach/exercises/catalog", {
          params: { query: { q: dq, body_part: bodyPart, equipment, cursor: pageParam } },
        }),
      )) as unknown as CatalogPage,
    initialPageParam: "",
    getNextPageParam: (last) => last.next_cursor ?? undefined,
    enabled: source === "catalog",
    staleTime: 10 * 60_000,
  });

  const library = useQuery({
    queryKey: ["coach", "library", dq],
    queryFn: async () => (await unwrap(api.GET("/api/coach/exercises", { params: { query: { q: dq } } }))) as unknown as Exercise[],
    enabled: source === "library",
  });

  async function pickCatalog(c: CatalogItem) {
    try {
      onPick(await ensure.mutateAsync(c));
      setDetail(null);
    } catch (e) {
      toast((e as Error).message, "error");
    }
  }

  const catItems = catalog.data?.pages.flatMap((p) => p.items) ?? [];
  const total = catalog.data?.pages[0]?.total;

  return (
    <div>
      <Tabs
        className="mb-3"
        value={source}
        onChange={setSource}
        options={[
          { value: "catalog", label: "Catálogo" },
          { value: "library", label: "Mi biblioteca" },
        ]}
      />
      <div className="relative mb-3">
        <Search className="pointer-events-none absolute left-3.5 top-1/2 size-5 -translate-y-1/2 text-ink-2" />
        <Input
          type="search"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder={source === "catalog" ? "Buscar en inglés: squat, press, curl…" : "Buscar en tu biblioteca"}
          className="pl-11"
        />
      </div>

      {coach && (
      <button
        onClick={() => setCustom(true)}
        className="mb-3 flex h-11 w-full items-center justify-center gap-2 rounded-btn border border-dashed border-orchid/60 text-[14px] font-semibold text-orchid hover:bg-orchid/5"
      >
        <PencilLine className="size-4" /> ¿No está? Crea tu propio ejercicio
      </button>
      )}

      {source === "catalog" && (
        <div className="mb-3 space-y-2">
          <Chips
            value={bodyPart}
            onChange={setBodyPart}
            options={(filters.data?.body_parts ?? []).filter((b) => b !== "neck")}
            allLabel="Todo el cuerpo"
          />
          {filters.data && filters.data.equipments.length > 0 && (
            <select
              value={equipment}
              onChange={(e) => setEquipment(e.target.value)}
              className="h-11 w-full rounded-input border border-line bg-surface-2 px-3 text-base text-ink"
              aria-label="Equipo"
            >
              <option value="">Cualquier equipo</option>
              {filters.data.equipments.map((eq) => (
                <option key={eq} value={eq}>
                  {tr(eq)}
                </option>
              ))}
            </select>
          )}
        </div>
      )}

      {/* Resultados */}
      {source === "catalog" ? (
        catalog.isLoading ? (
          <Spinner />
        ) : catalog.error ? (
          <ErrorBox error={catalog.error} onRetry={() => catalog.refetch()} />
        ) : catItems.length === 0 ? (
          <EmptyState
            icon={SearchX}
            text={coach ? "Sin resultados. Prueba con otra palabra en inglés (squat, row, lunge…) o créalo tú." : "Sin resultados. Prueba con otra palabra en inglés (squat, row, lunge…)."}
            action={
              coach && <Button variant="secondary" size="sm" icon={PencilLine} onClick={() => setCustom(true)}>
                Crear “{q.trim() || "ejercicio"}”
              </Button>
            }
          />
        ) : (
          <>
            {total != null && <p className="mb-2 text-sm text-ink-2">{total} ejercicios</p>}
            <Grid>
              {catItems.map((c) => (
                <Card
                  key={c.external_id}
                  ex={catalogToExercise(c)}
                  inLibrary={!!c.library_id}
                  pickLabel={pickLabel}
                  busy={ensure.isPending && ensure.variables?.external_id === c.external_id}
                  onInfo={() => setDetail({ ex: catalogToExercise(c), cat: c })}
                  onPick={() => pickCatalog(c)}
                />
              ))}
            </Grid>
            {catalog.hasNextPage && (
              <Button variant="secondary" full className="mt-4" loading={catalog.isFetchingNextPage} onClick={() => catalog.fetchNextPage()}>
                Ver más
              </Button>
            )}
          </>
        )
      ) : library.isLoading ? (
        <Spinner />
      ) : (library.data ?? []).length === 0 ? (
        <EmptyState
          icon={BookOpen}
          text={dq ? "No está en tu biblioteca." : "Tu biblioteca está vacía. Los ejercicios que agregues desde el catálogo o crees tú se guardan aquí."}
          action={
            coach && <Button variant="secondary" size="sm" icon={PencilLine} onClick={() => setCustom(true)}>
              Crear ejercicio propio
            </Button>
          }
        />
      ) : (
        <Grid>
          {library.data!.map((ex) => (
            <Card key={ex.id} ex={ex} pickLabel={pickLabel} onInfo={() => setDetail({ ex })} onPick={() => onPick(ex)} />
          ))}
        </Grid>
      )}

      <p className="mt-6 text-center text-xs text-ink-2">
        Ejercicios y animaciones:{" "}
        <a href="https://exercisedb.dev" target="_blank" rel="noreferrer" className="underline">
          ExerciseDB
        </a>{" "}
        por AscendAPI
      </p>

      <CustomExerciseSheet
        open={custom}
        initialName={q.trim()}
        onClose={() => setCustom(false)}
        onCreated={(ex) => {
          setCustom(false);
          setSource("library");
          onPick(ex);
        }}
      />

      <ExerciseDetailSheet
        ex={detail?.ex ?? null}
        editable={coach && !detail?.cat}
        onClose={() => setDetail(null)}
        action={
          detail && (
            <Button
              full
              icon={Plus}
              loading={ensure.isPending}
              onClick={() => (detail.cat ? pickCatalog(detail.cat) : (onPick(detail.ex), setDetail(null)))}
            >
              {pickLabel}
            </Button>
          )
        }
      />
    </div>
  );
}

function Grid({ children }: { children: React.ReactNode }) {
  return <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">{children}</div>;
}

function Card({
  ex,
  inLibrary,
  pickLabel,
  busy,
  onInfo,
  onPick,
}: {
  ex: Exercise;
  inLibrary?: boolean;
  pickLabel: string;
  busy?: boolean;
  onInfo: () => void;
  onPick: () => void;
}) {
  return (
    <div className="card flex min-w-0 flex-col gap-2 p-2">
      <div className="relative">
        <button onClick={onInfo} className="block w-full" aria-label={`Ver ${ex.name}`}>
          <ExerciseMedia ex={ex} className="!rounded-[12px]" />
        </button>
        <button
          onClick={onInfo}
          aria-label="Ver instrucciones"
          className="absolute left-1.5 top-1.5 grid size-8 place-items-center rounded-full bg-surface/90 text-ink shadow-sm backdrop-blur hover:bg-surface"
        >
          <Info className="size-[18px]" />
        </button>
        {inLibrary && (
          <span className="absolute right-1.5 top-1.5 grid size-7 place-items-center rounded-full bg-success text-white" title="En tu biblioteca">
            <Check className="size-4" />
          </span>
        )}
        {ex.source === "custom" && (
          <span className="absolute bottom-1.5 left-1.5 rounded-full bg-orchid px-2 py-0.5 text-[11px] font-bold text-white">Propio</span>
        )}
      </div>
      <div className="min-w-0 flex-1 px-0.5">
        <p className="line-clamp-2 text-[14px] font-semibold first-letter:uppercase leading-snug">{ex.name}</p>
        <p className="truncate text-xs text-ink-2">
          {tr(ex.muscle_group)}
          {ex.equipment && ` · ${tr(ex.equipment)}`}
        </p>
        {ex.target_muscles.length > 0 && <p className="truncate text-xs text-ink-2">{trList(ex.target_muscles)}</p>}
      </div>
      <Button size="sm" variant="dark" full icon={Plus} loading={busy} onClick={onPick} className="!gap-1.5 !px-2">
        {pickLabel}
      </Button>
    </div>
  );
}

function Chips({ value, onChange, options, allLabel }: { value: string; onChange: (v: string) => void; options: string[]; allLabel: string }) {
  return (
    <div className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1">
      {["", ...options].map((o) => (
        <button
          key={o || "all"}
          onClick={() => onChange(o)}
          className={cx(
            "h-10 shrink-0 rounded-full border px-4 text-sm font-semibold",
            value === o ? "border-fire-fill bg-fire-fill text-on-fire" : "border-line bg-surface text-ink-2",
          )}
        >
          {o ? tr(o) : allLabel}
        </button>
      ))}
    </div>
  );
}
