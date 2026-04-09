import "./env";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { Readable } from "node:stream";
import { fileURLToPath } from "node:url";
import cookieParser from "cookie-parser";
import cors from "cors";
import express, { type NextFunction, type Request, type Response } from "express";
import {
  buildGatewayModelCatalog,
  hasGatewayMode,
  listGatewayCandidates,
  markGatewayAccountUsed,
  parseProviderGroups,
  resolveGatewayPlatform,
  type GatewayAccount
} from "./gateway";
import { ensureNewApiBinding, getNewApiConfig, type NewApiBinding } from "./newapi";
import {
  ensureSub2ApiBinding,
  fetchSub2ApiAdminRecentUsage,
  fetchSub2ApiAdminRecentUsagePage,
  fetchSub2ApiModelCatalog,
  fetchSub2ApiUserSnapshot,
  getSub2ApiConfig,
  hasSub2ApiMode
} from "./sub2api";
import {
  applyInviteReward,
  applyTemplateToCdk,
  buildDirectRechargePreview,
  confirmDirectRecharge,
  createChildApiKeyForCdk,
  createTemplate,
  deleteChildApiKey,
  ensureDb,
  findApiKeyById,
  findApiKeyBySecret,
  findCdkByCode,
  findCdkByInviteCode,
  findCdkByLocalApiKey,
  findOrderById,
  findOrderByOrderNo,
  findTemplate,
  generatePendingCdk,
  getApiKeyUsageSnapshot,
  getApiKeysForCdk,
  getCdkUsage,
  getQuotaSnapshot,
  hasApiKeyQuotaAvailable,
  hasQuotaAvailable,
  hashValue,
  isExpired,
  makeId,
  makeOrderNo,
  maskSecret,
  readDb,
  recordUsage,
  updateChildApiKey,
  updateDb
} from "./store";
import type { Cdk, Db, Order, OrderMode, RechargeMode, SiteSettings, Template } from "./types";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, "..");
const distDir = path.join(rootDir, "dist");
const port = Number(process.env.PORT ?? 8787);
const adminCookieName = "relay_admin_session";
const adminSessionAbsoluteTtlMs = Number(process.env.ADMIN_SESSION_ABSOLUTE_TTL_MS ?? 12 * 60 * 60 * 1000);
const adminSessionIdleTtlMs = Number(process.env.ADMIN_SESSION_IDLE_TTL_MS ?? 2 * 60 * 60 * 1000);
const adminLoginWindowMs = Number(process.env.ADMIN_LOGIN_WINDOW_MS ?? 15 * 60 * 1000);
const adminLoginLockoutMs = Number(process.env.ADMIN_LOGIN_LOCKOUT_MS ?? 15 * 60 * 1000);
const adminLoginMaxFailures = Number(process.env.ADMIN_LOGIN_MAX_FAILURES ?? 5);

type AdminSession = {
  token: string;
  username: string;
  csrfToken: string;
  createdAt: string;
  expiresAt: string;
  lastSeenAt: string;
  idleExpiresAt: string;
  clientIp: string;
  userAgentHash: string | null;
};

type AdminLoginAttempt = {
  failures: number;
  firstFailedAt: number;
  lastFailedAt: number;
  lockedUntil: number | null;
};

const adminSessions = new Map<string, AdminSession>();
const adminLoginAttempts = new Map<string, AdminLoginAttempt>();

function hasNewApiMode() {
  return Boolean(process.env.NEWAPI_BASE_URL?.trim());
}

function getUpstreamMode() {
  if (hasSub2ApiMode()) return "sub2api";
  if (hasGatewayMode()) return "selfhosted";
  if (hasNewApiMode()) return "newapi";
  if (process.env.OPENAI_BASE_URL && process.env.OPENAI_API_KEY) return "upstream";
  return "mock";
}

function roundCny(value: number) {
  return Number(value.toFixed(2));
}

function numberOrNull(value: unknown) {
  if (value === "" || value == null) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function stringOrNull(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function parseRechargeMode(value: unknown): RechargeMode {
  if (value === "boost_quota" || value === "increase_quota") return "boost_quota";
  if (value === "overwrite") return "overwrite";
  return "extend_duration";
}

type TemplatePresetMode = "daily_pass" | "weekly_pass" | "monthly_pass" | "token_pack";

function parseTemplatePresetMode(value: unknown): TemplatePresetMode | null {
  if (value === "daily_pass" || value === "weekly_pass" || value === "monthly_pass" || value === "token_pack") {
    return value;
  }
  return null;
}

function detectTemplatePresetMode(input: {
  durationDays: number | null | undefined;
  dailyQuotaUsd: number | null | undefined;
  totalQuotaUsd: number | null | undefined;
}) {
  const hasDailyQuota = input.dailyQuotaUsd != null && input.dailyQuotaUsd > 0;
  const hasTotalQuota = input.totalQuotaUsd != null && input.totalQuotaUsd > 0;

  if (hasDailyQuota && !hasTotalQuota && input.durationDays === 1) {
    return "daily_pass" satisfies TemplatePresetMode;
  }

  if (hasDailyQuota && !hasTotalQuota && input.durationDays === 7) {
    return "weekly_pass" satisfies TemplatePresetMode;
  }

  if (hasDailyQuota && !hasTotalQuota && input.durationDays === 30) {
    return "monthly_pass" satisfies TemplatePresetMode;
  }

  if (hasTotalQuota && !hasDailyQuota) {
    return "token_pack" satisfies TemplatePresetMode;
  }

  return null;
}

function buildTemplateQuotaConfig(
  body: any,
  currentTemplate?: Pick<Template, "durationDays" | "dailyQuotaUsd" | "totalQuotaUsd">
) {
  const explicitMode = parseTemplatePresetMode(body?.templateType ?? body?.template_type);
  const fallbackMode =
    currentTemplate == null
      ? "monthly_pass"
      : detectTemplatePresetMode(currentTemplate) ?? "monthly_pass";
  const mode = explicitMode ?? fallbackMode;

  const dailyQuotaUsd = numberOrNull(body?.dailyQuotaUsd ?? body?.daily_quota_usd);
  const durationDays = numberOrNull(body?.durationDays ?? body?.duration_days);
  const totalQuotaUsd = numberOrNull(body?.totalQuotaUsd ?? body?.total_quota_usd);

  if (mode === "daily_pass") {
    if (dailyQuotaUsd == null || dailyQuotaUsd <= 0) {
      throw new Error("包天模板必须填写大于 0 的日额度");
    }
    return {
      templateType: mode,
      durationDays: 1,
      dailyQuotaUsd,
      monthlyQuotaUsd: null,
      totalQuotaUsd: null
    };
  }

  if (mode === "weekly_pass") {
    if (dailyQuotaUsd == null || dailyQuotaUsd <= 0) {
      throw new Error("包周模板必须填写大于 0 的日额度");
    }
    return {
      templateType: mode,
      durationDays: 7,
      dailyQuotaUsd,
      monthlyQuotaUsd: null,
      totalQuotaUsd: null
    };
  }

  if (mode === "monthly_pass") {
    if (dailyQuotaUsd == null || dailyQuotaUsd <= 0) {
      throw new Error("包月模板必须填写大于 0 的日额度");
    }
    return {
      templateType: mode,
      durationDays: 30,
      dailyQuotaUsd,
      monthlyQuotaUsd: null,
      totalQuotaUsd: null
    };
  }

  if (durationDays == null || durationDays <= 0) {
    throw new Error("Token量模板必须填写大于 0 的有效期天数");
  }
  if (totalQuotaUsd == null || totalQuotaUsd <= 0) {
    throw new Error("Token量模板必须填写大于 0 的总额度");
  }

  return {
    templateType: mode,
    durationDays,
    dailyQuotaUsd: null,
    monthlyQuotaUsd: null,
    totalQuotaUsd
  };
}

function getBaseUrl(req: Request) {
  const host = req.get("x-forwarded-host") ?? req.get("host") ?? `localhost:${port}`;
  const protocol = req.get("x-forwarded-proto") ?? req.protocol ?? "http";
  return `${protocol}://${host}`;
}

function resolvePublicBaseUrl(req: Request, configuredBaseUrl: string) {
  const requestBaseUrl = getBaseUrl(req);
  const normalized = configuredBaseUrl.trim();
  if (!normalized) return requestBaseUrl;

  try {
    const configuredUrl = new URL(normalized);
    const requestUrl = new URL(requestBaseUrl);
    const localHosts = new Set(["localhost", "127.0.0.1"]);
    const bothLocal = localHosts.has(configuredUrl.hostname) && localHosts.has(requestUrl.hostname);

    if (bothLocal && (configuredUrl.hostname !== requestUrl.hostname || configuredUrl.port !== requestUrl.port)) {
      return requestBaseUrl;
    }
  } catch {
    return requestBaseUrl;
  }

  return normalized;
}

function applyNewApiBinding(cdk: Cdk, binding: NewApiBinding) {
  cdk.upstreamUserId = binding.upstreamUserId;
  cdk.upstreamUsername = binding.upstreamUsername;
  cdk.upstreamTokenId = binding.upstreamTokenId;
  cdk.upstreamTokenName = binding.upstreamTokenName;
  cdk.upstreamTokenKey = binding.upstreamTokenKey;
  cdk.upstreamQuotaFloor = binding.upstreamQuotaFloor;
  cdk.upstreamProvisionedAt = binding.upstreamProvisionedAt;
}

function applySub2ApiBinding(
  cdk: Cdk,
  binding: Awaited<ReturnType<typeof ensureSub2ApiBinding>>
) {
  cdk.sub2apiUserId = binding.sub2apiUserId;
  cdk.sub2apiEmail = binding.sub2apiEmail;
  cdk.sub2apiUsername = binding.sub2apiUsername;
  cdk.sub2apiProvisionedAt = binding.sub2apiProvisionedAt;
  cdk.sub2apiLastSyncAt = binding.sub2apiLastSyncAt;
  cdk.sub2apiBindings = binding.sub2apiBindings;
}

async function syncCdkNewApiBinding(code: string, input?: { desiredTotalQuotaUsd?: number | null }) {
  const db = readDb();
  const cdk = findCdkByCode(db, code);
  if (!cdk) {
    throw new Error("CDK 不存在");
  }

  const binding = await ensureNewApiBinding(cdk, input);

  updateDb((mutableDb) => {
    const mutableCdk = findCdkByCode(mutableDb, code);
    if (!mutableCdk) {
      throw new Error("CDK 不存在");
    }
    applyNewApiBinding(mutableCdk, binding);
  });

  return binding;
}

async function syncCdkSub2ApiBinding(code: string, input?: { desiredExpiresAt?: string | null }) {
  const db = readDb();
  const cdk = findCdkByCode(db, code);
  if (!cdk) {
    throw new Error("CDK 不存在");
  }

  const template = findTemplate(db, cdk.templateId);
  if (!template) {
    throw new Error("模板不存在");
  }

  const binding = await ensureSub2ApiBinding(cdk, template, input);

  updateDb((mutableDb) => {
    const mutableCdk = findCdkByCode(mutableDb, code);
    if (!mutableCdk) {
      throw new Error("CDK 不存在");
    }
    applySub2ApiBinding(mutableCdk, binding);
  });

  return binding;
}

function predictActivationExpiry(cdk: Cdk, template: Template) {
  if (cdk.redeemedAt) {
    return cdk.expiresAt;
  }
  if (!template.durationDays) {
    return cdk.expiresAt;
  }

  const now = Date.now();
  const expiresBase = cdk.expiresAt ? new Date(cdk.expiresAt).getTime() : now;
  const base = Math.max(expiresBase, now);
  return new Date(base + template.durationDays * 24 * 60 * 60 * 1000).toISOString();
}

function pickSub2ApiBinding(cdk: Cdk, template: Template, platform: ReturnType<typeof resolveGatewayPlatform>) {
  if (!platform) return null;

  const matrix = parseProviderGroups(template.providerGroup);
  const preferredGroupNames = [
    ...(matrix.platforms[platform] ?? []),
    ...matrix.all
  ];

  for (const groupName of preferredGroupNames) {
    const matched = cdk.sub2apiBindings.find(
      (item) => item.platform === platform && item.groupName === groupName && item.apiKey
    );
    if (matched) return matched;
  }

  return cdk.sub2apiBindings.find((item) => item.platform === platform && item.apiKey) ?? null;
}

function getClientIp(req: Request) {
  const forwarded = req.get("x-forwarded-for");
  if (forwarded) {
    const [first] = forwarded.split(",");
    if (first?.trim()) return first.trim();
  }
  return req.ip || req.socket.remoteAddress || "unknown";
}

function getUserAgentHash(req: Request) {
  const userAgent = req.get("user-agent")?.trim();
  return userAgent ? hashValue(userAgent) : null;
}

function isSecureRequest(req: Request) {
  const forwardedProto = String(req.get("x-forwarded-proto") ?? "").trim().toLowerCase();
  return req.secure || forwardedProto === "https";
}

function getCorsAllowedOrigins() {
  const db = readDb();
  const allowed = new Set<string>([
    `http://localhost:${port}`,
    `http://127.0.0.1:${port}`,
    "http://localhost:5173",
    "http://127.0.0.1:5173"
  ]);

  for (const item of [
    process.env.PUBLIC_BASE_URL,
    db.site.remoteWebUrl,
    ...(String(process.env.CORS_ALLOWED_ORIGINS ?? "")
      .split(",")
      .map((value) => value.trim())
      .filter(Boolean))
  ]) {
    if (!item) continue;
    try {
      allowed.add(new URL(item).origin);
    } catch {
      // Ignore invalid origin configuration and keep serving.
    }
  }

  return allowed;
}

function isAllowedCorsOrigin(origin: string) {
  return getCorsAllowedOrigins().has(origin);
}

function cleanupAdminAuthState() {
  const now = Date.now();

  for (const [token, session] of adminSessions.entries()) {
    if (new Date(session.expiresAt).getTime() <= now || new Date(session.idleExpiresAt).getTime() <= now) {
      adminSessions.delete(token);
    }
  }

  for (const [key, attempt] of adminLoginAttempts.entries()) {
    const expired =
      (attempt.lockedUntil != null && attempt.lockedUntil <= now && now - attempt.lastFailedAt > adminLoginWindowMs) ||
      (attempt.lockedUntil == null && now - attempt.lastFailedAt > adminLoginWindowMs);

    if (expired) {
      adminLoginAttempts.delete(key);
    }
  }
}

function buildAdminLoginKey(req: Request, username: string) {
  const normalizedUsername = username.trim().toLowerCase() || "__empty__";
  return `${normalizedUsername}@${getClientIp(req)}`;
}

function getAdminLoginAttemptStatus(key: string) {
  cleanupAdminAuthState();
  const attempt = adminLoginAttempts.get(key);
  if (!attempt || !attempt.lockedUntil) {
    return { locked: false as const, retryAfterSeconds: 0 };
  }

  const remainingMs = attempt.lockedUntil - Date.now();
  if (remainingMs <= 0) {
    adminLoginAttempts.delete(key);
    return { locked: false as const, retryAfterSeconds: 0 };
  }

  return {
    locked: true as const,
    retryAfterSeconds: Math.ceil(remainingMs / 1000)
  };
}

function recordAdminLoginFailure(key: string) {
  cleanupAdminAuthState();
  const now = Date.now();
  const current = adminLoginAttempts.get(key);

  if (!current || now - current.firstFailedAt > adminLoginWindowMs) {
    adminLoginAttempts.set(key, {
      failures: 1,
      firstFailedAt: now,
      lastFailedAt: now,
      lockedUntil: null
    });
    return;
  }

  current.failures += 1;
  current.lastFailedAt = now;
  if (current.failures >= adminLoginMaxFailures) {
    current.lockedUntil = now + adminLoginLockoutMs;
  }
}

function clearAdminLoginFailures(key: string) {
  adminLoginAttempts.delete(key);
}

function createAdminSession(req: Request, username: string) {
  const now = new Date();
  const session: AdminSession = {
    token: crypto.randomBytes(24).toString("hex"),
    username,
    csrfToken: crypto.randomBytes(24).toString("hex"),
    createdAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + adminSessionAbsoluteTtlMs).toISOString(),
    lastSeenAt: now.toISOString(),
    idleExpiresAt: new Date(now.getTime() + adminSessionIdleTtlMs).toISOString(),
    clientIp: getClientIp(req),
    userAgentHash: getUserAgentHash(req)
  };

  adminSessions.set(session.token, session);
  return session;
}

function getAdminSession(req: Request, options?: { touch?: boolean }) {
  cleanupAdminAuthState();

  const token = String(req.cookies?.[adminCookieName] ?? "").trim();
  if (!token) return null;

  const session = adminSessions.get(token);
  if (!session) return null;

  const now = Date.now();
  const expired = new Date(session.expiresAt).getTime() <= now || new Date(session.idleExpiresAt).getTime() <= now;
  const userAgentHash = getUserAgentHash(req);
  const hasUserAgentMismatch = Boolean(session.userAgentHash && userAgentHash && session.userAgentHash !== userAgentHash);

  if (expired || hasUserAgentMismatch) {
    adminSessions.delete(token);
    return null;
  }

  if (options?.touch !== false) {
    const touchedAt = new Date();
    session.lastSeenAt = touchedAt.toISOString();
    session.idleExpiresAt = new Date(touchedAt.getTime() + adminSessionIdleTtlMs).toISOString();
  }

  return session;
}

function destroyAdminSession(req: Request) {
  const token = String(req.cookies?.[adminCookieName] ?? "").trim();
  if (!token) return;
  adminSessions.delete(token);
}

function hasDefaultAdminCredentialRisk() {
  const db = readDb();
  return db.admins.some(
    (admin) => admin.username === "admin" && admin.passwordHash === hashValue("relay123456")
  );
}

function buildAdminSessionResponse(req: Request, session: AdminSession | null) {
  return {
    is_admin: Boolean(session),
    username: session?.username ?? null,
    csrfToken: session?.csrfToken ?? null,
    createdAt: session?.createdAt ?? null,
    expiresAt: session?.expiresAt ?? null,
    lastSeenAt: session?.lastSeenAt ?? null,
    idleExpiresAt: session?.idleExpiresAt ?? null,
    secureCookie: session ? isSecureRequest(req) : false,
    sameSite: "lax" as const,
    writeProtectionEnabled: true,
    csrfProtectionEnabled: true,
    sessionTtlMinutes: Math.round(adminSessionAbsoluteTtlMs / 60000),
    idleTimeoutMinutes: Math.round(adminSessionIdleTtlMs / 60000),
    credentialRotationRecommended: hasDefaultAdminCredentialRisk()
  };
}

function requireAdmin(req: Request, res: Response, next: NextFunction) {
  const session = getAdminSession(req);
  if (!session) {
    res.status(401).json({ message: "请先登录管理后台" });
    return;
  }
  next();
}

function getSessionUsername(req: Request) {
  return getAdminSession(req)?.username ?? null;
}

function requireAdminWriteProtection(req: Request, res: Response, next: NextFunction) {
  const session = getAdminSession(req);
  if (!session) {
    res.status(401).json({ message: "请先登录管理后台" });
    return;
  }

  const origin = req.get("origin")?.trim();
  if (origin && !isAllowedCorsOrigin(origin)) {
    res.status(403).json({ message: "当前来源未被允许访问后台写接口" });
    return;
  }

  const csrfToken = req.get("x-admin-csrf")?.trim();
  if (!csrfToken || csrfToken !== session.csrfToken) {
    res.status(403).json({ message: "后台写操作需要有效的 CSRF 校验" });
    return;
  }

  next();
}

function parseBearer(req: Request) {
  const value = req.header("authorization");
  if (value?.startsWith("Bearer ")) {
    return value.slice("Bearer ".length).trim();
  }

  const directHeaderKey =
    req.header("x-api-key")?.trim() || req.header("x-goog-api-key")?.trim() || req.query.key?.toString().trim();
  if (directHeaderKey) {
    return directHeaderKey;
  }

  const legacyKey = req.query.api_key?.toString().trim();
  return legacyKey || null;
}

function getProxyPayload(req: Request) {
  const contentType = String(req.header("content-type") ?? "");
  const buffer = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0);
  if (!contentType.includes("application/json")) {
    return {
      rawBody: buffer,
      jsonBody: null as Record<string, unknown> | null
    };
  }

  try {
    return {
      rawBody: buffer,
      jsonBody: buffer.length ? (JSON.parse(buffer.toString("utf8")) as Record<string, unknown>) : {}
    };
  } catch {
    return {
      rawBody: buffer,
      jsonBody: null as Record<string, unknown> | null
    };
  }
}

