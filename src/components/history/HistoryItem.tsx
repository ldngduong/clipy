import { useLayoutEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  Pin,
  PinOff,
  Copy,
  Check,
  Trash2,
  Folder,
  FolderPlus,
  AlertTriangle,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { timeAgo, truncate } from "@/lib/format";
import { type ClipboardItem } from "@/types";
import { useItemMutations, useCollectionsQuery, useSettingsQuery } from "@/hooks/useClipboardData";

async function reportLag(phase: string, ms: number) {
  if (ms < 50) return;
  const { invoke } = await import("@tauri-apps/api/core");
  invoke("debug_timing", { phase, ms }).catch(() => undefined);
}

function useLagReporter(phase: string) {
  return (action: () => void) => {
    const t = performance.now();
    action();
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        void reportLag(phase, performance.now() - t);
      });
    });
  };
}

function useLagReporterAsync(phase: string) {
  return (action: () => Promise<unknown>) => {
    const t = performance.now();
    const p = action();
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        void reportLag(phase, performance.now() - t);
      });
    });
    p.catch(() => undefined).finally(() =>
      void reportLag(`${phase}-total`, performance.now() - t),
    );
  };
}

function ItemPreview({ item }: { item: ClipboardItem }) {
  const imageSrc = item.preview_base64 ?? item.image_base64;
  if (item.kind === "IMAGE" && imageSrc) {
    return (
      <div className="pr-[4.5rem]">
        <img
          src={`data:image/png;base64,${imageSrc}`}
          alt="clipboard image"
          className="max-h-40 rounded-md border object-contain"
        />
      </div>
    );
  }

  const content = item.content ?? item.html ?? "";
  if (item.item_type === "URL") {
    return (
      <p className="min-w-0 break-all pr-[4.5rem] text-sm font-medium text-primary">
        {content}
      </p>
    );
  }

  const mono =
    item.item_type === "CODE" ||
    item.item_type === "COMMAND" ||
    item.item_type === "JSON";

  return (
    <p
      className={cn(
        "min-w-0 overflow-hidden break-all pr-[4.5rem] text-sm leading-relaxed whitespace-pre-wrap",
        mono ? "font-mono text-[13px]" : "text-foreground/90",
        "line-clamp-3",
      )}
    >
      {truncate(content, 300)}
    </p>
  );
}

function CollectionDialog({
  open,
  onOpenChange,
  itemId,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  itemId: number;
}) {
  const collections = useCollectionsQuery();
  const mutations = useItemMutations();
  const { t } = useTranslation();
  const [newName, setNewName] = useState("");

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>{t("item.moveToCollection")}</DialogTitle>
        </DialogHeader>
        <div className="flex max-h-64 flex-col gap-1 overflow-y-auto">
          {collections.data?.map((c) => (
            <button
              key={c.id}
              className="flex min-w-0 items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-accent"
              title={c.name}
              onClick={() => {
                mutations.setCollection.mutate({ itemId, collectionId: c.id });
                onOpenChange(false);
              }}
            >
              <Folder className="size-3.5 shrink-0 text-muted-foreground" />
              <span className="truncate">{c.name}</span>
            </button>
          ))}
          {!collections.data?.length && (
            <p className="px-2 py-1 text-xs text-muted-foreground">
              {t("item.noCollectionsMove")}
            </p>
          )}
        </div>
        <div className="flex gap-1.5">
          <Input
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            placeholder={t("item.newCollectionName")}
            autoComplete="off"
            onKeyDown={(e) => {
              if (e.key === "Enter" && newName.trim()) {
                createAndAssign();
              }
            }}
          />
          <Button
            disabled={!newName.trim()}
            onClick={() => createAndAssign()}
          >
            <FolderPlus className="mr-1 size-4" /> {t("common.create")}
          </Button>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            {t("common.close")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );

  function createAndAssign() {
    if (!newName.trim()) return;
    const name = newName.trim();
    const existing = collections.data?.find(
      (c) => c.name.toLowerCase() === name.toLowerCase(),
    );
    if (existing) {
      mutations.setCollection.mutate({ itemId, collectionId: existing.id });
    } else {
      // create then assign: rely on backend name match via re-query
      void import("@/lib/api").then(({ api }) =>
        api.createCollection(name).then((id) => {
          mutations.setCollection.mutate({ itemId, collectionId: id });
        }),
      );
    }
    setNewName("");
    onOpenChange(false);
  }
}

