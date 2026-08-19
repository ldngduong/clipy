export type Theme = "light" | "dark" | "system";

export const THEME_EVENT = "clipy:theme-changed";

export function getStoredTheme(): Theme {
  const v = localStorage.getItem("theme");
  return v === "light" || v === "dark" || v === "system" ? v : "system";
}

export function isDarkNow(): boolean {
  return document.documentElement.classList.contains("dark");
}

export function applyTheme(theme: Theme) {
  const root = document.documentElement;
  const dark =
    theme === "dark" ||
    (theme === "system" &&
      window.matchMedia("(prefers-color-scheme: dark)").matches);
  root.classList.toggle("dark", dark);
  root.style.colorScheme = dark ? "dark" : "light";
  localStorage.setItem("theme", theme);
  window.dispatchEvent(new Event(THEME_EVENT));
}

export function initTheme() {
  applyTheme(getStoredTheme());
  window
    .matchMedia("(prefers-color-scheme: dark)")
    .addEventListener("change", () => {
      if (getStoredTheme() === "system") applyTheme("system");
    });
}
