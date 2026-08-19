import { Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";

export interface CollectionEntry {
  name: string;
  itemCount: number;
}

interface CollectionSelectDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  hint: string;
  countLabel: string;
  confirmLabel: string;
  cancelLabel: string;
  itemCountLabel: (count: number) => string;
  entries: CollectionEntry[];
  selected: string[];
  onToggle: (name: string) => void;
  onConfirm: () => void;
  max: number;
  pending: boolean;
}

export function CollectionSelectDialog({
  open,
  onOpenChange,
  title,
  hint,
  countLabel,
  confirmLabel,
  cancelLabel,
  itemCountLabel,
  entries,
  selected,
  onToggle,
  onConfirm,
  max,
  pending,
}: CollectionSelectDialogProps) {
  const canCheckMore = selected.length < max;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
        </DialogHeader>
        <p className="text-xs text-muted-foreground">{hint}</p>
        <div className="max-h-56 overflow-y-auto rounded-lg border">
          {entries.map((entry) => {
            const checked = selected.includes(entry.name);
            return (
              <button
                key={entry.name}
                type="button"
                disabled={!checked && !canCheckMore}
                onClick={() => onToggle(entry.name)}
                className={cn(
                  "flex w-full items-center gap-2 px-3 py-2 text-left text-sm transition-colors hover:bg-accent/50",
                  !checked && !canCheckMore && "cursor-not-allowed opacity-50",
                )}
              >
                <span
                  className={cn(
                    "flex size-4 shrink-0 items-center justify-center rounded border",
                    checked ? "border-primary bg-primary text-primary-foreground" : "border-input",
                  )}
                >
                  {checked && <Check className="size-3" />}
                </span>
                <span className="min-w-0 flex-1 truncate">{entry.name}</span>
                <span className="shrink-0 text-xs text-muted-foreground">
                  {itemCountLabel(entry.itemCount)}
                </span>
              </button>
            );
          })}
        </div>
        <DialogFooter>
          <span className="mr-auto text-xs text-muted-foreground">{countLabel}</span>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={pending}>
            {cancelLabel}
          </Button>
          <Button disabled={selected.length === 0 || pending} onClick={onConfirm}>
            {confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}