function estimateCostUsd(inputTokens: number | null, outputTokens: number | null) {
  if (inputTokens == null && outputTokens == null) return null;
  const input = inputTokens ?? 0;
  const output = outputTokens ?? 0;
  return Number((input / 1_000_000 + output / 500_000).toFixed(6));
}

function computeNextFixedResetAt(dailyResetTime: string) {
  const [rawHour = "0", rawMinute = "0"] = dailyResetTime.split(":");
  const hour = Number(rawHour);
  const minute = Number(rawMinute);
  if (!Number.isInteger(hour) || !Number.isInteger(minute)) return null;

  const now = new Date();
  const next = new Date(now);
  next.setSeconds(0, 0);
  next.setHours(hour, minute, 0, 0);
  if (next.getTime() <= now.getTime()) {
    next.setDate(next.getDate() + 1);
  }
  return next.toISOString();
}

function resolveUsageShape(payload: any) {
  const usage = payload?.usage ?? {};
  const inputTokens = Number(
    usage.prompt_tokens ??
      usage.input_tokens ??
      usage.inputTokens ??
      usage.promptTokens ??
      usage.input ??
      usage.input_tokens_details?.cached_tokens ??
      0
  );
  const outputTokens = Number(
    usage.completion_tokens ??
      usage.output_tokens ??
      usage.outputTokens ??
      usage.completionTokens ??
      usage.output ??
      0
  );
  const totalTokens = Number(usage.total_tokens ?? usage.totalTokens ?? inputTokens + outputTokens);

  return {
    inputTokens: Number.isFinite(inputTokens) ? inputTokens : null,
    outputTokens: Number.isFinite(outputTokens) ? outputTokens : null,
    totalTokens: Number.isFinite(totalTokens) ? totalTokens : null
  };
}

function getQuickstart(baseUrl: string, apiKey: string) {
  const body = {
    model: "gpt-4.1-mini",
    messages: [{ role: "user", content: "给我一段 hello world 示例。" }]
  };

  return {
    baseUrl,
    header: `Authorization: Bearer ${apiKey}`,
    curl: [
      `curl ${baseUrl}/v1/chat/completions \\`,
      `  -H "Content-Type: application/json" \\`,
      `  -H "Authorization: Bearer ${apiKey}" \\`,
      `  -d '${JSON.stringify(body, null, 2)}'`
    ].join("\n")
  };
}

function serializeCdk(cdk: Cdk) {
  return {
    id: cdk.id,
    code: cdk.code,
    localApiKey: cdk.localApiKey,
    local_api_key: cdk.localApiKey,
    localApiKeyMasked: maskSecret(cdk.localApiKey),
    local_api_key_masked: maskSecret(cdk.localApiKey),
    disabled: cdk.disabled,
    createdAt: cdk.createdAt,
    created_at: cdk.createdAt,
    redeemedAt: cdk.redeemedAt,
    redeemed_at: cdk.redeemedAt,
    expiresAt: cdk.expiresAt,
    expires_at: cdk.expiresAt,
    usageCount: cdk.usageCount,
    usage_count: cdk.usageCount,
    totalCostUsd: cdk.totalCostUsd,
    total_cost_usd: cdk.totalCostUsd,
    lastUsedAt: cdk.lastUsedAt,
    last_used_at: cdk.lastUsedAt,
    note: cdk.note,
    effectiveDailyQuotaUsd: cdk.effectiveDailyQuotaUsd,
    effective_daily_quota_usd: cdk.effectiveDailyQuotaUsd,
    effectiveMonthlyQuotaUsd: cdk.effectiveMonthlyQuotaUsd,
    effective_monthly_quota_usd: cdk.effectiveMonthlyQuotaUsd,
    effectiveTotalQuotaUsd: cdk.effectiveTotalQuotaUsd,
    effective_total_quota_usd: cdk.effectiveTotalQuotaUsd,
    inviteCode: cdk.inviteCode,
    invite_code: cdk.inviteCode,
    inviteCount: cdk.inviteCount,
    invite_count: cdk.inviteCount,
    inviteRewardTotalUsd: cdk.inviteRewardTotalUsd,
    invite_reward_total_usd: cdk.inviteRewardTotalUsd,
    lastRechargeAt: cdk.lastRechargeAt,
    last_recharge_at: cdk.lastRechargeAt,
    sourceCdkCode: cdk.sourceCdkCode,
    source_cdk_code: cdk.sourceCdkCode,
    rechargeTargetCode: cdk.rechargeTargetCode,
    recharge_target_code: cdk.rechargeTargetCode,
    rechargeMode: cdk.rechargeMode,
    recharge_mode: cdk.rechargeMode,
    rechargeConfirmedAt: cdk.rechargeConfirmedAt,
    recharge_confirmed_at: cdk.rechargeConfirmedAt
  };
}

