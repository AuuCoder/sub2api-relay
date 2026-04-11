import "./env";
import crypto from "node:crypto";
import { parseProviderGroups, type GatewayPlatform } from "./gateway";
import { DEFAULT_CONCURRENT_SESSIONS, type Cdk, type Sub2ApiBinding, type Template } from "./types";

type Sub2ApiConfig = {
  baseUrl: string;
  admin:
    | {
        kind: "api_key";
        apiKey: string;
      }
    | {
        kind: "password";
        email: string;
        password: string;
      };
  fallbackAdmin?:
    | {
        kind: "api_key";
        apiKey: string;
      }
    | {
        kind: "password";
        email: string;
        password: string;
      };
  defaultGroupSpec: string | null;
};

type Sub2ApiRequestAuth =
  | {
      kind: "admin_api_key";
      apiKey: string;
    }
  | {
      kind: "bearer";
      token: string;
    };

type Sub2ApiEnvelope<T> = {
  code?: number;
  message?: string;
  reason?: string;
  data?: T;
};

type Sub2ApiPaginated<T> = {
  items?: T[];
  total?: number;
  page?: number;
  page_size?: number;
  pages?: number;
};

type Sub2ApiAdminUser = {
  id: number;
  email: string;
  username: string;
  status?: string;
  notes?: string;
  concurrency?: number;
  allowed_groups?: number[];
};

type Sub2ApiGroup = {
  id: number;
  name: string;
  platform: string;
  status?: string;
  subscription_type?: string;
  daily_limit_usd?: number | null;
  weekly_limit_usd?: number | null;
  monthly_limit_usd?: number | null;
};

type Sub2ApiSubscription = {
  id: number;
  user_id: number;
  group_id: number;
  status?: string;
  starts_at?: string;
  expires_at?: string;
  daily_window_start?: string;
  weekly_window_start?: string;
  monthly_window_start?: string;
  daily_usage_usd?: number | null;
  weekly_usage_usd?: number | null;
  monthly_usage_usd?: number | null;
  group?: Sub2ApiGroup | null;
};

type Sub2ApiApiKey = {
  id: number;
  user_id: number;
  key: string;
  name: string;
  status?: string;
  group_id?: number | null;
  expires_at?: string | null;
  group?: Sub2ApiGroup | null;
};

type Sub2ApiAuthResponse = {
  access_token?: string;
  refresh_token?: string;
  token_type?: string;
  requires_2fa?: boolean;
};

type Sub2ApiUsageUser = {
  id: number;
  email?: string;
  username?: string;
};

type Sub2ApiUsageApiKeyRef = {
  id: number;
  name?: string;
};

type Sub2ApiUsageAccountRef = {
  id: number;
  name?: string;
};

type Sub2ApiAdminUsageLog = {
  id: number;
  user_id: number;
  api_key_id?: number;
  account_id?: number;
  status_code?: number | null;
  http_status?: number | null;
  response_status?: number | null;
  status?: number | string | null;
  request_id?: string;
  model?: string;
  upstream_model?: string | null;
  service_tier?: string | null;
  reasoning_effort?: string | null;
  inbound_endpoint?: string | null;
  upstream_endpoint?: string | null;
  input_tokens?: number;
  output_tokens?: number;
  cache_creation_tokens?: number;
  cache_read_tokens?: number;
  total_cost?: number;
  actual_cost?: number;
  duration_ms?: number | null;
  first_token_ms?: number | null;
  created_at?: string;
  request_type?: string;
  model_mapping_chain?: string | null;
  user?: Sub2ApiUsageUser | null;
  api_key?: Sub2ApiUsageApiKeyRef | null;
  account?: Sub2ApiUsageAccountRef | null;
};

export type Sub2ApiRecentUsageItem = {
  id: number;
  userId: number;
  apiKeyId: number | null;
  accountId: number | null;
  statusCode: number | null;
  requestId: string | null;
  model: string | null;
  upstreamModel: string | null;
  serviceTier: string | null;
  reasoningEffort: string | null;
  inboundEndpoint: string | null;
  upstreamEndpoint: string | null;
  inputTokens: number | null;
  outputTokens: number | null;
  cacheCreationTokens: number | null;
  cacheReadTokens: number | null;
  totalTokens: number | null;
  totalCost: number | null;
  actualCost: number | null;
  durationMs: number | null;
  firstTokenMs: number | null;
  createdAt: string;
  requestType: string | null;
  modelMappingChain: string | null;
  userEmail: string | null;
  userName: string | null;
  apiKeyName: string | null;
  accountName: string | null;
};

