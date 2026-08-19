import { useEffect, useMemo, useRef } from "react";
import { Search, X, ClipboardList, Trash2 } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { useUiStore, type TypeFilter } from "@/stores/ui";
import { useTranslation } from "react-i18next";
import { useItemsQuery, useItemMutations } from "@/hooks/useClipboardData";
import { HistoryItem } from "@/components/history/HistoryItem";

const TYPE_FILTERS: TypeFilter[] = [
  "ALL",
  "TEXT",
  "URL",
  "CODE",
  "JSON",
  "COMMAND",
  "EMAIL",
  "IMAGE",
];

function translateType(t: (k: string) => string, f: string): string {
  if (f === "TEXT" || f === "COMMAND" || f === "IMAGE" || f === "EMAIL") return t(`types.${f}`);
  return f;
}

function FilterChip({
  label,
  active,
  onClick,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "rounded-full px-2.5 py-0.5 text-xs font-medium transition-colors",
        active
          ? "bg-primary text-primary-foreground"
          : "bg-muted text-muted-foreground hover:bg-muted/60 hover:text-foreground",
      )}
    >
      {label}
    </button>
  );
}

export function HistoryView() {
  const { t } = useTranslation();
  const {
    query,
    typeFilter,
    setQuery,
    setTypeFilter,
    selectedId,
    setSelectedId,
  } = useUiStore();
  const itemsQuery = useItemsQuery();
  const mutations = useItemMutations();
  const listRef = useRef<HTMLDivElement>(null);

  const items = itemsQuery.data ?? [];
  const activeFilterCount = [
    typeFilter !== "ALL",
    query.trim() !== "",
  ].filter(Boolean).length;

  const selectedIndex = useMemo(
    () => items.findIndex((i) => i.id === selectedId),
    [items, selectedId],
  );

  useEffect(() => {
    const viewport = listRef.current?.querySelector<HTMLElement>(
      "[data-radix-scroll-area-viewport]",
    );
    const el = listRef.current?.querySelector<HTMLElement>(
      `[data-item-id="${selectedId}"]`,
    );
    el?.scrollIntoView({ block: "nearest" });
    void viewport;
  }, [selectedId]);

  const moveSelection = (dir: 1 | -1) => {
    if (items.length === 0) return;
    const next =
      selectedIndex === -1
        ? 0
        : (selectedIndex + dir + items.length) % items.length;
    setSelectedId(items[next].id);
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      moveSelection(1);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      moveSelection(-1);
    } else if (e.key === "Escape" && query) {
      setQuery("");
    }
  };

  return (
    <div className="flex min-w-0 flex-1 flex-col" onKeyDown={onKeyDown}>
      <div className="flex items-center gap-2 border-b px-4 py-2.5">
        <Search className="size-4 shrink-0 text-muted-foreground" />
        <Input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={t("history.searchPlaceholder")}
          className="border-none bg-transparent shadow-none focus-visible:ring-0"
        />
        {query && (
          <Button
            variant="ghost"
            size="icon"
            className="size-7 shrink-0"
            onClick={() => setQuery("")}
          >
            <X className="size-4" />
          </Button>
        )}
        {activeFilterCount > 0 && (
          <Button
            variant="ghost"
            size="sm"
            className="shrink-0 text-xs text-muted-foreground"
            onClick={() => {
              setQuery("");
              setTypeFilter("ALL");
            }}
          >
            {t("history.clearActive", { count: activeFilterCount })}
          </Button>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-1.5 border-b px-4 py-2">
        {TYPE_FILTERS.map((f) => (
          <FilterChip
            key={f}
            label={f === "ALL" ? t("history.all") : translateType(t, f)}
            active={typeFilter === f}
            onClick={() => setTypeFilter(f)}
          />
        ))}
        <div className="ml-auto">
          <Button
            variant="ghost"
            size="sm"
            className="h-6 px-2 text-xs text-muted-foreground hover:text-destructive"
            onClick={() => {
              if (confirm(t("history.clearConfirm"))) {
                mutations.clearHistory.mutate();
              }
            }}
          >
            <Trash2 className="mr-1 size-3.5" /> {t("history.clear")}
          </Button>
        </div>
      </div>

      <ScrollArea className="min-h-0 min-w-0 flex-1 overflow-hidden" ref={listRef}>
        <div className="flex flex-col gap-3 p-3">
          {itemsQuery.isLoading && (
            <>
              {Array.from({ length: 8 }).map((_, i) => (
                <Skeleton key={i} className="h-20 w-full" />
              ))}
            </>
          )}

          {!itemsQuery.isLoading && items.length === 0 && (
            <div className="flex flex-col items-center gap-2 py-20 text-muted-foreground">
              <ClipboardList className="size-10" />
              <p className="text-sm">
                {query.trim() || activeFilterCount > 0
                  ? t("history.noMatches")
                  : t("history.empty")}
              </p>
            </div>
          )}

          {items.map((item) => (
            <div key={item.id} data-item-id={item.id} className="min-w-0">
              <HistoryItem
                item={item}
                selected={item.id === selectedId}
              />
            </div>
          ))}
        </div>
      </ScrollArea>
    </div>
  );
}