import { useState } from "react";
import { useTranslation } from "react-i18next";
import {
  ClipboardList,
  Folder,
  FolderPlus,
  LogIn,
  LogOut,
  Pencil,
  Pin,
  PinOff,
  Settings as SettingsIcon,
  Trash2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import { useUiStore } from "@/stores/ui";
import { useAuthStore } from "@/stores/auth";
import { useCollectionsQuery } from "@/hooks/useClipboardData";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { toast } from "sonner";

function NavItem({
  active,
  onClick,
  icon,
  label,
  count,
}: {
  active: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  label: string;
  count?: number;
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "flex min-w-0 w-full items-center gap-2 overflow-hidden rounded-md px-2 py-1.5 text-sm transition-colors",
        active
          ? "bg-accent text-accent-foreground"
          : "text-muted-foreground hover:bg-accent/50 hover:text-accent-foreground",
      )}
      title={label}
    >
      {icon}
      <span className="min-w-0 flex-1 truncate text-left">{label}</span>
      {count !== undefined && (
        <span className="shrink-0 text-xs text-muted-foreground group-hover:invisible">
          {count}
        </span>
      )}
    </button>
  );
}
function SectionLabel({
  children,
  action,
}: {
  children: React.ReactNode;
  action?: React.ReactNode;
}) {
  return (
    <div className="flex items-center justify-between px-2 pt-2">
      <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
        {children}
      </span>
      {action}
    </div>
  );
}

function AccountPopover() {
  const { t } = useTranslation();
  const setView = useUiStore((s) => s.setView);
  const { user, logout } = useAuthStore();
  const [open, setOpen] = useState(false);
  const isGuest = !user;

  const goLogin = () => {
    setOpen(false);
    setView("login");
  };
  const goSettings = () => {
    setOpen(false);
    setView("settings");
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          className="flex w-full min-w-0 items-center gap-2 rounded-md px-2 py-1.5 text-sm transition-colors hover:bg-accent/50"
          title={isGuest ? t("sidebar.guest") : t("common.account")}
        >
          {isGuest ? (
            <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-accent text-xs font-semibold text-muted-foreground">
              {t("sidebar.guest").charAt(0).toUpperCase()}
            </span>
          ) : user.avatarUrl ? (
            <img
              src={user.avatarUrl}
              alt=""
              className="size-6 shrink-0 rounded-full"
            />
          ) : (
            <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-accent text-xs font-semibold">
              {(user.displayName || user.email).trim().charAt(0).toUpperCase()}
            </span>
          )}
          <span className="min-w-0 flex-1 truncate text-left">
            {isGuest ? t("sidebar.guest") : user.displayName || user.email}
          </span>
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-56 p-1" align="start">
        {isGuest ? (
          <div className="border-b px-2 py-2">
            <p className="text-sm font-medium">{t("sidebar.guest")}</p>
          </div>
        ) : (
          <div className="border-b px-2 py-2">
            <p className="truncate text-sm font-medium">{user.displayName}</p>
            <p className="truncate text-xs text-muted-foreground">{user.email}</p>
          </div>
        )}
        <button
          className="mt-1 flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-sm transition-colors hover:bg-accent/50"
          onClick={goSettings}
        >
          <SettingsIcon className="size-4" />
          {t("common.settings")}
        </button>
        {isGuest ? (
          <button
            className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-sm transition-colors hover:bg-accent/50"
            onClick={goLogin}
          >
            <LogIn className="size-4" />
            {t("auth.login")}
          </button>
        ) : (
          <button
            className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-sm text-destructive transition-colors hover:bg-destructive/10"
            onClick={() => {
              setOpen(false);
              void logout();
            }}
          >
            <LogOut className="size-4" />
            {t("auth.logout")}
          </button>
        )}
      </PopoverContent>
    </Popover>
  );
}

