import "./env";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import {
  DEFAULT_CONCURRENT_SESSIONS,
  type AdminUser,
  type ApiKey,
  type Cdk,
  type DailyResetMode,
  type Db,
  type LimitHistoryRow,
  type LimitHistorySnapshot,
  type Order,
  type RechargeMode,
  type SiteSettings,
  type Sub2ApiBinding,
  type Template,
  type UsageRecord
} from "./types";

const dataDir = path.resolve(process.cwd(), "data");
const dbPath = path.join(dataDir, "db.json");
const DAY_MS = 24 * 60 * 60 * 1000;

function nowIso() {
  return new Date().toISOString();
}

function asNumber(value: unknown, fallback: number | null = null) {
  if (value == null || value === "") return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function asBoolean(value: unknown, fallback: boolean) {
  return typeof value === "boolean" ? value : fallback;
}

function normalizeSub2ApiBindings(value: unknown): Sub2ApiBinding[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => {
      if (!item || typeof item !== "object") return null;
      const record = item as Record<string, unknown>;
      const platform = String(record.platform ?? "").trim();
      if (!["anthropic", "openai", "gemini", "antigravity"].includes(platform)) {
        return null;
      }

      const groupId = asNumber(record.groupId ?? record.group_id, null);
      const groupName =
        (typeof record.groupName === "string" ? record.groupName : record.group_name ?? "").toString().trim() || "";

      if (!groupId || !groupName) {
        return null;
      }

      return {
        platform: platform as Sub2ApiBinding["platform"],
        groupId,
        groupName,
        subscriptionId: asNumber(record.subscriptionId ?? record.subscription_id, null),
        subscriptionExpiresAt:
          typeof record.subscriptionExpiresAt === "string"
            ? record.subscriptionExpiresAt
            : typeof record.subscription_expires_at === "string"
              ? record.subscription_expires_at
              : null,
        apiKeyId: asNumber(record.apiKeyId ?? record.api_key_id, null),
        apiKeyName:
          typeof record.apiKeyName === "string"
            ? record.apiKeyName
            : typeof record.api_key_name === "string"
              ? record.api_key_name
              : null,
        apiKeyStatus:
          typeof record.apiKeyStatus === "string"
            ? record.apiKeyStatus
            : typeof record.api_key_status === "string"
              ? record.api_key_status
              : null,
        apiKey:
          typeof record.apiKey === "string" ? record.apiKey : typeof record.api_key === "string" ? record.api_key : null
      } satisfies Sub2ApiBinding;
    })
    .filter(Boolean) as Sub2ApiBinding[];
}

export function hashValue(value: string) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

export function makeId(prefix: string) {
  return `${prefix}_${crypto.randomBytes(8).toString("hex")}`;
}

export function makeCdkCode() {
  return `CDK-${crypto.randomBytes(3).toString("hex").toUpperCase()}-${crypto
    .randomBytes(3)
    .toString("hex")
    .toUpperCase()}`;
}

export function makeLocalApiKey() {
  return `sk-relay-${crypto.randomBytes(18).toString("hex")}`;
}

export function makeChildApiKey() {
  return `sk-child-${crypto.randomBytes(18).toString("hex")}`;
}

export function makeInviteCode() {
  return `INV${crypto.randomBytes(3).toString("hex").toUpperCase()}`;
}

export function makeOrderNo() {
  const stamp = new Date()
    .toISOString()
    .replace(/[-:TZ.]/g, "")
    .slice(0, 14);
  return `OD${stamp}${crypto.randomBytes(2).toString("hex").toUpperCase()}`;
}

function ensureDir() {
  fs.mkdirSync(dataDir, { recursive: true });
}

function defaultSiteSettings(): SiteSettings {
  return {
    title: "HAOCUN",
    appEnv: process.env.NODE_ENV ?? "development",
    remoteWebUrl: process.env.PUBLIC_BASE_URL ?? "https://cdk.muyuai.top",
    qqGroupText: "联系管理员或加入交流群获取正式套餐：",
    qqGroupUrl: "https://qm.qq.com/q/c8uV3U5jHO",
    qqGroupQrcodeAvailable: true,
    helpContent: "",
    paymentMode: (process.env.PAYMENT_MODE as SiteSettings["paymentMode"] | undefined) ?? "manual_review",
    paymentChannelLabel: process.env.PAYMENT_CHANNEL_LABEL ?? "支付宝 / 微信人工审核",
    paymentAccountName: process.env.PAYMENT_ACCOUNT_NAME ?? null,
    paymentAccountNo: process.env.PAYMENT_ACCOUNT_NO ?? null,
    paymentQrCodeUrl: process.env.PAYMENT_QR_CODE_URL ?? null,
    paymentInstructions:
      process.env.PAYMENT_INSTRUCTIONS ??
      "下单后提交付款备注或流水号，管理员审核通过后自动发放或充值。",
    inviteEnabled: true,
    inviteDiscountPercent: 5,
    inviteRewardTotalUsd: 3
  };
}

function buildInitialLimitHistory(code: string, template: Template, activatedAt: string, expiresAt: string | null) {
  const rows: LimitHistoryRow[] = expiresAt
    ? [
        {
          cdk: code,
          kind: "current",
          templateName: template.name,
          durationDays: template.durationDays,
          dailyQuotaUsd: template.dailyQuotaUsd,
          mode: null,
          confirmedAt: null,
          segments: [
            {
              label: "初始",
              startAt: activatedAt,
              endAt: expiresAt,
              dailyQuotaUsd: template.dailyQuotaUsd
            }
          ]
        }
      ]
    : [];

  return buildLimitHistorySnapshot(code, activatedAt, expiresAt, rows);
}

function buildLimitHistorySnapshot(
  code: string,
  activatedAt: string | null,
  finalExpiresAt: string | null,
  rows: LimitHistoryRow[]
): LimitHistorySnapshot {
  const currentTime = nowIso();
  const segments = rows.flatMap((item) => item.segments);
  return {
    cdk: code,
    currentTime,
    activatedAt,
    originalExpiresAt: rows[0]?.segments[0]?.endAt ?? finalExpiresAt,
    finalExpiresAt,
    overallBar: {
      label: "总览",
      segments
    },
    rows,
    steps: rows.map((item) => ({
      label: item.cdk,
      segments: item.segments
    }))
  };
}

function createPrimaryApiKey(cdk: Cdk, template: Template): ApiKey {
  return {
    id: makeId("key"),
    cdkId: cdk.id,
    name: "default",
    key: cdk.localApiKey,
    isEnabled: true,
    expiresAt: cdk.expiresAt,
    canLoginWebUi: true,
    limit5hUsd: null,
    limitDailyUsd: template.dailyQuotaUsd,
    limitWeeklyUsd: template.weeklyQuotaUsd,
    limitMonthlyUsd: template.monthlyQuotaUsd,
    limitTotalUsd: template.totalQuotaUsd,
    limitConcurrentSessions: template.concurrentSessions,
    providerGroup: template.providerGroup,
    createdAt: cdk.createdAt,
    updatedAt: cdk.createdAt
  };
}

function buildSeedDb(): Db {
  const createdAt = nowIso();
  const admin: AdminUser = {
    username: process.env.ADMIN_USERNAME ?? "admin",
    passwordHash: hashValue(process.env.ADMIN_PASSWORD ?? "relay123456"),
    createdAt
  };

  return {
    site: defaultSiteSettings(),
    admins: [admin],
    templates: [],
    cdks: [],
    apiKeys: [],
    orders: [],
    usage: []
  };
}

