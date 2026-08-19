import { invoke } from "@tauri-apps/api/core";
import type {
  ClipboardItem,
  Collection,
  ItemFilters,
  Settings,
  Stats,
} from "@/types";

export const api = {
  getItems: (filters?: ItemFilters) =>
    invoke<ClipboardItem[]>("get_items", { filters: filters ?? null }),

  searchItems: (query: string, filters?: ItemFilters) =>
    invoke<ClipboardItem[]>("search_items", { query, filters: filters ?? null }),

  getItem: (id: number) => invoke<ClipboardItem>("get_item", { id }),

  setItemStatus: (id: number, status: string) =>
    invoke<void>("set_item_status", { id, status }),

  deleteItem: (id: number) => invoke<void>("delete_item", { id }),

  clearHistory: () => invoke<number>("clear_history"),



  copyItem: (id: number) => invoke<void>("copy_item", { id }),

  getCollections: () => invoke<Collection[]>("get_collections"),

  createCollection: (name: string) => invoke<number>("create_collection", { name }),

  renameCollection: (id: number, name: string) =>
    invoke<void>("rename_collection", { id, name }),

  deleteCollection: (id: number) => invoke<void>("delete_collection", { id }),

  setCollectionPinned: (id: number, pinned: boolean) =>
    invoke<void>("set_collection_pinned", { id, pinned }),

  setItemCollection: (itemId: number, collectionId: number | null) =>
    invoke<void>("set_item_collection", { itemId, collectionId }),







  getSettings: () => invoke<Settings>("get_settings"),

  setSettings: (settings: Settings) => invoke<void>("set_settings", { settings }),

  setCapturePaused: (paused: boolean) =>
    invoke<void>("set_capture_paused", { paused }),

  getStats: () => invoke<Stats>("get_stats"),

  getDbPath: () => invoke<string>("get_db_path"),
};