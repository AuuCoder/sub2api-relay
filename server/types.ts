export type PaymentMode = "manual_review" | "mock_auto";
export type PaymentChannel = "manual" | "mock";
export type OrderMode = "new_purchase" | "recharge_existing";
export type OrderStatus = "pending" | "submitted" | "paid" | "cancelled";
export type RechargeMode = "extend_duration" | "boost_quota" | "overwrite";
export type DailyResetMode = "fixed" | "rolling";
export type UpstreamPlatform = "anthropic" | "openai" | "gemini" | "antigravity";

export const DEFAULT_CONCURRENT_SESSIONS = 5;

export type Sub2ApiBinding = {
  platform: UpstreamPlatform;
  groupId: number;
  groupName: string;
  subscriptionId: number | null;
  subscriptionExpiresAt: string | null;
  apiKeyId: number | null;
  apiKeyName: string | null;
  apiKeyStatus: string | null;
  apiKey: string | null;
};

export type SiteSettings = {
  title: string;
  appEnv: string;
  remoteWebUrl: string;
  qqGroupText: string;
  qqGroupUrl: string;
  qqGroupQrcodeAvailable: boolean;
  helpContent: string;
  paymentMode: PaymentMode;
  paymentChannelLabel: string;
  paymentAccountName: string | null;
  paymentAccountNo: string | null;
  paymentQrCodeUrl: string | null;
  paymentInstructions: string;
  inviteEnabled: boolean;
  inviteDiscountPercent: number;
  inviteRewardTotalUsd: number;
};

export type Template = {
  id: string;
  name: string;
  content: string;
  durationDays: number | null;
  rpm: number | null;
  concurrentSessions: number | null;
  dailyQuotaUsd: number | null;
  weeklyQuotaUsd: number | null;
  monthlyQuotaUsd: number | null;
  totalQuotaUsd: number | null;
  dailyResetMode: DailyResetMode;
  dailyResetTime: string;
  providerGroup: string | null;
  contactText: string | null;
  contactLink: string | null;
  hideGroupInfo: boolean;
  enabled: boolean;
  allowNewPurchase: boolean;
  allowRecharge: boolean;
  createdAt: string;
  updatedAt: string;
};

export type Cdk = {
  id: string;
  code: string;
  templateId: string;
  localApiKey: string;
  disabled: boolean;
  createdAt: string;
  redeemedAt: string | null;
  expiresAt: string | null;
  usageCount: number;
  totalCostUsd: number;
  lastUsedAt: string | null;
  note: string | null;
  effectiveDailyQuotaUsd: number | null;
  effectiveMonthlyQuotaUsd: number | null;
  effectiveTotalQuotaUsd: number | null;
  inviteCode: string;
  inviteCount: number;
  inviteRewardTotalUsd: number;
  lastRechargeAt: string | null;
  sourceCdkCode: string | null;
  rechargeTargetCode: string | null;
  rechargeMode: RechargeMode | null;
  rechargeConfirmedAt: string | null;
  limitHistory: LimitHistorySnapshot | null;
  upstreamUserId: number | null;
  upstreamUsername: string | null;
  upstreamTokenId: number | null;
  upstreamTokenName: string | null;
  upstreamTokenKey: string | null;
  upstreamQuotaFloor: number | null;
  upstreamProvisionedAt: string | null;
  sub2apiUserId: number | null;
  sub2apiEmail: string | null;
  sub2apiUsername: string | null;
  sub2apiProvisionedAt: string | null;
  sub2apiLastSyncAt: string | null;
  sub2apiBindings: Sub2ApiBinding[];
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

export type LimitHistorySnapshot = {
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

export type ApiKey = {
  id: string;
  cdkId: string;
  name: string;
  key: string;
  isEnabled: boolean;
  expiresAt: string | null;
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
};

export type Order = {
  id: string;
  orderNo: string;
  templateId: string;
  mode: OrderMode;
  cdkId: string | null;
  cdkCodeSnapshot: string | null;
  buyerName: string | null;
  buyerContact: string | null;
  paymentChannel: PaymentChannel;
  originalAmountCny: number;
  discountAmountCny: number;
  finalAmountCny: number;
  inviteCode: string | null;
  inviterCdkId: string | null;
  inviteRewardApplied: boolean;
  status: OrderStatus;
  createdCdkId: string | null;
  paymentReference: string | null;
  paymentNote: string | null;
  adminNote: string | null;
  submittedAt: string | null;
  paidAt: string | null;
  confirmedBy: string | null;
  createdAt: string;
  updatedAt: string;
};

export type UsageRecord = {
  id: string;
  cdkId: string;
  apiKeyId: string | null;
  path: string;
  model: string | null;
  statusCode: number | null;
  createdAt: string;
  durationMs: number;
  ttfbMs: number | null;
  inputTokens: number | null;
  outputTokens: number | null;
  cacheReadInputTokens: number | null;
  cacheCreationInputTokens: number | null;
  totalTokens: number | null;
  costUsd: number | null;
  estimatedCostUsd: number | null;
  requestId: string;
  clientKey: string;
  sessionId: string | null;
  retryCount: number | null;
  costSource: "actual" | "estimated" | null;
};

export type AdminUser = {
  username: string;
  passwordHash: string;
  createdAt: string;
};

export type Db = {
  site: SiteSettings;
  admins: AdminUser[];
  templates: Template[];
  cdks: Cdk[];
  apiKeys: ApiKey[];
  orders: Order[];
  usage: UsageRecord[];
};