export function Sidebar() {
  const { t } = useTranslation();
  const {
    view,
    collectionFilter,
    setCollectionFilter,
    resetFilters,
    setView,
  } = useUiStore();

  const collections = useCollectionsQuery();
  const qc = useQueryClient();
  const [createOpen, setCreateOpen] = useState(false);
  const [newName, setNewName] = useState("");

  const createCollection = useMutation({
    mutationFn: (name: string) => api.createCollection(name),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["collections"] });
      setCreateOpen(false);
      setNewName("");
    },
    onError: (e) => toast.error(String(e)),
  });

  const renameCollection = useMutation({
    mutationFn: ({ id, name }: { id: number; name: string }) =>
      api.renameCollection(id, name),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["collections"] }),
    onError: (e) => toast.error(String(e)),
  });

  const togglePinCollection = useMutation({
    mutationFn: ({ id, pinned }: { id: number; pinned: boolean }) =>
      api.setCollectionPinned(id, pinned),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["collections"] }),
    onError: (e) => toast.error(String(e)),
  });

  const deleteCollection = useMutation({
    mutationFn: api.deleteCollection,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["collections"] });
      qc.invalidateQueries({ queryKey: ["items"] });
      setCollectionFilter(null);
    },
    onError: (e) => toast.error(String(e)),
  });

  const [renameId, setRenameId] = useState<number | null>(null);
  const [renameValue, setRenameValue] = useState("");

  const goAll = () => {
    setView("history");
    resetFilters();
    setCollectionFilter(null);
  };

  return (
      <aside className="flex w-56 shrink-0 flex-col border-r bg-muted/30">
        <div className="flex items-center border-b px-4 py-3">
          <span className="text-sm font-semibold">Clipy</span>
        </div>

        <div className="flex min-h-0 flex-1 flex-col">
          <div className="flex flex-col gap-0.5 p-2">
            <NavItem
              active={view === "history" && !collectionFilter}
              onClick={goAll}
              icon={<ClipboardList className="size-4 shrink-0" />}
              label={t("sidebar.allItems")}
            />
          </div>

          <SectionLabel
            action={
              <Button
                variant="ghost"
                size="icon"
                className="size-6"
                onClick={() => setCreateOpen(true)}
              >
                <FolderPlus className="size-3.5" />
              </Button>
            }
          >
            {t("sidebar.collections")}
          </SectionLabel>
          <div className="min-h-0 flex-1 overflow-y-auto">
            <div className="flex flex-col gap-0.5 p-2">
              {collections.data?.map((c) => (
                <ContextMenu key={c.id}>
                  <ContextMenuTrigger className="block w-full min-w-0">
                    <div className="group relative">
                      <NavItem
                        active={view === "history" && collectionFilter === c.id}
                        onClick={() => {
                          setView("history");
                          setCollectionFilter(
                            view === "history" && collectionFilter === c.id ? null : c.id,
                          );
                        }}
                        icon={
                          c.pinned ? (
                            <Pin className="size-4 shrink-0 text-amber-500" />
                          ) : (
                            <Folder className="size-4 shrink-0" />
                          )
                        }
                        label={c.name}
                        count={c.item_count}
                      />
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          togglePinCollection.mutate({ id: c.id, pinned: !c.pinned });
                        }}
                        title={
                          c.pinned
                            ? t("sidebar.unpinCollection")
                            : t("sidebar.pinCollection")
                        }
                        className="absolute right-1 top-1/2 hidden size-6 -translate-y-1/2 items-center justify-center rounded-md text-muted-foreground hover:bg-accent group-hover:flex"
                      >
                        {c.pinned ? (
                          <PinOff className="size-3.5" />
                        ) : (
                          <Pin className="size-3.5" />
                        )}
                      </button>
                    </div>
                  </ContextMenuTrigger>
                  <ContextMenuContent>
                    <ContextMenuItem
                      onClick={() =>
                        togglePinCollection.mutate({ id: c.id, pinned: !c.pinned })
                      }
                    >
                      {c.pinned ? (
                        <PinOff className="mr-2 size-4" />
                      ) : (
                        <Pin className="mr-2 size-4" />
                      )}
                      {c.pinned ? t("sidebar.unpinCollection") : t("sidebar.pinCollection")}
                    </ContextMenuItem>
                    <ContextMenuItem
                      onClick={() => {
                        setRenameId(c.id);
                        setRenameValue(c.name);
                      }}
                    >
                      <Pencil className="mr-2 size-4" /> {t("sidebar.renameCollection")}
                    </ContextMenuItem>
                    <ContextMenuItem
                      className="text-destructive"
                      onClick={() => deleteCollection.mutate(c.id)}
                    >
                      <Trash2 className="mr-2 size-4" /> {t("sidebar.deleteCollection")}
                    </ContextMenuItem>
                  </ContextMenuContent>
                </ContextMenu>
              ))}
              {!collections.data?.length && (
                <p className="px-2 py-1 text-xs text-muted-foreground">
                  {t("sidebar.noCollections")}
                </p>
              )}
            </div>
          </div>

        </div>

        <div className="border-t p-2">
          <AccountPopover />
        </div>

        <Dialog open={createOpen} onOpenChange={setCreateOpen}>
          <DialogContent className="sm:max-w-sm">
            <DialogHeader>
              <DialogTitle>{t("sidebar.newCollection")}</DialogTitle>
            </DialogHeader>
            <Input
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder={t("sidebar.newCollectionPlaceholder")}
              autoComplete="off"
              onKeyDown={(e) => {
                if (e.key === "Enter" && newName.trim()) {
                  createCollection.mutate(newName.trim());
                }
              }}
            />
            <DialogFooter>
              <Button
                disabled={!newName.trim()}
                onClick={() => createCollection.mutate(newName.trim())}
              >
                Create
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        <Dialog
          open={renameId !== null}
          onOpenChange={(open) => !open && setRenameId(null)}
        >
          <DialogContent className="sm:max-w-sm">
            <DialogHeader>
              <DialogTitle>{t("sidebar.renameCollection")}</DialogTitle>
            </DialogHeader>
            <Input
              value={renameValue}
              onChange={(e) => setRenameValue(e.target.value)}
              autoComplete="off"
              onKeyDown={(e) => {
                if (e.key === "Enter" && renameValue.trim() && renameId !== null) {
                  renameCollection.mutate({ id: renameId, name: renameValue.trim() });
                  setRenameId(null);
                }
              }}
            />
            <DialogFooter>
              <Button
                disabled={!renameValue.trim()}
                onClick={() => {
                  if (renameId !== null) {
                    renameCollection.mutate({ id: renameId, name: renameValue.trim() });
                    setRenameId(null);
                  }
                }}
              >
                Save
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </aside>
  );
}