import "./env";
import crypto from "node:crypto";
import type { Cdk } from "./types";

type NewApiConfig = {
  baseUrl: string;
  admin:
    | {
        kind: "access_token";
        accessToken: string;
        userId: number;
      }
    | {
        kind: "password";
        username: string;
        password: string;
      };
  userGroup: string;
  tokenGroup: string;
};

type NewApiAuth =
  | {
      kind: "access_token";
      accessToken: string;
      userId: number;
    }
  | {
      kind: "session";
      cookieHeader: string;
      userId: number;
    };

type NewApiEnvelope<T> = {
  success?: boolean;
  message?: string;
  data?: T;
};

type NewApiPage<T> = {
  items?: T[];
  total?: number;
  page?: number;
  page_size?: number;
};

type NewApiUser = {
  id: number;
  username: string;
  display_name?: string;
  role?: number;
  status?: number;
  quota?: number;
  group?: string;
  remark?: string;
};

type NewApiToken = {
  id: number;
  name: string;
  status?: number;
  expired_time?: number;
  remain_quota?: number;
  unlimited_quota?: boolean;
  model_limits_enabled?: boolean;
  group?: string;
  cross_group_retry?: boolean;
};

export type NewApiBinding = {
  upstreamUserId: number;
  upstreamUsername: string;
  upstreamTokenId: number;
  upstreamTokenName: string;
  upstreamTokenKey: string;
  upstreamQuotaFloor: number;
  upstreamProvisionedAt: string;
};

const NEWAPI_QUOTA_PER_USD = 500_000;
const NEWAPI_QUOTA_MULTIPLIER = 20;
const NEWAPI_MIN_USER_QUOTA = 100_000_000;
const NEWAPI_MAX_USER_QUOTA = 1_500_000_000;

function normalizeBaseUrl(raw: string) {
  const trimmed = raw.trim().replace(/\/+$/, "");
  return trimmed.replace(/\/v1$/i, "");
}

