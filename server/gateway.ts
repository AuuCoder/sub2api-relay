import "./env";
import fs from "node:fs";
import path from "node:path";

export type GatewayPlatform = "anthropic" | "openai" | "gemini" | "antigravity";

type RawGatewayAccount = {
  id?: unknown;
  name?: unknown;
  platform?: unknown;
  baseUrl?: unknown;
  apiKey?: unknown;
  authHeader?: unknown;
  authPrefix?: unknown;
  groups?: unknown;
  models?: unknown;
  headers?: unknown;
  enabled?: unknown;
  priority?: unknown;
  preserveBasePath?: unknown;
};

export type GatewayAccount = {
  id: string;
  name: string;
  platform: GatewayPlatform;
  baseUrl: string;
  apiKey: string;
  authHeader: string;
  authPrefix: string;
  groups: string[];
  models: string[];
  headers: Record<string, string>;
  enabled: boolean;
  priority: number;
  preserveBasePath: boolean;
};

type ProviderGroupMatrix = {
  all: string[];
  platforms: Partial<Record<GatewayPlatform, string[]>>;
};

const gatewayPlatforms: GatewayPlatform[] = ["anthropic", "openai", "gemini", "antigravity"];
const providerGroupAliases: Record<string, GatewayPlatform> = {
  anthropic: "anthropic",
  claude: "anthropic",
  openai: "openai",
  gpt: "openai",
  gemini: "gemini",
  google: "gemini",
  antigravity: "antigravity",
  ag: "antigravity"
};

let cachedAccounts: GatewayAccount[] | null = null;
let cachedFilePath: string | null = null;
let cachedFileMtimeMs = -1;
let cachedJsonSource = "";
const accountLastUsedAt = new Map<string, number>();

