export type PublicSite = {
  title: string;
  appEnv: string;
  remoteWebUrl: string;
  qqGroupText: string;
  qqGroupUrl: string;
  qqGroupQrcodeAvailable: boolean;
  paymentMode: "manual_review" | "mock_auto";
  paymentChannelLabel: string;
  paymentAccountName: string | null;
  paymentAccountNo: string | null;
  paymentQrCodeUrl: string | null;
  paymentInstructions: string;
  inviteEnabled: boolean;
  inviteDiscountPercent: number;
  inviteRewardTotalUsd: number;
};

export type PaymentInfo = {
  paymentMode: "manual_review" | "mock_auto";
  paymentChannelLabel: string;
  paymentAccountName: string | null;
  paymentAccountNo: string | null;
  paymentQrCodeUrl: string | null;
  paymentInstructions: string;
};

export type Template = {
  id: string;
  name: string;
  content: string;
  templateType?: "daily_pass" | "weekly_pass" | "monthly_pass" | "token_pack" | null;
  template_type?: "daily_pass" | "weekly_pass" | "monthly_pass" | "token_pack" | null;
  durationDays: number | null;
  duration_days?: number | null;
  rpm?: number | null;
  concurrentSessions?: number | null;
  concurrent_sessions?: number | null;
  dailyQuotaUsd: number | null;
  daily_quota_usd?: number | null;
  weeklyQuotaUsd?: number | null;
  weekly_quota_usd?: number | null;
  monthlyQuotaUsd: number | null;
  monthly_quota_usd?: number | null;
  totalQuotaUsd: number | null;
  total_quota_usd?: number | null;
  dailyResetMode?: "fixed" | "rolling";
  daily_reset_mode?: "fixed" | "rolling";
  dailyResetTime?: string;
  daily_reset_time?: string;
  providerGroup: string | null;
  provider_group?: string | null;
  contactText: string | null;
  contact_text?: string | null;
  contactLink: string | null;
  contact_link?: string | null;
  hideGroupInfo?: boolean;
  hide_group_info?: boolean;
  enabled: boolean;
  allowNewPurchase: boolean;
  allow_new_purchase?: boolean;
  allowRecharge: boolean;
  allow_recharge?: boolean;
  createdAt: string;
  created_at?: string;
  updatedAt: string;
  updated_at?: string;
};

export type RechargeMode = "extend_duration" | "boost_quota" | "overwrite";

export type RechargeState = {
  expiresAt: string | null;
  effectiveDailyQuotaUsd: number | null;
  effectiveMonthlyQuotaUsd: number | null;
  effectiveTotalQuotaUsd: number | null;
};

export type LimitSegment = {
  label: string;
  startAt: string;
  endAt: string;
  dailyQuotaUsd: number | null;
};

export type LimitHistoryRow = {
  cdk: string;
  kind: "current" | "recharge";
  templateName: string | null;
  durationDays: number | null;
  dailyQuotaUsd: number | null;
  mode: RechargeMode | null;
  confirmedAt?: string | null;
  segments: LimitSegment[];
};

export type LimitHistory = {
  cdk: string;
  currentTime: string;
  activatedAt: string | null;
  originalExpiresAt: string | null;
  finalExpiresAt: string | null;
  overallBar: {
    label: string;
    segments: LimitSegment[];
  };
  rows: LimitHistoryRow[];
  steps: Array<{
    label: string;
    segments: LimitSegment[];
  }>;
};

export type RechargePreview = {
  mode: RechargeMode;
  sourceCdk: PublicCdk;
  sourceTemplate: Template;
  targetCdk: PublicCdk;
  targetTemplate: Template;
  before: RechargeState;
  after: RechargeState;
  change: {
    durationDays: number | null;
    dailyQuotaUsd: number | null;
    monthlyQuotaUsd: number | null;
    totalQuotaUsd: number | null;
  };
  currentTime: string;
  currentDailyQuotaUsd: number | null;
  sourceDailyQuotaUsd: number | null;
  peakDailyQuotaUsd: number | null;
  combinedDailyQuotaUsd: number | null;
  targetExpiresAtBefore: string | null;
  finalExpiresAt: string | null;
  extensionDays: number | null;
  overallBar: {
    label: string;
    segments: LimitSegment[];
  };
  rows: LimitHistoryRow[];
  summary: {
    modeLabel: string;
    keepsLocalApiKey: boolean;
    sourceWillBeDisabled: boolean;
  };
};

export type RechargePreviewResponse = {
  ok: true;
  data: RechargePreview;
};

export type RechargeConfirmResponse = {
  ok: true;
  message: string;
  targetCdk?: string;
  target_cdk?: string;
  preview: RechargePreview;
};

export type QuotaBlock = {
  label: string;
  usedUsd: number | null;
  limitUsd: number | null;
  remainingUsd: number | null;
  resetAt?: string | null;
  usageSource?: string | null;
};

