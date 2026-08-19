import { create } from "zustand";
import type { ItemType } from "@/types";

export type TypeFilter = "ALL" | ItemType;
export type View = "history" | "settings" | "login";

interface UiState {
  view: View;
  query: string;
  typeFilter: TypeFilter;
  collectionFilter: number | null;
  selectedId: number | null;

  setView: (v: View) => void;
  setQuery: (q: string) => void;
  setTypeFilter: (t: TypeFilter) => void;
  setCollectionFilter: (id: number | null) => void;
  setSelectedId: (id: number | null) => void;
  resetFilters: () => void;
}

export const useUiStore = create<UiState>((set) => ({
  view: "history",
  query: "",
  typeFilter: "ALL",
  collectionFilter: null,
  selectedId: null,

  setView: (view) => set({ view }),
  setQuery: (query) => set({ query }),
  setTypeFilter: (typeFilter) => set({ typeFilter }),
  setCollectionFilter: (collectionFilter) => set({ collectionFilter }),
  setSelectedId: (selectedId) => set({ selectedId }),
  resetFilters: () =>
    set({
      query: "",
      typeFilter: "ALL",
      collectionFilter: null,
    }),
}));