function normalizeTemplate(raw: any, index: number): Template {
  const createdAt = typeof raw?.createdAt === "string" ? raw.createdAt : nowIso();
  return {
    id: typeof raw?.id === "string" ? raw.id : makeId(`tpl${index}`),
    name: typeof raw?.name === "string" && raw.name.trim() ? raw.name : `套餐 ${index + 1}`,
    content: typeof raw?.content === "string" ? raw.content : "",
    durationDays: asNumber(raw?.durationDays ?? raw?.duration_days, null),
    rpm: asNumber(raw?.rpm, null),
    concurrentSessions: asNumber(
      raw?.concurrentSessions ?? raw?.concurrent_sessions,
      DEFAULT_CONCURRENT_SESSIONS
    ),
    dailyQuotaUsd: asNumber(raw?.dailyQuotaUsd ?? raw?.daily_quota_usd, null),
    weeklyQuotaUsd: asNumber(raw?.weeklyQuotaUsd ?? raw?.weekly_quota_usd, null),
    monthlyQuotaUsd: asNumber(raw?.monthlyQuotaUsd ?? raw?.monthly_quota_usd, null),
    totalQuotaUsd: asNumber(raw?.totalQuotaUsd ?? raw?.total_quota_usd, null),
    dailyResetMode:
      raw?.dailyResetMode === "rolling" || raw?.daily_reset_mode === "rolling" ? "rolling" : "fixed",
    dailyResetTime:
      (typeof raw?.dailyResetTime === "string" ? raw.dailyResetTime : raw?.daily_reset_time ?? "").trim() || "00:00",
    providerGroup: typeof raw?.providerGroup === "string" ? raw.providerGroup : raw?.provider_group ?? null,
    contactText: typeof raw?.contactText === "string" ? raw.contactText : raw?.contact_text ?? null,
    contactLink: typeof raw?.contactLink === "string" ? raw.contactLink : raw?.contact_link ?? null,
    hideGroupInfo: asBoolean(raw?.hideGroupInfo ?? raw?.hide_group_info, false),
    enabled: asBoolean(raw?.enabled, true),
    allowNewPurchase: asBoolean(raw?.allowNewPurchase ?? raw?.allow_new_purchase, true),
    allowRecharge: asBoolean(raw?.allowRecharge ?? raw?.allow_recharge, true),
    createdAt,
    updatedAt: typeof raw?.updatedAt === "string" ? raw.updatedAt : createdAt
  };
}

function normalizeCdk(raw: any, index: number, templates: Template[]): Cdk {
  const template = templates.find((item) => item.id === raw?.templateId || item.id === raw?.template_id) ?? null;
  const createdAt = typeof raw?.createdAt === "string" ? raw.createdAt : nowIso();
  const code = typeof raw?.code === "string" ? raw.code : makeCdkCode();
  const redeemedAt = typeof raw?.redeemedAt === "string" ? raw.redeemedAt : raw?.redeemed_at ?? null;
  const expiresAt = typeof raw?.expiresAt === "string" ? raw.expiresAt : raw?.expires_at ?? null;
  const limitHistory = raw?.limitHistory ?? raw?.limit_history ?? null;

  return {
    id: typeof raw?.id === "string" ? raw.id : makeId(`cdk${index}`),
    code,
    templateId: template?.id ?? templates[0]?.id ?? makeId("tpl_missing"),
    localApiKey:
      typeof raw?.localApiKey === "string" ? raw.localApiKey : raw?.local_api_key ?? makeLocalApiKey(),
    disabled: asBoolean(raw?.disabled, false),
    createdAt,
    redeemedAt,
    expiresAt,
    usageCount: asNumber(raw?.usageCount ?? raw?.usage_count, 0) ?? 0,
    totalCostUsd: asNumber(raw?.totalCostUsd ?? raw?.total_cost_usd, 0) ?? 0,
    lastUsedAt: typeof raw?.lastUsedAt === "string" ? raw.lastUsedAt : raw?.last_used_at ?? null,
    note: typeof raw?.note === "string" ? raw.note : null,
    effectiveDailyQuotaUsd: asNumber(
      raw?.effectiveDailyQuotaUsd ?? raw?.effective_daily_quota_usd ?? template?.dailyQuotaUsd,
      null
    ),
    effectiveMonthlyQuotaUsd: asNumber(
      raw?.effectiveMonthlyQuotaUsd ?? raw?.effective_monthly_quota_usd ?? template?.monthlyQuotaUsd,
      null
    ),
    effectiveTotalQuotaUsd: asNumber(
      raw?.effectiveTotalQuotaUsd ?? raw?.effective_total_quota_usd ?? template?.totalQuotaUsd,
      null
    ),
    inviteCode: typeof raw?.inviteCode === "string" && raw.inviteCode ? raw.inviteCode : makeInviteCode(),
    inviteCount: asNumber(raw?.inviteCount ?? raw?.invite_count, 0) ?? 0,
    inviteRewardTotalUsd: asNumber(raw?.inviteRewardTotalUsd ?? raw?.invite_reward_total_usd, 0) ?? 0,
    lastRechargeAt: typeof raw?.lastRechargeAt === "string" ? raw.lastRechargeAt : raw?.last_recharge_at ?? null,
    sourceCdkCode: typeof raw?.sourceCdkCode === "string" ? raw.sourceCdkCode : raw?.source_cdk_code ?? null,
    rechargeTargetCode:
      typeof raw?.rechargeTargetCode === "string" ? raw.rechargeTargetCode : raw?.recharge_target_code ?? null,
    rechargeMode:
      raw?.rechargeMode === "extend_duration" ||
      raw?.rechargeMode === "boost_quota" ||
      raw?.rechargeMode === "overwrite"
        ? raw.rechargeMode
        : raw?.recharge_mode === "extend_duration" ||
            raw?.recharge_mode === "boost_quota" ||
            raw?.recharge_mode === "overwrite"
          ? raw.recharge_mode
          : null,
    rechargeConfirmedAt:
      typeof raw?.rechargeConfirmedAt === "string"
        ? raw.rechargeConfirmedAt
        : raw?.recharge_confirmed_at ?? raw?.last_recharge_at ?? null,
    limitHistory:
      limitHistory && typeof limitHistory === "object"
        ? (limitHistory as Cdk["limitHistory"])
        : redeemedAt && template
          ? buildInitialLimitHistory(code, template, redeemedAt, expiresAt)
          : null,
    upstreamUserId: asNumber(raw?.upstreamUserId ?? raw?.upstream_user_id, null),
    upstreamUsername:
      typeof raw?.upstreamUsername === "string" ? raw.upstreamUsername : raw?.upstream_username ?? null,
    upstreamTokenId: asNumber(raw?.upstreamTokenId ?? raw?.upstream_token_id, null),
    upstreamTokenName:
      typeof raw?.upstreamTokenName === "string" ? raw.upstreamTokenName : raw?.upstream_token_name ?? null,
    upstreamTokenKey:
      typeof raw?.upstreamTokenKey === "string" ? raw.upstreamTokenKey : raw?.upstream_token_key ?? null,
    upstreamQuotaFloor: asNumber(raw?.upstreamQuotaFloor ?? raw?.upstream_quota_floor, null),
    upstreamProvisionedAt:
      typeof raw?.upstreamProvisionedAt === "string"
        ? raw.upstreamProvisionedAt
        : raw?.upstream_provisioned_at ?? null,
    sub2apiUserId: asNumber(raw?.sub2apiUserId ?? raw?.sub2api_user_id, null),
    sub2apiEmail: typeof raw?.sub2apiEmail === "string" ? raw.sub2apiEmail : raw?.sub2api_email ?? null,
    sub2apiUsername:
      typeof raw?.sub2apiUsername === "string" ? raw.sub2apiUsername : raw?.sub2api_username ?? null,
    sub2apiProvisionedAt:
      typeof raw?.sub2apiProvisionedAt === "string"
        ? raw.sub2apiProvisionedAt
        : raw?.sub2api_provisioned_at ?? null,
    sub2apiLastSyncAt:
      typeof raw?.sub2apiLastSyncAt === "string" ? raw.sub2apiLastSyncAt : raw?.sub2api_last_sync_at ?? null,
    sub2apiBindings: normalizeSub2ApiBindings(raw?.sub2apiBindings ?? raw?.sub2api_bindings)
  };
}