export type Sub2ApiRecentUsagePage = {
  items: Sub2ApiRecentUsageItem[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
};

export type Sub2ApiProvisioning = {
  sub2apiUserId: number;
  sub2apiEmail: string;
  sub2apiUsername: string;
  sub2apiProvisionedAt: string;
  sub2apiLastSyncAt: string;
  sub2apiBindings: Sub2ApiBinding[];
};

export type Sub2ApiUserSnapshot = {
  userId: number;
  concurrency: number | null;
  subscriptions: Array<{
    id: number;
    platform: GatewayPlatform;
    groupId: number;
    groupName: string;
    status: string | null;
    startsAt: string | null;
    expiresAt: string | null;
    dailyWindowStart: string | null;
    weeklyWindowStart: string | null;
    monthlyWindowStart: string | null;
    dailyUsageUsd: number | null;
    weeklyUsageUsd: number | null;
    monthlyUsageUsd: number | null;
    dailyLimitUsd: number | null;
    weeklyLimitUsd: number | null;
    monthlyLimitUsd: number | null;
  }>;
};

function extractUsageStatusCode(item: Sub2ApiAdminUsageLog) {
  const directCandidates = [item.status_code, item.http_status, item.response_status, item.status];
  for (const candidate of directCandidates) {
    if (Number.isFinite(candidate)) {
      return Number(candidate);
    }
  }

  if (typeof item.status === "string" && item.status.trim()) {
    const match = item.status.match(/\b([1-5]\d{2})\b/);
    if (match) {
      return Number(match[1]);
    }
  }

  const hasBillableSignal = [
    item.input_tokens,
    item.output_tokens,
    item.cache_creation_tokens,
    item.cache_read_tokens,
    item.total_cost,
    item.actual_cost
  ].some((value) => Number.isFinite(value));

  return hasBillableSignal ? 200 : null;
}

const DAY_MS = 24 * 60 * 60 * 1000;
const sub2apiPlatforms: GatewayPlatform[] = ["anthropic", "openai", "gemini", "antigravity"];

function isObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object";
}

function getItems<T>(value: unknown) {
  if (Array.isArray(value)) return value as T[];
  if (isObject(value) && Array.isArray(value.items)) return value.items as T[];
  return [] as T[];
}

function normalizeBaseUrl(raw: string) {
  const trimmed = raw.trim().replace(/\/+$/, "");
  return trimmed.replace(/\/api\/v1$/i, "");
}

function toErrorMessage(payload: unknown, fallback: string) {
  if (isObject(payload)) {
    if (typeof payload.message === "string" && payload.message.trim()) {
      return payload.message.trim();
    }
    if (typeof payload.reason === "string" && payload.reason.trim()) {
      return payload.reason.trim();
    }
  }
  if (typeof payload === "string" && payload.trim()) {
    return payload.trim();
  }
  return fallback;
}