export type UsageRecord = {
  id?: string;
  cdkId?: string;
  apiKeyId?: string | null;
  path?: string;
  model: string | null;
  upstreamModel?: string | null;
  endpoint?: string;
  statusCode: number | null;
  createdAt: string;
  durationMs: number | null;
  inputTokens: number | null;
  outputTokens: number | null;
  totalTokens: number | null;
  estimatedCostUsd?: number | null;
  costUsd?: number | null;
  requestId: string | null;
  clientKey?: string;
  sessionId: string | null;
  retryCount: number | null;
  providerName?: string | null;
  keyName?: string | null;
  requestType?: string | null;
  ttfbMs?: number | null;
  cacheReadInputTokens?: number | null;
  cacheCreationInputTokens?: number | null;
  costSource?: "actual" | "estimated" | null;
  context1mApplied?: boolean;
  specialSettings?: Array<Record<string, unknown>>;
};

export type PublicCdk = {
  id: string;
  code: string;
  localApiKey: string;
  local_api_key?: string;
  localApiKeyMasked: string;
  local_api_key_masked?: string;
  disabled: boolean;
  createdAt: string;
  created_at?: string;
  redeemedAt: string | null;
  redeemed_at?: string | null;
  expiresAt: string | null;
  expires_at?: string | null;
  usageCount: number;
  usage_count?: number;
  totalCostUsd: number;
  total_cost_usd?: number;
  lastUsedAt: string | null;
  last_used_at?: string | null;
  note: string | null;
  effectiveDailyQuotaUsd: number | null;
  effective_daily_quota_usd?: number | null;
  effectiveMonthlyQuotaUsd: number | null;
  effective_monthly_quota_usd?: number | null;
  effectiveTotalQuotaUsd: number | null;
  effective_total_quota_usd?: number | null;
  inviteCode: string;
  invite_code?: string;
  inviteCount: number;
  invite_count?: number;
  inviteRewardTotalUsd: number;
  invite_reward_total_usd?: number;
  lastRechargeAt: string | null;
  last_recharge_at?: string | null;
  sourceCdkCode?: string | null;
  source_cdk_code?: string | null;
  rechargeTargetCode?: string | null;
  recharge_target_code?: string | null;
  rechargeMode?: RechargeMode | null;
  recharge_mode?: RechargeMode | null;
  rechargeConfirmedAt?: string | null;
  recharge_confirmed_at?: string | null;
};

export type Order = {
  id: string;
  orderNo: string;
  mode: "new_purchase" | "recharge_existing";
  status: "pending" | "submitted" | "paid" | "cancelled";
  template: Template | null;
  cdkCodeSnapshot: string | null;
  originalAmountCny: number;
  discountAmountCny: number;
  finalAmountCny: number;
  buyerName: string | null;
  buyerContact: string | null;
  paymentChannel: "manual" | "mock";
  paymentReference: string | null;
  paymentNote: string | null;
  adminNote: string | null;
  inviteCode: string | null;
  inviterInviteCode: string | null;
  inviteRewardApplied: boolean;
  createdAt: string;
  updatedAt: string;
  submittedAt: string | null;
  paidAt: string | null;
  confirmedBy: string | null;
  cdk: PublicCdk | null;
  createdCdk: PublicCdk | null;
};

export type PublicCatalog = {
  site: PublicSite;
  payment: PaymentInfo;
  invite: {
    enabled: boolean;
    discountPercent: number;
    rewardTotalUsd: number;
  };
  templates: Template[];
};

export type OrderPreview = {
  mode: "new_purchase" | "recharge_existing";
  template: Template;
  targetCdk: PublicCdk | null;
  inviter: {
    inviteCode: string;
  } | null;
  payment: PaymentInfo;
  originalAmountCny: number;
  discountAmountCny: number;
  finalAmountCny: number;
  paymentChannel: "manual" | "mock";
};

export type RechargeUsage = {
  targetCdk?: string;
  target_cdk?: string;
  mode?: RechargeMode | null;
  confirmedAt?: string | null;
  confirmed_at?: string | null;
  message?: string;
};

export type RedeemDetail = {
  cdk: PublicCdk;
  template: Template;
  quotas?: {
    daily: QuotaBlock;
    monthly: QuotaBlock;
    total: QuotaBlock;
  };
  stats?: {
    totalRequests: number;
    totalCostUsd: number;
    lastUsedAt: string | null;
  };
  quickstart?: {
    baseUrl: string;
    header: string;
    curl: string;
  };
  invite?: {
    enabled: boolean;
    inviteCode: string;
    inviteDiscountPercent: number;
    inviteRewardTotalUsd: number;
    inviteCount: number;
    inviteRewardAppliedUsd: number;
  };
  payment?: PaymentInfo;
  rechargeTemplates?: Template[];
  recentOrders?: Order[];
  remote_api_key: string | null;
  remote_web_url: string | null;
  content: string;
  qq_group_text: string | null;
  qq_group_url: string | null;
  qq_group_qrcode_available: boolean;
  hide_group_info: boolean;
  used_at: string | null;
  recharge_usage: RechargeUsage | null;
};

