const REDEEM_BROWSER_CDK_KEY = "asxs:redeem-browser-cdk";
const LEGACY_REDEEM_BROWSER_CDK_KEY = "asxs-last-cdk";

export function cn(...parts: Array<string | false | null | undefined>) {
  return parts.filter(Boolean).join(" ");
}

export function formatDate(value: string | null | undefined, fallback = "-") {
  if (!value) return fallback;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return fallback;
  return new Intl.DateTimeFormat("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit"
  }).format(date);
}

export function formatShortDate(value: string | null | undefined, fallback = "-") {
  if (!value) return fallback;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return fallback;
  return new Intl.DateTimeFormat("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit"
  }).format(date);
}

export function formatMoney(value: number | null | undefined, digits = 2, fallback = "-") {
  if (value == null || !Number.isFinite(value)) return fallback;
  return `$${value.toFixed(digits)}`;
}

export function formatUsageUsd(value: number | null | undefined, fallback = "-") {
  if (value == null || !Number.isFinite(value)) return fallback;
  const abs = Math.abs(value);
  const digits = abs >= 1 ? 2 : abs >= 0.01 ? 4 : 6;
  return `$${value.toFixed(digits).replace(/0+$/, "").replace(/\.$/, "")}`;
}

export function formatCost(value: number | null | undefined) {
  if (value == null || !Number.isFinite(value)) return "-";
  return `$${value.toFixed(value >= 1 ? 2 : 6).replace(/0+$/, "").replace(/\.$/, "")}`;
}

export function formatCny(value: number | null | undefined) {
  if (value == null || !Number.isFinite(value)) return "-";
  return `¥${value.toFixed(2)}`;
}

export function formatCompact(value: number | null | undefined, fallback = "-") {
  if (value == null || !Number.isFinite(value)) return fallback;
  return new Intl.NumberFormat("en-US", {
    notation: value >= 10_000 ? "compact" : "standard",
    maximumFractionDigits: value >= 10_000 ? 1 : 0
  }).format(value);
}

export function formatInteger(value: number | null | undefined, fallback = "-") {
  if (value == null || !Number.isFinite(value)) return fallback;
  return new Intl.NumberFormat("en-US").format(value);
}

export function formatDurationMs(value: number | null | undefined, fallback = "-") {
  if (value == null || !Number.isFinite(value)) return fallback;
  if (value < 1000) return `${Math.round(value)}ms`;
  if (value < 60_000) return `${(value / 1000).toFixed(value >= 10_000 ? 0 : 1)}s`;
  return `${(value / 60_000).toFixed(1)}m`;
}

export function safeNumber(value: number | null | undefined, fallback = 0) {
  return value == null || !Number.isFinite(value) ? fallback : value;
}

export function getRemainingDays(value: string | null | undefined) {
  if (!value) return null;
  const time = new Date(value).getTime();
  if (Number.isNaN(time)) return null;
  return Math.max(0, Math.ceil((time - Date.now()) / (24 * 60 * 60 * 1000)));
}

export function ensureV1Url(value: string | null | undefined) {
  if (!value) return "";
  try {
    const url = new URL(value);
    url.pathname = url.pathname.replace(/\/+$/, "");
    if (!url.pathname.endsWith("/v1")) {
      url.pathname = `${url.pathname || ""}/v1`.replace(/\/{2,}/g, "/");
    }
    return url.toString().replace(/\/$/, "");
  } catch {
    return value.endsWith("/v1") ? value : `${value.replace(/\/+$/, "")}/v1`;
  }
}

export function extractCdkCode(value: string) {
  const trimmed = value.trim();
  if (!trimmed) return "";

  try {
    const url = new URL(trimmed);
    const parts = url.pathname.split("/").filter(Boolean);
    return decodeURIComponent(parts.at(-1) ?? trimmed);
  } catch {
    const sanitized = trimmed.replace(/\/+$/, "");
    const parts = sanitized.split("/");
    return decodeURIComponent(parts.at(-1) ?? sanitized);
  }
}

export function maskSecret(secret: string) {
  if (!secret) return "-";
  if (secret.length <= 12) return secret;
  return `${secret.slice(0, 6)}...${secret.slice(-4)}`;
}

export function truncateMiddle(value: string | null | undefined, head = 12, tail = 8) {
  if (!value) return "-";
  if (value.length <= head + tail + 3) return value;
  return `${value.slice(0, head)}...${value.slice(-tail)}`;
}

export async function copyText(value: string) {
  await navigator.clipboard.writeText(value);
}

export function rememberCdk(code: string) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(REDEEM_BROWSER_CDK_KEY, code);
  window.localStorage.setItem(LEGACY_REDEEM_BROWSER_CDK_KEY, code);
}

export function getRememberedCdk() {
  if (typeof window === "undefined") return null;
  return (
    window.localStorage.getItem(REDEEM_BROWSER_CDK_KEY) ??
    window.localStorage.getItem(LEGACY_REDEEM_BROWSER_CDK_KEY)
  );
}

export function clearRememberedCdk() {
  if (typeof window === "undefined") return;
  window.localStorage.removeItem(REDEEM_BROWSER_CDK_KEY);
  window.localStorage.removeItem(LEGACY_REDEEM_BROWSER_CDK_KEY);
}

export function getStatusTone(disabled: boolean, expired: boolean) {
  if (disabled) return "danger";
  if (expired) return "warning";
  return "success";
}

export function isExpiredAt(value: string | null | undefined) {
  if (!value) return false;
  const time = new Date(value).getTime();
  return Number.isFinite(time) && time <= Date.now();
}