function splitList(value: string) {
  return value
    .split(/[\n,，;；]+/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function normalizeTextList(value: unknown) {
  if (Array.isArray(value)) {
    return value
      .map((item) => String(item ?? "").trim())
      .filter(Boolean);
  }
  if (typeof value === "string") {
    return splitList(value);
  }
  return [];
}

function asGatewayPlatform(value: unknown): GatewayPlatform | null {
  const normalized = String(value ?? "")
    .trim()
    .toLowerCase();
  return providerGroupAliases[normalized] ?? null;
}

function defaultAuthHeader(platform: GatewayPlatform) {
  if (platform === "anthropic") return "x-api-key";
  if (platform === "gemini") return "x-goog-api-key";
  return "authorization";
}

function defaultAuthPrefix(authHeader: string) {
  return authHeader.toLowerCase() === "authorization" ? "Bearer " : "";
}

function normalizeHeaders(value: unknown) {
  if (!value || typeof value !== "object") return {};
  const headers: Record<string, string> = {};
  for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
    const normalizedKey = key.trim();
    const normalizedValue = String(item ?? "").trim();
    if (!normalizedKey || !normalizedValue) continue;
    headers[normalizedKey] = normalizedValue;
  }
  return headers;
}

function normalizeAccount(raw: RawGatewayAccount, index: number): GatewayAccount | null {
  const platform = asGatewayPlatform(raw.platform);
  const baseUrl = String(raw.baseUrl ?? "").trim().replace(/\/+$/, "");
  const apiKey = String(raw.apiKey ?? "").trim();
  if (!platform || !baseUrl || !apiKey) {
    return null;
  }

  const authHeader = String(raw.authHeader ?? defaultAuthHeader(platform)).trim() || defaultAuthHeader(platform);

  const headers = normalizeHeaders(raw.headers);
  if (platform === "anthropic" && !Object.keys(headers).some((key) => key.toLowerCase() === "anthropic-version")) {
    headers["anthropic-version"] = "2023-06-01";
  }

  return {
    id: String(raw.id ?? `gw_${platform}_${index + 1}`).trim() || `gw_${platform}_${index + 1}`,
    name: String(raw.name ?? `Gateway ${platform} ${index + 1}`).trim() || `Gateway ${platform} ${index + 1}`,
    platform,
    baseUrl,
    apiKey,
    authHeader,
    authPrefix: String(raw.authPrefix ?? defaultAuthPrefix(authHeader)),
    groups: normalizeTextList(raw.groups),
    models: normalizeTextList(raw.models),
    headers,
    enabled: raw.enabled !== false,
    priority: Number.isFinite(Number(raw.priority)) ? Number(raw.priority) : 100,
    preserveBasePath: raw.preserveBasePath === true
  };
}

function readAccountsSource() {
  const configuredFile = String(process.env.GATEWAY_ACCOUNTS_FILE ?? "").trim();
  if (configuredFile) {
    const resolvedPath = path.resolve(process.cwd(), configuredFile);
    const stat = fs.existsSync(resolvedPath) ? fs.statSync(resolvedPath) : null;
    if (
      cachedAccounts &&
      cachedFilePath === resolvedPath &&
      stat &&
      cachedFileMtimeMs === stat.mtimeMs
    ) {
      return cachedAccounts;
    }

    if (!stat) {
      throw new Error(`网关账号文件不存在：${resolvedPath}`);
    }

    const payload = JSON.parse(fs.readFileSync(resolvedPath, "utf8")) as RawGatewayAccount[];
    const accounts = Array.isArray(payload)
      ? payload.map((item, index) => normalizeAccount(item, index)).filter(Boolean) as GatewayAccount[]
      : [];

    cachedFilePath = resolvedPath;
    cachedFileMtimeMs = stat.mtimeMs;
    cachedAccounts = accounts;
    return accounts;
  }

  const rawJson = String(process.env.GATEWAY_ACCOUNTS_JSON ?? "").trim();
  if (!rawJson) {
    cachedJsonSource = "";
    cachedAccounts = [];
    return [];
  }

  if (cachedAccounts && cachedJsonSource === rawJson) {
    return cachedAccounts;
  }

  const payload = JSON.parse(rawJson) as RawGatewayAccount[];
  const accounts = Array.isArray(payload)
    ? payload.map((item, index) => normalizeAccount(item, index)).filter(Boolean) as GatewayAccount[]
    : [];

  cachedFilePath = null;
  cachedFileMtimeMs = -1;
  cachedJsonSource = rawJson;
  cachedAccounts = accounts;
  return accounts;
}

export function getGatewayAccounts() {
  return readAccountsSource().filter((item) => item.enabled);
}

export function hasGatewayMode() {
  return getGatewayAccounts().length > 0;
}

export function parseProviderGroups(raw: string | null | undefined): ProviderGroupMatrix {
  const matrix: ProviderGroupMatrix = {
    all: [],
    platforms: {}
  };

  const normalized = String(raw ?? "").trim();
  if (!normalized) {
    return matrix;
  }

  let segments: string[] = [];

  if (normalized.startsWith("{")) {
    try {
      const parsed = JSON.parse(normalized) as Record<string, unknown>;
      for (const [key, value] of Object.entries(parsed)) {
        const platform = asGatewayPlatform(key);
        const values = normalizeTextList(value);
        if (!values.length) continue;
        if (platform) {
          matrix.platforms[platform] = Array.from(new Set([...(matrix.platforms[platform] ?? []), ...values]));
        } else {
          matrix.all = Array.from(new Set([...matrix.all, ...values]));
        }
      }
      return matrix;
    } catch {
      segments = splitList(normalized);
    }
  } else {
    segments = splitList(normalized);
  }

  for (const segment of segments) {
    const separatorIndex = Math.max(segment.indexOf(":"), segment.indexOf("="));
    if (separatorIndex > 0) {
      const rawLabel = segment.slice(0, separatorIndex).trim();
      const rawValue = segment.slice(separatorIndex + 1).trim();
      const platform = asGatewayPlatform(rawLabel);
      if (platform && rawValue) {
        matrix.platforms[platform] = Array.from(
          new Set([...(matrix.platforms[platform] ?? []), ...normalizeTextList(rawValue)])
        );
        continue;
      }
    }

    matrix.all = Array.from(new Set([...matrix.all, segment]));
  }

  return matrix;
}

function matchModelPattern(pattern: string, model: string) {
  if (!pattern) return true;
  if (pattern === "*") return true;
  if (pattern === model) return true;
  if (pattern.endsWith("*")) {
    return model.startsWith(pattern.slice(0, -1));
  }
  return false;
}

function matchesProviderGroup(account: GatewayAccount, providerGroup: string | null | undefined) {
  const matrix = parseProviderGroups(providerGroup);
  const specificGroups = matrix.platforms[account.platform] ?? [];
  const allowedGroups = specificGroups.length ? specificGroups : matrix.all;
  if (!allowedGroups.length) {
    return true;
  }
  if (!account.groups.length) {
    return false;
  }
  return account.groups.some((group) => allowedGroups.includes(group));
}

function matchesModel(account: GatewayAccount, model: string | null) {
  if (!model) return true;
  if (!account.models.length) return true;
  return account.models.some((pattern) => matchModelPattern(pattern, model));
}

export function listGatewayCandidates(input: {
  platform: GatewayPlatform;
  providerGroup: string | null | undefined;
  model?: string | null;
}) {
  return getGatewayAccounts()
    .filter((item) => item.platform === input.platform)
    .filter((item) => matchesProviderGroup(item, input.providerGroup))
    .filter((item) => matchesModel(item, input.model ?? null))
    .sort((left, right) => {
      if (left.priority !== right.priority) {
        return right.priority - left.priority;
      }
      return (accountLastUsedAt.get(left.id) ?? 0) - (accountLastUsedAt.get(right.id) ?? 0);
    });
}

export function markGatewayAccountUsed(accountId: string) {
  accountLastUsedAt.set(accountId, Date.now());
}

export function buildGatewayModelCatalog(providerGroup: string | null | undefined) {
  const models = new Map<string, { id: string; object: string; owned_by: string; platform: GatewayPlatform }>();

  for (const account of getGatewayAccounts()) {
    if (!matchesProviderGroup(account, providerGroup)) continue;
    for (const model of account.models) {
      if (!model || model.endsWith("*")) continue;
      if (models.has(model)) continue;
      models.set(model, {
        id: model,
        object: "model",
        owned_by: account.name,
        platform: account.platform
      });
    }
  }

  return Array.from(models.values()).sort((left, right) => left.id.localeCompare(right.id));
}

export function resolveGatewayPlatform(input: {
  path: string;
  headers: Record<string, string | string[] | undefined>;
}) {
  const explicit = String(
    input.headers["x-relay-platform"] ??
      input.headers["x-upstream-platform"] ??
      input.headers["x-provider-platform"] ??
      ""
  )
    .trim()
    .toLowerCase();

  const explicitPlatform = asGatewayPlatform(explicit);
  if (explicitPlatform) {
    return explicitPlatform;
  }

  if (input.path.startsWith("/antigravity/")) return "antigravity";
  if (input.path.startsWith("/v1beta/")) return "gemini";
  if (input.path === "/v1/messages" || input.path.startsWith("/v1/messages/")) return "anthropic";
  if (input.path === "/v1/chat/completions" || input.path === "/chat/completions") return "openai";
  if (input.path === "/v1/responses" || input.path.startsWith("/v1/responses/")) return "openai";
  if (input.path === "/responses" || input.path.startsWith("/responses/")) return "openai";
  if (input.path === "/antigravity/models") return "antigravity";
  if (input.path === "/v1/usage") return "anthropic";
  if (input.path.startsWith("/v1/")) return "openai";
  return null;
}
