import { useEffect } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { listen } from "@tauri-apps/api/event";
import { emit } from "@tauri-apps/api/event";
import { Toaster } from "sonner";
import { Sidebar } from "@/components/layout/Sidebar";
import { HistoryView } from "@/components/history/HistoryView";
import { SettingsView } from "@/components/settings/SettingsView";
import { BackendErrorScreen } from "@/components/auth/BackendErrorScreen";
import { LoginView } from "@/components/auth/LoginView";
import { useClipboardEvents, useSettingsQuery } from "@/hooks/useClipboardData";
import { useUiStore } from "@/stores/ui";
import { useAuthStore } from "@/stores/auth";
import i18n from "@/i18n";
import { applyTheme, type Theme } from "@/lib/theme";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 1000,
      refetchOnWindowFocus: true,
    },
  },
});

function useThemeSync() {
  const { data: settings } = useSettingsQuery();
  useEffect(() => {
    if (settings?.theme) applyTheme(settings.theme as Theme);
  }, [settings?.theme]);

  useEffect(() => {
    if (settings?.language) {
      void i18n.changeLanguage(settings.language);
    }
  }, [settings?.language]);
}

function useSettingsEvent() {
  const setView = useUiStore((s) => s.setView);
  useEffect(() => {
    let un: (() => void) | undefined;
    void listen("clipy://open-settings", () => setView("settings")).then((u) => (un = u));
    return () => un?.();
  }, [setView]);
}

function AppContent() {
  useClipboardEvents();
  useThemeSync();
  useSettingsEvent();
  const view = useUiStore((s) => s.view);
  const authStatus = useAuthStore((s) => s.status);
  const initialize = useAuthStore((s) => s.initialize);

  useEffect(() => {
    void initialize().finally(() => {
      void emit("clipy://app-ready");
    });
  }, [initialize]);

  if (authStatus === "loading") {
    return null;
  }

  if (authStatus === "error") {
    return (
      <>
        <BackendErrorScreen />
        <Toaster position="top-center" closeButton />
      </>
    );
  }

  if (authStatus === "guest" && view === "login") {
    return (
      <>
        <LoginView />
        <Toaster position="top-center" closeButton />
      </>
    );
  }

  return (
    <div className="flex h-screen overflow-hidden bg-background text-foreground">
      <Sidebar />
      {view === "settings" ? <SettingsView /> : <HistoryView />}
      <Toaster position="top-center" closeButton />
    </div>
  );
}

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <AppContent />
    </QueryClientProvider>
  );
}