function serializeTemplate(template: Template) {
  const templateType = detectTemplatePresetMode(template);
  return {
    ...template,
    templateType,
    template_type: templateType,
    duration_days: template.durationDays,
    daily_quota_usd: template.dailyQuotaUsd,
    weekly_quota_usd: template.weeklyQuotaUsd,
    monthly_quota_usd: template.monthlyQuotaUsd,
    total_quota_usd: template.totalQuotaUsd,
    daily_reset_mode: template.dailyResetMode,
    daily_reset_time: template.dailyResetTime,
    provider_group: template.providerGroup,
    contact_text: template.contactText,
    contact_link: template.contactLink,
    hide_group_info: template.hideGroupInfo,
    allow_new_purchase: template.allowNewPurchase,
    allow_recharge: template.allowRecharge,
    created_at: template.createdAt,
    updated_at: template.updatedAt
  };
}

function serializeApiKey(db: Db, cdk: Cdk, item: ReturnType<typeof getApiKeysForCdk>[number]) {
  const usage = getApiKeyUsageSnapshot(db, item);
  return {
    id: item.id,
    userId: cdk.id,
    key: item.key,
    name: item.name,
    isEnabled: item.isEnabled,
    expiresAt: item.expiresAt,
    effectiveExpiresAt: item.expiresAt,
    canLoginWebUi: item.canLoginWebUi,
    limit5hUsd: item.limit5hUsd,
    limitDailyUsd: item.limitDailyUsd,
    limitWeeklyUsd: item.limitWeeklyUsd,
    limitMonthlyUsd: item.limitMonthlyUsd,
    limitTotalUsd: item.limitTotalUsd,
    limitConcurrentSessions: item.limitConcurrentSessions,
    providerGroup: item.providerGroup,
    createdAt: item.createdAt,
    updatedAt: item.updatedAt,
    created_at: item.createdAt,
    updated_at: item.updatedAt,
    isPrimary: item.key === cdk.localApiKey,
    is_primary: item.key === cdk.localApiKey,
    usage
  };
}

function serializePaymentSettings(site: SiteSettings) {
  return {
    paymentMode: site.paymentMode,
    paymentChannelLabel: site.paymentChannelLabel,
    paymentAccountName: site.paymentAccountName,
    paymentAccountNo: site.paymentAccountNo,
    paymentQrCodeUrl: site.paymentQrCodeUrl,
    paymentInstructions: site.paymentInstructions
  };
}

function serializeOrder(db: Db, order: Order) {
  const template = findTemplate(db, order.templateId);
  const cdk = order.cdkId ? db.cdks.find((item) => item.id === order.cdkId) ?? null : null;
  const createdCdk = order.createdCdkId
    ? db.cdks.find((item) => item.id === order.createdCdkId) ?? null
    : null;
  const inviter = order.inviterCdkId ? db.cdks.find((item) => item.id === order.inviterCdkId) ?? null : null;

  return {
    id: order.id,
    orderNo: order.orderNo,
    mode: order.mode,
    status: order.status,
    template: template ? serializeTemplate(template) : null,
    cdkCodeSnapshot: order.cdkCodeSnapshot,
    originalAmountCny: order.originalAmountCny,
    discountAmountCny: order.discountAmountCny,
    finalAmountCny: order.finalAmountCny,
    buyerName: order.buyerName,
    buyerContact: order.buyerContact,
    paymentChannel: order.paymentChannel,
    paymentReference: order.paymentReference,
    paymentNote: order.paymentNote,
    adminNote: order.adminNote,
    inviteCode: order.inviteCode,
    inviterInviteCode: inviter?.inviteCode ?? null,
    inviteRewardApplied: order.inviteRewardApplied,
    createdAt: order.createdAt,
    updatedAt: order.updatedAt,
    submittedAt: order.submittedAt,
    paidAt: order.paidAt,
    confirmedBy: order.confirmedBy,
    cdk: cdk ? serializeCdk(cdk) : null,
    createdCdk: createdCdk ? serializeCdk(createdCdk) : null
  };
}

function buildOrderPreview(db: Db, input: {
  templateId: string;
  mode: OrderMode;
  cdkCode?: string;
  inviteCode?: string;
}) {
  const template = findTemplate(db, input.templateId);
  if (!template || !template.enabled) {
    throw new Error("套餐不存在或已下架");
  }

  if (input.mode === "new_purchase" && !template.allowNewPurchase) {
    throw new Error("这个套餐暂不支持新购");
  }

  if (input.mode === "recharge_existing" && !template.allowRecharge) {
    throw new Error("这个套餐暂不支持充值");
  }

  let targetCdk: Cdk | null = null;
  if (input.mode === "recharge_existing") {
    if (!input.cdkCode?.trim()) {
      throw new Error("充值模式需要填写目标 CDK");
    }
    targetCdk = findCdkByCode(db, input.cdkCode.trim());
    if (!targetCdk) {
      throw new Error("目标 CDK 不存在");
    }
  }

  const originalAmountCny = 0;

  let inviter: Cdk | null = null;
  let discountAmountCny = 0;
  if (db.site.inviteEnabled && input.inviteCode?.trim()) {
    inviter = findCdkByInviteCode(db, input.inviteCode.trim());
    if (!inviter) {
      throw new Error("邀请码不存在");
    }
    if (targetCdk && inviter.id === targetCdk.id) {
      throw new Error("不能使用自己的邀请码");
    }
    discountAmountCny = roundCny((originalAmountCny * db.site.inviteDiscountPercent) / 100);
  }

  const finalAmountCny = roundCny(Math.max(originalAmountCny - discountAmountCny, 0));
  const paymentChannel: Order["paymentChannel"] = db.site.paymentMode === "mock_auto" ? "mock" : "manual";

  return {
    template,
    targetCdk,
    inviter,
    paymentChannel,
    originalAmountCny,
    discountAmountCny,
    finalAmountCny
  };
}

function fulfillOrder(db: Db, order: Order, confirmedBy: string | null) {
  if (order.status === "paid") {
    return order;
  }

  if (order.status === "cancelled") {
    throw new Error("订单已取消，不能再次发货");
  }

  const template = findTemplate(db, order.templateId);
  if (!template) {
    throw new Error("订单关联的套餐不存在");
  }

  let affectedCdk: Cdk | null = null;

  if (order.mode === "new_purchase") {
    if (!order.createdCdkId) {
      const nextCdk = generatePendingCdk(template);
      db.cdks.unshift(nextCdk);
      order.createdCdkId = nextCdk.id;
      affectedCdk = nextCdk;
    } else {
      affectedCdk = db.cdks.find((item) => item.id === order.createdCdkId) ?? null;
    }
  } else {
    if (!order.cdkId) {
      throw new Error("充值订单缺少目标 CDK");
    }
    const cdk = db.cdks.find((item) => item.id === order.cdkId) ?? null;
    if (!cdk) {
      throw new Error("目标 CDK 不存在");
    }
    applyTemplateToCdk(cdk, template, "recharge");
    affectedCdk = cdk;
  }

  if (order.inviterCdkId && !order.inviteRewardApplied) {
    const inviter = db.cdks.find((item) => item.id === order.inviterCdkId) ?? null;
    if (inviter && inviter.id !== affectedCdk?.id) {
      applyInviteReward(inviter, db.site.inviteRewardTotalUsd);
      order.inviteRewardApplied = true;
    }
  }

  const timestamp = new Date().toISOString();
  order.status = "paid";
  order.paidAt = timestamp;
  order.confirmedBy = confirmedBy;
  order.updatedAt = timestamp;

  return order;
}

function serializeRedeemResponse(code: string, req: Request) {
  const db = readDb();
  const cdk = findCdkByCode(db, code);
  if (!cdk) {
    return null;
  }

  const template = findTemplate(db, cdk.templateId);
  if (!template) {
    return null;
  }

  const usage = getCdkUsage(db, cdk.id);
  const quotas = getQuotaSnapshot(db, cdk);
  const baseUrl = resolvePublicBaseUrl(req, db.site.remoteWebUrl);
  const rechargeTemplates = db.templates.filter((item) => item.enabled && item.allowRecharge);
  const recentOrders = db.orders
    .filter((item) => item.cdkId === cdk.id || item.createdCdkId === cdk.id)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .slice(0, 10)
    .map((item) => serializeOrder(db, item));

  return {
    cdk: serializeCdk(cdk),
    template: serializeTemplate(template),
    quotas,
    stats: {
      totalRequests: usage.length,
      totalCostUsd: cdk.totalCostUsd,
      lastUsedAt: cdk.lastUsedAt
    },
    quickstart: getQuickstart(baseUrl, cdk.localApiKey),
    invite: {
      enabled: db.site.inviteEnabled,
      inviteCode: cdk.inviteCode,
      inviteDiscountPercent: db.site.inviteDiscountPercent,
      inviteRewardTotalUsd: db.site.inviteRewardTotalUsd,
      inviteCount: cdk.inviteCount,
      inviteRewardAppliedUsd: cdk.inviteRewardTotalUsd
    },
    payment: serializePaymentSettings(db.site),
    rechargeTemplates: rechargeTemplates.map((item) => serializeTemplate(item)),
    recentOrders,
    remote_api_key: cdk.redeemedAt && !cdk.disabled ? cdk.localApiKey : null,
    remote_web_url: baseUrl,
    content: db.site.helpContent || template.content,
    qq_group_text: template.hideGroupInfo ? null : db.site.qqGroupText,
    qq_group_url: template.hideGroupInfo ? null : db.site.qqGroupUrl,
    qq_group_qrcode_available: template.hideGroupInfo ? false : db.site.qqGroupQrcodeAvailable,
    hide_group_info: template.hideGroupInfo,
    used_at: cdk.redeemedAt,
    recharge_usage:
      cdk.rechargeTargetCode != null
        ? {
            targetCdk: cdk.rechargeTargetCode,
            target_cdk: cdk.rechargeTargetCode,
            mode: cdk.rechargeMode,
            confirmedAt: cdk.rechargeConfirmedAt,
            confirmed_at: cdk.rechargeConfirmedAt,
            message: `该 CDK 已用于为 ${cdk.rechargeTargetCode} 充值。`
          }
        : null
  };
}

async function buildAdminRecentUsage(db: Db) {
  const localUsage = db.usage.slice(0, 20);
  if (getUpstreamMode() !== "sub2api") {
    return localUsage;
  }

  const sub2ApiUserMap = new Map<number, Cdk>();
  for (const cdk of db.cdks) {
    if (cdk.sub2apiUserId == null) continue;
    sub2ApiUserMap.set(cdk.sub2apiUserId, cdk);
  }

  try {
    const recentUsage = await fetchSub2ApiAdminRecentUsage({
      limit: 200,
      timezone: "Asia/Shanghai"
    });

    const scopedItems = sub2ApiUserMap.size
      ? recentUsage.filter((item) => sub2ApiUserMap.has(item.userId))
      : recentUsage;

    const selectedItems = (scopedItems.length ? scopedItems : recentUsage).slice(0, 20);
    const filtered = selectedItems.map((item) => {
      const cdk = sub2ApiUserMap.get(item.userId) ?? null;
      return {
        id: `sub2api_${item.id}`,
        cdkId: cdk?.id ?? "",
        apiKeyId: null,
        path: item.inboundEndpoint ?? item.upstreamEndpoint ?? "/v1",
        endpoint: item.upstreamEndpoint ?? item.inboundEndpoint ?? null,
        model: item.model,
        statusCode: item.statusCode,
        createdAt: item.createdAt,
        durationMs: item.durationMs,
        inputTokens: item.inputTokens,
        outputTokens: item.outputTokens,
        totalTokens: item.totalTokens,
        estimatedCostUsd: item.actualCost ?? item.totalCost,
        costUsd: item.actualCost ?? item.totalCost,
        requestId: item.requestId,
        clientKey: cdk ? maskSecret(cdk.localApiKey) : item.apiKeyName ?? "sub2api",
        sessionId: null,
        retryCount: null,
        providerName: item.accountName ?? "Sub2API",
        keyName: item.apiKeyName ?? cdk?.sub2apiUsername ?? cdk?.code ?? item.userName ?? item.userEmail ?? null
      };
    });

    return filtered;
  } catch (error) {
    console.warn("[sub2api] fetch recent usage failed:", error instanceof Error ? error.message : error);
    return [];
  }
}

function computeQuotaRemaining(limitUsd: number | null, usedUsd: number | null) {
  if (limitUsd == null || usedUsd == null) return null;
  return Math.max(limitUsd - usedUsd, 0);
}

function sumNullable(values: Array<number | null | undefined>) {
  const numeric = values.filter((value): value is number => value != null && Number.isFinite(value));
  if (!numeric.length) return null;
  return Number(numeric.reduce((sum, value) => sum + value, 0).toFixed(6));
}

