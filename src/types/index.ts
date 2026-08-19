export type ItemKind = "TEXT" | "HTML" | "IMAGE";

export type ItemType =
  | "TEXT"
  | "URL"
  | "CODE"
  | "JSON"
  | "COMMAND"
  | "EMAIL"
  | "IMAGE"
  | "FILE";

export type ItemStatus = "TEMPORARY" | "SAVED" | "PINNED";

export interface ClipboardItem {
  id: number;
  kind: ItemKind;
  content: string | null;
  html: string | null;
  image_base64: string | null;
  preview_base64: string | null;
  sha256: string;
  item_type: ItemType;
  status: ItemStatus;
  is_sensitive: boolean;
  expires_at: string | null;
  created_at: string;
  collections: string[];
}

export interface Collection {
  id: number;
  name: string;
  created_at: string;
  item_count: number;
  pinned: boolean;
}

export interface ItemFilters {
  kind?: string;
  item_type?: string;
  status?: string;
  collection_id?: number;
  limit?: number;
  offset?: number;
}

export interface Stats {
  total: number;
  temporary: number;
  saved: number;
  pinned: number;
  images: number;
  sensitive: number;
  storage_bytes: number;
}

export interface Settings {
  retention_hours: number;
  max_history: number;
  capture_images: boolean;
  secret_detection: boolean;
  global_shortcut: string;
  theme: string;
  language: string;
  launch_on_startup: boolean;
  start_minimized: boolean;
  click_to_copy: boolean;
}