function buildUrl(baseUrl: string, path: string, query?: Record<string, string>) {
  const root = baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`;
  const url = new URL(path.startsWith("/") ? path.slice(1) : path, root);
  if (query) {
    Object.entries(query).forEach(([key, value]) => {
      if (!value) return;
      url.searchParams.set(key, value);
    });
  }
  return url.toString();
}

async function requestSub2Api<T>(
  config: Pick<Sub2ApiConfig, "baseUrl">,
  input: {
    path: string;
    method?: string;
    auth?: Sub2ApiRequestAuth;
    body?: unknown;
    query?: Record<string, string>;
  }
) {
  const headers = new Headers({
    Accept: "application/json"
  });

  if (input.body != null) {
    headers.set("Content-Type", "application/json");
  }

  if (input.auth?.kind === "admin_api_key") {
    headers.set("x-api-key", input.auth.apiKey);
  } else if (input.auth?.kind === "bearer") {
    headers.set("Authorization", `Bearer ${input.auth.token}`);
  }

  const response = await fetch(buildUrl(config.baseUrl, input.path, input.query), {
    method: input.method ?? (input.body == null ? "GET" : "POST"),
    headers,
    body: input.body == null ? undefined : JSON.stringify(input.body)
  });

  const text = await response.text();
  let payload: unknown = null;

  if (text) {
    try {
      payload = JSON.parse(text);
    } catch {
      payload = text;
    }
  }

  if (!response.ok) {
    throw new Error(toErrorMessage(payload, `Sub2API 请求失败（${response.status}）`));
  }

  const envelope = payload as Sub2ApiEnvelope<T> | null;
  if (isObject(envelope) && typeof envelope.code === "number" && envelope.code !== 0) {
    throw new Error(toErrorMessage(envelope, "Sub2API 返回失败"));
  }

  return {
    payload,
    data: isObject(envelope) && "data" in envelope ? (envelope.data as T) : (payload as T),
    response
  };
}

function buildIdentity(
  cdk: Pick<Cdk, "id" | "code" | "localApiKey" | "sub2apiEmail" | "sub2apiUsername">
) {
  const digest = crypto.createHash("sha256").update(`${cdk.id}:${cdk.localApiKey}`).digest("hex");
  const handle = digest.slice(0, 16);
  return {
    email: cdk.sub2apiEmail?.trim() || `cdk-${handle}@relay.local`,
    username: cdk.sub2apiUsername?.trim() || `cdk_${handle}`,
    password: `S2A${digest.slice(0, 24)}!`,
    notes: `Managed by relay CDK ${cdk.code}`
  };
}

async function loginWithEmailPassword(config: Sub2ApiConfig, email: string, password: string) {
  const { data } = await requestSub2Api<Sub2ApiAuthResponse>(config, {
    path: "/api/v1/auth/login",
    method: "POST",
    body: {
      email,
      password
    }
  });

  if (data?.requires_2fa) {
    throw new Error("Sub2API 账户启用了 2FA，当前无法自动接管该账户");
  }

  const accessToken = String(data?.access_token ?? "").trim();
  if (!accessToken) {
    throw new Error("Sub2API 登录成功，但未返回 access_token");
  }

  return {
    kind: "bearer",
    token: accessToken
  } satisfies Extract<Sub2ApiRequestAuth, { kind: "bearer" }>;
}

async function validateAdminAuth(config: Sub2ApiConfig, auth: Sub2ApiRequestAuth) {
  await requestSub2Api<Sub2ApiPaginated<Sub2ApiAdminUser>>(config, {
    path: "/api/v1/admin/users",
    auth,
    query: {
      page: "1",
      page_size: "1"
    }
  });
}

async function resolveAdminAuth(config: Sub2ApiConfig): Promise<Sub2ApiRequestAuth> {
  const candidates = [config.admin, config.fallbackAdmin].filter(Boolean) as Array<Sub2ApiConfig["admin"]>;
  let lastError: Error | null = null;

  for (const candidate of candidates) {
    try {
      const auth =
        candidate.kind === "api_key"
          ? ({
              kind: "admin_api_key",
              apiKey: candidate.apiKey
            } satisfies Extract<Sub2ApiRequestAuth, { kind: "admin_api_key" }>)
          : await loginWithEmailPassword(config, candidate.email, candidate.password);

      await validateAdminAuth(config, auth);
      return auth;
    } catch (error) {
      lastError = error instanceof Error ? error : new Error("Sub2API 管理员鉴权失败");
    }
  }

  throw lastError ?? new Error("Sub2API 管理员鉴权失败");
}

async function getUserById(config: Sub2ApiConfig, adminAuth: Sub2ApiRequestAuth, userId: number) {
  try {
    const { data } = await requestSub2Api<Sub2ApiAdminUser>(config, {
      path: `/api/v1/admin/users/${userId}`,
      auth: adminAuth
    });
    return data ?? null;
  } catch {
    return null;
  }
}

async function findUser(config: Sub2ApiConfig, adminAuth: Sub2ApiRequestAuth, identity: ReturnType<typeof buildIdentity>) {
  const { data } = await requestSub2Api<Sub2ApiPaginated<Sub2ApiAdminUser>>(config, {
    path: "/api/v1/admin/users",
    auth: adminAuth,
    query: {
      page_size: "100",
      search: identity.email
    }
  });

  const items = getItems<Sub2ApiAdminUser>(data);
  return (
    items.find((item) => item.email?.toLowerCase() === identity.email.toLowerCase()) ??
    items.find((item) => item.username?.toLowerCase() === identity.username.toLowerCase()) ??
    null
  );
}

function sortNumeric(values: number[]) {
  return Array.from(new Set(values)).sort((left, right) => left - right);
}

function sameNumericArray(left: number[], right: number[]) {
  if (left.length !== right.length) return false;
  return left.every((item, index) => item === right[index]);
}

async function ensureUser(
  config: Sub2ApiConfig,
  adminAuth: Sub2ApiRequestAuth,
  cdk: Pick<Cdk, "id" | "code" | "localApiKey" | "sub2apiUserId" | "sub2apiEmail" | "sub2apiUsername">,
  template: Pick<Template, "concurrentSessions">,
  groups: Sub2ApiGroup[]
) {
  const identity = buildIdentity(cdk);
  const desiredConcurrency = Math.max(template.concurrentSessions ?? DEFAULT_CONCURRENT_SESSIONS, 1);
  const desiredAllowedGroups = sortNumeric(groups.map((item) => item.id));
  let user = cdk.sub2apiUserId ? await getUserById(config, adminAuth, cdk.sub2apiUserId) : null;

  if (!user) {
    user = await findUser(config, adminAuth, identity);
  }

  if (!user) {
    const { data } = await requestSub2Api<Sub2ApiAdminUser>(config, {
      path: "/api/v1/admin/users",
      method: "POST",
      auth: adminAuth,
      body: {
        email: identity.email,
        password: identity.password,
        username: identity.username,
        notes: identity.notes,
        concurrency: desiredConcurrency,
        allowed_groups: desiredAllowedGroups
      }
    });
    if (!data) {
      throw new Error("Sub2API 用户创建失败");
    }
    return {
      user: data,
      identity
    };
  }

  const currentAllowedGroups = sortNumeric(Array.isArray(user.allowed_groups) ? user.allowed_groups : []);
  const mergedAllowedGroups = sortNumeric([...currentAllowedGroups, ...desiredAllowedGroups]);
  const nextConcurrency = Math.max(user.concurrency ?? 0, desiredConcurrency);
  const nextStatus = user.status === "disabled" ? "active" : user.status ?? "active";

  const needsUpdate =
    user.email !== identity.email ||
    user.username !== identity.username ||
    nextConcurrency !== (user.concurrency ?? 0) ||
    nextStatus !== (user.status ?? "active") ||
    !sameNumericArray(mergedAllowedGroups, currentAllowedGroups);

  if (needsUpdate) {
    const { data } = await requestSub2Api<Sub2ApiAdminUser>(config, {
      path: `/api/v1/admin/users/${user.id}`,
      method: "PUT",
      auth: adminAuth,
      body: {
        email: identity.email,
        password: identity.password,
        username: identity.username,
        notes: identity.notes,
        concurrency: nextConcurrency,
        status: nextStatus,
        allowed_groups: mergedAllowedGroups
      }
    });
    if (data) {
      user = data;
    }
  }

  return {
    user,
    identity
  };
}

async function getAllGroups(config: Sub2ApiConfig, adminAuth: Sub2ApiRequestAuth) {
  const { data } = await requestSub2Api<Sub2ApiGroup[]>(config, {
    path: "/api/v1/admin/groups/all",
    auth: adminAuth
  });

  return Array.isArray(data) ? data : [];
}

function asGatewayPlatform(value: string) {
  return sub2apiPlatforms.includes(value as GatewayPlatform) ? (value as GatewayPlatform) : null;
}

function resolveGroupsBySpec(allGroups: Sub2ApiGroup[], spec: string) {
  const matrix = parseProviderGroups(spec);
  const targets = new Map<number, Sub2ApiGroup>();
  const missing: string[] = [];

  for (const platform of sub2apiPlatforms) {
    const desiredNames = matrix.platforms[platform] ?? [];
    for (const name of desiredNames) {
      const group = allGroups.find(
        (item) => item.name === name && asGatewayPlatform(item.platform) === platform && item.status !== "disabled"
      );
      if (group) {
        targets.set(group.id, group);
      } else {
        missing.push(`${platform}:${name}`);
      }
    }
  }

  for (const name of matrix.all) {
    const matches = allGroups.filter((item) => item.name === name && item.status !== "disabled");
    if (!matches.length) {
      missing.push(name);
      continue;
    }
    matches.forEach((item) => targets.set(item.id, item));
  }

  const resolved = Array.from(targets.values()).filter((item) => asGatewayPlatform(item.platform));
  if (!resolved.length) {
    throw new Error("没有找到可用的 Sub2API 分组，请检查 providerGroup 配置");
  }

  if (missing.length) {
    throw new Error(`以下 Sub2API 分组不存在或未启用：${missing.join("，")}`);
  }

  const nonSubscription = resolved.filter((item) => item.subscription_type !== "subscription");
  if (nonSubscription.length) {
    throw new Error(
      `以下 Sub2API 分组不是 subscription 模式：${nonSubscription.map((item) => item.name).join("，")}`
    );
  }

  return resolved.sort((left, right) => left.name.localeCompare(right.name));
}

function normalizeGroupSpec(value: string | null | undefined) {
  const normalized = String(value ?? "").trim();
  if (!normalized) return "";
  if (normalized.toLowerCase() === "default" || normalized === "默认") {
    return "";
  }
  return normalized;
}

function resolveTargetGroups(allGroups: Sub2ApiGroup[], providerGroup: string | null | undefined, defaultGroupSpec: string | null) {
  const preferredSpec = normalizeGroupSpec(providerGroup);
  const fallbackSpec = normalizeGroupSpec(defaultGroupSpec);

  if (!preferredSpec && !fallbackSpec) {
    throw new Error("当前套餐没有配置 Sub2API 分组，请先填写 providerGroup 或 SUB2API_DEFAULT_GROUPS");
  }

  if (preferredSpec) {
    try {
      return resolveGroupsBySpec(allGroups, preferredSpec);
    } catch (error) {
      if (!fallbackSpec || fallbackSpec === preferredSpec) {
        throw error;
      }
    }
  }

  return resolveGroupsBySpec(allGroups, fallbackSpec);
}

async function listUserSubscriptions(config: Sub2ApiConfig, adminAuth: Sub2ApiRequestAuth, userId: number) {
  const { data } = await requestSub2Api<Sub2ApiPaginated<Sub2ApiSubscription>>(config, {
    path: `/api/v1/admin/users/${userId}/subscriptions`,
    auth: adminAuth,
    query: {
      page_size: "200"
    }
  });

  return getItems<Sub2ApiSubscription>(data);
}

function computeValidityDaysFromNow(targetExpiresAt: string | null | undefined) {
  if (!targetExpiresAt) return 30;
  const diff = new Date(targetExpiresAt).getTime() - Date.now();
  if (diff <= 0) return 1;
  return Math.max(1, Math.ceil(diff / DAY_MS));
}

function computeExtensionDays(currentExpiresAt: string | null | undefined, targetExpiresAt: string | null | undefined) {
  if (!currentExpiresAt || !targetExpiresAt) return 0;
  const diff = new Date(targetExpiresAt).getTime() - new Date(currentExpiresAt).getTime();
  if (diff <= 0) return 0;
  return Math.ceil(diff / DAY_MS);
}

async function ensureSubscription(
  config: Sub2ApiConfig,
  adminAuth: Sub2ApiRequestAuth,
  userId: number,
  group: Sub2ApiGroup,
  targetExpiresAt: string | null | undefined
) {
  const subscriptions = await listUserSubscriptions(config, adminAuth, userId);
  let subscription =
    subscriptions.find((item) => item.group_id === group.id) ??
    subscriptions.find((item) => item.group?.id === group.id) ??
    null;

  if (!subscription) {
    const { data } = await requestSub2Api<Sub2ApiSubscription>(config, {
      path: "/api/v1/admin/subscriptions/assign",
      method: "POST",
      auth: adminAuth,
      body: {
        user_id: userId,
        group_id: group.id,
        validity_days: computeValidityDaysFromNow(targetExpiresAt),
        notes: `relay CDK subscription for ${group.name}`
      }
    });
    if (!data) {
      throw new Error(`Sub2API 订阅创建失败：${group.name}`);
    }
    subscription = data;
  }

  const extendDays = computeExtensionDays(subscription.expires_at ?? null, targetExpiresAt);
  if (extendDays > 0) {
    const { data } = await requestSub2Api<Sub2ApiSubscription>(config, {
      path: `/api/v1/admin/subscriptions/${subscription.id}/extend`,
      method: "POST",
      auth: adminAuth,
      body: {
        days: extendDays
      }
    });
    if (data) {
      subscription = data;
    }
  }

  return subscription;
}

async function listUserApiKeys(config: Sub2ApiConfig, adminAuth: Sub2ApiRequestAuth, userId: number) {
  const { data } = await requestSub2Api<Sub2ApiPaginated<Sub2ApiApiKey>>(config, {
    path: `/api/v1/admin/users/${userId}/api-keys`,
    auth: adminAuth,
    query: {
      page_size: "200"
    }
  });

  return getItems<Sub2ApiApiKey>(data);
}

function isUsableApiKey(item: Sub2ApiApiKey) {
  if (!item.key || !item.key.trim()) return false;
  if (item.status && item.status !== "active") return false;
  if (item.expires_at && new Date(item.expires_at).getTime() <= Date.now()) return false;
  return true;
}

async function bindExistingApiKeyToGroup(
  config: Sub2ApiConfig,
  adminAuth: Sub2ApiRequestAuth,
  apiKey: Sub2ApiApiKey,
  group: Sub2ApiGroup
) {
  const { data } = await requestSub2Api<{
    api_key?: Sub2ApiApiKey;
    key?: Sub2ApiApiKey;
  }>(config, {
    path: `/api/v1/admin/api-keys/${apiKey.id}`,
    method: "PUT",
    auth: adminAuth,
    body: {
      group_id: group.id
    }
  });

  return data?.api_key ?? data?.key ?? apiKey;
}

async function createApiKeyWithUserLogin(
  config: Sub2ApiConfig,
  identity: ReturnType<typeof buildIdentity>,
  group: Sub2ApiGroup,
  name: string
) {
  let userAuth: Sub2ApiRequestAuth;
  try {
    userAuth = await loginWithEmailPassword(config, identity.email, identity.password);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Sub2API 用户登录失败";
    if (message.includes("Backend mode")) {
      throw new Error("Sub2API 处于 backend mode，普通用户无法登录，无法自动创建用户 API Key");
    }
    throw error;
  }

  const { data } = await requestSub2Api<Sub2ApiApiKey>(config, {
    path: "/api/v1/keys",
    method: "POST",
    auth: userAuth,
    body: {
      name,
      group_id: group.id
    }
  });

  if (!data) {
    throw new Error(`Sub2API API Key 创建失败：${group.name}`);
  }
  return data;
}

async function ensureApiKey(
  config: Sub2ApiConfig,
  adminAuth: Sub2ApiRequestAuth,
  user: Sub2ApiAdminUser,
  identity: ReturnType<typeof buildIdentity>,
  group: Sub2ApiGroup,
  cdkCode: string
) {
  const keys = await listUserApiKeys(config, adminAuth, user.id);
  const directMatch = keys.find(
    (item) => isUsableApiKey(item) && (item.group_id === group.id || item.group?.id === group.id)
  );
  if (directMatch) {
    return directMatch;
  }

  const unboundKey = keys.find((item) => isUsableApiKey(item) && (item.group_id == null && item.group == null));
  if (unboundKey) {
    return bindExistingApiKeyToGroup(config, adminAuth, unboundKey, group);
  }

  const keyName = `CDK ${cdkCode} ${group.platform}`;
  return createApiKeyWithUserLogin(config, identity, group, keyName);
}

function normalizeBinding(
  group: Sub2ApiGroup,
  subscription: Sub2ApiSubscription,
  apiKey: Sub2ApiApiKey
): Sub2ApiBinding {
  const platform = asGatewayPlatform(group.platform);
  if (!platform) {
    throw new Error(`Sub2API 分组平台不受支持：${group.platform}`);
  }

  return {
    platform,
    groupId: group.id,
    groupName: group.name,
    subscriptionId: subscription.id ?? null,
    subscriptionExpiresAt: subscription.expires_at ?? null,
    apiKeyId: apiKey.id ?? null,
    apiKeyName: apiKey.name ?? null,
    apiKeyStatus: apiKey.status ?? null,
    apiKey: apiKey.key ?? null
  };
}

export function hasSub2ApiMode() {
  return Boolean(process.env.SUB2API_BASE_URL?.trim());
}

export function getSub2ApiConfig(): Sub2ApiConfig {
  const baseUrl = String(process.env.SUB2API_BASE_URL ?? "").trim();
  if (!baseUrl) {
    throw new Error("缺少 SUB2API_BASE_URL");
  }

  const adminApiKey = String(process.env.SUB2API_ADMIN_API_KEY ?? "").trim();
  const adminEmail = String(process.env.SUB2API_ADMIN_EMAIL ?? "").trim();
  const adminPassword = String(process.env.SUB2API_ADMIN_PASSWORD ?? "").trim();

  if (adminApiKey) {
    return {
      baseUrl: normalizeBaseUrl(baseUrl),
      admin: {
        kind: "api_key",
        apiKey: adminApiKey
      },
      fallbackAdmin:
        adminEmail && adminPassword
          ? {
              kind: "password",
              email: adminEmail,
              password: adminPassword
            }
          : undefined,
      defaultGroupSpec:
        String(process.env.SUB2API_DEFAULT_GROUPS ?? "").trim() ||
        String(process.env.SUB2API_DEFAULT_PROVIDER_GROUP ?? "").trim() ||
        null
    };
  }

  if (adminEmail && adminPassword) {
    return {
      baseUrl: normalizeBaseUrl(baseUrl),
      admin: {
        kind: "password",
        email: adminEmail,
        password: adminPassword
      },
      defaultGroupSpec:
        String(process.env.SUB2API_DEFAULT_GROUPS ?? "").trim() ||
        String(process.env.SUB2API_DEFAULT_PROVIDER_GROUP ?? "").trim() ||
        null
    };
  }

  throw new Error("请配置 SUB2API_ADMIN_API_KEY 或 SUB2API_ADMIN_EMAIL + SUB2API_ADMIN_PASSWORD");
}

export async function ensureSub2ApiBinding(
  cdk: Pick<
    Cdk,
    "id" | "code" | "localApiKey" | "sub2apiUserId" | "sub2apiEmail" | "sub2apiUsername" | "sub2apiProvisionedAt"
  >,
  template: Pick<Template, "providerGroup" | "concurrentSessions">,
  input?: {
    desiredExpiresAt?: string | null;
  }
): Promise<Sub2ApiProvisioning> {
  const config = getSub2ApiConfig();
  const adminAuth = await resolveAdminAuth(config);
  const allGroups = await getAllGroups(config, adminAuth);
  const targetGroups = resolveTargetGroups(allGroups, template.providerGroup, config.defaultGroupSpec);
  const { user, identity } = await ensureUser(config, adminAuth, cdk, template, targetGroups);

  const bindings: Sub2ApiBinding[] = [];
  for (const group of targetGroups) {
    const subscription = await ensureSubscription(config, adminAuth, user.id, group, input?.desiredExpiresAt ?? null);
    const apiKey = await ensureApiKey(config, adminAuth, user, identity, group, cdk.code);
    bindings.push(normalizeBinding(group, subscription, apiKey));
  }

  const timestamp = new Date().toISOString();
  return {
    sub2apiUserId: user.id,
    sub2apiEmail: identity.email,
    sub2apiUsername: identity.username,
    sub2apiProvisionedAt: cdk.sub2apiProvisionedAt ?? timestamp,
    sub2apiLastSyncAt: timestamp,
    sub2apiBindings: bindings.sort((left, right) =>
      `${left.platform}:${left.groupName}`.localeCompare(`${right.platform}:${right.groupName}`)
    )
  };
}

function getModelPathForPlatform(platform: GatewayPlatform) {
  if (platform === "gemini") return "/v1beta/models";
  if (platform === "antigravity") return "/antigravity/models";
  return "/v1/models";
}

function normalizeModelId(item: Record<string, unknown>) {
  if (typeof item.id === "string" && item.id.trim()) {
    return item.id.trim();
  }
  if (typeof item.name === "string" && item.name.trim()) {
    return item.name.trim();
  }
  return null;
}

export async function fetchSub2ApiModelCatalog(bindings: Sub2ApiBinding[]) {
  const config = getSub2ApiConfig();
  const models = new Map<
    string,
    {
      id: string;
      object: string;
      owned_by: string;
      platform: GatewayPlatform;
      group: string;
    }
  >();

  for (const binding of bindings) {
    if (!binding.apiKey) continue;
    try {
      const { data } = await requestSub2Api<any>(config, {
        path: getModelPathForPlatform(binding.platform),
        auth: {
          kind: "bearer",
          token: binding.apiKey
        }
      });

      const items = Array.isArray(data)
        ? (data as Record<string, unknown>[])
        : Array.isArray(data?.data)
          ? (data.data as Record<string, unknown>[])
          : Array.isArray(data?.models)
            ? (data.models as Record<string, unknown>[])
            : [];

      for (const item of items) {
        const id = normalizeModelId(item);
        if (!id || models.has(`${binding.platform}:${id}`)) continue;
        models.set(`${binding.platform}:${id}`, {
          id,
          object: "model",
          owned_by: binding.groupName,
          platform: binding.platform,
          group: binding.groupName
        });
      }
    } catch {
      continue;
    }
  }

  return Array.from(models.values()).sort((left, right) => left.id.localeCompare(right.id));
}

export async function fetchSub2ApiUserSnapshot(userId: number): Promise<Sub2ApiUserSnapshot | null> {
  const config = getSub2ApiConfig();
  const adminAuth = await resolveAdminAuth(config);
  const user = await getUserById(config, adminAuth, userId);
  if (!user) return null;

  const subscriptions = await listUserSubscriptions(config, adminAuth, userId);
  return {
    userId,
    concurrency: Number.isFinite(user.concurrency) ? Number(user.concurrency) : null,
    subscriptions: subscriptions
      .map((item) => {
        const platform = asGatewayPlatform(item.group?.platform ?? "");
        if (!platform) return null;
        return {
          id: item.id,
          platform,
          groupId: item.group_id,
          groupName: item.group?.name ?? "",
          status: typeof item.status === "string" ? item.status : null,
          startsAt: typeof item.starts_at === "string" ? item.starts_at : null,
          expiresAt: typeof item.expires_at === "string" ? item.expires_at : null,
          dailyWindowStart: typeof item.daily_window_start === "string" ? item.daily_window_start : null,
          weeklyWindowStart: typeof item.weekly_window_start === "string" ? item.weekly_window_start : null,
          monthlyWindowStart: typeof item.monthly_window_start === "string" ? item.monthly_window_start : null,
          dailyUsageUsd: Number.isFinite(item.daily_usage_usd) ? Number(item.daily_usage_usd) : null,
          weeklyUsageUsd: Number.isFinite(item.weekly_usage_usd) ? Number(item.weekly_usage_usd) : null,
          monthlyUsageUsd: Number.isFinite(item.monthly_usage_usd) ? Number(item.monthly_usage_usd) : null,
          dailyLimitUsd: Number.isFinite(item.group?.daily_limit_usd) ? Number(item.group?.daily_limit_usd) : null,
          weeklyLimitUsd: Number.isFinite(item.group?.weekly_limit_usd) ? Number(item.group?.weekly_limit_usd) : null,
          monthlyLimitUsd: Number.isFinite(item.group?.monthly_limit_usd) ? Number(item.group?.monthly_limit_usd) : null
        };
      })
      .filter(Boolean) as Sub2ApiUserSnapshot["subscriptions"]
  };
}

export async function fetchSub2ApiAdminRecentUsagePage(input?: {
  page?: number;
  pageSize?: number;
  timezone?: string;
  startDate?: string;
  endDate?: string;
  userId?: number;
}) {
  const config = getSub2ApiConfig();
  const adminAuth = await resolveAdminAuth(config);
  const page = Math.max(1, Number(input?.page ?? 1));
  const pageSize = Math.min(200, Math.max(1, Number(input?.pageSize ?? 20)));
  const query: Record<string, string> = {
    page: String(page),
    page_size: String(pageSize),
    exact_total: "false"
  };

  if (input?.timezone?.trim()) {
    query.timezone = input.timezone.trim();
  }
  if (input?.startDate?.trim()) {
    query.start_date = input.startDate.trim();
  }
  if (input?.endDate?.trim()) {
    query.end_date = input.endDate.trim();
  }
  if (Number.isFinite(input?.userId) && Number(input?.userId) > 0) {
    query.user_id = String(Number(input?.userId));
  }

  const { data } = await requestSub2Api<Sub2ApiPaginated<Sub2ApiAdminUsageLog>>(config, {
    path: "/api/v1/admin/usage",
    auth: adminAuth,
    query
  });

  const items = getItems<Sub2ApiAdminUsageLog>(data);
  const mapped = items
    .map((item) => {
      const inputTokens = Number.isFinite(item.input_tokens) ? Number(item.input_tokens) : null;
      const outputTokens = Number.isFinite(item.output_tokens) ? Number(item.output_tokens) : null;
      const cacheCreationTokens = Number.isFinite(item.cache_creation_tokens)
        ? Number(item.cache_creation_tokens)
        : null;
      const cacheReadTokens = Number.isFinite(item.cache_read_tokens) ? Number(item.cache_read_tokens) : null;

      const tokenValues = [inputTokens, outputTokens, cacheCreationTokens, cacheReadTokens].filter(
        (value): value is number => value != null
      );

      return {
        id: item.id,
        userId: item.user_id,
        apiKeyId: Number.isFinite(item.api_key_id) ? Number(item.api_key_id) : null,
        accountId: Number.isFinite(item.account_id) ? Number(item.account_id) : null,
        statusCode: extractUsageStatusCode(item),
        requestId: typeof item.request_id === "string" && item.request_id.trim() ? item.request_id.trim() : null,
        model: typeof item.model === "string" && item.model.trim() ? item.model.trim() : null,
        upstreamModel:
          typeof item.upstream_model === "string" && item.upstream_model.trim() ? item.upstream_model.trim() : null,
        serviceTier:
          typeof item.service_tier === "string" && item.service_tier.trim() ? item.service_tier.trim() : null,
        reasoningEffort:
          typeof item.reasoning_effort === "string" && item.reasoning_effort.trim()
            ? item.reasoning_effort.trim()
            : null,
        inboundEndpoint:
          typeof item.inbound_endpoint === "string" && item.inbound_endpoint.trim()
            ? item.inbound_endpoint.trim()
            : null,
        upstreamEndpoint:
          typeof item.upstream_endpoint === "string" && item.upstream_endpoint.trim()
            ? item.upstream_endpoint.trim()
            : null,
        inputTokens,
        outputTokens,
        cacheCreationTokens,
        cacheReadTokens,
        totalTokens: tokenValues.length ? tokenValues.reduce((sum, value) => sum + value, 0) : null,
        totalCost: Number.isFinite(item.total_cost) ? Number(item.total_cost) : null,
        actualCost: Number.isFinite(item.actual_cost) ? Number(item.actual_cost) : null,
        durationMs: Number.isFinite(item.duration_ms) ? Number(item.duration_ms) : null,
        firstTokenMs: Number.isFinite(item.first_token_ms) ? Number(item.first_token_ms) : null,
        createdAt: typeof item.created_at === "string" ? item.created_at : new Date().toISOString(),
        requestType: typeof item.request_type === "string" && item.request_type.trim() ? item.request_type.trim() : null,
        modelMappingChain:
          typeof item.model_mapping_chain === "string" && item.model_mapping_chain.trim()
            ? item.model_mapping_chain.trim()
            : null,
        userEmail: typeof item.user?.email === "string" && item.user.email.trim() ? item.user.email.trim() : null,
        userName:
          typeof item.user?.username === "string" && item.user.username.trim() ? item.user.username.trim() : null,
        apiKeyName: typeof item.api_key?.name === "string" && item.api_key.name.trim() ? item.api_key.name.trim() : null,
        accountName:
          typeof item.account?.name === "string" && item.account.name.trim() ? item.account.name.trim() : null
      } satisfies Sub2ApiRecentUsageItem;
    })
    .sort((left, right) => right.createdAt.localeCompare(left.createdAt));

  const total = Number.isFinite(data?.total) ? Number(data.total) : mapped.length;
  const pages = Number.isFinite(data?.pages) ? Number(data.pages) : Math.max(1, Math.ceil(total / pageSize));

  return {
    items: mapped,
    total,
    page,
    pageSize,
    totalPages: Math.max(1, pages)
  } satisfies Sub2ApiRecentUsagePage;
}

export async function fetchSub2ApiAdminRecentUsage(input?: {
  limit?: number;
  timezone?: string;
  startDate?: string;
  endDate?: string;
  userId?: number;
}) {
  const page = await fetchSub2ApiAdminRecentUsagePage({
    page: 1,
    pageSize: input?.limit,
    timezone: input?.timezone,
    startDate: input?.startDate,
    endDate: input?.endDate,
    userId: input?.userId
  });

  return page.items;
}
