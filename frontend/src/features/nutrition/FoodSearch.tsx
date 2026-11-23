import { useEffect, useRef, useState } from "react";
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, Flame, Plus, ScanBarcode, Search, SearchX, Star, X } from "lucide-react";
import { api, unwrap, ApiError } from "@/api/client";
import { Button, EmptyState, ErrorBox, Input, Sheet, Spinner, cx } from "@/components/ui";
import { useToast } from "@/components/ui/toast";
import { FoodThumb } from "./FoodCalculator";
import { fmtN, mealLabel, sourceLabel, type FoodItem, type Meal, type SearchPage } from "./nutri";

type Source = "all" | "usda" | "off";

function useDebounced<T>(v: T, ms = 450) {
  const [d, setD] = useState(v);
  useEffect(() => {
    const t = setTimeout(() => setD(v), ms);
    return () => clearTimeout(t);
  }, [v, ms]);
  return d;
}

/**
 * Buscar alimento → al elegir, el backend trae la ficha fresca y la guarda en la caché propia
 * (`onPick` recibe el alimento con id propio, listo para la calculadora).
 */
export function FoodSearchSheet({
  open,
  meal,
  onClose,
  onPick,
  onQuickAdd,
  onManual,
}: {
  open: boolean;
  meal: Meal;
  onClose: () => void;
  onPick: (f: FoodItem) => void;
  onQuickAdd: (f: FoodItem) => void;
  /** Abrir "solo calorías" (sin alimento) */
  onManual: () => void;
}) {
  const toast = useToast();
  const [q, setQ] = useState("");
  const [source, setSource] = useState<Source>("all");
  const [quickTab, setQuickTab] = useState<"recent" | "frequent" | "favorites">("recent");
  const [scanning, setScanning] = useState(false);
  const dq = useDebounced(q.trim());
  const searching = dq.length >= 2;

  useEffect(() => {
    if (open) {
      setQ("");
      setScanning(false);
    }
  }, [open]);

  const quick = useQuery({
    queryKey: ["nutrition", "quick"],
    queryFn: async () => (await unwrap(api.GET("/api/nutrition/quick"))) as unknown as Record<"recent" | "frequent" | "favorites", FoodItem[]>,
    enabled: open,
  });

  const results = useInfiniteQuery({
    queryKey: ["nutrition", "search", dq, source],
    queryFn: async ({ pageParam }) =>
      (await unwrap(api.GET("/api/nutrition/search", { params: { query: { q: dq, source, page: pageParam } } }))) as unknown as SearchPage,
    initialPageParam: 1,
    getNextPageParam: (last) => (last.has_more ? last.page + 1 : undefined),
    enabled: open && searching,
    staleTime: 10 * 60_000,
    retry: false,
  });

  const resolve = useMutation({
    mutationFn: async (it: FoodItem) =>
      (await unwrap(api.POST("/api/nutrition/foods/resolve", { body: { source: it.source, external_id: it.external_id } }))) as unknown as FoodItem,
    onSuccess: (f) => onPick(f),
    onError: (e) => toast((e as Error).message, "error"),
  });

  const items = results.data?.pages.flatMap((p) => p.items) ?? [];
  const errors = results.data?.pages[0]?.errors ?? {};
  const quickItems = quick.data?.[quickTab] ?? [];

  // Quitar de la lista: en Recientes/Frecuentes lo oculta (vuelve si lo comes otra vez);
  // en Favoritos le quita la estrella. Siempre con "Deshacer".
  const qc = useQueryClient();
  const refreshQuick = () => qc.invalidateQueries({ queryKey: ["nutrition", "quick"] });
  const setHidden = (f: FoodItem, hide: boolean, tab: typeof quickTab) => {
    const path = { params: { path: { food_id: f.id! } } };
    if (tab === "favorites")
      return unwrap(hide ? api.DELETE("/api/nutrition/favorites/{food_id}", path) : api.PUT("/api/nutrition/favorites/{food_id}", path));
    return unwrap(hide ? api.DELETE("/api/nutrition/quick/{food_id}", path) : api.PUT("/api/nutrition/quick/{food_id}", path));
  };
  const removeQuick = useMutation({
    mutationFn: ({ f, tab }: { f: FoodItem; tab: typeof quickTab }) => setHidden(f, true, tab),
    onSuccess: (_, { f, tab }) => {
      refreshQuick();
      toast(tab === "favorites" ? `${f.name} ya no es favorito` : `Quitaste ${f.name} de la lista`, "ok", {
        label: "Deshacer",
        onClick: () => setHidden(f, false, tab).then(refreshQuick),
      });
    },
    onError: (e) => toast((e as Error).message, "error"),
  });

  return (
    <Sheet open={open} onClose={onClose} title={`Agregar a ${mealLabel(meal).toLowerCase()}`}>
      {scanning ? (
        <BarcodeScanner
          onClose={() => setScanning(false)}
          onFound={(f) => {
            setScanning(false);
            onPick(f);
          }}
        />
      ) : (
        <div className="space-y-3">
          <div className="flex gap-2">
            <div className="relative flex-1">
              <Search className="pointer-events-none absolute left-3.5 top-1/2 size-5 -translate-y-1/2 text-ink-2" />
              <Input
                type="search"
                autoFocus
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="Ej. huevo, avena, yogurt Lala"
                className="pl-11"
                aria-label="Buscar alimento o producto"
              />
            </div>
            <button
              onClick={() => setScanning(true)}
              aria-label="Escanear código de barras"
              className="grid size-12 shrink-0 place-items-center rounded-input border border-line bg-surface-2 text-ink hover:bg-surface"
            >
              <ScanBarcode className="size-6" />
            </button>
          </div>

          <button
            onClick={onManual}
            className="flex w-full items-center gap-3 rounded-input border border-dashed border-line px-3 py-2.5 text-left hover:bg-surface-2"
          >
            <span className="grid size-9 shrink-0 place-items-center rounded-full bg-fire/10 text-fire">
              <Flame className="size-5" />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block font-semibold">Agregar solo calorías</span>
              <span className="block text-xs text-ink-2">Si no está en la lista, escribe las kcal directo</span>
            </span>
            <Plus className="size-5 shrink-0 text-ink-2" />
          </button>

          {searching ? (
            <>
              <div className="flex gap-2">
                {(
                  [
                    ["all", "Todo"],
                    ["usda", "Alimentos"],
                    ["off", "Productos"],
                  ] as [Source, string][]
                ).map(([v, l]) => (
                  <button
                    key={v}
                    onClick={() => setSource(v)}
                    className={cx(
                      "h-9 rounded-full border px-3.5 text-sm font-semibold",
                      source === v ? "border-fire-fill bg-fire-fill text-on-fire" : "border-line text-ink-2",
                    )}
                  >
                    {l}
                  </button>
                ))}
              </div>

              {results.isLoading ? (
                <Spinner className="py-10" />
              ) : results.error ? (
                <ErrorBox error={results.error} onRetry={() => results.refetch()} />
              ) : (
                <>
                  {Object.entries(errors).map(([k, msg]) => (
                    <p key={k} className="flex gap-2 rounded-input bg-warning/10 p-2.5 text-sm">
                      <AlertTriangle className="mt-0.5 size-4 shrink-0 text-warning" />
                      {k === "usda" ? "Alimentos genéricos" : "Productos comerciales"} no disponibles ahora: {msg}
                    </p>
                  ))}
                  {items.length === 0 ? (
                    <EmptyState icon={SearchX} text={`Sin resultados para “${dq}”. Prueba otra palabra, escanea el código de barras o usa “Agregar solo calorías”.`} />
                  ) : (
                    <ul className="divide-y divide-line rounded-card border border-line">
                      {items.map((it) => (
                        <li key={`${it.source}:${it.external_id}`}>
                          <ResultRow it={it} busy={resolve.isPending && resolve.variables?.external_id === it.external_id} onClick={() => resolve.mutate(it)} />
                        </li>
                      ))}
                    </ul>
                  )}
                  {results.hasNextPage && (
                    <Button variant="secondary" full loading={results.isFetchingNextPage} onClick={() => results.fetchNextPage()}>
                      Ver más resultados
                    </Button>
                  )}
                  {source !== "off" && items.some((i) => i.source === "usda") && (
                    <p className="text-center text-xs text-ink-2">Los alimentos genéricos (USDA) aparecen con su nombre en inglés.</p>
                  )}
                </>
              )}
            </>
          ) : (
            <>
              <div className="flex gap-1 rounded-btn bg-surface-2 p-1" role="tablist">
                {(
                  [
                    ["recent", "Recientes"],
                    ["frequent", "Frecuentes"],
                    ["favorites", "Favoritos"],
                  ] as const
                ).map(([v, l]) => (
                  <button
                    key={v}
                    role="tab"
                    aria-selected={quickTab === v}
                    onClick={() => setQuickTab(v)}
                    className={cx("h-10 flex-1 rounded-[9px] text-sm font-semibold", quickTab === v ? "bg-fire-fill text-on-fire" : "text-ink-2")}
                  >
                    {l}
                  </button>
                ))}
              </div>
              {quick.isLoading ? (
                <Spinner className="py-10" />
              ) : quickItems.length === 0 ? (
                <p className="px-2 py-8 text-center text-[15px] text-ink-2">
                  {quickTab === "favorites"
                    ? "Toca la ★ en un alimento para guardarlo aquí."
                    : quickTab === "frequent"
                      ? "Aquí aparecerá lo que comes seguido."
                      : "Busca tu primer alimento arriba."}
                </p>
              ) : (
                <ul className="divide-y divide-line rounded-card border border-line">
                  {quickItems.map((f) => (
                    <li key={f.id} className="flex items-center">
                      <button onClick={() => onPick(f)} className="flex min-w-0 flex-1 items-center gap-3 px-3 py-2.5 text-left hover:bg-surface-2">
                        <FoodThumb url={f.image_url} size={40} />
                        <span className="min-w-0 flex-1">
                          <span className="flex items-center gap-1 truncate font-semibold first-letter:uppercase">
                            {f.favorite && <Star className="size-3.5 shrink-0 fill-gold text-gold" />}
                            <span className="truncate">{f.name}</span>
                          </span>
                          <span className="block truncate text-sm text-ink-2">
                            {f.brand && `${f.brand} · `}
                            {f.last_amount ? `última vez ${fmtN(f.last_amount)} ${f.basis_unit}` : `${fmtN(f.kcal, 0)} kcal / 100 ${f.basis_unit}`}
                          </span>
                        </span>
                      </button>
                      {f.last_amount && (
                        <button
                          onClick={() => onQuickAdd(f)}
                          aria-label={`Repetir ${f.name}, ${f.last_amount} ${f.basis_unit}`}
                          title="Repetir la última cantidad"
                          className="grid size-10 shrink-0 place-items-center rounded-full border border-line text-ink hover:bg-surface-2"
                        >
                          <Plus className="size-5" />
                        </button>
                      )}
                      <button
                        onClick={() => removeQuick.mutate({ f, tab: quickTab })}
                        disabled={removeQuick.isPending && removeQuick.variables?.f.id === f.id}
                        aria-label={quickTab === "favorites" ? `Quitar ${f.name} de favoritos` : `Quitar ${f.name} de la lista`}
                        title={quickTab === "favorites" ? "Quitar de favoritos" : "Quitar de la lista"}
                        className="mr-1 grid size-10 shrink-0 place-items-center rounded-full text-ink-2 hover:bg-surface-2 hover:text-danger disabled:opacity-40"
                      >
                        <X className="size-5" />
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </>
          )}
          <p className="pt-1 text-center text-xs text-ink-2">Datos: USDA FoodData Central y Open Food Facts (ODbL).</p>
        </div>
      )}
    </Sheet>
  );
}

function ResultRow({ it, busy, onClick }: { it: FoodItem; busy: boolean; onClick: () => void }) {
  return (
    <button onClick={onClick} disabled={busy} className="flex w-full items-center gap-3 px-3 py-2.5 text-left hover:bg-surface-2 disabled:opacity-60">
      <FoodThumb url={it.image_url} size={48} />
      <span className="min-w-0 flex-1">
        <span className="block truncate font-semibold first-letter:uppercase">{it.name}</span>
        <span className="block truncate text-sm text-ink-2">
          {it.brand && `${it.brand} · `}
          {sourceLabel(it.source)}
          {it.is_mexican && " · México"}
        </span>
        <span className="mt-0.5 flex items-center gap-1 text-xs font-medium tabular-nums text-ink-2">
          {it.suspicious && <AlertTriangle className="size-3.5 text-warning" aria-label="Datos dudosos" />}
          <b className="text-ink">{fmtN(it.kcal, 0)} kcal</b> · P {fmtN(it.protein_g)} · C {fmtN(it.carbs_g)} · G {fmtN(it.fat_g)}
          <span className="text-ink-2">/100 {it.basis_unit}</span>
        </span>
      </span>
      {busy && <Spinner className="!py-0" />}
    </button>
  );
}

/** Escáner de código de barras (EAN/UPC) → Open Food Facts. */
function BarcodeScanner({ onClose, onFound }: { onClose: () => void; onFound: (f: FoodItem) => void }) {
  const [msg, setMsg] = useState<string | null>(null);
  const [manual, setManual] = useState("");
  const [busy, setBusy] = useState(false);
  const done = useRef(false);

  async function lookup(code: string) {
    if (done.current) return;
    done.current = true;
    setBusy(true);
    setMsg(null);
    try {
      const f = (await unwrap(api.GET("/api/nutrition/barcode/{code}", { params: { path: { code } } }))) as unknown as FoodItem;
      navigator.vibrate?.(80);
      onFound(f);
    } catch (e) {
      setMsg(e instanceof ApiError ? e.message : "No se pudo consultar el producto.");
      done.current = false;
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    let scanner: import("html5-qrcode").Html5Qrcode | null = null;
    let stopped = false;
    import("html5-qrcode").then(({ Html5Qrcode, Html5QrcodeSupportedFormats: F }) => {
      if (stopped) return;
      scanner = new Html5Qrcode("barcode-reader", {
        verbose: false,
        formatsToSupport: [F.EAN_13, F.EAN_8, F.UPC_A, F.UPC_E],
      });
      scanner
        .start(
          { facingMode: "environment" },
          { fps: 12, qrbox: (w) => ({ width: Math.min(w * 0.85, 320), height: 140 }) },
          (text) => {
            scanner?.stop().catch(() => {});
            lookup(text);
          },
          () => {},
        )
        .catch(() => setMsg("No se pudo abrir la cámara. Escribe el código del empaque."));
    });
    return () => {
      stopped = true;
      if (scanner?.isScanning) scanner.stop().catch(() => {});
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="space-y-3">
      <div className="relative overflow-hidden rounded-card bg-black">
        <div id="barcode-reader" className="aspect-[4/3] w-full [&_video]:size-full [&_video]:object-cover" />
        <div className="pointer-events-none absolute inset-x-[8%] top-1/2 h-24 -translate-y-1/2 rounded-btn border-4 border-fire" />
        <button onClick={onClose} aria-label="Cerrar escáner" className="absolute right-2 top-2 grid size-10 place-items-center rounded-full bg-black/60 text-white">
          <X className="size-5" />
        </button>
      </div>
      <p className="text-center text-[15px] text-ink-2">{busy ? "Buscando el producto…" : "Apunta al código de barras del empaque."}</p>
      {msg && (
        <p role="alert" className="rounded-input bg-danger/10 p-3 text-[15px] font-medium text-danger">
          {msg}
        </p>
      )}
      <form
        className="flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          if (manual.length >= 6) lookup(manual);
        }}
      >
        <Input inputMode="numeric" value={manual} onChange={(e) => setManual(e.target.value.replace(/\D/g, ""))} placeholder="o escribe el código" aria-label="Código de barras" />
        <Button type="submit" variant="dark" disabled={manual.length < 6} loading={busy}>
          Buscar
        </Button>
      </form>
      <Button variant="secondary" full onClick={onClose}>
        Buscar por nombre
      </Button>
    </div>
  );
}