function normalizeApiKey(raw: any, index: number, cdks: Cdk[], templates: Template[]): ApiKey {
  const cdk = cdks.find((item) => item.id === raw?.cdkId || item.id === raw?.cdk_id) ?? null;
  const template = cdk ? templates.find((item) => item.id === cdk.templateId) ?? null : null;
  const createdAt = typeof raw?.createdAt === "string" ? raw.createdAt : nowIso();
  return {
    id: typeof raw?.id === "string" ? raw.id : makeId(`key${index}`),
    cdkId: cdk?.id ?? "",
    name: typeof raw?.name === "string" && raw.name.trim() ? raw.name : `子 Key ${index + 1}`,
    key: typeof raw?.key === "string" ? raw.key : makeChildApiKey(),
    isEnabled: asBoolean(raw?.isEnabled ?? raw?.is_enabled, true),
    expiresAt: typeof raw?.expiresAt === "string" ? raw.expiresAt : raw?.expires_at ?? cdk?.expiresAt ?? null,
    canLoginWebUi: asBoolean(raw?.canLoginWebUi ?? raw?.can_login_web_ui, true),
    limit5hUsd: asNumber(raw?.limit5hUsd ?? raw?.limit_5h_usd, null),
    limitDailyUsd: asNumber(raw?.limitDailyUsd ?? raw?.limit_daily_usd, null),
    limitWeeklyUsd: asNumber(raw?.limitWeeklyUsd ?? raw?.limit_weekly_usd, null),
    limitMonthlyUsd: asNumber(raw?.limitMonthlyUsd ?? raw?.limit_monthly_usd, null),
    limitTotalUsd: asNumber(raw?.limitTotalUsd ?? raw?.limit_total_usd, null),
    limitConcurrentSessions: asNumber(
      raw?.limitConcurrentSessions ?? raw?.limit_concurrent_sessions ?? template?.concurrentSessions,
      null
    ),
    providerGroup:
      typeof raw?.providerGroup === "string" ? raw.providerGroup : raw?.provider_group ?? template?.providerGroup ?? null,
    createdAt,
    updatedAt: typeof raw?.updatedAt === "string" ? raw.updatedAt : createdAt
  };
}

function normalizeOrder(raw: any, index: number): Order {
  const createdAt = typeof raw?.createdAt === "string" ? raw.createdAt : nowIso();
  const status = raw?.status;
  const mode = raw?.mode;
  return {
    id: typeof raw?.id === "string" ? raw.id : makeId(`ord${index}`),
    orderNo: typeof raw?.orderNo === "string" ? raw.orderNo : raw?.order_no ?? makeOrderNo(),
    templateId: typeof raw?.templateId === "string" ? raw.templateId : raw?.template_id ?? "",
    mode: mode === "recharge_existing" ? "recharge_existing" : "new_purchase",
    cdkId: typeof raw?.cdkId === "string" ? raw.cdkId : raw?.cdk_id ?? null,
    cdkCodeSnapshot:
      typeof raw?.cdkCodeSnapshot === "string" ? raw.cdkCodeSnapshot : raw?.cdk_code_snapshot ?? null,
    buyerName: typeof raw?.buyerName === "string" ? raw.buyerName : raw?.buyer_name ?? null,
    buyerContact: typeof raw?.buyerContact === "string" ? raw.buyerContact : raw?.buyer_contact ?? null,
    paymentChannel: raw?.paymentChannel === "mock" ? "mock" : "manual",
    originalAmountCny: asNumber(raw?.originalAmountCny ?? raw?.original_amount_cny, 0) ?? 0,
    discountAmountCny: asNumber(raw?.discountAmountCny ?? raw?.discount_amount_cny, 0) ?? 0,
    finalAmountCny: asNumber(raw?.finalAmountCny ?? raw?.final_amount_cny, 0) ?? 0,
    inviteCode: typeof raw?.inviteCode === "string" ? raw.inviteCode : raw?.invite_code ?? null,
    inviterCdkId: typeof raw?.inviterCdkId === "string" ? raw.inviterCdkId : raw?.inviter_cdk_id ?? null,
    inviteRewardApplied: asBoolean(raw?.inviteRewardApplied ?? raw?.invite_reward_applied, false),
    status:
      status === "submitted" || status === "paid" || status === "cancelled" ? status : "pending",
    createdCdkId: typeof raw?.createdCdkId === "string" ? raw.createdCdkId : raw?.created_cdk_id ?? null,
    paymentReference:
      typeof raw?.paymentReference === "string" ? raw.paymentReference : raw?.payment_reference ?? null,
    paymentNote: typeof raw?.paymentNote === "string" ? raw.paymentNote : raw?.payment_note ?? null,
    adminNote: typeof raw?.adminNote === "string" ? raw.adminNote : raw?.admin_note ?? null,
    submittedAt: typeof raw?.submittedAt === "string" ? raw.submittedAt : raw?.submitted_at ?? null,
    paidAt: typeof raw?.paidAt === "string" ? raw.paidAt : raw?.paid_at ?? null,
    confirmedBy: typeof raw?.confirmedBy === "string" ? raw.confirmedBy : raw?.confirmed_by ?? null,
    createdAt,
    updatedAt: typeof raw?.updatedAt === "string" ? raw.updatedAt : createdAt
  };
}

function normalizeUsage(raw: any, index: number): UsageRecord {
  const createdAt = typeof raw?.createdAt === "string" ? raw.createdAt : nowIso();
  return {
    id: typeof raw?.id === "string" ? raw.id : makeId(`use${index}`),
    cdkId: typeof raw?.cdkId === "string" ? raw.cdkId : raw?.cdk_id ?? "",
    apiKeyId: typeof raw?.apiKeyId === "string" ? raw.apiKeyId : raw?.api_key_id ?? null,
    path: typeof raw?.path === "string" ? raw.path : "/v1/chat/completions",
    model: typeof raw?.model === "string" ? raw.model : null,
    statusCode: asNumber(raw?.statusCode ?? raw?.status_code, null),
    createdAt,
    durationMs: asNumber(raw?.durationMs ?? raw?.duration_ms, 0) ?? 0,
    ttfbMs: asNumber(raw?.ttfbMs ?? raw?.ttfb_ms, null),
    inputTokens: asNumber(raw?.inputTokens ?? raw?.input_tokens, null),
    outputTokens: asNumber(raw?.outputTokens ?? raw?.output_tokens, null),
    cacheReadInputTokens: asNumber(raw?.cacheReadInputTokens ?? raw?.cache_read_input_tokens, null),
    cacheCreationInputTokens: asNumber(raw?.cacheCreationInputTokens ?? raw?.cache_creation_input_tokens, null),
    totalTokens: asNumber(raw?.totalTokens ?? raw?.total_tokens, null),
    costUsd: asNumber(raw?.costUsd ?? raw?.cost_usd, null),
    estimatedCostUsd: asNumber(raw?.estimatedCostUsd ?? raw?.estimated_cost_usd, null),
    requestId: typeof raw?.requestId === "string" ? raw.requestId : raw?.request_id ?? makeId("req"),
    clientKey: typeof raw?.clientKey === "string" ? raw.clientKey : raw?.client_key ?? "-",
    sessionId: typeof raw?.sessionId === "string" ? raw.sessionId : raw?.session_id ?? null,
    retryCount: asNumber(raw?.retryCount ?? raw?.retry_count, null),
    costSource:
      raw?.costSource === "actual" || raw?.cost_source === "actual"
        ? "actual"
        : raw?.costSource === "estimated" || raw?.cost_source === "estimated"
          ? "estimated"
          : null
  };
}

function normalizeAdmins(raw: any): AdminUser[] {
  if (!Array.isArray(raw) || raw.length === 0) {
    return [
      {
        username: process.env.ADMIN_USERNAME ?? "admin",
        passwordHash: hashValue(process.env.ADMIN_PASSWORD ?? "relay123456"),
        createdAt: nowIso()
      }
    ];
  }

  return raw.map((item, index) => ({
    username: typeof item?.username === "string" ? item.username : `admin${index + 1}`,
    passwordHash:
      typeof item?.passwordHash === "string"
        ? item.passwordHash
        : hashValue(process.env.ADMIN_PASSWORD ?? "relay123456"),
    createdAt: typeof item?.createdAt === "string" ? item.createdAt : nowIso()
  }));
}

