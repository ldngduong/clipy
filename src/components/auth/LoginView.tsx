import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { isNetworkError, request } from "@/lib/auth";
import { isApiError, useAuthStore } from "@/stores/auth";
import { useUiStore } from "@/stores/ui";
import i18n from "@/i18n";

function GoogleIcon() {
  return (
    <svg className="size-4" viewBox="0 0 24 24" aria-hidden="true">
      <path
        fill="#4285F4"
        d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
      />
      <path
        fill="#34A853"
        d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
      />
      <path
        fill="#FBBC05"
        d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
      />
      <path
        fill="#EA4335"
        d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
      />
    </svg>
  );
}

function oauthResponseHtml(lang: string): string {
  const dark = window.matchMedia?.("(prefers-color-scheme: dark)").matches;
  const bg = dark ? "#18181b" : "#ffffff";
  const fg = dark ? "#fafafa" : "#18181b";
  const ok = lang === "vi" ? "Đăng nhập thành công!" : "Signed in successfully!";
  const sub =
    lang === "vi"
      ? "Bạn có thể quay lại ứng dụng"
      : "You can return to the app now";
  return `<!doctype html><html><head><meta charset="utf-8"></head>
<body style="margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;background:${bg};color:${fg};font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif">
<div style="text-align:center;padding:24px">
  <div style="font-size:18px;font-weight:600;margin-top:12px">${ok}</div>
  <div style="font-size:14px;opacity:.7;margin-top:6px">${sub}</div>
</div></body></html>`;
}

export function LoginView() {
  const { t } = useTranslation();
  const { login, register, loginWithGoogle } = useAuthStore();
  const setView = useUiStore((s) => s.setView);
  const [mode, setMode] = useState<"login" | "register">("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [googlePending, setGooglePending] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!email.trim() || !password) {
      setError(t("auth.fillAll"));
      return;
    }
    if (mode === "register" && !displayName.trim()) {
      setError(t("auth.fillAll"));
      return;
    }
    setPending(true);
    try {
      if (mode === "login") {
        await login(email, password);
      } else {
        await register(email, password, displayName);
      }
      setView("history");
    } catch (err) {
      setError(isNetworkError(err) ? t("auth.connectionFailed") : isApiError(err) ? err.message : String(err));
    } finally {
      setPending(false);
    }
  };

  const handleGoogle = async () => {
    setError(null);
    setGooglePending(true);
    try {
      const lang = i18n.language?.startsWith("vi") ? "vi" : "en";
      const { start, onUrl, onInvalidUrl, cancel } = await import(
        "@fabianlars/tauri-plugin-oauth"
      );
      const { openUrl } = await import("@tauri-apps/plugin-opener");
      const port = await start({
        ports: [14100, 14101, 14102],
        response: oauthResponseHtml(lang),
      });
      const { url } = await request<{ url: string }>(
        `/auth/google/url?lang=${lang}&port=${port}`,
        {},
        false,
      );

      const unlisteners: Array<() => void> = [];
      const callback = await new Promise<{ code?: string; error?: string }>(
        (resolve) => {
          let settled = false;
          const finish = (result: { code?: string; error?: string }) => {
            if (settled) return;
            settled = true;
            resolve(result);
          };
          const timeout = setTimeout(() => finish({ error: "timeout" }), 120_000);
          void onUrl((callbackUrl) => {
            clearTimeout(timeout);
            finish({ code: new URL(callbackUrl).searchParams.get("code") ?? undefined });
          }).then((unlisten) => unlisteners.push(unlisten));
          void onInvalidUrl((message) => {
            clearTimeout(timeout);
            finish({ error: message });
          }).then((unlisten) => unlisteners.push(unlisten));
          void openUrl(url);
        },
      );
      unlisteners.forEach((unlisten) => unlisten());

      await cancel(port).catch(() => undefined);

      if (callback.error) {
        setError(`${t("auth.googleFailed")} (${callback.error})`);
        return;
      }
      if (!callback.code) {
        setError(t("auth.googleFailed"));
        return;
      }
      await loginWithGoogle(url, callback.code);
      setView("history");
    } catch (err) {
      setError(isNetworkError(err) ? t("auth.connectionFailed") : isApiError(err) ? err.message : String(err));
    } finally {
      setGooglePending(false);
    }
  };

  const fields = {
    login: (
      <>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="login-email">{t("auth.email")}</Label>
          <Input
            id="login-email"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            autoComplete="email"
            autoFocus
            className="h-10 rounded-lg"
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="login-password">{t("auth.password")}</Label>
          <Input
            id="login-password"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="current-password"
            className="h-10 rounded-lg"
          />
        </div>
      </>
    ),
    register: (
      <>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="register-name">{t("auth.displayName")}</Label>
          <Input
            id="register-name"
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            autoComplete="name"
            autoFocus
            className="h-10 rounded-lg"
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="register-email">{t("auth.email")}</Label>
          <Input
            id="register-email"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            autoComplete="email"
            className="h-10 rounded-lg"
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="register-password">{t("auth.password")}</Label>
          <Input
            id="register-password"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="new-password"
            className="h-10 rounded-lg"
          />
        </div>
      </>
    ),
  } as const;

  return (
    <div className="relative flex h-screen items-center justify-center overflow-hidden bg-background text-foreground">
      <div className="w-full max-w-sm px-4">
        <div className="flex flex-col items-center gap-3">
          <div className="text-center">
            <h1 className="text-2xl font-bold tracking-tight">Clipy</h1>
            <p className="mt-1 text-sm text-muted-foreground">{t("auth.subtitle")}</p>
          </div>
        </div>

        <div className="mt-6 rounded-2xl border bg-card/80 p-5 shadow-sm backdrop-blur">
          <Tabs
            value={mode}
            onValueChange={(v) => {
              setMode(v as "login" | "register");
              setError(null);
            }}
          >
            <TabsList className="grid w-full grid-cols-2">
              <TabsTrigger value="login">{t("auth.login")}</TabsTrigger>
              <TabsTrigger value="register">{t("auth.register")}</TabsTrigger>
            </TabsList>

            <form onSubmit={submit} className="mt-4 flex flex-col gap-3">
              {fields[mode]}

              {error && (
                <p className="rounded-lg bg-destructive/10 px-3 py-2 text-sm text-destructive">
                  {error}
                </p>
              )}

              <Button type="submit" disabled={pending} className="mt-1 h-10">
                {pending && <Loader2 className="mr-2 size-4 animate-spin" />}
                {mode === "login" ? t("auth.login") : t("auth.register")}
              </Button>
            </form>
          </Tabs>

          <div className="my-4 flex items-center gap-2 text-xs text-muted-foreground">
            <div className="h-px flex-1 bg-border" />
            {t("auth.or")}
            <div className="h-px flex-1 bg-border" />
          </div>

          <Button
            type="button"
            variant="outline"
            className="h-10 w-full"
            onClick={handleGoogle}
            disabled={googlePending}
          >
            {googlePending ? (
              <Loader2 className="mr-2 size-4 animate-spin" />
            ) : (
              <GoogleIcon />
            )}
            <span className="ml-2">{t("auth.loginWithGoogle")}</span>
          </Button>
        </div>

        <p className="mt-4 text-center text-xs text-muted-foreground/80">
          {t("auth.privacy")}
        </p>
      </div>
    </div>
  );
}