export type UsageSummaryResponse = {
  ok: true;
  data: {
    userId: string;
    userName: string;
    expiresAt: string | null;
    dailyResetMode: "fixed" | "rolling";
    dailyResetTime: string;
    rpm: number | null;
    limitConcurrentSessions: number | null;
    activeSessionCount: number | null;
    quotas: {
      daily: QuotaBlock;
      weekly: QuotaBlock;
      monthly: QuotaBlock;
      total: QuotaBlock;
    };
    recentUsage: UsageRecord[];
    partialErrors: Array<{ scope: string; message: string }>;
    fetchedAt: string;
    snapshot: {
      lastSyncedAt: string;
      syncSource: string;
      ageSeconds: number;
      cacheHit: boolean;
      cacheFresh: boolean;
      usedForStaticFields: boolean;
      refreshSource: string;
      fallbackUsed: boolean;
      activeSessionCount: number | null;
      activeSessionLastSyncedAt: string | null;
    };
    finalExpiresAt: string | null;
    quotaChangeTimeline: LimitHistoryRow[];
  };
};

export type RecentUsageResponse = {
  ok: true;
  data: {
    items: UsageRecord[];
    meta: {
      page: number;
      pageSize: number;
      total: number;
      totalPages: number;
      maxPages: number;
    };
    filters: {
      model: string | null;
      statusCode: number | null;
      availableModels: string[];
      availableStatusCodes: number[];
    };
  };
};

export type LimitHistoryResponse = {
  ok: true;
  data: LimitHistory;
};

export type ApiKeyUsage = {
  cost5h: { current: number; limit: number | null; resetAt: string | null };
  costDaily: { current: number; limit: number | null; resetAt: string | null };
  costWeekly: { current: number; limit: number | null; resetAt: string | null };
  costMonthly: { current: number; limit: number | null; resetAt: string | null };
  costTotal: { current: number; limit: number | null; resetAt: string | null };
  concurrentSessions: { current: number; limit: number | null };
  summary: {
    totalRequests: number;
    totalCost: number;
    totalTokens: number;
    totalInputTokens: number;
    totalOutputTokens: number;
  };
};

export type ApiKeyItem = {
  id: string;
  userId: string;
  key: string;
  name: string;
  isEnabled: boolean;
  expiresAt: string | null;
  effectiveExpiresAt: string | null;
  canLoginWebUi: boolean;
  limit5hUsd: number | null;
  limitDailyUsd: number | null;
  limitWeeklyUsd: number | null;
  limitMonthlyUsd: number | null;
  limitTotalUsd: number | null;
  limitConcurrentSessions: number | null;
  providerGroup: string | null;
  createdAt: string;
  updatedAt: string;
  isPrimary: boolean;
  usage: ApiKeyUsage;
};

export type ApiKeysResponse = {
  ok: true;
  data: {
    cdk: string;
    userId: string;
    userName: string;
    primaryKeyId: string | null;
    primaryExpiresAt: string | null;
    primaryLimits: {
      limit5hUsd: number | null;
      limitDailyUsd: number | null;
      limitWeeklyUsd: number | null;
      limitMonthlyUsd: number | null;
      limitTotalUsd: number | null;
      limitConcurrentSessions: number | null;
    };
    items: ApiKeyItem[];
  };
};

export type SessionInfo = {
  is_admin: boolean;
  username: string | null;
  csrfToken?: string | null;
  createdAt?: string | null;
  expiresAt?: string | null;
  lastSeenAt?: string | null;
  idleExpiresAt?: string | null;
  secureCookie?: boolean;
  sameSite?: "lax" | "strict" | "none";
  writeProtectionEnabled?: boolean;
  csrfProtectionEnabled?: boolean;
  sessionTtlMinutes?: number;
  idleTimeoutMinutes?: number;
  credentialRotationRecommended?: boolean;
};

export type AdminTemplateSummary = Template & {
  cdkCount: number;
  redeemedCount: number;
  usageCount: number;
  cdks: PublicCdk[];
};

export type AdminDashboard = {
  stats: {
    templateCount: number;
    cdkCount: number;
    activeCdkCount: number;
    orderCount: number;
    pendingOrderCount: number;
    usageCount: number;
    totalCostUsd: number;
    upstreamMode: string;
    paymentMode: "manual_review" | "mock_auto";
  };
  security: {
    allowedOrigins: string[];
    loginMaxFailures: number;
    lockoutMinutes: number;
    sessionTtlMinutes: number;
    idleTimeoutMinutes: number;
  };
  site: PublicSite;
  templates: AdminTemplateSummary[];
  recentUsage: UsageRecord[];
  recentOrders: Order[];
};