function normalizeDb(raw: any): Db {
  const seed = buildSeedDb();
  const site = {
    ...seed.site,
    ...(raw?.site ?? {})
  } satisfies SiteSettings;

  const templates: Template[] = Array.isArray(raw?.templates) && raw.templates.length > 0
    ? raw.templates.map((item: any, index: number) => normalizeTemplate(item, index))
    : seed.templates;
  const cdks: Cdk[] = Array.isArray(raw?.cdks)
    ? raw.cdks.map((item: any, index: number) => normalizeCdk(item, index, templates))
    : seed.cdks;
  const apiKeys: ApiKey[] = Array.isArray(raw?.apiKeys ?? raw?.api_keys)
    ? (raw.apiKeys ?? raw.api_keys).map((item: any, index: number) => normalizeApiKey(item, index, cdks, templates))
    : [];
  const orders: Order[] = Array.isArray(raw?.orders)
    ? raw.orders.map((item: any, index: number) => normalizeOrder(item, index))
    : [];
  const usage: UsageRecord[] = Array.isArray(raw?.usage)
    ? raw.usage.map((item: any, index: number) => normalizeUsage(item, index))
    : [];

  // Ensure every CDK has a primary key record.
  for (const cdk of cdks) {
    const alreadyExists = apiKeys.some((item) => item.cdkId === cdk.id && item.key === cdk.localApiKey);
    if (alreadyExists) continue;
    const template = templates.find((item) => item.id === cdk.templateId) ?? null;
    if (!template) continue;
    apiKeys.unshift(createPrimaryApiKey(cdk, template));
  }

  return {
    site,
    admins: normalizeAdmins(raw?.admins),
    templates,
    cdks,
    apiKeys,
    orders,
    usage
  };
}

function writeDb(db: Db) {
  ensureDir();
  fs.writeFileSync(dbPath, JSON.stringify(db, null, 2), "utf8");
}

export function ensureDb() {
  ensureDir();
  if (!fs.existsSync(dbPath)) {
    writeDb(buildSeedDb());
    return;
  }

  const raw = JSON.parse(fs.readFileSync(dbPath, "utf8"));
  const normalized = normalizeDb(raw);
  writeDb(normalized);
}

export function readDb(): Db {
  ensureDb();
  return JSON.parse(fs.readFileSync(dbPath, "utf8")) as Db;
}

export function updateDb<T>(mutator: (db: Db) => T): T {
  const db = readDb();
  const result = mutator(db);
  writeDb(db);
  return result;
}

export function findTemplate(db: Db, templateId: string) {
  return db.templates.find((item) => item.id === templateId) ?? null;
}

export function findCdkByCode(db: Db, code: string) {
  return db.cdks.find((item) => item.code.toLowerCase() === code.toLowerCase()) ?? null;
}

export function findCdkByLocalApiKey(db: Db, key: string) {
  return db.cdks.find((item) => item.localApiKey === key) ?? null;
}

export function findApiKeyBySecret(db: Db, key: string) {
  return db.apiKeys.find((item) => item.key === key) ?? null;
}

export function findApiKeyById(db: Db, apiKeyId: string) {
  return db.apiKeys.find((item) => item.id === apiKeyId) ?? null;
}

export function findCdkByInviteCode(db: Db, inviteCode: string) {
  return db.cdks.find((item) => item.inviteCode.toLowerCase() === inviteCode.toLowerCase()) ?? null;
}

export function findOrderByOrderNo(db: Db, orderNo: string) {
  return db.orders.find((item) => item.orderNo.toLowerCase() === orderNo.toLowerCase()) ?? null;
}

export function findOrderById(db: Db, orderId: string) {
  return db.orders.find((item) => item.id === orderId) ?? null;
}

