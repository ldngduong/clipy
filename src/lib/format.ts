import type { TFunction } from "i18next";

export function timeAgo(iso: string, t: TFunction): string {
  const then = new Date(normalizeUtc(iso)).getTime();
  if (Number.isNaN(then)) return "";
  const diffSec = Math.max(0, (Date.now() - then) / 1000);
  if (diffSec < 60) return t("item.justNow");
  const min = Math.floor(diffSec / 60);
  if (min < 60) return t("item.minAgo", { count: min });
  const h = Math.floor(min / 60);
  if (h < 24) return t("item.hourAgo", { count: h });
  const d = Math.floor(h / 24);
  if (d < 30) return t("item.dayAgo", { count: d });
  return new Date(normalizeUtc(iso)).toLocaleDateString();
}

function normalizeUtc(iso: string): string {
  if (iso.endsWith("Z")) return iso;
  return iso.replace(" ", "T") + "Z";
}

export function truncate(s: string, max = 160): string {
  if (s.length <= max) return s;
  return s.slice(0, max) + "…";
}