function toErrorMessage(payload: unknown, fallback: string) {
  if (typeof payload === "object" && payload && "message" in payload) {
    const value = (payload as { message?: unknown }).message;
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  if (typeof payload === "string" && payload.trim()) return payload.trim();
  return fallback;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object";
}

function getItems<T>(value: unknown) {
  if (Array.isArray(value)) return value as T[];
  if (isObject(value) && Array.isArray(value.items)) return value.items as T[];
  return [] as T[];
}

function getCookieHeader(response: Response) {
  const headers = response.headers as Headers & { getSetCookie?: () => string[] };
  const cookies =
    typeof headers.getSetCookie === "function"
      ? headers.getSetCookie()
      : response.headers.get("set-cookie")
        ? [String(response.headers.get("set-cookie"))]
        : [];

  return cookies
    .map((item) => item.split(";", 1)[0]?.trim() ?? "")
    .filter(Boolean)
    .join("; ");
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

async function requestNewApi<T>(
  config: NewApiConfig,
  input: {
    path: string;
    method?: string;
    auth?: NewApiAuth;
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

  if (input.auth?.kind === "session") {
    headers.set("Cookie", input.auth.cookieHeader);
    headers.set("New-Api-User", String(input.auth.userId));
  }

  if (input.auth?.kind === "access_token") {
    headers.set("Authorization", `Bearer ${input.auth.accessToken}`);
    headers.set("New-Api-User", String(input.auth.userId));
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
    throw new Error(toErrorMessage(payload, `New API 请求失败（${response.status}）`));
  }

  const envelope = payload as NewApiEnvelope<T> | null;
  if (isObject(envelope) && envelope.success === false) {
    throw new Error(toErrorMessage(envelope, "New API 返回失败"));
  }

  return {
    payload,
    data: isObject(envelope) && "data" in envelope ? (envelope.data as T) : (payload as T),
    response
  };
}

async function loginWithPassword(config: NewApiConfig, username: string, password: string) {
  const { data, response } = await requestNewApi<{ id?: number; require_2fa?: boolean }>(config, {
    path: "/api/user/login",
    method: "POST",
    body: {
      username,
      password
    }
  });

  if (data?.require_2fa) {
    throw new Error("New API 用户启用了 2FA，当前无法自动创建上游 Token");
  }

  const userId = Number(data?.id);
  if (!Number.isFinite(userId) || userId <= 0) {
    throw new Error("New API 登录成功，但未返回有效用户 ID");
  }

  const cookieHeader = getCookieHeader(response);
  if (!cookieHeader) {
    throw new Error("New API 登录成功，但未获取到会话 Cookie");
  }

  return {
    kind: "session",
    userId,
    cookieHeader
  } satisfies Extract<NewApiAuth, { kind: "session" }>;
}

async function resolveAdminAuth(config: NewApiConfig): Promise<NewApiAuth> {
  if (config.admin.kind === "access_token") {
    return {
      kind: "access_token",
      accessToken: config.admin.accessToken,
      userId: config.admin.userId
    };
  }

  return loginWithPassword(config, config.admin.username, config.admin.password);
}

function buildIdentity(cdk: Pick<Cdk, "id" | "code" | "localApiKey" | "upstreamUsername" | "upstreamTokenName">) {
  const digest = crypto.createHash("sha256").update(`${cdk.id}:${cdk.localApiKey}`).digest("hex");
  return {
    username: (cdk.upstreamUsername?.trim() || `cdk${digest.slice(0, 12)}`).slice(0, 20),
    password: `C${digest.slice(0, 15)}9!`,
    displayName: cdk.code.slice(0, 20),
    tokenName: (cdk.upstreamTokenName?.trim() || `CDK ${cdk.code}`).slice(0, 50)
  };
}

function computeQuotaFloor(totalQuotaUsd: number | null | undefined) {
  if (totalQuotaUsd == null) {
    return NEWAPI_MAX_USER_QUOTA;
  }

  const quota = Math.ceil(Math.max(totalQuotaUsd, 0) * NEWAPI_QUOTA_PER_USD * NEWAPI_QUOTA_MULTIPLIER);
  return Math.max(NEWAPI_MIN_USER_QUOTA, Math.min(quota, NEWAPI_MAX_USER_QUOTA));
}

async function getUserById(config: NewApiConfig, auth: NewApiAuth, userId: number) {
  try {
    const { data } = await requestNewApi<NewApiUser>(config, {
      path: `/api/user/${userId}`,
      auth
    });
    return data?.id ? data : null;
  } catch {
    return null;
  }
}

async function findUserByUsername(config: NewApiConfig, auth: NewApiAuth, username: string) {
  const { data } = await requestNewApi<NewApiPage<NewApiUser>>(config, {
    path: "/api/user/search",
    auth,
    query: {
      keyword: username,
      p: "1",
      page_size: "100"
    }
  });

  return getItems<NewApiUser>(data)
    .filter((item) => item?.username === username)
    .sort((a, b) => (b.id ?? 0) - (a.id ?? 0))[0] ?? null;
}

async function createUser(config: NewApiConfig, auth: NewApiAuth, input: {
  username: string;
  password: string;
  displayName: string;
}) {
  await requestNewApi(config, {
    path: "/api/user/",
    method: "POST",
    auth,
    body: {
      username: input.username,
      password: input.password,
      display_name: input.displayName,
      role: 1
    }
  });
}

async function updateUser(config: NewApiConfig, auth: NewApiAuth, input: {
  id: number;
  username: string;
  displayName: string;
  role: number;
  quota: number;
  group: string;
  remark: string;
}) {
  await requestNewApi(config, {
    path: "/api/user/",
    method: "PUT",
    auth,
    body: {
      id: input.id,
      username: input.username,
      display_name: input.displayName,
      role: input.role,
      quota: input.quota,
      group: input.group,
      remark: input.remark
    }
  });
}

async function getTokenById(config: NewApiConfig, auth: NewApiAuth, tokenId: number) {
  try {
    const { data } = await requestNewApi<NewApiToken>(config, {
      path: `/api/token/${tokenId}`,
      auth
    });
    return data?.id ? data : null;
  } catch {
    return null;
  }
}

async function findTokenByName(config: NewApiConfig, auth: NewApiAuth, tokenName: string) {
  const { data } = await requestNewApi<NewApiPage<NewApiToken>>(config, {
    path: "/api/token/search",
    auth,
    query: {
      keyword: tokenName,
      p: "1",
      page_size: "100"
    }
  });

  return getItems<NewApiToken>(data)
    .filter((item) => item?.name === tokenName)
    .sort((a, b) => (b.id ?? 0) - (a.id ?? 0))[0] ?? null;
}

async function createToken(config: NewApiConfig, auth: NewApiAuth, input: {
  tokenName: string;
  tokenGroup: string;
}) {
  await requestNewApi(config, {
    path: "/api/token/",
    method: "POST",
    auth,
    body: {
      name: input.tokenName,
      expired_time: -1,
      remain_quota: 0,
      unlimited_quota: true,
      model_limits_enabled: false,
      group: input.tokenGroup,
      cross_group_retry: false
    }
  });
}

async function updateToken(config: NewApiConfig, auth: NewApiAuth, input: {
  tokenId: number;
  tokenName: string;
  remainQuota: number;
  tokenGroup: string;
  crossGroupRetry: boolean;
}) {
  await requestNewApi(config, {
    path: "/api/token/",
    method: "PUT",
    auth,
    body: {
      id: input.tokenId,
      name: input.tokenName,
      status: 1,
      expired_time: -1,
      remain_quota: Math.max(input.remainQuota, 0),
      unlimited_quota: true,
      model_limits_enabled: false,
      group: input.tokenGroup,
      cross_group_retry: input.crossGroupRetry
    }
  });
}

async function getTokenKey(config: NewApiConfig, auth: NewApiAuth, tokenId: number) {
  const { data } = await requestNewApi<{ key?: string } | string>(config, {
    path: `/api/token/${tokenId}/key`,
    method: "POST",
    auth
  });

  const key =
    typeof data === "string"
      ? data
      : isObject(data) && typeof data.key === "string"
        ? data.key
        : "";

  if (!key) {
    throw new Error("New API Token 已创建，但未能读取完整 Key");
  }

  return key;
}

function getDesiredUserGroup(config: NewApiConfig, existingGroup: string | undefined) {
  return config.userGroup || existingGroup || "default";
}

function getDesiredTokenGroup(config: NewApiConfig, existingGroup: string | undefined) {
  return config.tokenGroup || existingGroup || "";
}

async function ensureUser(config: NewApiConfig, auth: NewApiAuth, cdk: Pick<
  Cdk,
  "id" | "code" | "localApiKey" | "upstreamUserId" | "upstreamUsername" | "upstreamTokenName"
>, quotaFloor: number) {
  const identity = buildIdentity(cdk);
  let user =
    typeof cdk.upstreamUserId === "number" && cdk.upstreamUserId > 0
      ? await getUserById(config, auth, cdk.upstreamUserId)
      : null;

  if (!user || user.username !== identity.username) {
    user = await findUserByUsername(config, auth, identity.username);
  }

  if (!user) {
    await createUser(config, auth, identity);
    user = await findUserByUsername(config, auth, identity.username);
  }

  if (!user) {
    throw new Error("New API 用户创建成功后未能查询到结果");
  }

  await updateUser(config, auth, {
    id: user.id,
    username: user.username,
    displayName: identity.displayName,
    role: typeof user.role === "number" && user.role > 0 ? user.role : 1,
    quota: quotaFloor,
    group: getDesiredUserGroup(config, user.group),
    remark: `CDK ${cdk.code}`
  });

  return {
    user,
    identity
  };
}

async function ensureToken(config: NewApiConfig, auth: NewApiAuth, cdk: Pick<
  Cdk,
  "upstreamTokenId" | "upstreamTokenName"
>, identity: ReturnType<typeof buildIdentity>) {
  let token =
    typeof cdk.upstreamTokenId === "number" && cdk.upstreamTokenId > 0
      ? await getTokenById(config, auth, cdk.upstreamTokenId)
      : null;

  if (!token || token.name !== identity.tokenName) {
    token = await findTokenByName(config, auth, identity.tokenName);
  }

  if (!token) {
    await createToken(config, auth, {
      tokenName: identity.tokenName,
      tokenGroup: getDesiredTokenGroup(config, undefined)
    });
    token = await findTokenByName(config, auth, identity.tokenName);
  }

  if (!token) {
    throw new Error("New API Token 创建成功后未能查询到结果");
  }

  await updateToken(config, auth, {
    tokenId: token.id,
    tokenName: identity.tokenName,
    remainQuota: typeof token.remain_quota === "number" ? token.remain_quota : 0,
    tokenGroup: getDesiredTokenGroup(config, token.group),
    crossGroupRetry: Boolean(token.cross_group_retry)
  });

  return token;
}

export function getNewApiConfig() {
  const rawBaseUrl = process.env.NEWAPI_BASE_URL?.trim();
  if (!rawBaseUrl) return null;

  const accessToken = process.env.NEWAPI_ADMIN_ACCESS_TOKEN?.trim();
  const adminUserId = Number(process.env.NEWAPI_ADMIN_USER_ID ?? "");
  const username = process.env.NEWAPI_ADMIN_USERNAME?.trim();
  const password = process.env.NEWAPI_ADMIN_PASSWORD?.trim();

  if (accessToken && Number.isFinite(adminUserId) && adminUserId > 0) {
    return {
      baseUrl: normalizeBaseUrl(rawBaseUrl),
      admin: {
        kind: "access_token",
        accessToken,
        userId: adminUserId
      },
      userGroup: process.env.NEWAPI_USER_GROUP?.trim() || "default",
      tokenGroup: process.env.NEWAPI_TOKEN_GROUP?.trim() || ""
    } satisfies NewApiConfig;
  }

  if (username && password) {
    return {
      baseUrl: normalizeBaseUrl(rawBaseUrl),
      admin: {
        kind: "password",
        username,
        password
      },
      userGroup: process.env.NEWAPI_USER_GROUP?.trim() || "default",
      tokenGroup: process.env.NEWAPI_TOKEN_GROUP?.trim() || ""
    } satisfies NewApiConfig;
  }

  throw new Error(
    "已配置 NEWAPI_BASE_URL，但缺少管理员身份信息。请提供 NEWAPI_ADMIN_ACCESS_TOKEN + NEWAPI_ADMIN_USER_ID，或 NEWAPI_ADMIN_USERNAME + NEWAPI_ADMIN_PASSWORD。"
  );
}

export async function ensureNewApiBinding(
  cdk: Pick<
    Cdk,
    | "id"
    | "code"
    | "localApiKey"
    | "effectiveTotalQuotaUsd"
    | "upstreamUserId"
    | "upstreamUsername"
    | "upstreamTokenId"
    | "upstreamTokenName"
  >,
  input?: {
    desiredTotalQuotaUsd?: number | null;
  }
) {
  const config = getNewApiConfig();
  if (!config) {
    throw new Error("当前未启用 New API 模式");
  }

  const quotaFloor = computeQuotaFloor(input?.desiredTotalQuotaUsd ?? cdk.effectiveTotalQuotaUsd);
  const adminAuth = await resolveAdminAuth(config);
  const { user, identity } = await ensureUser(config, adminAuth, cdk, quotaFloor);
  const userAuth = await loginWithPassword(config, identity.username, identity.password);
  const token = await ensureToken(config, userAuth, cdk, identity);
  const tokenKey = await getTokenKey(config, userAuth, token.id);

  return {
    upstreamUserId: userAuth.userId || user.id,
    upstreamUsername: identity.username,
    upstreamTokenId: token.id,
    upstreamTokenName: identity.tokenName,
    upstreamTokenKey: tokenKey,
    upstreamQuotaFloor: quotaFloor,
    upstreamProvisionedAt: new Date().toISOString()
  } satisfies NewApiBinding;
}
