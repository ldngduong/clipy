import { useEffect } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { listen } from "@tauri-apps/api/event";
import { toast } from "sonner";
import { api } from "@/lib/api";
import { useUiStore } from "@/stores/ui";

export const itemKeys = {
  all: ["items"] as const,
  list: (query: string, filters: object) => ["items", query, filters] as const,
  collections: ["collections"] as const,
  stats: ["stats"] as const,
  settings: ["settings"] as const,
};

export function useItemsQuery() {
  const query = useUiStore((s) => s.query);
  const typeFilter = useUiStore((s) => s.typeFilter);
  const collectionFilter = useUiStore((s) => s.collectionFilter);
  const filters = {
    item_type: typeFilter === "ALL" ? undefined : typeFilter,
    collection_id: collectionFilter ?? undefined,
    limit: 200,
  };

  return useQuery({
    queryKey: itemKeys.list(query.trim(), filters),
    queryFn: () =>
      query.trim()
        ? api.searchItems(query.trim(), filters)
        : api.getItems(filters),
    placeholderData: (prev) => prev,
    refetchInterval: 3000,
  });
}

export function useCollectionsQuery() {
  return useQuery({
    queryKey: itemKeys.collections,
    queryFn: api.getCollections,
  });
}

export function useStatsQuery() {
  return useQuery({
    queryKey: itemKeys.stats,
    queryFn: api.getStats,
  });
}

export function useSettingsQuery() {
  return useQuery({
    queryKey: itemKeys.settings,
    queryFn: api.getSettings,
  });
}

function useInvalidate() {
  const qc = useQueryClient();
  return () => {
    qc.invalidateQueries({ queryKey: itemKeys.all });
    qc.invalidateQueries({ queryKey: itemKeys.collections });
    qc.invalidateQueries({ queryKey: itemKeys.stats });
  };
}

export function useItemMutations() {
  const qc = useQueryClient();
  const invalidate = useInvalidate();

  const invalidateAll = () => {
    qc.invalidateQueries({ queryKey: itemKeys.all });
    qc.invalidateQueries({ queryKey: itemKeys.collections });
    qc.invalidateQueries({ queryKey: itemKeys.stats });
  };

  return {
    setStatus: useMutation({
      mutationFn: ({ id, status }: { id: number; status: string }) =>
        api.setItemStatus(id, status),
      onSuccess: invalidateAll,
      onError: (e) => toast.error(String(e)),
    }),
    delete: useMutation({
      mutationFn: api.deleteItem,
      onSuccess: invalidateAll,
      onError: (e) => toast.error(String(e)),
    }),
    setCollection: useMutation({
      mutationFn: ({ itemId, collectionId }: { itemId: number; collectionId: number | null }) =>
        api.setItemCollection(itemId, collectionId),
      onSuccess: invalidateAll,
      onError: (e) => toast.error(String(e)),
    }),
    copy: useMutation({
      mutationFn: api.copyItem,
      onError: (e) => toast.error(String(e)),
    }),
    clearHistory: useMutation({
      mutationFn: api.clearHistory,
      onSuccess: () => {
        invalidate();
        toast.success("History cleared");
      },
      onError: (e) => toast.error(String(e)),
    }),
  };
}

export function useClipboardEvents() {
  const qc = useQueryClient();

  useEffect(() => {
    const unlisteners: (() => void)[] = [];
    let cancelled = false;

    const invalidate = () => {
      if (cancelled) return;
      qc.invalidateQueries({ queryKey: itemKeys.all });
      qc.invalidateQueries({ queryKey: itemKeys.collections });
        qc.invalidateQueries({ queryKey: itemKeys.stats });
    };

    const events = [
      "clipy://item-created",
      "clipy://item-updated",
      "clipy://item-deleted",
      "clipy://items-deleted",
      "clipy://history-cleared",
      "clipy://collections-changed",
      "clipy://settings-changed",
      "clipy://capture-paused",
      "clipy://items-restored",
    ];

    Promise.all(
      events.map((name) =>
        listen(name, () => {
          invalidate();
        }),
      ),
    ).then((ls) => unlisteners.push(...ls));

    return () => {
      cancelled = true;
      unlisteners.forEach((u) => u());
    };
  }, [qc]);
}