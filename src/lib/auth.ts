import { load } from "@tauri-apps/plugin-store";

export const API_BASE_URL =
  import.meta.env.VITE_API_URL ?? "http://localhost:3210/api";

const AUTH_STORE_FILE = "auth.json";
const ACCESS_TOKEN_KEY = "accessToken";

let accessToken: string | null = null;
let refreshToken: string | null = null;
let refreshPromise: Promise<string> | null = null;

export function getAccessToken(): string | null {
  return accessToken;
}

export function getRefreshToken(): string | null {
  return refreshToken;
}

export async function loadTokensFromStore(): Promise<void> {
  const store = await load(AUTH_STORE_FILE, { autoSave: true });
  accessToken = (await store.get<string>(ACCESS_TOKEN_KEY)) ?? null;
  refreshToken = (await store.get<string>("refreshToken")) ?? null;
}

export async function saveTokens(access: string, refresh: string): Promise<void> {
  accessToken = access;
  refreshToken = refresh;
  const store = await load(AUTH_STORE_FILE, { autoSave: true });
  await store.set(ACCESS_TOKEN_KEY, access);
  await store.set("refreshToken", refresh);
  await store.save();
}

export async function clearTokens(): Promise<void> {
  accessToken = null;
  refreshToken = null;
  const store = await load(AUTH_STORE_FILE, { autoSave: true });
  await store.delete(ACCESS_TOKEN_KEY);
  await store.delete("refreshToken");
  await store.save();
}

export async function refreshAccessToken(): Promise<string> {
  if (refreshPromise) return refreshPromise;
  refreshPromise = doRefresh();
  try {
    return await refreshPromise;
  } finally {
    refreshPromise = null;
  }
}

async function doRefresh(): Promise<string> {
  if (!refreshToken) {
    throw new Error("No refresh token");
  }
  const response = await fetch(`${API_BASE_URL}/auth/refresh`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ refreshToken }),
  });
  if (!response.ok) {
    await clearTokens();
    throw new Error("Session expired");
  }
  const data = (await response.json()) as {
    accessToken: string;
    refreshToken: string;
  };
  await saveTokens(data.accessToken, data.refreshToken);
  return data.accessToken;
}

export interface RemoteUser {
  id: string;
  email: string;
  displayName: string;
  avatarUrl: string | null;
  plan: "free" | "pro";
}

export async function request<T>(
  path: string,
  init: RequestInit = {},
  retry = true,
): Promise<T> {
  const headers = new Headers(init.headers);
  if (init.body && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }
  const token = getAccessToken();
  if (token) headers.set("Authorization", `Bearer ${token}`);

  const response = await fetch(`${API_BASE_URL}${path}`, { ...init, headers });
  if (response.status === 401 && retry) {
    try {
      const fresh = await refreshAccessToken();
      headers.set("Authorization", `Bearer ${fresh}`);
      const retried = await fetch(`${API_BASE_URL}${path}`, { ...init, headers });
      return handleResponse<T>(retried);
    } catch {
      throw new AuthExpiredError();
    }
  }
  return handleResponse<T>(response);
}

async function handleResponse<T>(response: Response): Promise<T> {
  if (!response.ok) {
    let message = `Request failed: ${response.status}`;
    try {
      const body = (await response.json()) as { message?: string | string[] };
      if (Array.isArray(body.message)) message = body.message.join(", ");
      else if (body.message) message = body.message;
    } catch {
      // ignore non-JSON errors
    }
    throw new ApiError(response.status, message);
  }
  if (response.status === 204) return undefined as T;
  return (await response.json()) as T;
}

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

export class AuthExpiredError extends Error {
  constructor() {
    super("Phiên đăng nhập đã hết hạn");
    this.name = "AuthExpiredError";
  }
}

export function isNetworkError(error: unknown): boolean {
  return error instanceof TypeError;
}

export interface UploadImageResult {
  key: string;
  sizeBytes: number;
}

export async function uploadBackupImage(
  sha256: string,
  bytes: Uint8Array,
): Promise<UploadImageResult> {
  return request<UploadImageResult>(`/backup/images/${sha256}`, {
    method: "PUT",
    body: JSON.stringify({ base64: bytesToBase64(bytes) }),
  });
}

export async function downloadBackupImage(sha256: string): Promise<Uint8Array> {
  return rawRequest(`/backup/images/${sha256}`);
}

async function rawRequest(path: string): Promise<Uint8Array> {
  const headers = new Headers();
  const token = getAccessToken();
  if (token) headers.set("Authorization", `Bearer ${token}`);

  let response = await fetch(`${API_BASE_URL}${path}`, { headers });
  if (response.status === 401) {
    try {
      const fresh = await refreshAccessToken();
      headers.set("Authorization", `Bearer ${fresh}`);
      response = await fetch(`${API_BASE_URL}${path}`, { headers });
    } catch {
      throw new AuthExpiredError();
    }
  }
  if (!response.ok) {
    let message = `Request failed: ${response.status}`;
    try {
      const body = (await response.json()) as { message?: string };
      if (body.message) message = body.message;
    } catch {
      // ignore non-JSON errors
    }
    throw new ApiError(response.status, message);
  }
  return new Uint8Array(await response.arrayBuffer());
}

export function base64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export function bytesToBase64(bytes: Uint8Array): string {
  let bin = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    bin += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(bin);
}

export interface PaddleCatalog {
  environment: "sandbox" | "production";
  clientToken: string;
  prices: { monthly: string; yearly: string };
  checkoutUrl: { monthly: string; yearly: string };
}

export interface BillingSubscription {
  status: string;
  scheduledChange: string | null;
  priceId: string;
  productId: string;
}

export interface BillingStatus {
  subscription: BillingSubscription | null;
}

export function getPaddleCatalog(): Promise<PaddleCatalog> {
  return request<PaddleCatalog>("/paddle/catalog");
}

export function getBillingStatus(): Promise<BillingStatus> {
  return request<BillingStatus>("/paddle/status");
}

export async function createPortalSession(): Promise<string> {
  const data = await request<{ url: string }>("/paddle/portal", {
    method: "POST",
  });
  return data.url;
}