async function buildRedeemUsageSummary(db: Db, cdk: Cdk) {
  const template = findTemplate(db, cdk.templateId);
  if (!template) return null;
  const quotas = getQuotaSnapshot(db, cdk);
  let dailyUsedUsd = quotas.daily.usedUsd;
  let weeklyUsedUsd: number | null = null;
  let monthlyUsedUsd = quotas.monthly.usedUsd;
  let totalUsedUsd = quotas.total.usedUsd;
  let limitConcurrentSessions = template.concurrentSessions;
  let partialErrors: Array<{ scope: string; message: string }> = [];
  const resetAt = template.dailyResetMode === "fixed" ? computeNextFixedResetAt(template.dailyResetTime) : null;

  if (getUpstreamMode() === "sub2api" && cdk.sub2apiUserId != null) {
    try {
      const snapshot = await fetchSub2ApiUserSnapshot(cdk.sub2apiUserId);
      if (snapshot) {
        dailyUsedUsd = sumNullable(snapshot.subscriptions.map((item) => item.dailyUsageUsd)) ?? dailyUsedUsd;
        weeklyUsedUsd = sumNullable(snapshot.subscriptions.map((item) => item.weeklyUsageUsd));
        monthlyUsedUsd = sumNullable(snapshot.subscriptions.map((item) => item.monthlyUsageUsd)) ?? monthlyUsedUsd;
        limitConcurrentSessions = template.concurrentSessions ?? snapshot.concurrency ?? 1;
      } else {
        limitConcurrentSessions = template.concurrentSessions ?? 1;
      }
    } catch (error) {
      partialErrors = [
        {
          scope: "sub2api",
          message: error instanceof Error ? error.message : "实时套餐信息读取失败"
        }
      ];
      limitConcurrentSessions = template.concurrentSessions ?? 1;
    }
  }

  return {
    ok: true,
    data: {
      userId: cdk.id,
      userName: cdk.code,
      expiresAt: cdk.expiresAt,
      dailyResetMode: template.dailyResetMode,
      dailyResetTime: template.dailyResetTime,
      rpm: template.rpm,
      limitConcurrentSessions,
      activeSessionCount: null,
      quotas: {
        daily: {
          label: "套餐日额度",
          limitUsd: quotas.daily.limitUsd,
          usedUsd: dailyUsedUsd,
          remainingUsd: computeQuotaRemaining(quotas.daily.limitUsd, dailyUsedUsd),
          resetAt,
          usageSource: getUpstreamMode() === "sub2api" ? "sub2api.daily" : "local.daily"
        },
        weekly: {
          label: "套餐周额度",
          limitUsd: template.weeklyQuotaUsd,
          usedUsd: weeklyUsedUsd,
          remainingUsd: computeQuotaRemaining(template.weeklyQuotaUsd, weeklyUsedUsd),
          resetAt: null,
          usageSource: getUpstreamMode() === "sub2api" ? "sub2api.weekly" : "local.weekly"
        },
        monthly: {
          label: "套餐月额度",
          limitUsd: quotas.monthly.limitUsd,
          usedUsd: monthlyUsedUsd,
          remainingUsd: computeQuotaRemaining(quotas.monthly.limitUsd, monthlyUsedUsd),
          resetAt: null,
          usageSource: getUpstreamMode() === "sub2api" ? "sub2api.monthly" : "local.monthly"
        },
        total: {
          label: "套餐总额度",
          limitUsd: quotas.total.limitUsd,
          usedUsd: totalUsedUsd,
          remainingUsd: computeQuotaRemaining(quotas.total.limitUsd, totalUsedUsd),
          resetAt: null,
          usageSource: getUpstreamMode() === "sub2api" ? "sub2api.total" : "local.total"
        }
      },
      recentUsage: [],
      partialErrors,
      fetchedAt: new Date().toISOString(),
      snapshot: {
        lastSyncedAt: new Date().toISOString(),
        syncSource: getUpstreamMode() === "sub2api" ? "sub2api+local" : "local",
        ageSeconds: 0,
        cacheHit: false,
        cacheFresh: true,
        usedForStaticFields: true,
        refreshSource: getUpstreamMode() === "sub2api" ? "sub2api+local" : "local",
        fallbackUsed: partialErrors.length > 0,
        activeSessionCount: null,
        activeSessionLastSyncedAt: null
      },
      finalExpiresAt: cdk.expiresAt,
      quotaChangeTimeline: cdk.limitHistory?.rows ?? []
    }
  };
}

function buildLocalRecentUsageResponse(db: Db, cdk: Cdk, input: {
  page: number;
  pageSize: number;
  model: string;
  statusCode: string;
}) {
  let usage = getCdkUsage(db, cdk.id);
  if (input.model !== "all") {
    usage = usage.filter((item) => item.model === input.model);
  }
  if (input.statusCode !== "all") {
    usage = usage.filter((item) => String(item.statusCode ?? "") === input.statusCode);
  }

  const offset = (input.page - 1) * input.pageSize;
  const items = usage.slice(offset, offset + input.pageSize).map((item) => {
    const apiKey = item.apiKeyId ? findApiKeyById(db, item.apiKeyId) : null;
    const template = findTemplate(db, cdk.templateId);
    return {
      createdAt: item.createdAt,
      model: item.model,
      endpoint: formatUsageEndpoint(item.path),
      statusCode: item.statusCode,
      costUsd: item.estimatedCostUsd ?? 0,
      providerName: apiKey?.providerGroup ?? template?.providerGroup ?? "local-relay",
      requestId: item.requestId,
      sessionId: item.sessionId,
      keyName: apiKey?.name ?? "default",
      retryCount: item.retryCount,
      durationMs: item.durationMs,
      ttfbMs: null,
      inputTokens: item.inputTokens,
      outputTokens: item.outputTokens,
      cacheReadInputTokens: null,
      cacheCreationInputTokens: null,
      totalTokens: item.totalTokens ?? 0,
      context1mApplied: false,
      specialSettings: []
    };
  });

  return {
    ok: true,
    data: {
      items,
      meta: {
        page: input.page,
        pageSize: input.pageSize,
        total: usage.length,
        totalPages: Math.max(1, Math.ceil(usage.length / input.pageSize)),
        maxPages: 50
      },
      filters: {
        model: input.model === "all" ? null : input.model,
        statusCode: input.statusCode === "all" ? null : Number(input.statusCode),
        availableModels: Array.from(new Set(usage.map((item) => item.model).filter(Boolean))),
        availableStatusCodes: Array.from(new Set(usage.map((item) => item.statusCode).filter((item) => item != null)))
      }
    }
  };
}

async function buildSub2ApiRecentUsageResponse(
  db: Db,
  cdk: Cdk,
  input: {
    page: number;
    pageSize: number;
    model: string;
    statusCode: string;
  }
) {
  const template = findTemplate(db, cdk.templateId);
  const bindingsByApiKeyName = new Map(
    cdk.sub2apiBindings
      .filter((item) => item.apiKeyName)
      .map((item) => [item.apiKeyName as string, item])
  );

  let usage: Awaited<ReturnType<typeof fetchSub2ApiAdminRecentUsage>> = [];
  let page = 1;
  let total = 0;

  while (page <= 10) {
    const current = await fetchSub2ApiAdminRecentUsagePage({
      page,
      pageSize: 200,
      timezone: "Asia/Shanghai",
      userId: cdk.sub2apiUserId ?? undefined
    });

    usage.push(...current.items);
    total = current.total;

    if (!current.items.length || usage.length >= total || page >= current.totalPages) {
      break;
    }

    page += 1;
  }

  if (input.model !== "all") {
    usage = usage.filter((item) => item.model === input.model);
  }
  if (input.statusCode !== "all") {
    usage = usage.filter((item) => String(item.statusCode ?? "") === input.statusCode);
  }

  const offset = (input.page - 1) * input.pageSize;
  const items = usage.slice(offset, offset + input.pageSize).map((item) => {
    const binding = item.apiKeyName ? bindingsByApiKeyName.get(item.apiKeyName) ?? null : null;

    return {
      createdAt: item.createdAt,
      model: item.model,
      endpoint: formatUsageEndpoint(item.inboundEndpoint ?? item.upstreamEndpoint ?? "/v1"),
      statusCode: item.statusCode,
      costUsd: item.actualCost ?? item.totalCost ?? 0,
      providerName: binding?.groupName ?? template?.providerGroup ?? item.accountName ?? "sub2api",
      requestId: item.requestId,
      sessionId: null,
      keyName: item.apiKeyName ?? "default",
      retryCount: null,
      durationMs: item.durationMs,
      ttfbMs: null,
      inputTokens: item.inputTokens,
      outputTokens: item.outputTokens,
      cacheReadInputTokens: item.cacheReadTokens,
      cacheCreationInputTokens: item.cacheCreationTokens,
      totalTokens: item.totalTokens ?? 0,
      context1mApplied: false,
      specialSettings: []
    };
  });

  return {
    ok: true,
    data: {
      items,
      meta: {
        page: input.page,
        pageSize: input.pageSize,
        total: usage.length,
        totalPages: Math.max(1, Math.ceil(usage.length / input.pageSize)),
        maxPages: 50
      },
      filters: {
        model: input.model === "all" ? null : input.model,
        statusCode: input.statusCode === "all" ? null : Number(input.statusCode),
        availableModels: Array.from(new Set(usage.map((item) => item.model).filter(Boolean))),
        availableStatusCodes: Array.from(new Set(usage.map((item) => item.statusCode).filter((item) => item != null)))
      }
    }
  };
}

async function buildRecentUsageResponse(
  db: Db,
  cdk: Cdk,
  input: {
    page: number;
    pageSize: number;
    model: string;
    statusCode: string;
  }
) {
  if (getUpstreamMode() === "sub2api" && cdk.sub2apiUserId != null) {
    try {
      return await buildSub2ApiRecentUsageResponse(db, cdk, input);
    } catch (error) {
      console.warn("[sub2api] build recent usage failed:", error instanceof Error ? error.message : error);
    }
  }

  return buildLocalRecentUsageResponse(db, cdk, input);
}

function formatUsageEndpoint(path: string) {
  if (!path.startsWith("/")) return path;
  if (
    path.startsWith("/v1") ||
    path.startsWith("/v1beta") ||
    path.startsWith("/chat/") ||
    path === "/chat/completions" ||
    path.startsWith("/responses") ||
    path.startsWith("/antigravity/")
  ) {
    return path;
  }
  return `/v1${path}`;
}

function buildLimitHistoryResponse(cdk: Cdk) {
  return {
    ok: true,
    data:
      cdk.limitHistory ?? {
        cdk: cdk.code,
        currentTime: new Date().toISOString(),
        activatedAt: cdk.redeemedAt,
        originalExpiresAt: cdk.expiresAt,
        finalExpiresAt: cdk.expiresAt,
        overallBar: {
          label: "总览",
          segments: []
        },
        rows: [],
        steps: []
      }
  };
}

function buildApiKeysResponse(db: Db, cdk: Cdk) {
  const template = findTemplate(db, cdk.templateId);
  if (!template) return null;
  const items = getApiKeysForCdk(db, cdk.id).map((item) => serializeApiKey(db, cdk, item));
  return {
    ok: true,
    data: {
      cdk: cdk.code,
      userId: cdk.id,
      userName: cdk.code,
      primaryKeyId: items.find((item) => item.isPrimary)?.id ?? null,
      primaryExpiresAt: cdk.expiresAt,
      primaryLimits: {
        limit5hUsd: null,
        limitDailyUsd: cdk.effectiveDailyQuotaUsd,
        limitWeeklyUsd: template.weeklyQuotaUsd,
        limitMonthlyUsd: cdk.effectiveMonthlyQuotaUsd,
        limitTotalUsd: cdk.effectiveTotalQuotaUsd,
        limitConcurrentSessions: template.concurrentSessions
      },
      items
    }
  };
}

function buildCatalogResponse(req: Request) {
  const db = readDb();
  return {
    site: {
      ...db.site,
      remoteWebUrl: resolvePublicBaseUrl(req, db.site.remoteWebUrl)
    },
    payment: serializePaymentSettings(db.site),
    invite: {
      enabled: db.site.inviteEnabled,
      discountPercent: db.site.inviteDiscountPercent,
      rewardTotalUsd: db.site.inviteRewardTotalUsd
    },
    templates: db.templates.filter((item) => item.enabled).map((item) => serializeTemplate(item))
  };
}