export function getApiKeysForCdk(db: Db, cdkId: string) {
  return db.apiKeys
    .filter((item) => item.cdkId === cdkId)
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

export function maskSecret(secret: string) {
  if (secret.length <= 10) return secret;
  return `${secret.slice(0, 6)}...${secret.slice(-4)}`;
}

function addQuota(current: number | null, amount: number | null) {
  if (current == null || amount == null) return null;
  return Number((current + amount).toFixed(6));
}

function addDuration(expiresAt: string | null, durationDays: number | null) {
  if (!durationDays) return expiresAt;
  const nowTime = Date.now();
  const expiresBase = expiresAt ? new Date(expiresAt).getTime() : nowTime;
  const base = Math.max(expiresBase, nowTime);
  return new Date(base + durationDays * DAY_MS).toISOString();
}

function addDurationFrom(startAt: string, durationDays: number | null) {
  if (!durationDays) return startAt;
  return new Date(new Date(startAt).getTime() + durationDays * DAY_MS).toISOString();
}

function daysBetween(startAt: string, endAt: string) {
  return Number(((new Date(endAt).getTime() - new Date(startAt).getTime()) / DAY_MS).toFixed(6));
}

function getRechargeModeLabel(mode: RechargeMode) {
  switch (mode) {
    case "extend_duration":
      return "叠加时长";
    case "boost_quota":
      return "叠加额度";
    default:
      return "覆盖充值";
  }
}

function hasRechargeQuota(cdk: Cdk) {
  return !(
    cdk.effectiveDailyQuotaUsd == null &&
    cdk.effectiveMonthlyQuotaUsd == null &&
    cdk.effectiveTotalQuotaUsd == null
  );
}

function snapshotRechargeState(cdk: Cdk) {
  return {
    expiresAt: cdk.expiresAt,
    effectiveDailyQuotaUsd: cdk.effectiveDailyQuotaUsd,
    effectiveMonthlyQuotaUsd: cdk.effectiveMonthlyQuotaUsd,
    effectiveTotalQuotaUsd: cdk.effectiveTotalQuotaUsd
  };
}

function buildRechargeRows(
  input: {
    mode: RechargeMode;
    nowIso: string;
    sourceCdk: Cdk;
    sourceTemplate: Template;
    targetCdk: Cdk;
    targetTemplate: Template;
    sourceEndAt: string | null;
    finalExpiresAt: string | null;
    peakDailyQuotaUsd: number | null;
    combinedDailyQuotaUsd: number | null;
  }
) {
  const rows: LimitHistoryRow[] = [];

  if (input.targetCdk.expiresAt && input.targetCdk.effectiveDailyQuotaUsd != null) {
    rows.push({
      cdk: input.targetCdk.code,
      kind: "current",
      templateName: input.targetTemplate.name,
      durationDays: input.targetTemplate.durationDays,
      dailyQuotaUsd: input.targetCdk.effectiveDailyQuotaUsd,
      mode: null,
      confirmedAt: null,
      segments: [
        {
          label: "当前",
          startAt: input.nowIso,
          endAt: input.targetCdk.expiresAt,
          dailyQuotaUsd: input.targetCdk.effectiveDailyQuotaUsd
        }
      ]
    });
  }

  const sourceSegments =
    input.sourceEndAt && input.sourceTemplate.dailyQuotaUsd != null
      ? [
          {
            label: "新卡",
            startAt: input.nowIso,
            endAt: input.sourceEndAt,
            dailyQuotaUsd: input.sourceTemplate.dailyQuotaUsd
          }
        ]
      : [];

  rows.push({
    cdk: input.sourceCdk.code,
    kind: "recharge",
    templateName: input.sourceTemplate.name,
    durationDays: input.sourceTemplate.durationDays,
    dailyQuotaUsd: input.sourceTemplate.dailyQuotaUsd,
    mode: input.mode,
    confirmedAt: input.nowIso,
    segments: sourceSegments
  });

  if (input.finalExpiresAt && input.combinedDailyQuotaUsd != null) {
    rows.unshift({
      cdk: input.targetCdk.code,
      kind: "current",
      templateName: input.targetTemplate.name,
      durationDays: input.targetTemplate.durationDays,
      dailyQuotaUsd: input.peakDailyQuotaUsd,
      mode: input.mode,
      confirmedAt: null,
      segments: [
        {
          label: "充值后",
          startAt: input.nowIso,
          endAt: input.finalExpiresAt,
          dailyQuotaUsd: input.combinedDailyQuotaUsd
        }
      ]
    });
  }

  return rows;
}

function buildRechargePreviewData(
  targetCdk: Cdk,
  targetTemplate: Template,
  sourceCdk: Cdk,
  sourceTemplate: Template,
  mode: RechargeMode
) {
  const currentTime = nowIso();
  const targetExpired = !targetCdk.expiresAt || new Date(targetCdk.expiresAt).getTime() <= Date.now();
  const sourceDurationDays = sourceTemplate.durationDays ?? 0;
  const sourceDailyQuotaUsd = sourceTemplate.dailyQuotaUsd ?? sourceCdk.effectiveDailyQuotaUsd;
  const currentDailyQuotaUsd = targetCdk.effectiveDailyQuotaUsd;
  const sourceEndAt = sourceDurationDays > 0 ? addDurationFrom(currentTime, sourceDurationDays) : null;

  let finalExpiresAt = targetCdk.expiresAt;
  let peakDailyQuotaUsd = currentDailyQuotaUsd;
  let combinedDailyQuotaUsd = currentDailyQuotaUsd;
  let extensionDays: number | null = null;

  if (mode === "extend_duration") {
    if (!sourceTemplate.durationDays) {
      throw new Error("新 CDK 没有可叠加的时长");
    }

    if (!targetExpired && currentDailyQuotaUsd != null && sourceDailyQuotaUsd != null && currentDailyQuotaUsd !== sourceDailyQuotaUsd) {
      throw new Error("目标卡未过期时，只支持同日额度卡顺延");
    }

    if (targetExpired) {
      finalExpiresAt = addDurationFrom(currentTime, sourceTemplate.durationDays);
      peakDailyQuotaUsd = sourceDailyQuotaUsd;
      combinedDailyQuotaUsd = sourceDailyQuotaUsd;
    } else {
      finalExpiresAt = addDuration(targetCdk.expiresAt, sourceTemplate.durationDays);
      peakDailyQuotaUsd = currentDailyQuotaUsd;
      combinedDailyQuotaUsd = currentDailyQuotaUsd;
    }

    extensionDays = sourceTemplate.durationDays;
  } else if (mode === "boost_quota") {
    if (!sourceTemplate.durationDays || sourceDailyQuotaUsd == null || currentDailyQuotaUsd == null) {
      throw new Error("叠加额度需要当前卡和新卡都具备日额度与时长");
    }

    if (targetExpired || !targetCdk.expiresAt || !sourceEndAt) {
      finalExpiresAt = addDurationFrom(currentTime, sourceTemplate.durationDays);
      peakDailyQuotaUsd = sourceDailyQuotaUsd;
      combinedDailyQuotaUsd = sourceDailyQuotaUsd;
      extensionDays = sourceTemplate.durationDays;
    } else {
      const combined = Number((currentDailyQuotaUsd + sourceDailyQuotaUsd).toFixed(6));
      const targetExpiresAtMs = new Date(targetCdk.expiresAt).getTime();
      const sourceEndAtMs = new Date(sourceEndAt).getTime();
      const overlapEndsAt = new Date(Math.min(targetExpiresAtMs, sourceEndAtMs)).toISOString();
      const remainingSourceDays = Math.max(daysBetween(overlapEndsAt, sourceEndAt), 0);

      peakDailyQuotaUsd = combined;
      combinedDailyQuotaUsd = combined;
      extensionDays =
        remainingSourceDays > 0 ? Number(((remainingSourceDays * sourceDailyQuotaUsd) / combined).toFixed(6)) : null;
      finalExpiresAt =
        extensionDays && extensionDays > 0 ? addDuration(targetCdk.expiresAt, extensionDays) : targetCdk.expiresAt;
    }
  } else {
    if (!sourceTemplate.durationDays) {
      throw new Error("覆盖充值需要新 CDK 具备有效时长");
    }

    finalExpiresAt = addDurationFrom(currentTime, sourceTemplate.durationDays);
    peakDailyQuotaUsd = sourceDailyQuotaUsd;
    combinedDailyQuotaUsd = sourceDailyQuotaUsd;
    extensionDays = sourceTemplate.durationDays;
  }

  const rows = buildRechargeRows({
    mode,
    nowIso: currentTime,
    sourceCdk,
    sourceTemplate,
    targetCdk,
    targetTemplate,
    sourceEndAt,
    finalExpiresAt,
    peakDailyQuotaUsd,
    combinedDailyQuotaUsd
  });

  return {
    mode,
    currentTime,
    currentDailyQuotaUsd,
    sourceDailyQuotaUsd,
    peakDailyQuotaUsd,
    combinedDailyQuotaUsd,
    sourceDurationDays: sourceTemplate.durationDays,
    targetExpiresAtBefore: targetCdk.expiresAt,
    originalExpiresAt: targetCdk.expiresAt,
    finalExpiresAt,
    extensionDays,
    targetTemplateName: targetTemplate.name,
    sourceTemplateName: sourceTemplate.name,
    rows,
    overallBar: {
      label: "总览",
      segments: rows.flatMap((item) => item.segments)
    }
  };
}

function syncPrimaryApiKey(db: Db, cdk: Cdk) {
  const template = findTemplate(db, cdk.templateId);
  if (!template) return;
  const primary = db.apiKeys.find((item) => item.cdkId === cdk.id && item.key === cdk.localApiKey);
  if (!primary) {
    db.apiKeys.unshift(createPrimaryApiKey(cdk, template));
    return;
  }

  primary.expiresAt = cdk.expiresAt;
  primary.limitDailyUsd = cdk.effectiveDailyQuotaUsd;
  primary.limitWeeklyUsd = template.weeklyQuotaUsd;
  primary.limitMonthlyUsd = cdk.effectiveMonthlyQuotaUsd;
  primary.limitTotalUsd = cdk.effectiveTotalQuotaUsd;
  primary.limitConcurrentSessions = template.concurrentSessions;
  primary.providerGroup = template.providerGroup;
  primary.updatedAt = nowIso();
}

function resetCdkUsage(db: Db, cdkId: string) {
  db.usage = db.usage.filter((item) => item.cdkId !== cdkId);
  const cdk = db.cdks.find((item) => item.id === cdkId);
  if (!cdk) return;
  cdk.usageCount = 0;
  cdk.totalCostUsd = 0;
  cdk.lastUsedAt = null;
}

function applyDirectRecharge(db: Db, targetCdk: Cdk, sourceCdk: Cdk, sourceTemplate: Template, mode: RechargeMode) {
  const targetTemplate = findTemplate(db, targetCdk.templateId);
  if (!targetTemplate) {
    throw new Error("目标 CDK 对应套餐不存在");
  }

  const appliedAt = nowIso();
  const targetExpiredBefore = !targetCdk.expiresAt || new Date(targetCdk.expiresAt).getTime() <= Date.now();
  const preview = buildRechargePreviewData(targetCdk, targetTemplate, sourceCdk, sourceTemplate, mode);

  if (mode === "extend_duration") {
    targetCdk.expiresAt = preview.finalExpiresAt;
    if (targetExpiredBefore && sourceTemplate.dailyQuotaUsd != null) {
      targetCdk.effectiveDailyQuotaUsd = sourceTemplate.dailyQuotaUsd;
      targetCdk.effectiveMonthlyQuotaUsd = sourceTemplate.monthlyQuotaUsd;
      targetCdk.effectiveTotalQuotaUsd = sourceTemplate.totalQuotaUsd;
      targetCdk.templateId = sourceTemplate.id;
    }
  } else if (mode === "boost_quota") {
    targetCdk.effectiveDailyQuotaUsd = preview.combinedDailyQuotaUsd;
    targetCdk.effectiveMonthlyQuotaUsd = addQuota(targetCdk.effectiveMonthlyQuotaUsd, sourceTemplate.monthlyQuotaUsd);
    targetCdk.effectiveTotalQuotaUsd = addQuota(targetCdk.effectiveTotalQuotaUsd, sourceTemplate.totalQuotaUsd);
    targetCdk.expiresAt = preview.finalExpiresAt;
  } else {
    targetCdk.templateId = sourceTemplate.id;
    targetCdk.effectiveDailyQuotaUsd = sourceTemplate.dailyQuotaUsd;
    targetCdk.effectiveMonthlyQuotaUsd = sourceTemplate.monthlyQuotaUsd;
    targetCdk.effectiveTotalQuotaUsd = sourceTemplate.totalQuotaUsd;
    targetCdk.expiresAt = preview.finalExpiresAt;
    resetCdkUsage(db, targetCdk.id);
  }

  const rows = preview.rows.map((item) =>
    item.kind === "recharge"
      ? {
          ...item,
          confirmedAt: appliedAt
        }
      : item
  );

  targetCdk.limitHistory = buildLimitHistorySnapshot(
    targetCdk.code,
    targetCdk.redeemedAt,
    preview.finalExpiresAt,
    rows
  );
  syncPrimaryApiKey(db, targetCdk);

  return preview;
}

function resolveDirectRechargeContext(
  db: Db,
  input: {
    sourceCdkCode: string;
    targetCdkCode: string;
    mode: RechargeMode;
  }
) {
  const sourceCode = input.sourceCdkCode.trim();
  const targetCode = input.targetCdkCode.trim();

  if (!sourceCode) {
    throw new Error("请填写来源 CDK");
  }

  if (!targetCode) {
    throw new Error("缺少目标 CDK");
  }

  const sourceCdk = findCdkByCode(db, sourceCode);
  if (!sourceCdk) {
    throw new Error("来源 CDK 不存在");
  }

  const targetCdk = findCdkByCode(db, targetCode);
  if (!targetCdk) {
    throw new Error("目标 CDK 不存在");
  }

  if (sourceCdk.id === targetCdk.id) {
    throw new Error("不能把当前 CDK 充值到自己");
  }

  if (targetCdk.disabled) {
    throw new Error("目标 CDK 已禁用，不能继续充值");
  }

  if (!targetCdk.redeemedAt) {
    throw new Error("目标 CDK 还未激活，请先打开目标 CDK 页面");
  }

  if (sourceCdk.disabled) {
    throw new Error("来源 CDK 已失效，不能再次充值");
  }

  if (sourceCdk.redeemedAt) {
    throw new Error("来源 CDK 已经激活，请换一张未使用的新 CDK");
  }

  const sourceTemplate = findTemplate(db, sourceCdk.templateId);
  if (!sourceTemplate) {
    throw new Error("来源 CDK 对应套餐不存在");
  }

  const targetTemplate = findTemplate(db, targetCdk.templateId);
  if (!targetTemplate) {
    throw new Error("目标 CDK 对应套餐不存在");
  }

  return {
    sourceCdk,
    targetCdk,
    sourceTemplate,
    targetTemplate
  };
}

export function buildDirectRechargePreview(
  db: Db,
  input: {
    sourceCdkCode: string;
    targetCdkCode: string;
    mode: RechargeMode;
  }
) {
  const context = resolveDirectRechargeContext(db, input);
  const preview = buildRechargePreviewData(
    context.targetCdk,
    context.targetTemplate,
    context.sourceCdk,
    context.sourceTemplate,
    input.mode
  );

  return {
    mode: input.mode,
    sourceCdk: context.sourceCdk,
    sourceTemplate: context.sourceTemplate,
    targetCdk: context.targetCdk,
    targetTemplate: context.targetTemplate,
    before: snapshotRechargeState(context.targetCdk),
    after: {
      expiresAt: preview.finalExpiresAt,
      effectiveDailyQuotaUsd:
        input.mode === "overwrite"
          ? context.sourceTemplate.dailyQuotaUsd
          : input.mode === "boost_quota"
            ? preview.combinedDailyQuotaUsd
            : !context.targetCdk.expiresAt || new Date(context.targetCdk.expiresAt).getTime() <= Date.now()
              ? context.sourceTemplate.dailyQuotaUsd
              : preview.peakDailyQuotaUsd,
      effectiveMonthlyQuotaUsd:
        input.mode === "overwrite"
          ? context.sourceTemplate.monthlyQuotaUsd
          : input.mode === "boost_quota"
            ? addQuota(context.targetCdk.effectiveMonthlyQuotaUsd, context.sourceTemplate.monthlyQuotaUsd)
            : !context.targetCdk.expiresAt || new Date(context.targetCdk.expiresAt).getTime() <= Date.now()
              ? context.sourceTemplate.monthlyQuotaUsd
              : context.targetCdk.effectiveMonthlyQuotaUsd,
      effectiveTotalQuotaUsd:
        input.mode === "overwrite"
          ? context.sourceTemplate.totalQuotaUsd
          : input.mode === "boost_quota"
            ? addQuota(context.targetCdk.effectiveTotalQuotaUsd, context.sourceTemplate.totalQuotaUsd)
            : !context.targetCdk.expiresAt || new Date(context.targetCdk.expiresAt).getTime() <= Date.now()
              ? context.sourceTemplate.totalQuotaUsd
              : context.targetCdk.effectiveTotalQuotaUsd
    },
    change: {
      durationDays: preview.extensionDays,
      dailyQuotaUsd: preview.sourceDailyQuotaUsd,
      monthlyQuotaUsd: context.sourceTemplate.monthlyQuotaUsd,
      totalQuotaUsd: context.sourceTemplate.totalQuotaUsd
    },
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
    summary: {
      modeLabel: getRechargeModeLabel(input.mode),
      keepsLocalApiKey: true,
      sourceWillBeDisabled: true
    }
  };
}

export function confirmDirectRecharge(
  db: Db,
  input: {
    sourceCdkCode: string;
    targetCdkCode: string;
    mode: RechargeMode;
  }
) {
  const preview = buildDirectRechargePreview(db, input);
  const timestamp = nowIso();
  const sourceCdk = db.cdks.find((item) => item.id === preview.sourceCdk.id);
  const targetCdk = db.cdks.find((item) => item.id === preview.targetCdk.id);

  if (!sourceCdk || !targetCdk) {
    throw new Error("充值目标发生变化，请刷新后重试");
  }

  const sourceTemplate = findTemplate(db, sourceCdk.templateId);
  if (!sourceTemplate) {
    throw new Error("来源 CDK 对应套餐不存在");
  }

  const applied = applyDirectRecharge(db, targetCdk, sourceCdk, sourceTemplate, input.mode);
  targetCdk.lastRechargeAt = timestamp;

  sourceCdk.disabled = true;
  sourceCdk.redeemedAt = sourceCdk.redeemedAt ?? timestamp;
  sourceCdk.expiresAt = timestamp;
  sourceCdk.effectiveDailyQuotaUsd = 0;
  sourceCdk.effectiveMonthlyQuotaUsd = 0;
  sourceCdk.effectiveTotalQuotaUsd = 0;
  sourceCdk.lastRechargeAt = timestamp;
  sourceCdk.note = `已充值到 ${targetCdk.code}（${getRechargeModeLabel(input.mode)}）`;
  sourceCdk.rechargeTargetCode = targetCdk.code;
  sourceCdk.rechargeMode = input.mode;
  sourceCdk.rechargeConfirmedAt = timestamp;
  targetCdk.sourceCdkCode = sourceCdk.code;
  syncPrimaryApiKey(db, sourceCdk);

  return {
    ...preview,
    after: snapshotRechargeState(targetCdk),
    currentTime: applied.currentTime,
    currentDailyQuotaUsd: applied.currentDailyQuotaUsd,
    sourceDailyQuotaUsd: applied.sourceDailyQuotaUsd,
    peakDailyQuotaUsd: applied.peakDailyQuotaUsd,
    combinedDailyQuotaUsd: applied.combinedDailyQuotaUsd,
    targetExpiresAtBefore: applied.targetExpiresAtBefore,
    finalExpiresAt: applied.finalExpiresAt,
    extensionDays: applied.extensionDays,
    overallBar: applied.overallBar,
    rows: applied.rows
  };
}

export function applyTemplateToCdk(cdk: Cdk, template: Template, mode: "new" | "recharge") {
  const now = new Date();
  const nowTime = now.getTime();

  if (!cdk.redeemedAt) {
    cdk.redeemedAt = now.toISOString();
  }

  if (mode === "new") {
    cdk.templateId = template.id;
    cdk.effectiveDailyQuotaUsd = template.dailyQuotaUsd;
    cdk.effectiveMonthlyQuotaUsd = template.monthlyQuotaUsd;
    cdk.effectiveTotalQuotaUsd = template.totalQuotaUsd;
    cdk.rechargeMode = null;
    cdk.rechargeConfirmedAt = null;
  } else {
    cdk.templateId = template.id;
    cdk.effectiveDailyQuotaUsd = addQuota(cdk.effectiveDailyQuotaUsd, template.dailyQuotaUsd);
    cdk.effectiveMonthlyQuotaUsd = addQuota(cdk.effectiveMonthlyQuotaUsd, template.monthlyQuotaUsd);
    cdk.effectiveTotalQuotaUsd = addQuota(cdk.effectiveTotalQuotaUsd, template.totalQuotaUsd);
    cdk.lastRechargeAt = now.toISOString();
  }

  if (template.durationDays) {
    const expiresBase = cdk.expiresAt ? new Date(cdk.expiresAt).getTime() : nowTime;
    const base = Math.max(expiresBase, nowTime);
    cdk.expiresAt = new Date(base + template.durationDays * 24 * 60 * 60 * 1000).toISOString();
  }

  if (mode === "new") {
    cdk.limitHistory = buildInitialLimitHistory(cdk.code, template, cdk.redeemedAt, cdk.expiresAt);
  }
}

export function applyInviteReward(cdk: Cdk, rewardTotalUsd: number) {
  cdk.inviteCount += 1;
  cdk.inviteRewardTotalUsd = Number((cdk.inviteRewardTotalUsd + rewardTotalUsd).toFixed(6));
  cdk.effectiveTotalQuotaUsd = addQuota(cdk.effectiveTotalQuotaUsd, rewardTotalUsd);
}

export function isExpired(cdk: Cdk) {
  return Boolean(cdk.expiresAt && new Date(cdk.expiresAt).getTime() <= Date.now());
}

export function createTemplate(input: {
  name: string;
  content?: string;
  durationDays?: number | null;
  rpm?: number | null;
  concurrentSessions?: number | null;
  dailyQuotaUsd?: number | null;
  weeklyQuotaUsd?: number | null;
  monthlyQuotaUsd?: number | null;
  totalQuotaUsd?: number | null;
  dailyResetMode?: DailyResetMode;
  dailyResetTime?: string;
  providerGroup?: string | null;
  contactText?: string | null;
  contactLink?: string | null;
  hideGroupInfo?: boolean;
  enabled?: boolean;
  allowNewPurchase?: boolean;
  allowRecharge?: boolean;
}) {
  const timestamp = nowIso();
  const template: Template = {
    id: makeId("tpl"),
    name: input.name,
    content: input.content ?? "",
    durationDays: input.durationDays ?? null,
    rpm: input.rpm ?? null,
    concurrentSessions: input.concurrentSessions ?? DEFAULT_CONCURRENT_SESSIONS,
    dailyQuotaUsd: input.dailyQuotaUsd ?? null,
    weeklyQuotaUsd: input.weeklyQuotaUsd ?? null,
    monthlyQuotaUsd: input.monthlyQuotaUsd ?? null,
    totalQuotaUsd: input.totalQuotaUsd ?? null,
    dailyResetMode: input.dailyResetMode ?? "fixed",
    dailyResetTime: input.dailyResetTime ?? "00:00",
    providerGroup: input.providerGroup ?? null,
    contactText: input.contactText ?? null,
    contactLink: input.contactLink ?? null,
    hideGroupInfo: input.hideGroupInfo ?? false,
    enabled: input.enabled ?? true,
    allowNewPurchase: input.allowNewPurchase ?? true,
    allowRecharge: input.allowRecharge ?? true,
    createdAt: timestamp,
    updatedAt: timestamp
  };
  return template;
}

export function generateCdkFromTemplate(template: Template) {
  const timestamp = nowIso();
  const cdk: Cdk = {
    id: makeId("cdk"),
    code: makeCdkCode(),
    templateId: template.id,
    localApiKey: makeLocalApiKey(),
    disabled: false,
    createdAt: timestamp,
    redeemedAt: null,
    expiresAt: null,
    usageCount: 0,
    totalCostUsd: 0,
    lastUsedAt: null,
    note: null,
    effectiveDailyQuotaUsd: template.dailyQuotaUsd,
    effectiveMonthlyQuotaUsd: template.monthlyQuotaUsd,
    effectiveTotalQuotaUsd: template.totalQuotaUsd,
    inviteCode: makeInviteCode(),
    inviteCount: 0,
    inviteRewardTotalUsd: 0,
    lastRechargeAt: null,
    sourceCdkCode: null,
    rechargeTargetCode: null,
    rechargeMode: null,
    rechargeConfirmedAt: null,
    limitHistory: null,
    upstreamUserId: null,
    upstreamUsername: null,
    upstreamTokenId: null,
    upstreamTokenName: null,
    upstreamTokenKey: null,
    upstreamQuotaFloor: null,
    upstreamProvisionedAt: null,
    sub2apiUserId: null,
    sub2apiEmail: null,
    sub2apiUsername: null,
    sub2apiProvisionedAt: null,
    sub2apiLastSyncAt: null,
    sub2apiBindings: []
  };
  return cdk;
}

export function generatePendingCdk(template: Template) {
  const timestamp = nowIso();
  return {
    id: makeId("cdk"),
    code: makeCdkCode(),
    templateId: template.id,
    localApiKey: makeLocalApiKey(),
    disabled: false,
    createdAt: timestamp,
    redeemedAt: null,
    expiresAt: null,
    usageCount: 0,
    totalCostUsd: 0,
    lastUsedAt: null,
    note: null,
    effectiveDailyQuotaUsd: template.dailyQuotaUsd,
    effectiveMonthlyQuotaUsd: template.monthlyQuotaUsd,
    effectiveTotalQuotaUsd: template.totalQuotaUsd,
    inviteCode: makeInviteCode(),
    inviteCount: 0,
    inviteRewardTotalUsd: 0,
    lastRechargeAt: null,
    sourceCdkCode: null,
    rechargeTargetCode: null,
    rechargeMode: null,
    rechargeConfirmedAt: null,
    limitHistory: null,
    upstreamUserId: null,
    upstreamUsername: null,
    upstreamTokenId: null,
    upstreamTokenName: null,
    upstreamTokenKey: null,
    upstreamQuotaFloor: null,
    upstreamProvisionedAt: null,
    sub2apiUserId: null,
    sub2apiEmail: null,
    sub2apiUsername: null,
    sub2apiProvisionedAt: null,
    sub2apiLastSyncAt: null,
    sub2apiBindings: []
  } satisfies Cdk;
}

export function getCdkUsage(db: Db, cdkId: string) {
  return db.usage
    .filter((item) => item.cdkId === cdkId)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export function getApiKeyUsage(db: Db, apiKeyId: string) {
  return db.usage
    .filter((item) => item.apiKeyId === apiKeyId)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

function withinDays(iso: string, days: number) {
  return new Date(iso).getTime() >= Date.now() - days * 24 * 60 * 60 * 1000;
}

function withinHours(iso: string, hours: number) {
  return new Date(iso).getTime() >= Date.now() - hours * 60 * 60 * 1000;
}

function getCurrentFixedResetWindowStart(dailyResetTime: string) {
  const [rawHour = "0", rawMinute = "0"] = dailyResetTime.split(":");
  const hour = Number(rawHour);
  const minute = Number(rawMinute);
  if (!Number.isInteger(hour) || !Number.isInteger(minute)) {
    return Date.now() - 24 * 60 * 60 * 1000;
  }

  const now = new Date();
  const start = new Date(now);
  start.setSeconds(0, 0);
  start.setHours(hour, minute, 0, 0);
  if (start.getTime() > now.getTime()) {
    start.setDate(start.getDate() - 1);
  }
  return start.getTime();
}

function isWithinCurrentDailyWindow(iso: string, mode: DailyResetMode, dailyResetTime: string) {
  const createdAt = new Date(iso).getTime();
  if (!Number.isFinite(createdAt)) return false;
  if (mode === "rolling") {
    return withinDays(iso, 1);
  }
  return createdAt >= getCurrentFixedResetWindowStart(dailyResetTime);
}

function getUsageCost(item: Pick<UsageRecord, "costUsd" | "estimatedCostUsd">) {
  return item.costUsd ?? item.estimatedCostUsd ?? 0;
}

function sumCost(records: UsageRecord[]) {
  return Number(records.reduce((sum, item) => sum + getUsageCost(item), 0).toFixed(6));
}

function sumTokens(records: UsageRecord[], key: "inputTokens" | "outputTokens" | "totalTokens") {
  return records.reduce((sum, item) => sum + (item[key] ?? 0), 0);
}

export function getApiKeyUsageSnapshot(db: Db, apiKey: ApiKey) {
  const records = getApiKeyUsage(db, apiKey.id);
  const cdk = db.cdks.find((item) => item.id === apiKey.cdkId) ?? null;
  const template = cdk ? findTemplate(db, cdk.templateId) : null;
  const dailyResetMode = template?.dailyResetMode ?? "fixed";
  const dailyResetTime = template?.dailyResetTime ?? "00:00";
  const cost5h = records.filter((item) => withinHours(item.createdAt, 5));
  const daily = records.filter((item) =>
    isWithinCurrentDailyWindow(item.createdAt, dailyResetMode, dailyResetTime)
  );
  const weekly = records.filter((item) => withinDays(item.createdAt, 7));
  const monthly = records.filter((item) => withinDays(item.createdAt, 30));

  return {
    cost5h: {
      current: sumCost(cost5h),
      limit: apiKey.limit5hUsd,
      resetAt: null
    },
    costDaily: {
      current: sumCost(daily),
      limit: apiKey.limitDailyUsd,
      resetAt: null
    },
    costWeekly: {
      current: sumCost(weekly),
      limit: apiKey.limitWeeklyUsd,
      resetAt: null
    },
    costMonthly: {
      current: sumCost(monthly),
      limit: apiKey.limitMonthlyUsd,
      resetAt: null
    },
    costTotal: {
      current: sumCost(records),
      limit: apiKey.limitTotalUsd,
      resetAt: null
    },
    concurrentSessions: {
      current: 0,
      limit: apiKey.limitConcurrentSessions
    },
    summary: {
      totalRequests: records.length,
      totalCost: sumCost(records),
      totalTokens: sumTokens(records, "totalTokens"),
      totalInputTokens: sumTokens(records, "inputTokens"),
      totalOutputTokens: sumTokens(records, "outputTokens")
    }
  };
}

export function getQuotaSnapshot(db: Db, cdk: Cdk) {
  const records = getCdkUsage(db, cdk.id);
  const template = findTemplate(db, cdk.templateId);
  const dailyResetMode = template?.dailyResetMode ?? "fixed";
  const dailyResetTime = template?.dailyResetTime ?? "00:00";
  const daily = records.filter((item) =>
    isWithinCurrentDailyWindow(item.createdAt, dailyResetMode, dailyResetTime)
  );
  const monthly = records.filter((item) => withinDays(item.createdAt, 30));
  const total = records;

  return {
    daily: {
      label: "当日额度",
      usedUsd: sumCost(daily),
      limitUsd: cdk.effectiveDailyQuotaUsd,
      remainingUsd:
        cdk.effectiveDailyQuotaUsd == null ? null : Math.max(cdk.effectiveDailyQuotaUsd - sumCost(daily), 0)
    },
    monthly: {
      label: "当月额度",
      usedUsd: sumCost(monthly),
      limitUsd: cdk.effectiveMonthlyQuotaUsd,
      remainingUsd:
        cdk.effectiveMonthlyQuotaUsd == null
          ? null
          : Math.max(cdk.effectiveMonthlyQuotaUsd - sumCost(monthly), 0)
    },
    total: {
      label: "总额度",
      usedUsd: sumCost(total),
      limitUsd: cdk.effectiveTotalQuotaUsd,
      remainingUsd:
        cdk.effectiveTotalQuotaUsd == null ? null : Math.max(cdk.effectiveTotalQuotaUsd - sumCost(total), 0)
    }
  };
}

export function hasQuotaAvailable(db: Db, cdk: Cdk) {
  const snapshot = getQuotaSnapshot(db, cdk);
  return [snapshot.daily, snapshot.monthly, snapshot.total].every((item) => {
    if (item.limitUsd == null) return true;
    return item.usedUsd < item.limitUsd;
  });
}

export function hasApiKeyQuotaAvailable(db: Db, apiKey: ApiKey) {
  const snapshot = getApiKeyUsageSnapshot(db, apiKey);
  const pairs = [
    [snapshot.cost5h.current, snapshot.cost5h.limit],
    [snapshot.costDaily.current, snapshot.costDaily.limit],
    [snapshot.costWeekly.current, snapshot.costWeekly.limit],
    [snapshot.costMonthly.current, snapshot.costMonthly.limit],
    [snapshot.costTotal.current, snapshot.costTotal.limit]
  ] as const;

  return pairs.every(([current, limit]) => limit == null || current < limit);
}

export function createChildApiKeyForCdk(
  db: Db,
  cdk: Cdk,
  input: {
    name: string;
    expiresAt?: string | null;
    limit5hUsd?: number | null;
    limitDailyUsd?: number | null;
    limitWeeklyUsd?: number | null;
    limitMonthlyUsd?: number | null;
    limitTotalUsd?: number | null;
    limitConcurrentSessions?: number | null;
  }
) {
  const timestamp = nowIso();
  const template = findTemplate(db, cdk.templateId);
  const apiKey: ApiKey = {
    id: makeId("key"),
    cdkId: cdk.id,
    name: input.name.trim(),
    key: makeChildApiKey(),
    isEnabled: true,
    expiresAt: input.expiresAt ?? cdk.expiresAt,
    canLoginWebUi: true,
    limit5hUsd: input.limit5hUsd ?? null,
    limitDailyUsd: input.limitDailyUsd ?? null,
    limitWeeklyUsd: input.limitWeeklyUsd ?? null,
    limitMonthlyUsd: input.limitMonthlyUsd ?? null,
    limitTotalUsd: input.limitTotalUsd ?? null,
    limitConcurrentSessions: input.limitConcurrentSessions ?? template?.concurrentSessions ?? null,
    providerGroup: template?.providerGroup ?? null,
    createdAt: timestamp,
    updatedAt: timestamp
  };
  db.apiKeys.push(apiKey);
  return apiKey;
}

export function updateChildApiKey(
  db: Db,
  apiKey: ApiKey,
  input: {
    name?: string;
    expiresAt?: string | null;
    limit5hUsd?: number | null;
    limitDailyUsd?: number | null;
    limitWeeklyUsd?: number | null;
    limitMonthlyUsd?: number | null;
    limitTotalUsd?: number | null;
    limitConcurrentSessions?: number | null;
  }
) {
  if (typeof input.name === "string" && input.name.trim()) {
    apiKey.name = input.name.trim();
  }
  if (input.expiresAt !== undefined) apiKey.expiresAt = input.expiresAt;
  if (input.limit5hUsd !== undefined) apiKey.limit5hUsd = input.limit5hUsd;
  if (input.limitDailyUsd !== undefined) apiKey.limitDailyUsd = input.limitDailyUsd;
  if (input.limitWeeklyUsd !== undefined) apiKey.limitWeeklyUsd = input.limitWeeklyUsd;
  if (input.limitMonthlyUsd !== undefined) apiKey.limitMonthlyUsd = input.limitMonthlyUsd;
  if (input.limitTotalUsd !== undefined) apiKey.limitTotalUsd = input.limitTotalUsd;
  if (input.limitConcurrentSessions !== undefined) apiKey.limitConcurrentSessions = input.limitConcurrentSessions;
  apiKey.updatedAt = nowIso();
  return apiKey;
}

export function deleteChildApiKey(db: Db, apiKeyId: string) {
  const index = db.apiKeys.findIndex((item) => item.id === apiKeyId);
  if (index < 0) return false;
  db.apiKeys.splice(index, 1);
  db.usage = db.usage.filter((item) => item.apiKeyId !== apiKeyId);
  return true;
}

export function recordUsage(
  db: Db,
  input: Omit<UsageRecord, "id" | "createdAt">
) {
  const createdAt = nowIso();
  const usage: UsageRecord = {
    id: makeId("use"),
    createdAt,
    ...input,
    costUsd: input.costUsd ?? null,
    estimatedCostUsd: input.estimatedCostUsd ?? null,
    costSource: input.costSource ?? null,
    ttfbMs: input.ttfbMs ?? null,
    cacheReadInputTokens: input.cacheReadInputTokens ?? null,
    cacheCreationInputTokens: input.cacheCreationInputTokens ?? null
  };
  db.usage.unshift(usage);

  const cdk = db.cdks.find((item) => item.id === usage.cdkId);
  if (cdk) {
    cdk.usageCount += 1;
    cdk.lastUsedAt = createdAt;
    cdk.totalCostUsd = Number((cdk.totalCostUsd + getUsageCost(usage)).toFixed(6));
  }

  return usage;
}
