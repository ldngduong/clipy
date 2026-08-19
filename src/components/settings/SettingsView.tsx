import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { applyTheme, type Theme } from "@/lib/theme";
import { ArrowLeft, DatabaseBackup, Keyboard, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  CollectionSelectDialog,
  type CollectionEntry,
} from "@/components/settings/CollectionSelectDialog";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { useUiStore } from "@/stores/ui";
import { useSettingsQuery } from "@/hooks/useClipboardData";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { useAuthStore } from "@/stores/auth";
import i18n from "@/i18n";
import type { Settings } from "@/types";

function modName(code: string): string | null {
  switch (code) {
    case "ControlLeft":
    case "ControlRight":
    case "Control":
      return "Ctrl";
    case "ShiftLeft":
    case "ShiftRight":
    case "Shift":
      return "Shift";
    case "AltLeft":
    case "AltRight":
    case "Alt":
      return "Alt";
    case "MetaLeft":
    case "MetaRight":
    case "Meta":
      return "Super";
    default:
      return null;
  }
}

function keyName(code: string): string | null {
  if (code.startsWith("Key")) return code.slice(3);
  if (code.startsWith("Digit")) return code.slice(5);
  if (code.startsWith("F") && code.length > 1) return code;
  switch (code) {
    case "Space":
      return "Space";
    case "Enter":
      return "Enter";
    case "Backspace":
      return "Backspace";
    case "Delete":
      return "Delete";
    case "Tab":
      return "Tab";
    case "Escape":
      return "Escape";
    case "ArrowUp":
      return "Up";
    case "ArrowDown":
      return "Down";
    case "ArrowLeft":
      return "Left";
    case "ArrowRight":
      return "Right";
    case "Home":
      return "Home";
    case "End":
      return "End";
    case "PageUp":
      return "PageUp";
    case "PageDown":
      return "PageDown";
    case "Minus":
      return "-";
    case "Equal":
      return "=";
    case "Comma":
      return ",";
    case "Period":
      return ".";
    case "Semicolon":
      return ";";
    case "Quote":
      return "'";
    case "Backquote":
      return "`";
    case "BracketLeft":
      return "[";
    case "BracketRight":
      return "]";
    case "Backslash":
      return "\\";
    case "Slash":
      return "/";
    default:
      return null;
  }
}

export function ShortcutInput({
  value,
  onChange,
  className,
}: {
  value: string;
  onChange: (v: string) => void;
  className?: string;
}) {
  const { t } = useTranslation();
  const [listening, setListening] = useState(false);
  const display = value
    .replace(/^CommandOrControl\+/, "Ctrl+")
    .replace(/\+Control\+/g, "+Ctrl+")
    .replace(/^Control\+/, "Ctrl+");

  const commit = (mods: string[], key: string) => {
    onChange([...mods, key].join("+"));
    setListening(false);
  };

  const onKeyDown = (e: KeyboardEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.key === "Escape") {
      setListening(false);
      return;
    }
    const mods: string[] = [];
    if (e.ctrlKey) mods.push("Ctrl");
    if (e.shiftKey) mods.push("Shift");
    if (e.altKey) mods.push("Alt");
    if (e.metaKey) mods.push("Super");
    const key = keyName(e.code);
    if (!key || modName(e.code)) return;
    if (mods.length === 0) return;
    commit(mods, key);
  };

  useEffect(() => {
    if (!listening) return;
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [listening]);

  return (
    <button
      type="button"
      onClick={() => setListening(true)}
      className={cn(
        "flex h-8 items-center justify-center gap-2 rounded-lg border border-input bg-transparent px-2.5 text-sm text-muted-foreground transition-colors hover:bg-accent/50 focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50",
        className,
      )}
    >
      {listening ? (
        <>
          <span className="animate-pulse text-primary">{t("settings.shortcutListening")}</span>
        </>
      ) : (
        <>
          <Keyboard className="size-3.5" />
          <span>{display}</span>
        </>
      )}
    </button>
  );
}