function buildUpstreamUrl(
  baseUrl: string,
  publicProxyPath: string,
  originalUrl: string,
  options?: { preserveBasePath?: boolean }
) {
  const queryIndex = originalUrl.indexOf("?");
  const query = queryIndex >= 0 ? originalUrl.slice(queryIndex) : "";
  const normalizedBaseUrl = baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`;
  const base = new URL(normalizedBaseUrl);
  const basePath = base.pathname === "/" ? "" : base.pathname.replace(/\/+$/, "");
  let targetPath = publicProxyPath.startsWith("/") ? publicProxyPath : `/${publicProxyPath}`;

  if (options?.preserveBasePath && basePath && !targetPath.startsWith(basePath)) {
    targetPath = `${basePath}${targetPath}`;
  }

  return new URL(`${targetPath}${query}`, `${base.origin}/`).toString();
}

function normalizeUpstreamRequestPath(requestPath: string) {
  if (requestPath === "/chat/completions") return "/v1/chat/completions";
  if (requestPath === "/responses" || requestPath.startsWith("/responses/")) {
    return `/v1${requestPath}`;
  }
  return requestPath;
}

function extractRequestedModel(path: string, jsonBody: Record<string, unknown> | null) {
  const directModel = typeof jsonBody?.model === "string" ? jsonBody.model.trim() : "";
  if (directModel) {
    return directModel;
  }

  const geminiMatch = path.match(/^\/v1beta\/models\/([^/:?]+)(?::|\/|$)/i);
  if (geminiMatch?.[1]) {
    return decodeURIComponent(geminiMatch[1]);
  }

  const antigravityMatch = path.match(/^\/antigravity\/models\/([^/:?]+)(?::|\/|$)/i);
  if (antigravityMatch?.[1]) {
    return decodeURIComponent(antigravityMatch[1]);
  }

  return null;
}

function isRetryableGatewayStatus(status: number) {
  return [401, 403, 408, 409, 425, 429, 500, 502, 503, 504].includes(status);
}

function persistProxyUsage(input: {
  cdk: Cdk;
  boundApiKey: ReturnType<typeof findApiKeyBySecret>;
  localApiKey: string;
  path: string;
  model: string | null;
  statusCode: number | null;
  durationMs: number;
  inputTokens: number | null;
  outputTokens: number | null;
  totalTokens: number | null;
  estimatedCostUsd: number | null;
  requestId: string;
  retryCount?: number | null;
}) {
  updateDb((mutableDb) => {
    recordUsage(mutableDb, {
      cdkId: input.cdk.id,
      apiKeyId: input.boundApiKey?.id ?? null,
      path: input.path,
      model: input.model,
      statusCode: input.statusCode,
      durationMs: input.durationMs,
      inputTokens: input.inputTokens,
      outputTokens: input.outputTokens,
      totalTokens: input.totalTokens,
      estimatedCostUsd: input.estimatedCostUsd,
      requestId: input.requestId,
      clientKey: maskSecret(input.localApiKey),
      sessionId: null,
      retryCount: input.retryCount ?? null
    });
  });
}

function buildForwardHeaders(req: Request, account?: GatewayAccount) {
  const headers = new Headers();
  Object.entries(req.headers).forEach(([key, value]) => {
    if (!value) return;
    const lower = key.toLowerCase();
    if (
      [
        "host",
        "content-length",
        "authorization",
        "cookie",
        "connection",
        "x-api-key",
        "x-goog-api-key",
        "x-relay-platform",
        "x-upstream-platform",
        "x-provider-platform"
      ].includes(lower)
    ) {
      return;
    }
    if (Array.isArray(value)) {
      headers.set(key, value.join(","));
      return;
    }
    headers.set(key, value);
  });

  if (account) {
    Object.entries(account.headers).forEach(([key, value]) => {
      headers.set(key, value);
    });

    headers.set(account.authHeader, `${account.authPrefix}${account.apiKey}`);
  }

  return headers;
}

function applyUpstreamResponseHeaders(res: Response, upstreamResponse: globalThis.Response) {
  res.status(upstreamResponse.status);
  upstreamResponse.headers.forEach((value, key) => {
    if (key.toLowerCase() === "content-length") return;
    res.setHeader(key, value);
  });
}

async function relayUpstreamResponse(input: {
  res: Response;
  upstreamResponse: globalThis.Response;
  cdk: Cdk;
  boundApiKey: ReturnType<typeof findApiKeyBySecret>;
  localApiKey: string;
  path: string;
  model: string | null;
  requestId: string;
  startedAt: number;
  retryCount?: number | null;
  onSuccess?: () => void;
}) {
  const contentType = input.upstreamResponse.headers.get("content-type") ?? "";
  applyUpstreamResponseHeaders(input.res, input.upstreamResponse);

  if (contentType.includes("text/event-stream") && input.upstreamResponse.body) {
    if (input.upstreamResponse.ok) {
      input.onSuccess?.();
    }
    persistProxyUsage({
      cdk: input.cdk,
      boundApiKey: input.boundApiKey,
      localApiKey: input.localApiKey,
      path: input.path,
      model: input.model,
      statusCode: input.upstreamResponse.status,
      durationMs: Date.now() - input.startedAt,
      inputTokens: null,
      outputTokens: null,
      totalTokens: null,
      estimatedCostUsd: null,
      requestId: input.requestId,
      retryCount: input.retryCount ?? null
    });

    Readable.fromWeb(input.upstreamResponse.body as never).pipe(input.res);
    return;
  }

  const responseBuffer = Buffer.from(await input.upstreamResponse.arrayBuffer());
  let parsedPayload: any = null;
  if (contentType.includes("application/json")) {
    try {
      parsedPayload = responseBuffer.length ? JSON.parse(responseBuffer.toString("utf8")) : null;
    } catch {
      parsedPayload = null;
    }
  }

  const usage = resolveUsageShape(parsedPayload);
  const estimatedCostUsd = estimateCostUsd(usage.inputTokens, usage.outputTokens);

  if (input.upstreamResponse.ok) {
    input.onSuccess?.();
  }
  persistProxyUsage({
    cdk: input.cdk,
    boundApiKey: input.boundApiKey,
    localApiKey: input.localApiKey,
    path: input.path,
    model: input.model,
    statusCode: input.upstreamResponse.status,
    durationMs: Date.now() - input.startedAt,
    inputTokens: usage.inputTokens,
    outputTokens: usage.outputTokens,
    totalTokens: usage.totalTokens,
    estimatedCostUsd,
    requestId: input.requestId,
    retryCount: input.retryCount ?? null
  });

  input.res.send(responseBuffer);
}

async function handleProxy(req: Request, res: Response) {
  const localApiKey = parseBearer(req);
  if (!localApiKey) {
    res.status(401).json({ message: "缺少本地 API Key" });
    return;
  }

  const db = readDb();
  const boundApiKey = findApiKeyBySecret(db, localApiKey);
  const cdk = boundApiKey
    ? db.cdks.find((item) => item.id === boundApiKey.cdkId) ?? null
    : findCdkByLocalApiKey(db, localApiKey);
  if (!cdk) {
    res.status(401).json({ message: "API Key 无效" });
    return;
  }

  if (cdk.disabled) {
    res.status(403).json({ message: "CDK 已禁用" });
    return;
  }

  if (!cdk.redeemedAt) {
    res.status(403).json({ message: "CDK 尚未兑换，请先在前台兑换后再调用接口" });
    return;
  }

  if (isExpired(cdk)) {
    res.status(403).json({ message: "CDK 已过期" });
    return;
  }

  if (!hasQuotaAvailable(db, cdk)) {
    res.status(429).json({ message: "额度已用尽，请充值或更换套餐" });
    return;
  }

  if (boundApiKey) {
    if (!boundApiKey.isEnabled) {
      res.status(403).json({ message: "子 Key 已禁用" });
      return;
    }
    if (boundApiKey.expiresAt && new Date(boundApiKey.expiresAt).getTime() <= Date.now()) {
      res.status(403).json({ message: "子 Key 已过期" });
      return;
    }
    if (!hasApiKeyQuotaAvailable(db, boundApiKey)) {
      res.status(429).json({ message: "子 Key 额度已用尽" });
      return;
    }
  }

  const template = findTemplate(db, cdk.templateId);
  if (!template) {
    res.status(503).json({ message: "CDK 关联的套餐不存在" });
    return;
  }

  const upstreamMode = getUpstreamMode();
  let upstreamBaseUrl = process.env.OPENAI_BASE_URL?.trim() || null;
  let upstreamApiKey = process.env.OPENAI_API_KEY?.trim() || null;
  let upstreamPreserveBasePath = false;
  const startedAt = Date.now();
  const requestId = crypto.randomUUID();
  const requestPath = req.path;
  const normalizedProxyPath = requestPath.startsWith("/v1") ? requestPath.slice(3) : requestPath;
  const upstreamRequestPath = normalizeUpstreamRequestPath(requestPath);
  const { rawBody, jsonBody } = getProxyPayload(req);
  const model = extractRequestedModel(requestPath, jsonBody);
  let activeCdk = cdk;
  let activeTemplate = template;
  const effectiveProviderGroup = boundApiKey?.providerGroup ?? activeTemplate.providerGroup;

  if (upstreamMode === "selfhosted") {
    if (requestPath === "/v1/models" && req.method.toUpperCase() === "GET") {
      res.json({
        object: "list",
        data: buildGatewayModelCatalog(effectiveProviderGroup)
      });
      return;
    }

    const platform = resolveGatewayPlatform({
      path: requestPath,
      headers: req.headers
    });

    if (!platform) {
      res.status(400).json({
        message:
          "当前自研网关暂只支持 /v1/*(OpenAI)、/v1/messages(Claude)、/v1beta/*(Gemini) 和 /antigravity/*"
      });
      return;
    }

    const candidates = listGatewayCandidates({
      platform,
      providerGroup: effectiveProviderGroup,
      model
    });

    if (!candidates.length) {
      res.status(503).json({
        message: `没有可用的 ${platform} 网关账号${model ? `（模型 ${model}）` : ""}`
      });
      return;
    }

    let lastError: Error | null = null;

    for (const [index, account] of candidates.entries()) {
      const upstreamUrl = buildUpstreamUrl(account.baseUrl, normalizeUpstreamRequestPath(requestPath), req.originalUrl, {
        preserveBasePath: account.preserveBasePath
      });
      const init: RequestInit = {
        method: req.method,
        headers: buildForwardHeaders(req, account)
      };

      if (!["GET", "HEAD"].includes(req.method.toUpperCase()) && rawBody.length > 0) {
        init.body = new Uint8Array(rawBody);
      }

      try {
        const upstreamResponse = await fetch(upstreamUrl, init);
        if (isRetryableGatewayStatus(upstreamResponse.status) && index < candidates.length - 1) {
          await upstreamResponse.arrayBuffer().catch(() => null);
          continue;
        }

        await relayUpstreamResponse({
          res,
          upstreamResponse,
          cdk,
          boundApiKey,
          localApiKey,
          path: requestPath,
          model,
          requestId,
          startedAt,
          retryCount: index,
          onSuccess: () => markGatewayAccountUsed(account.id)
        });
        return;
      } catch (error) {
        lastError = error instanceof Error ? error : new Error("网关请求失败");
        if (index === candidates.length - 1) {
          break;
        }
      }
    }

    res.status(502).json({
      message: lastError ? `网关上游请求失败：${lastError.message}` : "网关上游全部不可用"
    });
    return;
  }

  if (upstreamMode === "newapi") {
    let newApiConfig;
    try {
      newApiConfig = getNewApiConfig();
    } catch (error) {
      res.status(503).json({ message: error instanceof Error ? error.message : "New API 配置不完整" });
      return;
    }

    upstreamBaseUrl = newApiConfig?.baseUrl ?? null;

    if (cdk.upstreamTokenKey) {
      upstreamApiKey = cdk.upstreamTokenKey;
    } else {
      try {
        const binding = await syncCdkNewApiBinding(cdk.code, {
          desiredTotalQuotaUsd: cdk.effectiveTotalQuotaUsd
        });
        upstreamApiKey = binding.upstreamTokenKey;
      } catch (error) {
        res.status(503).json({
          message: error instanceof Error ? `New API 账户同步失败：${error.message}` : "New API 账户同步失败"
        });
        return;
      }
    }
  }

  if (upstreamMode === "sub2api") {
    let sub2ApiConfig;
    try {
      sub2ApiConfig = getSub2ApiConfig();
    } catch (error) {
      res.status(503).json({ message: error instanceof Error ? error.message : "Sub2API 配置不完整" });
      return;
    }

    upstreamBaseUrl = sub2ApiConfig.baseUrl;
    try {
      upstreamPreserveBasePath = new URL(`${sub2ApiConfig.baseUrl.replace(/\/+$/, "")}/`).pathname !== "/";
    } catch {
      upstreamPreserveBasePath = false;
    }

    if (requestPath === "/v1/models" && req.method.toUpperCase() === "GET") {
      if (!activeCdk.sub2apiBindings.length || activeCdk.sub2apiBindings.some((item) => !item.apiKey)) {
        try {
          await syncCdkSub2ApiBinding(activeCdk.code, {
            desiredExpiresAt: activeCdk.expiresAt
          });
          const refreshedDb = readDb();
          activeCdk = findCdkByCode(refreshedDb, activeCdk.code) ?? activeCdk;
          activeTemplate = findTemplate(refreshedDb, activeCdk.templateId) ?? activeTemplate;
        } catch (error) {
          res.status(503).json({
            message: error instanceof Error ? `Sub2API 账户同步失败：${error.message}` : "Sub2API 账户同步失败"
          });
          return;
        }
      }

      const models = await fetchSub2ApiModelCatalog(activeCdk.sub2apiBindings);
      res.json({
        object: "list",
        data: models
      });
      return;
    }

    const platform = resolveGatewayPlatform({
      path: requestPath,
      headers: req.headers
    });

    if (!platform) {
      res.status(400).json({
        message:
          "当前 Sub2API 模式暂只支持 /v1/*(OpenAI)、/v1/messages(Claude)、/v1beta/*(Gemini) 和 /antigravity/*"
      });
      return;
    }

    let binding = pickSub2ApiBinding(activeCdk, activeTemplate, platform);
    if (!binding?.apiKey) {
      try {
        await syncCdkSub2ApiBinding(activeCdk.code, {
          desiredExpiresAt: activeCdk.expiresAt
        });
        const refreshedDb = readDb();
        activeCdk = findCdkByCode(refreshedDb, activeCdk.code) ?? activeCdk;
        activeTemplate = findTemplate(refreshedDb, activeCdk.templateId) ?? activeTemplate;
        binding = pickSub2ApiBinding(activeCdk, activeTemplate, platform);
      } catch (error) {
        res.status(503).json({
          message: error instanceof Error ? `Sub2API 账户同步失败：${error.message}` : "Sub2API 账户同步失败"
        });
        return;
      }
    }

    if (!binding?.apiKey) {
      res.status(503).json({
        message: `当前套餐没有可用的 ${platform} Sub2API 通道，请检查 providerGroup 与 Sub2API 分组配置`
      });
      return;
    }

    upstreamApiKey = binding.apiKey;
  }

  if (!upstreamBaseUrl || !upstreamApiKey) {
    if (normalizedProxyPath === "/models") {
      res.json({
        object: "list",
        data: [
          { id: "gpt-4.1-mini", object: "model", owned_by: "relay-clone" },
          { id: "gpt-4.1", object: "model", owned_by: "relay-clone" },
          { id: "o4-mini", object: "model", owned_by: "relay-clone" }
        ]
      });
      return;
    }

    if (
      !["/v1/chat/completions", "/chat/completions"].includes(requestPath) ||
      req.method.toUpperCase() !== "POST"
    ) {
      res.status(503).json({
        message:
          upstreamMode === "newapi"
            ? "当前已启用 New API 模式，但 CDK 还没有可用的上游 Token。"
            : upstreamMode === "sub2api"
              ? "当前已启用 Sub2API 模式，但 CDK 还没有可用的上游 Key。"
              : "当前未配置真实上游。请设置 OPENAI_BASE_URL 和 OPENAI_API_KEY。"
      });
      return;
    }

    const prompt = Array.isArray(jsonBody?.messages)
      ? jsonBody.messages
          .map((item: any) =>
            typeof item?.content === "string" ? item.content : JSON.stringify(item?.content ?? "")
          )
          .join("\n")
      : "你好";
    const content = `这是一个本地演示回复。你刚才发来的内容是：${prompt.slice(0, 400)}`;
    const inputTokens = Math.max(24, Math.ceil(prompt.length * 1.3));
    const outputTokens = Math.max(36, Math.ceil(content.length * 1.3));
    const totalTokens = inputTokens + outputTokens;
    const estimatedCostUsd = estimateCostUsd(inputTokens, outputTokens);

    updateDb((mutableDb) => {
      recordUsage(mutableDb, {
        cdkId: cdk.id,
        apiKeyId: boundApiKey?.id ?? null,
        path: requestPath,
        model,
        statusCode: 200,
        durationMs: Date.now() - startedAt,
        inputTokens,
        outputTokens,
        totalTokens,
        estimatedCostUsd,
        requestId,
        clientKey: maskSecret(localApiKey),
        sessionId: null,
        retryCount: null
      });
    });

    res.json({
      id: `chatcmpl_${crypto.randomBytes(8).toString("hex")}`,
      object: "chat.completion",
      created: Math.floor(Date.now() / 1000),
      model: model ?? "gpt-4.1-mini",
      choices: [
        {
          index: 0,
          finish_reason: "stop",
          message: {
            role: "assistant",
            content
          }
        }
      ],
      usage: {
        prompt_tokens: inputTokens,
        completion_tokens: outputTokens,
        total_tokens: totalTokens
      }
    });
    return;
  }

  const upstreamUrl = buildUpstreamUrl(upstreamBaseUrl, upstreamRequestPath, req.originalUrl, {
    preserveBasePath: upstreamPreserveBasePath
  });
  const headers = buildForwardHeaders(req);
  headers.set("authorization", `Bearer ${upstreamApiKey}`);

  const init: RequestInit = {
    method: req.method,
    headers
  };

  if (!["GET", "HEAD"].includes(req.method.toUpperCase()) && rawBody.length > 0) {
    init.body = new Uint8Array(rawBody);
  }

  const upstreamResponse = await fetch(upstreamUrl, init);
  await relayUpstreamResponse({
    res,
    upstreamResponse,
    cdk,
    boundApiKey,
    localApiKey,
    path: requestPath,
    model,
    requestId,
    startedAt
  });
}

ensureDb();

const app = express();
app.use(
  cors({
    origin(origin, callback) {
      if (!origin) {
        callback(null, true);
        return;
      }

      callback(null, isAllowedCorsOrigin(origin));
    },
    credentials: true,
    methods: ["GET", "POST", "PATCH", "DELETE", "OPTIONS"]
  })
);
app.use((req, res, next) => {
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
  res.setHeader("Permissions-Policy", "camera=(), microphone=(), geolocation=(), payment=()");
  res.setHeader("Cross-Origin-Opener-Policy", "same-origin");
  res.setHeader("Content-Security-Policy", [
    "default-src 'self'",
    "base-uri 'self'",
    "frame-ancestors 'none'",
    "form-action 'self'",
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    "font-src 'self' https://fonts.gstatic.com data:",
    "img-src 'self' data: https: http:",
    "connect-src 'self' https: http:"
  ].join("; "));
  next();
});
app.use(cookieParser());
app.use("/api/admin", (_req, res, next) => {
  res.setHeader("Cache-Control", "no-store");
  next();
});
app.use("/api", express.json({ limit: "2mb" }));
app.use("/v1", express.raw({ type: "*/*", limit: "50mb" }));
app.use("/v1beta", express.raw({ type: "*/*", limit: "50mb" }));
app.use("/antigravity", express.raw({ type: "*/*", limit: "50mb" }));
app.use("/chat", express.raw({ type: "*/*", limit: "50mb" }));
app.use("/responses", express.raw({ type: "*/*", limit: "50mb" }));

app.get("/api/public/site", (req, res) => {
  const db = readDb();
  res.json({
    ...db.site,
    remoteWebUrl: db.site.remoteWebUrl || getBaseUrl(req)
  });
});

app.get("/api/public/catalog", (req, res) => {
  res.json(buildCatalogResponse(req));
});

app.post("/api/orders/preview", (req, res) => {
  try {
    const db = readDb();
    const preview = buildOrderPreview(db, {
      templateId: String(req.body?.templateId ?? ""),
      mode: req.body?.mode === "recharge_existing" ? "recharge_existing" : "new_purchase",
      cdkCode: typeof req.body?.cdkCode === "string" ? req.body.cdkCode : undefined,
      inviteCode: typeof req.body?.inviteCode === "string" ? req.body.inviteCode : undefined
    });

    res.json({
      mode: req.body?.mode === "recharge_existing" ? "recharge_existing" : "new_purchase",
      template: serializeTemplate(preview.template),
      targetCdk: preview.targetCdk ? serializeCdk(preview.targetCdk) : null,
      inviter: preview.inviter
        ? {
            inviteCode: preview.inviter.inviteCode
          }
        : null,
      payment: serializePaymentSettings(db.site),
      originalAmountCny: preview.originalAmountCny,
      discountAmountCny: preview.discountAmountCny,
      finalAmountCny: preview.finalAmountCny,
      paymentChannel: preview.paymentChannel
    });
  } catch (error) {
    res.status(400).json({ message: error instanceof Error ? error.message : "订单预览失败" });
  }
});

app.post("/api/orders", (req, res) => {
  try {
    const created = updateDb((db) => {
      const mode: OrderMode = req.body?.mode === "recharge_existing" ? "recharge_existing" : "new_purchase";
      const preview = buildOrderPreview(db, {
        templateId: String(req.body?.templateId ?? ""),
        mode,
        cdkCode: typeof req.body?.cdkCode === "string" ? req.body.cdkCode : undefined,
        inviteCode: typeof req.body?.inviteCode === "string" ? req.body.inviteCode : undefined
      });
      const timestamp = new Date().toISOString();
      const order: Order = {
        id: makeId("ord"),
        orderNo: makeOrderNo(),
        templateId: preview.template.id,
        mode,
        cdkId: preview.targetCdk?.id ?? null,
        cdkCodeSnapshot: preview.targetCdk?.code ?? null,
        buyerName: String(req.body?.buyerName ?? "").trim() || null,
        buyerContact: String(req.body?.buyerContact ?? "").trim() || null,
        paymentChannel: preview.paymentChannel,
        originalAmountCny: preview.originalAmountCny,
        discountAmountCny: preview.discountAmountCny,
        finalAmountCny: preview.finalAmountCny,
        inviteCode: preview.inviter?.inviteCode ?? null,
        inviterCdkId: preview.inviter?.id ?? null,
        inviteRewardApplied: false,
        status: "pending",
        createdCdkId: null,
        paymentReference: null,
        paymentNote: null,
        adminNote: null,
        submittedAt: null,
        paidAt: null,
        confirmedBy: null,
        createdAt: timestamp,
        updatedAt: timestamp
      };

      db.orders.unshift(order);
      return serializeOrder(db, order);
    });

    res.json({
      order: created,
      payment: serializePaymentSettings(readDb().site)
    });
  } catch (error) {
    res.status(400).json({ message: error instanceof Error ? error.message : "创建订单失败" });
  }
});

app.get("/api/orders/:orderNo", (req, res) => {
  const db = readDb();
  const order = findOrderByOrderNo(db, req.params.orderNo);
  if (!order) {
    res.status(404).json({ message: "订单不存在" });
    return;
  }

  res.json({
    order: serializeOrder(db, order),
    payment: serializePaymentSettings(db.site)
  });
});

app.post("/api/orders/:orderNo/submit-payment", (req, res) => {
  try {
    const result = updateDb((db) => {
      const order = findOrderByOrderNo(db, req.params.orderNo);
      if (!order) {
        throw new Error("订单不存在");
      }
      if (order.status === "paid") {
        return serializeOrder(db, order);
      }
      if (order.status === "cancelled") {
        throw new Error("订单已取消");
      }

      order.paymentReference = String(req.body?.paymentReference ?? "").trim() || null;
      order.paymentNote = String(req.body?.paymentNote ?? "").trim() || null;
      order.buyerName = String(req.body?.buyerName ?? order.buyerName ?? "").trim() || order.buyerName;
      order.buyerContact =
        String(req.body?.buyerContact ?? order.buyerContact ?? "").trim() || order.buyerContact;
      order.submittedAt = new Date().toISOString();
      order.updatedAt = order.submittedAt;
      order.status = "submitted";
      return serializeOrder(db, order);
    });

    res.json({ order: result });
  } catch (error) {
    res.status(400).json({ message: error instanceof Error ? error.message : "提交付款信息失败" });
  }
});

app.post("/api/orders/:orderNo/mock-pay", (req, res) => {
  try {
    const result = updateDb((db) => {
      if (db.site.paymentMode !== "mock_auto") {
        throw new Error("当前站点未启用 mock 支付");
      }
      const order = findOrderByOrderNo(db, req.params.orderNo);
      if (!order) {
        throw new Error("订单不存在");
      }
      order.paymentReference = order.paymentReference ?? "MOCK-PAYMENT";
      order.paymentNote = order.paymentNote ?? "本地演示支付";
      fulfillOrder(db, order, "mock-auto");
      return serializeOrder(db, order);
    });

    res.json({ order: result });
  } catch (error) {
    res.status(400).json({ message: error instanceof Error ? error.message : "模拟支付失败" });
  }
});

app.post("/api/redeem/recharge/preview", (req, res) => {
  try {
    const db = readDb();
    const preview = buildDirectRechargePreview(db, {
      sourceCdkCode: String(req.body?.sourceCdkCode ?? req.body?.source_cdk ?? ""),
      targetCdkCode: String(req.body?.targetCdkCode ?? req.body?.target_cdk ?? ""),
      mode: parseRechargeMode(req.body?.mode)
    });

    res.json({
      ok: true,
      data: {
        mode: preview.mode,
        sourceCdk: serializeCdk(preview.sourceCdk),
        sourceTemplate: serializeTemplate(preview.sourceTemplate),
        targetCdk: serializeCdk(preview.targetCdk),
        targetTemplate: serializeTemplate(preview.targetTemplate),
        before: preview.before,
        after: preview.after,
        change: preview.change,
        currentTime: preview.currentTime,
        currentDailyQuotaUsd: preview.currentDailyQuotaUsd,
        sourceDailyQuotaUsd: preview.sourceDailyQuotaUsd,
        peakDailyQuotaUsd: preview.peakDailyQuotaUsd,
        combinedDailyQuotaUsd: preview.combinedDailyQuotaUsd,
        targetExpiresAtBefore: preview.targetExpiresAtBefore,
        finalExpiresAt: preview.finalExpiresAt,
        extensionDays: preview.extensionDays,
        overallBar: preview.overallBar,
        rows: preview.rows,
        summary: preview.summary
      }
    });
  } catch (error) {
    res.status(400).json({ message: error instanceof Error ? error.message : "充值预览失败" });
  }
});

app.post("/api/redeem/recharge/confirm", (req, res) => {
  try {
    const result = updateDb((db) =>
      confirmDirectRecharge(db, {
        sourceCdkCode: String(req.body?.sourceCdkCode ?? req.body?.source_cdk ?? ""),
        targetCdkCode: String(req.body?.targetCdkCode ?? req.body?.target_cdk ?? ""),
        mode: parseRechargeMode(req.body?.mode)
      })
    );

    if (getUpstreamMode() === "newapi") {
      void syncCdkNewApiBinding(result.targetCdk.code, {
        desiredTotalQuotaUsd: result.targetCdk.effectiveTotalQuotaUsd
      }).catch((error) => {
        console.error(
          "[newapi] recharge sync failed:",
          error instanceof Error ? error.message : "unknown error"
        );
      });
    } else if (getUpstreamMode() === "sub2api") {
      void syncCdkSub2ApiBinding(result.targetCdk.code, {
        desiredExpiresAt: result.targetCdk.expiresAt
      }).catch((error) => {
        console.error(
          "[sub2api] recharge sync failed:",
          error instanceof Error ? error.message : "unknown error"
        );
      });
    }

    res.json({
      ok: true,
      message: `${result.summary.modeLabel}成功，当前 API Key 保持不变`,
      targetCdk: result.targetCdk.code,
      target_cdk: result.targetCdk.code,
      preview: {
        mode: result.mode,
        sourceCdk: serializeCdk(result.sourceCdk),
        sourceTemplate: serializeTemplate(result.sourceTemplate),
        targetCdk: serializeCdk(result.targetCdk),
        targetTemplate: serializeTemplate(result.targetTemplate),
        before: result.before,
        after: result.after,
        change: result.change,
        currentTime: result.currentTime,
        currentDailyQuotaUsd: result.currentDailyQuotaUsd,
        sourceDailyQuotaUsd: result.sourceDailyQuotaUsd,
        peakDailyQuotaUsd: result.peakDailyQuotaUsd,
        combinedDailyQuotaUsd: result.combinedDailyQuotaUsd,
        targetExpiresAtBefore: result.targetExpiresAtBefore,
        finalExpiresAt: result.finalExpiresAt,
        extensionDays: result.extensionDays,
        overallBar: result.overallBar,
        rows: result.rows,
        summary: result.summary
      }
    });
  } catch (error) {
    res.status(400).json({ message: error instanceof Error ? error.message : "确认充值失败" });
  }
});

app.post("/api/redeem/:cdk/activate", async (req, res) => {
  try {
    const existingDb = readDb();
    const existingCdk = findCdkByCode(existingDb, req.params.cdk);
    if (!existingCdk) {
      throw new Error("CDK 不存在");
    }

    const template = findTemplate(existingDb, existingCdk.templateId);
    if (!template) {
      throw new Error("模板不存在");
    }

    if (existingCdk.disabled || existingCdk.rechargeTargetCode) {
      throw new Error("该 CDK 已失效或已用于充值，不能再次激活");
    }

    if (existingCdk.redeemedAt) {
      throw new Error("该 CDK 已激活，不能重复使用；如需续费请使用新 CDK 充值");
    }

    if (getUpstreamMode() === "newapi") {
      await syncCdkNewApiBinding(existingCdk.code, {
        desiredTotalQuotaUsd: existingCdk.effectiveTotalQuotaUsd ?? template.totalQuotaUsd
      });
    } else if (getUpstreamMode() === "sub2api") {
      await syncCdkSub2ApiBinding(existingCdk.code, {
        desiredExpiresAt: predictActivationExpiry(existingCdk, template)
      });
    }

    updateDb((db) => {
      const cdk = findCdkByCode(db, req.params.cdk);
      if (!cdk) {
        throw new Error("CDK 不存在");
      }

      const currentTemplate = findTemplate(db, cdk.templateId);
      if (!currentTemplate) {
        throw new Error("模板不存在");
      }

      applyTemplateToCdk(cdk, currentTemplate, "new");
    });
    const payload = serializeRedeemResponse(req.params.cdk, req);

    res.json({ ok: true, data: payload });
  } catch (error) {
    res.status(400).json({ message: error instanceof Error ? error.message : "激活失败" });
  }
});

app.get("/api/redeem/:cdk", (req, res) => {
  const payload = serializeRedeemResponse(req.params.cdk, req);
  if (!payload) {
    res.status(404).json({ message: "CDK 不存在" });
    return;
  }
  res.json(payload);
});

app.get("/api/redeem/:cdk/usage-summary", (req, res) => {
  const db = readDb();
  const cdk = findCdkByCode(db, req.params.cdk);
  if (!cdk) {
    res.status(404).json({ message: "CDK 不存在" });
    return;
  }
  void buildRedeemUsageSummary(db, cdk)
    .then((payload) => {
      if (!payload) {
        res.status(404).json({ message: "模板不存在" });
        return;
      }
      res.json(payload);
    })
    .catch((error) => {
      res.status(500).json({ message: error instanceof Error ? error.message : "读取配额失败" });
    });
});

app.get("/api/redeem/:cdk/recent-usage", (req, res) => {
  const page = Math.max(1, Number(req.query.page ?? 1));
  const pageSize = Math.min(50, Math.max(1, Number(req.query.pageSize ?? 20)));
  const db = readDb();
  const cdk = findCdkByCode(db, req.params.cdk);
  if (!cdk) {
    res.status(404).json({ message: "CDK 不存在" });
    return;
  }
  void buildRecentUsageResponse(db, cdk, {
      page,
      pageSize,
      model: typeof req.query.model === "string" ? req.query.model : "all",
      statusCode: typeof req.query.status_code === "string" ? req.query.status_code : "all"
    })
    .then((payload) => {
      res.json(payload);
    })
    .catch((error) => {
      res.status(500).json({ message: error instanceof Error ? error.message : "读取近期调用失败" });
    });
});

app.get("/api/redeem/:cdk/limit-history", (req, res) => {
  const db = readDb();
  const cdk = findCdkByCode(db, req.params.cdk);
  if (!cdk) {
    res.status(404).json({ message: "CDK 不存在" });
    return;
  }
  res.json(buildLimitHistoryResponse(cdk));
});

app.get("/api/redeem/:cdk/api-keys", (req, res) => {
  const db = readDb();
  const cdk = findCdkByCode(db, req.params.cdk);
  if (!cdk) {
    res.status(404).json({ message: "CDK 不存在" });
    return;
  }
  const payload = buildApiKeysResponse(db, cdk);
  if (!payload) {
    res.status(404).json({ message: "模板不存在" });
    return;
  }
  res.json(payload);
});

app.post("/api/redeem/:cdk/api-keys", (req, res) => {
  try {
    const payload = updateDb((db) => {
      const cdk = findCdkByCode(db, req.params.cdk);
      if (!cdk) throw new Error("CDK 不存在");
      if (cdk.disabled || cdk.rechargeTargetCode) {
        throw new Error("该 CDK 已用于充值，不再支持 API Key 管理");
      }
      const followPrimaryExpires = req.body?.follow_primary_expires !== false;
      createChildApiKeyForCdk(db, cdk, {
        name: String(req.body?.name ?? "").trim() || `子 Key ${getApiKeysForCdk(db, cdk.id).length}`,
        expiresAt: followPrimaryExpires ? cdk.expiresAt : stringOrNull(req.body?.expires_at),
        limit5hUsd: numberOrNull(req.body?.limit_5h_usd),
        limitDailyUsd: numberOrNull(req.body?.limit_daily_usd),
        limitWeeklyUsd: numberOrNull(req.body?.limit_weekly_usd),
        limitMonthlyUsd: numberOrNull(req.body?.limit_monthly_usd),
        limitTotalUsd: numberOrNull(req.body?.limit_total_usd),
        limitConcurrentSessions: numberOrNull(req.body?.limit_concurrent_sessions)
      });
      return buildApiKeysResponse(db, cdk);
    });
    res.json(payload);
  } catch (error) {
    res.status(400).json({ message: error instanceof Error ? error.message : "创建子 Key 失败" });
  }
});

app.patch("/api/redeem/:cdk/api-keys/:id", (req, res) => {
  try {
    const payload = updateDb((db) => {
      const cdk = findCdkByCode(db, req.params.cdk);
      if (!cdk) throw new Error("CDK 不存在");
      const apiKey = findApiKeyById(db, req.params.id);
      if (!apiKey || apiKey.cdkId !== cdk.id) throw new Error("Key 不存在");
      if (apiKey.key === cdk.localApiKey) throw new Error("主 Key 不支持编辑");
      const followPrimaryExpires = req.body?.follow_primary_expires === true;
      updateChildApiKey(db, apiKey, {
        name: typeof req.body?.name === "string" ? req.body.name : undefined,
        expiresAt:
          req.body?.follow_primary_expires === true
            ? cdk.expiresAt
            : req.body?.expires_at !== undefined
              ? stringOrNull(req.body?.expires_at)
              : followPrimaryExpires
                ? cdk.expiresAt
                : undefined,
        limit5hUsd: numberOrNull(req.body?.limit_5h_usd),
        limitDailyUsd: numberOrNull(req.body?.limit_daily_usd),
        limitWeeklyUsd: numberOrNull(req.body?.limit_weekly_usd),
        limitMonthlyUsd: numberOrNull(req.body?.limit_monthly_usd),
        limitTotalUsd: numberOrNull(req.body?.limit_total_usd),
        limitConcurrentSessions: numberOrNull(req.body?.limit_concurrent_sessions)
      });
      return buildApiKeysResponse(db, cdk);
    });
    res.json(payload);
  } catch (error) {
    res.status(400).json({ message: error instanceof Error ? error.message : "更新子 Key 失败" });
  }
});

app.post("/api/redeem/:cdk/api-keys/:id/enabled", (req, res) => {
  try {
    const payload = updateDb((db) => {
      const cdk = findCdkByCode(db, req.params.cdk);
      if (!cdk) throw new Error("CDK 不存在");
      const apiKey = findApiKeyById(db, req.params.id);
      if (!apiKey || apiKey.cdkId !== cdk.id) throw new Error("Key 不存在");
      if (apiKey.key === cdk.localApiKey) throw new Error("主 Key 不支持禁用");
      apiKey.isEnabled = req.body?.is_enabled !== false;
      apiKey.updatedAt = new Date().toISOString();
      return buildApiKeysResponse(db, cdk);
    });
    res.json(payload);
  } catch (error) {
    res.status(400).json({ message: error instanceof Error ? error.message : "更新 Key 状态失败" });
  }
});

app.delete("/api/redeem/:cdk/api-keys/:id", (req, res) => {
  try {
    const payload = updateDb((db) => {
      const cdk = findCdkByCode(db, req.params.cdk);
      if (!cdk) throw new Error("CDK 不存在");
      const apiKey = findApiKeyById(db, req.params.id);
      if (!apiKey || apiKey.cdkId !== cdk.id) throw new Error("Key 不存在");
      if (apiKey.key === cdk.localApiKey) throw new Error("主 Key 不支持删除");
      deleteChildApiKey(db, apiKey.id);
      return buildApiKeysResponse(db, cdk);
    });
    res.json(payload);
  } catch (error) {
    res.status(400).json({ message: error instanceof Error ? error.message : "删除子 Key 失败" });
  }
});

app.get("/api/redeem/:cdk/usage", (req, res) => {
  const page = Math.max(1, Number(req.query.page ?? 1));
  const pageSize = Math.min(50, Math.max(1, Number(req.query.pageSize ?? 10)));
  const modelFilter = typeof req.query.model === "string" ? req.query.model : "all";

  const db = readDb();
  const cdk = findCdkByCode(db, req.params.cdk);
  if (!cdk) {
    res.status(404).json({ message: "CDK 不存在" });
    return;
  }

  let usage = getCdkUsage(db, cdk.id);
  if (modelFilter !== "all") {
    usage = usage.filter((item) => item.model === modelFilter);
  }

  const offset = (page - 1) * pageSize;
  const items = usage.slice(offset, offset + pageSize);
  const models = Array.from(new Set(usage.map((item) => item.model).filter(Boolean)));

  res.json({
    items,
    meta: {
      page,
      pageSize,
      total: usage.length,
      totalPages: Math.max(1, Math.ceil(usage.length / pageSize))
    },
    filters: {
      availableModels: models
    }
  });
});

app.get("/api/redeem/:cdk/orders", (req, res) => {
  const db = readDb();
  const cdk = findCdkByCode(db, req.params.cdk);
  if (!cdk) {
    res.status(404).json({ message: "CDK 不存在" });
    return;
  }

  const orders = db.orders
    .filter((item) => item.cdkId === cdk.id || item.createdCdkId === cdk.id)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .map((item) => serializeOrder(db, item));

  res.json({ items: orders });
});

app.post("/api/admin/login", (req, res) => {
  const username = String(req.body?.username ?? "").trim();
  const password = String(req.body?.password ?? "");
  const loginKey = buildAdminLoginKey(req, username);
  const lockStatus = getAdminLoginAttemptStatus(loginKey);

  if (lockStatus.locked) {
    res.setHeader("Retry-After", String(lockStatus.retryAfterSeconds));
    res.status(429).json({
      message: `登录失败次数过多，请在 ${lockStatus.retryAfterSeconds} 秒后重试`,
      retryAfterSeconds: lockStatus.retryAfterSeconds
    });
    return;
  }

  const db = readDb();
  const admin = db.admins.find(
    (item) => item.username === username && item.passwordHash === hashValue(password)
  );

  if (!admin) {
    recordAdminLoginFailure(loginKey);
    res.status(401).json({ message: "账号或密码错误" });
    return;
  }

  clearAdminLoginFailures(loginKey);
  const session = createAdminSession(req, admin.username);
  res.cookie(adminCookieName, session.token, {
    httpOnly: true,
    sameSite: "lax",
    secure: isSecureRequest(req),
    maxAge: adminSessionAbsoluteTtlMs,
    path: "/"
  });
  res.json({ ok: true, ...buildAdminSessionResponse(req, session) });
});

app.post("/api/admin/logout", requireAdminWriteProtection, (req, res) => {
  destroyAdminSession(req);
  res.clearCookie(adminCookieName, {
    httpOnly: true,
    sameSite: "lax",
    secure: isSecureRequest(req),
    path: "/"
  });
  res.json({ ok: true });
});

app.get("/api/admin/session", (req, res) => {
  res.json(buildAdminSessionResponse(req, getAdminSession(req)));
});

app.get("/api/admin/dashboard", requireAdmin, async (_req, res) => {
  const db = readDb();
  const templates = db.templates.map((template) => {
    const cdks = db.cdks.filter((item) => item.templateId === template.id);
    return {
      ...serializeTemplate(template),
      cdkCount: cdks.length,
      redeemedCount: cdks.filter((item) => Boolean(item.redeemedAt)).length,
      usageCount: db.usage.filter((usage) => cdks.some((cdk) => cdk.id === usage.cdkId)).length,
      cdks: cdks.slice().sort((a, b) => b.createdAt.localeCompare(a.createdAt)).map(serializeCdk)
    };
  });

  try {
    const recentUsage = await buildAdminRecentUsage(db);

    res.json({
      stats: {
        templateCount: db.templates.length,
        cdkCount: db.cdks.length,
        activeCdkCount: db.cdks.filter((item) => !item.disabled && !isExpired(item)).length,
        orderCount: db.orders.length,
        pendingOrderCount: db.orders.filter((item) => item.status !== "paid" && item.status !== "cancelled").length,
        usageCount: db.usage.length,
        totalCostUsd: Number(db.cdks.reduce((sum, item) => sum + item.totalCostUsd, 0).toFixed(6)),
        upstreamMode: getUpstreamMode(),
        paymentMode: db.site.paymentMode
      },
      security: {
        allowedOrigins: Array.from(getCorsAllowedOrigins()),
        loginMaxFailures: adminLoginMaxFailures,
        lockoutMinutes: Math.round(adminLoginLockoutMs / 60000),
        sessionTtlMinutes: Math.round(adminSessionAbsoluteTtlMs / 60000),
        idleTimeoutMinutes: Math.round(adminSessionIdleTtlMs / 60000)
      },
      site: db.site,
      templates,
      recentUsage,
      recentOrders: db.orders
        .slice()
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
        .slice(0, 20)
        .map((item) => serializeOrder(db, item))
    });
  } catch (error) {
    res.status(500).json({ message: error instanceof Error ? error.message : "后台总览加载失败" });
  }
});

app.patch("/api/admin/site", requireAdminWriteProtection, (req, res) => {
  const site = updateDb((db) => {
    db.site.title = String(req.body?.title ?? db.site.title).trim() || db.site.title;
    db.site.remoteWebUrl = String(req.body?.remoteWebUrl ?? db.site.remoteWebUrl).trim() || db.site.remoteWebUrl;
    db.site.paymentMode =
      req.body?.paymentMode === "mock_auto" || req.body?.paymentMode === "manual_review"
        ? req.body.paymentMode
        : db.site.paymentMode;
    db.site.paymentChannelLabel =
      String(req.body?.paymentChannelLabel ?? db.site.paymentChannelLabel).trim() || db.site.paymentChannelLabel;
    db.site.paymentAccountName =
      String(req.body?.paymentAccountName ?? db.site.paymentAccountName ?? "").trim() || null;
    db.site.paymentAccountNo =
      String(req.body?.paymentAccountNo ?? db.site.paymentAccountNo ?? "").trim() || null;
    db.site.paymentQrCodeUrl =
      String(req.body?.paymentQrCodeUrl ?? db.site.paymentQrCodeUrl ?? "").trim() || null;
    db.site.paymentInstructions =
      String(req.body?.paymentInstructions ?? db.site.paymentInstructions).trim() || db.site.paymentInstructions;
    db.site.inviteEnabled = typeof req.body?.inviteEnabled === "boolean" ? req.body.inviteEnabled : db.site.inviteEnabled;
    db.site.inviteDiscountPercent = numberOrNull(req.body?.inviteDiscountPercent) ?? db.site.inviteDiscountPercent;
    db.site.inviteRewardTotalUsd = numberOrNull(req.body?.inviteRewardTotalUsd) ?? db.site.inviteRewardTotalUsd;
    return db.site;
  });

  res.json({ ok: true, site });
});

app.post("/api/admin/templates", requireAdminWriteProtection, (req, res) => {
  const name = String(req.body?.name ?? "").trim();
  if (!name) {
    res.status(400).json({ message: "模板名称不能为空" });
    return;
  }

  let quotaConfig;
  try {
    quotaConfig = buildTemplateQuotaConfig(req.body);
  } catch (error) {
    res.status(400).json({ message: error instanceof Error ? error.message : "模板参数不正确" });
    return;
  }

  const template = createTemplate({
    name,
    content: String(req.body?.content ?? ""),
    durationDays: quotaConfig.durationDays,
    dailyQuotaUsd: quotaConfig.dailyQuotaUsd,
    monthlyQuotaUsd: quotaConfig.monthlyQuotaUsd,
    totalQuotaUsd: quotaConfig.totalQuotaUsd,
    providerGroup: String(req.body?.providerGroup ?? "").trim() || null,
    contactText: String(req.body?.contactText ?? "").trim() || null,
    contactLink: String(req.body?.contactLink ?? "").trim() || null,
    enabled: req.body?.enabled !== false,
    allowNewPurchase: req.body?.allowNewPurchase !== false,
    allowRecharge: req.body?.allowRecharge !== false
  });

  updateDb((db) => {
    db.templates.unshift(template);
  });

  res.json({ ok: true, template });
});

app.patch("/api/admin/templates/:id", requireAdminWriteProtection, (req, res) => {
  try {
    const updated = updateDb((db) => {
      const template = db.templates.find((item) => item.id === req.params.id);
      if (!template) return null;

      const quotaConfig = buildTemplateQuotaConfig(req.body, template);

      if (typeof req.body?.name === "string" && req.body.name.trim()) {
        template.name = req.body.name.trim();
      }
      if (typeof req.body?.content === "string") {
        template.content = req.body.content;
      }
      template.durationDays = quotaConfig.durationDays;
      template.dailyQuotaUsd = quotaConfig.dailyQuotaUsd;
      template.monthlyQuotaUsd = quotaConfig.monthlyQuotaUsd;
      template.totalQuotaUsd = quotaConfig.totalQuotaUsd;
      template.providerGroup = String(req.body?.providerGroup ?? "").trim() || null;
      template.contactText = String(req.body?.contactText ?? "").trim() || null;
      template.contactLink = String(req.body?.contactLink ?? "").trim() || null;
      template.enabled = typeof req.body?.enabled === "boolean" ? req.body.enabled : template.enabled;
      template.allowNewPurchase =
        typeof req.body?.allowNewPurchase === "boolean" ? req.body.allowNewPurchase : template.allowNewPurchase;
      template.allowRecharge =
        typeof req.body?.allowRecharge === "boolean" ? req.body.allowRecharge : template.allowRecharge;
      template.updatedAt = new Date().toISOString();

      return template;
    });

    if (!updated) {
      res.status(404).json({ message: "模板不存在" });
      return;
    }

    res.json({ ok: true, template: updated });
  } catch (error) {
    res.status(400).json({ message: error instanceof Error ? error.message : "更新模板失败" });
  }
});

app.post("/api/admin/templates/:id/cdks", requireAdminWriteProtection, (req, res) => {
  const count = Math.min(100, Math.max(1, Number(req.body?.count ?? 1)));

  const generated = updateDb((db) => {
    const template = db.templates.find((item) => item.id === req.params.id);
    if (!template) {
      return null;
    }

    const cdks = Array.from({ length: count }, () => generatePendingCdk(template));
    db.cdks.unshift(...cdks);
    return cdks.map(serializeCdk);
  });

  if (!generated) {
    res.status(404).json({ message: "模板不存在" });
    return;
  }

  res.json({ ok: true, cdks: generated });
});

app.post("/api/admin/orders/:id/confirm", requireAdminWriteProtection, (req, res) => {
  try {
    const username = getSessionUsername(req);
    const order = updateDb((db) => {
      const current = findOrderById(db, String(req.params.id));
      if (!current) {
        throw new Error("订单不存在");
      }
      current.paymentReference = current.paymentReference ?? "MANUAL-CONFIRMED";
      fulfillOrder(db, current, username);
      return serializeOrder(db, current);
    });
    res.json({ ok: true, order });
  } catch (error) {
    res.status(400).json({ message: error instanceof Error ? error.message : "审核订单失败" });
  }
});

app.post("/api/admin/orders/:id/cancel", requireAdminWriteProtection, (req, res) => {
  try {
    const order = updateDb((db) => {
      const current = findOrderById(db, String(req.params.id));
      if (!current) {
        throw new Error("订单不存在");
      }
      if (current.status === "paid") {
        throw new Error("已支付订单不能取消");
      }
      current.status = "cancelled";
      current.adminNote = String(req.body?.adminNote ?? "").trim() || current.adminNote;
      current.updatedAt = new Date().toISOString();
      return serializeOrder(db, current);
    });
    res.json({ ok: true, order });
  } catch (error) {
    res.status(400).json({ message: error instanceof Error ? error.message : "取消订单失败" });
  }
});

app.get("/v1/models", async (req, res) => {
  try {
    await handleProxy(req, res);
  } catch (error) {
    res.status(502).json({ message: error instanceof Error ? error.message : "获取模型列表失败" });
  }
});

app.all(/^\/v1\/.+$/, async (req, res) => {
  try {
    await handleProxy(req, res);
  } catch (error) {
    res.status(502).json({ message: error instanceof Error ? error.message : "上游请求失败" });
  }
});

app.all(/^\/v1beta\/.+$/, async (req, res) => {
  try {
    await handleProxy(req, res);
  } catch (error) {
    res.status(502).json({ message: error instanceof Error ? error.message : "Gemini 上游请求失败" });
  }
});

app.all(/^\/antigravity\/.+$/, async (req, res) => {
  try {
    await handleProxy(req, res);
  } catch (error) {
    res.status(502).json({ message: error instanceof Error ? error.message : "Antigravity 上游请求失败" });
  }
});

app.all(/^\/chat\/completions$/, async (req, res) => {
  try {
    await handleProxy(req, res);
  } catch (error) {
    res.status(502).json({ message: error instanceof Error ? error.message : "OpenAI 上游请求失败" });
  }
});

app.all(/^\/responses(?:\/.*)?$/, async (req, res) => {
  try {
    await handleProxy(req, res);
  } catch (error) {
    res.status(502).json({ message: error instanceof Error ? error.message : "Responses 上游请求失败" });
  }
});

if (fs.existsSync(distDir)) {
  app.use(express.static(distDir));
  app.get(/^(?!\/api\/|\/v1\/).*/, (_req, res) => {
    res.sendFile(path.join(distDir, "index.html"));
  });
}

app.listen(port, () => {
  console.log(`Relay clone server running at http://localhost:${port}`);
});
