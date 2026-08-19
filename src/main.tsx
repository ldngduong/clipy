import React from "react";
import ReactDOM from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import App from "./App";
import { initTheme } from "./lib/theme";
import "./index.css";

initTheme();

const queryClient = new QueryClient();

function showError(msg: string) {
  const el = document.createElement("pre");
  el.style.cssText =
    "position:fixed;inset:0;z-index:99999;background:#111;color:#ff6b6b;padding:24px;font-size:13px;white-space:pre-wrap;overflow:auto;";
  el.textContent = msg;
  document.body.appendChild(el);
}

window.addEventListener("error", (e) => {
  console.error(`window.onerror: ${e.message}\n${e.filename}:${e.lineno}`);
});
window.addEventListener("unhandledrejection", (e) => {
  console.error(`unhandledrejection:`, e.reason);
});

class ErrorBoundary extends React.Component<
  { children: React.ReactNode },
  { error: Error | null }
> {
  state = { error: null as Error | null };
  static getDerivedStateFromError(error: Error) {
    return { error };
  }
  render() {
    if (this.state.error) {
      showError(`React error: ${this.state.error.stack}`);
    }
    return this.props.children;
  }
}

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <ErrorBoundary>
      <QueryClientProvider client={queryClient}>
        <App />
      </QueryClientProvider>
    </ErrorBoundary>
  </React.StrictMode>,
);