function formatBytes(bytes: number): string {
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function SettingsView() {
  const { t } = useTranslation();
  const setView = useUiStore((s) => s.setView);
  const settingsQuery = useSettingsQuery();
  const user = useAuthStore((s) => s.user);
  const setUser = useAuthStore((s) => s.setUser);
  const [form, setForm] = useState<Settings | null>(null);
  const qc = useQueryClient();
  const [backupConfirmOpen, setBackupConfirmOpen] = useState(false);
  const [restoreConfirmOpen, setRestoreConfirmOpen] = useState(false);
  const [backupPending, setBackupPending] = useState(false);
  const [restorePending, setRestorePending] = useState(false);
  const [checkoutPending, setCheckoutPending] = useState(false);
  const [portalPending, setPortalPending] = useState(false);
  const [selectOpen, setSelectOpen] = useState(false);
  const [selectMode, setSelectMode] = useState<"backup" | "restore">("backup");
  const [selectEntries, setSelectEntries] = useState<CollectionEntry[]>([]);
  const [pendingBackupSnapshot, setPendingBackupSnapshot] = useState<BackupSnapshot | null>(
    null,
  );
  const [selectedNames, setSelectedNames] = useState<string[]>([]);
  const [selectPending, setSelectPending] = useState(false);

  interface BackupSnapshot {
    app?: string;
    version?: number;
    exported_at?: string;
    collections?: { name?: string; created_at?: string }[];
    items?: {
      kind?: string;
      content?: string | null;
      html?: string | null;
      image_key?: string;
      image_base64?: string;
      sha256?: string;
      item_type?: string;
      status?: string;
      is_sensitive?: boolean;
      expires_at?: string | null;
      created_at?: string;
      updated_at?: string;
      collections?: string[];
    }[];
  }

  const FREE_MAX_COLLECTIONS = 10;

  const openSelect = (
    mode: "backup" | "restore",
    entries: CollectionEntry[],
    snapshot?: BackupSnapshot,
  ) => {
    setSelectMode(mode);
    setSelectEntries(entries);
    setPendingBackupSnapshot(snapshot ?? null);
    setSelectedNames([]);
    setSelectPending(false);
    setSelectOpen(true);
  };

  const localSummary = (snapshot: BackupSnapshot): CollectionEntry[] => {
    const counts = new Map<string, number>();
    for (const item of snapshot.items ?? []) {
      if (!item.collections || item.collections.length === 0) continue;
      for (const name of item.collections) {
        counts.set(name, (counts.get(name) ?? 0) + 1);
      }
    }
    return (snapshot.collections ?? [])
      .filter((c) => c.name)
      .map((c) => ({ name: c.name as string, itemCount: counts.get(c.name as string) ?? 0 }));
  };

  const toggleSelected = (name: string) => {
    setSelectedNames((prev) => {
      if (prev.includes(name)) return prev.filter((n) => n !== name);
      if (prev.length >= FREE_MAX_COLLECTIONS) return prev;
      return [...prev, name];
    });
  };

  const confirmSelection = async () => {
    setSelectPending(true);
    try {
      if (selectMode === "backup") {
        if (!pendingBackupSnapshot) return;
        const filtered = filterSnapshot(pendingBackupSnapshot, selectedNames);
        await putBackup(filtered);
      } else {
        const { request } = await import("@/lib/auth");
        const restored = await request<{ data: BackupSnapshot }>(
          `/backup/restore?collections=${encodeURIComponent(selectedNames.join(","))}`,
        );
        await doRestore(restored.data);
      }
      setSelectOpen(false);
    } catch (e) {
      toast.error(
        selectMode === "backup"
          ? t("backup.failed", { error: String(e) })
          : t("backup.restoreFailed", { error: String(e) }),
      );
    } finally {
      setSelectPending(false);
    }
  };

  const putBackup = async (
    data: string,
    images: { sha256: string; base64: string }[] = [],
  ) => {
    const { request, uploadBackupImage, base64ToBytes } = await import("@/lib/auth");
    for (const image of images) {
      await uploadBackupImage(image.sha256, base64ToBytes(image.base64));
    }
    const saved = await request<{
      items: number;
      collections: number;
      updatedAt: string;
    }>("/backup", {
      method: "PUT",
      body: JSON.stringify({ data }),
    });
    toast.success(
      t("backup.success", { items: saved.items, collections: saved.collections }),
    );
    qc.invalidateQueries({ queryKey: ["backup-quota"] });
  };

  const doRestore = async (snapshot: BackupSnapshot) => {
    const { downloadBackupImage, bytesToBase64 } = await import("@/lib/auth");
    for (const item of snapshot.items ?? []) {
      if (item.kind === "IMAGE" && item.image_key) {
        const bytes = await downloadBackupImage(item.image_key);
        item.image_base64 = bytesToBase64(bytes);
      }
    }
    const { invoke } = await import("@tauri-apps/api/core");
    const result = await invoke<{
      items: number;
      collections: number;
      collections_removed: number;
      items_removed: number;
    }>("import_backup", { data: JSON.stringify(snapshot) });
    toast.success(
      t("backup.restoreSuccess", {
        items: result.items,
        collections: result.collections,
        collectionsRemoved: result.collections_removed,
        itemsRemoved: result.items_removed,
      }),
    );
    qc.invalidateQueries();
  };

  const filterSnapshot = (snapshot: BackupSnapshot, names: string[]): string => {
    const kept = new Set(names);
    return JSON.stringify({
      ...snapshot,
      collections: (snapshot.collections ?? []).filter(
        (c) => c.name && kept.has(c.name),
      ),
      items: (snapshot.items ?? []).filter((it) => {
        if (!it.collections || it.collections.length === 0) return true;
        return it.collections.every((name) => kept.has(name));
      }),
    });
  };

  const quotaQuery = useQuery({
    queryKey: ["backup-quota"],
    queryFn: async () => {
      const { request } = await import("@/lib/auth");
      return request<{ usedBytes: number; limitBytes: number }>("/backup/quota");
    },
    enabled: user?.plan === "pro",
  });

  useEffect(() => {
    if (settingsQuery.data && !form) setForm(settingsQuery.data);
  }, [settingsQuery.data]);

  const save = useMutation({
    mutationFn: async (s: Settings) => {
      await api.setSettings(s);
      i18n.changeLanguage(s.language);
      return s;
    },
    onSuccess: (s) => {
      toast.success(t("settings.saved"));
      setForm(s);
    },
    onError: () => toast.error(t("settings.saveFailed")),
  });

  const billingQuery = useQuery({
    queryKey: ["paddle-status"],
    queryFn: async () => {
      const { getBillingStatus } = await import("@/lib/auth");
      return getBillingStatus();
    },
    enabled: !!user,
    refetchInterval: 60_000,
  });

  const upgrade = async (priceKey: "monthly" | "yearly") => {
    if (!user?.email) return;
    setCheckoutPending(true);
    try {
      const { getPaddleCatalog, getBillingStatus, request } = await import("@/lib/auth");
      const catalog = await getPaddleCatalog();
      const checkoutUrl = catalog.checkoutUrl[priceKey];
      if (!checkoutUrl) {
        throw new Error(t("plans.notConfigured"));
      }
      const { openUrl } = await import("@tauri-apps/plugin-opener");
      const lang = i18n.language?.toLowerCase().startsWith("vi") ? "vi" : "en";
      await openUrl(
        `${checkoutUrl}&email=${encodeURIComponent(user.email)}&lang=${lang}`,
      );
      for (let i = 0; i < 10; i++) {
        await new Promise((r) => setTimeout(r, 4000));
        const status = await getBillingStatus();
        if (status.subscription) break;
      }
      const fresh = await request<{
        id: string;
        email: string;
        displayName: string;
        avatarUrl: string | null;
        plan: "free" | "pro";
      }>("/auth/me");
      setUser(fresh);
      qc.invalidateQueries({ queryKey: ["paddle-status"] });
      if (fresh.plan === "pro") toast.success(t("plans.upgraded"));
    } catch (e) {
      toast.error(String(e));
    } finally {
      setCheckoutPending(false);
    }
  };

  const manage = async () => {
    setPortalPending(true);
    try {
      const { createPortalSession } = await import("@/lib/auth");
      const url = await createPortalSession();
      const { openUrl } = await import("@tauri-apps/plugin-opener");
      await openUrl(url);
    } catch (e) {
      toast.error(t("plans.portalFailed", { error: String(e) }));
    } finally {
      setPortalPending(false);
    }
  };

  const scheduledChange = billingQuery.data?.subscription?.scheduledChange
    ? new Date(billingQuery.data.subscription.scheduledChange)
    : null;

  if (!form) return null;

  const set = (patch: Partial<Settings>) => setForm({ ...form, ...patch });

  return (
    <div className="min-w-0 flex-1 overflow-y-auto">
      <div className="flex items-center gap-2 border-b px-4 py-3">
        <Button
          variant="ghost"
          size="icon"
          className="size-7"
          onClick={() => setView("history")}
        >
          <ArrowLeft className="size-4" />
        </Button>
        <h1 className="text-sm font-semibold">{t("settings.title")}</h1>
      </div>

      <div className="flex flex-col gap-5 p-3">
        {user ? (
          <div className="rounded-lg border p-3">
            <div className="flex items-center justify-between">
              <div className="flex min-w-0 items-center gap-2">
                {user.avatarUrl ? (
                  <img
                    src={user.avatarUrl}
                    alt=""
                    className="size-8 shrink-0 rounded-full"
                  />
                ) : (
                  <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-accent text-sm font-semibold">
                    {(user.displayName || user.email).trim().charAt(0).toUpperCase()}
                  </span>
                )}
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">
                    {user?.displayName || user?.email}
                  </p>
                  <p className="truncate text-xs text-muted-foreground">{user?.email}</p>
                </div>
              </div>
              <span className="shrink-0 rounded-full bg-accent px-2.5 py-0.5 text-xs font-semibold">
                {user.plan === "pro" ? "Pro" : "Free"}
              </span>
            </div>
            {user.plan === "pro" && billingQuery.data?.subscription && (
              <div className="mt-3 space-y-2">
                {billingQuery.data.subscription.status === "past_due" && (
                  <p className="text-xs font-medium text-amber-600">
                    {t("plans.pastDue")}
                  </p>
                )}
                {scheduledChange && (
                  <p className="text-xs text-muted-foreground">
                    {t("plans.cancelScheduled", {
                      date: scheduledChange.toLocaleDateString(),
                    })}
                  </p>
                )}
                <div className="flex justify-end">
                  <Button
                    variant="outline"
                    size="sm"
                    className="shrink-0"
                    disabled={portalPending}
                    onClick={manage}
                  >
                    {t("plans.manage")}
                  </Button>
                </div>
              </div>
            )}
            {user.plan !== "pro" && (
              <div className="mt-3 flex justify-end gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  className="shrink-0"
                  disabled={checkoutPending}
                  onClick={() => upgrade("yearly")}
                >
                  {t("plans.upgradeYearly")}
                </Button>
                <Button
                  size="sm"
                  className="shrink-0"
                  disabled={checkoutPending}
                  onClick={() => upgrade("monthly")}
                >
                  {t("plans.upgradeMonthly")}
                </Button>
              </div>
            )}
          </div>
        ) : (
          <div className="flex items-center justify-between rounded-lg border p-3">
            <p className="text-sm font-medium">{t("sidebar.guest")}</p>
            <Button
              variant="outline"
              size="sm"
              className="shrink-0"
              onClick={() => setView("login")}
            >
              {t("auth.login")}
            </Button>
          </div>
        )}

        {user && (
          <section className="rounded-lg border p-4">
            <h2 className="flex items-center gap-2 text-sm font-semibold">
              <DatabaseBackup className="size-4" />
              {t("backup.title")}
            </h2>
            <p className="mt-1 text-xs text-muted-foreground">
              {user.plan === "pro" ? t("backup.hintPro") : t("backup.hint")}
            </p>
            {user.plan === "pro" && quotaQuery.data && (
              <p className="mt-1 text-xs text-muted-foreground">
                {t("backup.quota", {
                  used: formatBytes(quotaQuery.data.usedBytes),
                  limit: formatBytes(quotaQuery.data.limitBytes),
                })}
              </p>
            )}
            <div className="mt-3 flex flex-col gap-2">
              <Button
                className="h-9 w-full"
                disabled={backupPending}
                onClick={() => setBackupConfirmOpen(true)}
              >
                {t("backup.doBackup")}
              </Button>
              <Button
                variant="outline"
                className="h-9 w-full"
                disabled={restorePending}
                onClick={() => setRestoreConfirmOpen(true)}
              >
                <RotateCcw className="mr-2 size-4" />
                {t("backup.doRestore")}
              </Button>
            </div>
          </section>
        )}

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div className="flex flex-col gap-1.5">
            <Label>{t("settings.language")}</Label>
            <Select
              value={form.language}
              onValueChange={(v) => {
                set({ language: v });
                save.mutate({ ...form, language: v });
              }}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="en">{t("settings.languageEn")}</SelectItem>
                <SelectItem value="vi">{t("settings.languageVi")}</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="flex flex-col gap-1.5">
            <Label>{t("settings.theme")}</Label>
            <Select
              value={form.theme}
              onValueChange={(v) => {
                set({ theme: v });
                applyTheme(v as Theme);
                save.mutate({ ...form, theme: v });
              }}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="light">{t("settings.themeLight")}</SelectItem>
                <SelectItem value="dark">{t("settings.themeDark")}</SelectItem>
                <SelectItem value="system">{t("settings.themeSystem")}</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>

        <div className="flex flex-col gap-1.5">
          <Label>{t("settings.shortcut")}</Label>
          <ShortcutInput
            className="w-full"
            value={form.global_shortcut}
            onChange={(v) => {
              set({ global_shortcut: v });
              save.mutate({ ...form, global_shortcut: v });
            }}
          />
          <p className="text-xs text-muted-foreground">{t("settings.shortcutHint")}</p>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="retention">{t("settings.retention")}</Label>
            <Input
              id="retention"
              type="number"
              min={1}
              value={form.retention_hours}
              onChange={(e) => set({ retention_hours: Number(e.target.value) })}
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="maxHistory">{t("settings.maxHistory")}</Label>
            <Input
              id="maxHistory"
              type="number"
              min={100}
              step={100}
              value={form.max_history}
              onChange={(e) => set({ max_history: Number(e.target.value) })}
            />
          </div>
        </div>

        <div className="flex flex-col gap-3">
          {(
            [
              ["capture_images", t("settings.captureImages")],
              ["secret_detection", t("settings.secretDetection")],
              ["click_to_copy", t("settings.clickToCopy")],
              ["launch_on_startup", t("settings.launchOnStartup")],
              ["start_minimized", t("settings.startMinimized")],
            ] as const
          ).map(([key, label]) => (
            <div key={key} className="flex items-center justify-between">
              <Label className="cursor-pointer">{label}</Label>
              <Switch
                checked={Boolean(form[key])}
                onCheckedChange={(v) => set({ [key]: v } as Partial<Settings>)}
              />
            </div>
          ))}
        </div>

        <div className="flex justify-end gap-2">
          <Button
            onClick={() => save.mutate(form)}
            disabled={save.isPending}
          >
            {t("common.save")}
          </Button>
        </div>

      </div>

      <Dialog open={backupConfirmOpen} onOpenChange={setBackupConfirmOpen}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>{t("backup.confirmBackupTitle")}</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">{t("backup.confirmBackupMessage")}</p>
          <DialogFooter>
            <Button variant="outline" onClick={() => setBackupConfirmOpen(false)}>
              {t("common.cancel")}
            </Button>
            <Button
              disabled={backupPending}
              onClick={async () => {
                setBackupConfirmOpen(false);
                setBackupPending(true);
                try {
                  const { invoke } = await import("@tauri-apps/api/core");
                  const exportResult = await invoke<{
                    data: string;
                    items: number;
                    collections: number;
                    images_skipped: number;
                    images: { sha256: string; base64: string }[];
                  }>("export_backup", { includeImages: user?.plan === "pro" });
                  const snapshot = JSON.parse(exportResult.data) as BackupSnapshot;
                  const needsSelect =
                    user?.plan !== "pro" &&
                    (snapshot.collections?.length ?? 0) > FREE_MAX_COLLECTIONS;
                  if (needsSelect) {
                    openSelect("backup", localSummary(snapshot), snapshot);
                    return;
                  }
                  await putBackup(exportResult.data, exportResult.images);
                } catch (e) {
                  toast.error(t("backup.failed", { error: String(e) }));
                } finally {
                  setBackupPending(false);
                }
              }}
            >
              {t("backup.doBackup")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={restoreConfirmOpen} onOpenChange={setRestoreConfirmOpen}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>{t("backup.confirmTitle")}</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">{t("backup.confirmMessage")}</p>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRestoreConfirmOpen(false)}>
              {t("common.cancel")}
            </Button>
            <Button
              variant="destructive"
              disabled={restorePending}
              onClick={async () => {
                setRestoreConfirmOpen(false);
                setRestorePending(true);
                try {
                  const { request } = await import("@/lib/auth");
                  if (user?.plan !== "pro") {
                    const summary = await request<{
                      collections: CollectionEntry[];
                    }>("/backup/collections");
                    if (summary.collections.length > FREE_MAX_COLLECTIONS) {
                      openSelect("restore", summary.collections);
                      return;
                    }
                  }
                  const backup = await request<{ data: BackupSnapshot }>("/backup");
                  await doRestore(backup.data);
                } catch (e) {
                  toast.error(t("backup.restoreFailed", { error: String(e) }));
                } finally {
                  setRestorePending(false);
                }
              }}
            >
              {t("backup.confirmRestore")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <CollectionSelectDialog
        open={selectOpen}
        onOpenChange={setSelectOpen}
        title={
          selectMode === "backup"
            ? t("backup.selectBackupTitle")
            : t("backup.selectRestoreTitle")
        }
        hint={t("backup.selectHint", { max: FREE_MAX_COLLECTIONS })}
        countLabel={t("backup.selectCount", {
          count: selectedNames.length,
          max: FREE_MAX_COLLECTIONS,
        })}
        confirmLabel={
          selectMode === "backup" ? t("backup.doBackup") : t("backup.confirmRestore")
        }
        cancelLabel={t("common.cancel")}
        itemCountLabel={(count) => t("backup.itemCount", { count })}
        entries={selectEntries}
        selected={selectedNames}
        onToggle={toggleSelected}
        onConfirm={confirmSelection}
        max={FREE_MAX_COLLECTIONS}
        pending={selectPending}
      />
    </div>
  );
}