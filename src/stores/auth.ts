import { create } from "zustand";
import {
  ApiError,
  AuthExpiredError,
  clearTokens,
  getRefreshToken,
  isNetworkError,
  loadTokensFromStore,
  request,
  refreshAccessToken,
  saveTokens,
  type RemoteUser,
} from "@/lib/auth";

export type AuthStatus =
  | "loading"
  | "guest"
  | "authenticated"
  | "error";

interface AuthState {
  status: AuthStatus;
  user: RemoteUser | null;

  initialize: () => Promise<void>;
  retry: () => Promise<void>;
  continueAsGuest: () => Promise<void>;
  login: (email: string, password: string) => Promise<void>;
  register: (email: string, password: string, displayName: string) => Promise<void>;
  loginWithGoogle: (consentUrl: string, code: string) => Promise<void>;
  logout: () => Promise<void>;
  setUser: (user: RemoteUser) => void;
}

export const useAuthStore = create<AuthState>((set, get) => ({
  status: "loading",
  user: null,

  initialize: async () => {
    try {
      await loadTokensFromStore();
      if (getRefreshToken()) {
        const accessToken = await refreshAccessToken();
        const user = await request<RemoteUser>("/auth/me", {
          headers: { Authorization: `Bearer ${accessToken}` },
        });
        set({ status: "authenticated", user });
        return;
      }
      set({ status: "guest", user: null });
    } catch (error) {
      if (error instanceof AuthExpiredError) {
        await clearTokens();
        set({ status: "guest", user: null });
        return;
      }
      if (isNetworkError(error) || (error instanceof ApiError && error.status >= 500)) {
        set({ status: "error" });
        return;
      }
      await clearTokens();
      set({ status: "guest", user: null });
    }
  },

  retry: async () => {
    set({ status: "loading" });
    await get().initialize();
  },

  continueAsGuest: async () => {
    await clearTokens();
    set({ status: "guest", user: null });
  },

  login: async (email, password) => {
    const data = await request<{ accessToken: string; refreshToken: string }>(
      "/auth/login",
      {
        method: "POST",
        body: JSON.stringify({ email, password }),
      },
      false,
    );
    await saveTokens(data.accessToken, data.refreshToken);
    const user = await request<RemoteUser>("/auth/me");
    set({ status: "authenticated", user });
  },

  register: async (email, password, displayName) => {
    const data = await request<{ accessToken: string; refreshToken: string }>(
      "/auth/register",
      {
        method: "POST",
        body: JSON.stringify({ email, password, displayName }),
      },
      false,
    );
    await saveTokens(data.accessToken, data.refreshToken);
    const user = await request<RemoteUser>("/auth/me");
    set({ status: "authenticated", user });
  },

  loginWithGoogle: async (_consentUrl, code) => {
    const data = await request<{ accessToken: string; refreshToken: string }>(
      "/auth/google/exchange",
      {
        method: "POST",
        body: JSON.stringify({ code }),
      },
      false,
    );
    await saveTokens(data.accessToken, data.refreshToken);
    const user = await request<RemoteUser>("/auth/me");
    set({ status: "authenticated", user });
  },

  logout: async () => {
    try {
      const refreshToken = getRefreshToken();
      if (refreshToken) {
        await request("/auth/logout", {
          method: "POST",
          body: JSON.stringify({ refreshToken }),
        }).catch(() => undefined);
      }
    } finally {
      await clearTokens();
      set({ status: "guest", user: null });
    }
  },

  setUser: (user) => set({ user }),
}));

export function isApiError(error: unknown): error is ApiError {
  return error instanceof ApiError;
}