import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Loader2, RefreshCw, User } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useAuthStore } from "@/stores/auth";

export function BackendErrorScreen() {
  const { t } = useTranslation();
  const retry = useAuthStore((s) => s.retry);
  const continueAsGuest = useAuthStore((s) => s.continueAsGuest);
  const [pending, setPending] = useState<"retry" | "guest" | null>(null);

  const doRetry = async () => {
    setPending("retry");
    await retry();
  };

  const doGuest = async () => {
    setPending("guest");
    await continueAsGuest();
  };

  return (
    <div className="flex h-screen items-center justify-center bg-background text-foreground">
      <div className="flex w-full max-w-sm flex-col items-center gap-4 px-4 text-center">
        <h1 className="text-xl font-semibold">{t("error.title")}</h1>
        <p className="text-sm text-muted-foreground">{t("error.message")}</p>
        <div className="mt-2 flex w-full flex-col gap-2">
          <Button
            onClick={doRetry}
            disabled={pending !== null}
            className="h-10 w-full"
          >
            {pending === "retry" ? (
              <Loader2 className="mr-2 size-4 animate-spin" />
            ) : (
              <RefreshCw className="mr-2 size-4" />
            )}
            {t("error.retry")}
          </Button>
          <Button
            variant="outline"
            onClick={doGuest}
            disabled={pending !== null}
            className="h-10 w-full"
          >
            <User className="mr-2 size-4" />
            {t("error.continueGuest")}
          </Button>
        </div>
      </div>
    </div>
  );
}