export function HistoryItem({
  item,
  selected,
}: {
  item: ClipboardItem;
  selected: boolean;
}) {
  const mutations = useItemMutations();
  const { t } = useTranslation();
  const { data: settings } = useSettingsQuery();
  const [collectionOpen, setCollectionOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const copyTimer = useRef<number | undefined>(undefined);
  const isImage = item.kind === "IMAGE";
  const lagPin = useLagReporterAsync("pin-click");
  const lagCopy = useLagReporter("copy-click");
  const lagColl = useLagReporter("collection-open");

  const renderStart = useRef(performance.now());
  useLayoutEffect(() => {
    const dt = performance.now() - renderStart.current;
    renderStart.current = performance.now();
    if (isImage && dt > 80) void reportLag("item-render", dt);
  });

  const handlePin = (e?: React.MouseEvent) => {
    e?.stopPropagation();
    lagPin(() =>
      mutations.setStatus.mutateAsync({
        id: item.id,
        status: pinned ? "TEMPORARY" : "PINNED",
      }),
    );
  };

  const handleCopy = (e?: React.MouseEvent) => {
    e?.stopPropagation();
    lagCopy(() => mutations.copy.mutate(item.id));
    setCopied(true);
    window.clearTimeout(copyTimer.current);
    copyTimer.current = window.setTimeout(() => setCopied(false), 1200);
  };

  const pinned = item.status === "PINNED";

  return (
    <div
      className={cn(
        "group relative flex min-w-0 cursor-pointer flex-col gap-2 rounded-lg border bg-muted/50 p-4 transition-colors duration-75",
        selected
          ? "border-primary/60 bg-accent/70"
          : "border-transparent",
      )}
      onClick={settings?.click_to_copy ? handleCopy : undefined}
    >
      {item.is_sensitive && (
        <div className="inline-flex w-fit items-center gap-1.5 rounded-md bg-destructive/10 px-2 py-1 text-xs text-destructive">
          <AlertTriangle className="size-3.5 shrink-0" />
          {t("item.sensitive")}
        </div>
      )}

      <ItemPreview item={item} />

      <div className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
        <Badge variant="outline" className="px-1.5 py-0 text-[10px] font-normal">
          {item.item_type === "TEXT" || item.item_type === "COMMAND" || item.item_type === "IMAGE" || item.item_type === "EMAIL"
            ? t(`types.${item.item_type}`)
            : item.item_type}
        </Badge>
        {pinned && (
          <span className="inline-flex items-center gap-0.5 text-amber-500">
            <Pin className="size-3" /> {t("item.pinned")}
          </span>
        )}
        <span>{timeAgo(item.created_at, t)}</span>
        {item.collections.map((c) => (
          <Badge
            key={c}
            variant="secondary"
            className="max-w-[180px] px-1.5 py-0 text-[10px]"
            title={c}
          >
            <Folder className="mr-0.5 size-2.5 shrink-0" />
            <span className="truncate">{c}</span>
          </Badge>
        ))}
      </div>

      <div className="absolute right-2 top-2 flex gap-0.5">
        <Button
          variant="ghost"
          size="icon"
          className="size-7"
          title={t("item.copy")}
          onClick={handleCopy}
        >
          {copied ? (
            <Check className="size-3.5 text-emerald-500 animate-in zoom-in-75 duration-200" />
          ) : (
            <Copy className="size-3.5" />
          )}
        </Button>
        <DropdownMenu
          onOpenChange={(open) => {
            if (!open) return;
            const t = performance.now();
            requestAnimationFrame(() => {
              requestAnimationFrame(() => {
                void reportLag("popover-open", performance.now() - t);
              });
            });
          }}
        >
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className="size-7"
              onClick={(e) => e.stopPropagation()}
            >
              <span className="text-muted-foreground">⋯</span>
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-48">
            <DropdownMenuItem onClick={handleCopy}>
              <Copy className="mr-2 size-4" /> {t("item.copy")}
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={handlePin}>
              {pinned ? (
                <PinOff className="mr-2 size-4" />
              ) : (
                <Pin className="mr-2 size-4" />
              )}
              {pinned ? t("item.unpin") : t("item.pin")}
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              onClick={(e) => {
                e.stopPropagation();
                lagColl(() => setCollectionOpen(true));
              }}
            >
              <Folder className="mr-2 size-4" /> {t("item.addToCollection")}
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              className="text-destructive"
              onClick={() => mutations.delete.mutate(item.id)}
            >
              <Trash2 className="mr-2 size-4" /> {t("item.delete")}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      <CollectionDialog
        open={collectionOpen}
        onOpenChange={setCollectionOpen}
        itemId={item.id}
      />
    </div>
  );
}