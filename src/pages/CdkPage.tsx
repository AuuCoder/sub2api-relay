import { useEffect, useMemo, useState } from "react";
import { Activity, ChevronLeft, ChevronRight, Gauge, KeyRound, Link2, RefreshCw } from "lucide-react";
import { useNavigate, useParams } from "react-router-dom";
import { AppLayout } from "../components/Layout";
import { CopyField, LimitTimeline, MarkdownContent, Modal, StatusBadge } from "../components/PublicUi";
import { getJson, HttpError, postJson } from "../lib/api";
import {
  cn,
  ensureV1Url,
  extractCdkCode,
  formatCompact,
  formatDate,
  formatDurationMs,
  formatInteger,
  formatMoney,
  formatUsageCost,
  formatUsageUsd,
  isExpiredAt,
  maskSecret,
  rememberCdk
} from "../lib/utils";
import type {
  RecentUsageResponse,
  RechargeConfirmResponse,
  RechargeMode,
  RechargePreview,
  RechargePreviewResponse,
  RedeemDetail,
  UsageRecord,
  UsageSummaryResponse
} from "../types";

const rechargeModes: Array<{ value: RechargeMode; label: string }> = [
  { value: "extend_duration", label: "叠加时长" },
  { value: "boost_quota", label: "叠加额度" },
  { value: "overwrite", label: "覆盖充值" }
];

export function CdkPage() {
  const navigate = useNavigate();
  const { cdk = "" } = useParams();
  const [detail, setDetail] = useState<RedeemDetail | null>(null);
  const [summary, setSummary] = useState<UsageSummaryResponse["data"] | null>(null);
  const [recent, setRecent] = useState<RecentUsageResponse["data"] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [summaryLoading, setSummaryLoading] = useState(false);
  const [recentLoading, setRecentLoading] = useState(false);
  const [activateLoading, setActivateLoading] = useState(false);
  const [rechargeOpen, setRechargeOpen] = useState(false);
  const [refreshNonce, setRefreshNonce] = useState(0);
  const [recentPage, setRecentPage] = useState(1);
  const [recentModel, setRecentModel] = useState("all");
  const [recentStatusCode, setRecentStatusCode] = useState("all");

  const navItems = useMemo(
    () => [
      { label: "激活首页", to: `/${encodeURIComponent(cdk)}` },
      { label: "限额变化历史", to: `/${encodeURIComponent(cdk)}/history` },
      { label: "API Key管理", to: `/${encodeURIComponent(cdk)}/keys` }
    ],
    [cdk]
  );

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    setDetail(null);
    setSummary(null);
    setRecent(null);

    getJson<RedeemDetail>(`/api/redeem/${encodeURIComponent(cdk)}`)
      .then((payload) => {
        if (cancelled) return;
        setDetail(payload);
      })
      .catch((cause) => {
        if (cancelled) return;
        setError(cause instanceof HttpError ? cause.message : "该 CDK 无效或不存在");
      })
      .finally(() => {
        if (cancelled) return;
        setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [cdk, refreshNonce]);

  useEffect(() => {
    setRecentPage(1);
    setRecentModel("all");
    setRecentStatusCode("all");
  }, [cdk]);

  useEffect(() => {
    if (!detail?.used_at || detail.recharge_usage) return;

    let cancelled = false;
    setSummaryLoading(true);

    getJson<UsageSummaryResponse>(`/api/redeem/${encodeURIComponent(cdk)}/usage-summary`)
      .then((payload) => {
        if (cancelled) return;
        setSummary(payload.data);
      })
      .catch(() => {
        if (cancelled) return;
        setSummary(null);
      })
      .finally(() => {
        if (cancelled) return;
        setSummaryLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [cdk, detail?.used_at, detail?.recharge_usage, refreshNonce]);

  useEffect(() => {
    if (!detail?.used_at || detail.recharge_usage) return;

    let cancelled = false;
    setRecentLoading(true);

    const params = new URLSearchParams({
      page: String(recentPage),
      pageSize: "20",
      model: recentModel,
      status_code: recentStatusCode
    });

    getJson<RecentUsageResponse>(`/api/redeem/${encodeURIComponent(cdk)}/recent-usage?${params.toString()}`)
      .then((payload) => {
        if (cancelled) return;
        setRecent(payload.data);
      })
      .catch(() => {
        if (cancelled) return;
        setRecent(null);
      })
      .finally(() => {
        if (cancelled) return;
        setRecentLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [cdk, detail?.used_at, detail?.recharge_usage, recentModel, recentPage, recentStatusCode, refreshNonce]);

  useEffect(() => {
    if (!detail?.used_at || detail.recharge_usage) return;
    rememberCdk(cdk);
  }, [cdk, detail?.used_at, detail?.recharge_usage]);

  const expired = isExpiredAt(summary?.finalExpiresAt ?? detail?.cdk.expiresAt ?? null);
  const support = getSupport(detail);
  const endpoint = ensureV1Url(detail?.remote_web_url);
  const chips = getTemplateChips(detail?.template);
  const currentCode = detail ? extractCdkCode(detail.cdk.code) : cdk;
  const packageUsageSummary = buildPackageUsageSummary(detail, summary);
  const activeUsageSummary = summary
    ? [
        {
          label: "Session数",
          value: getActiveSessionDisplay(summary)
        },
        {
          label: "Session 上限",
          value: getSessionLimitDisplay(detail, summary)
        },
        {
          label: "RPM",
          value: getRpmDisplay(detail, summary)
        }
      ]
    : [];
  const visibleQuotas = summary ? getVisibleQuotaRows(summary) : [];

  async function activate() {
    setActivateLoading(true);
    try {
      await postJson(`/api/redeem/${encodeURIComponent(cdk)}/activate`, {});
      setRefreshNonce((value) => value + 1);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "激活失败");
    } finally {
      setActivateLoading(false);
    }
  }

  return (
    <AppLayout navItems={navItems} wide>
      {loading ? (
        <CenteredCard text="正在加载 CDK 信息..." />
      ) : error || !detail ? (
        <CenteredError text={error ?? "该 CDK 无效或不存在"} />
      ) : !detail.template ? (
        <CenteredError text="该 CDK 未绑定模板，无法激活。" />
      ) : !detail.used_at ? (
        <section className="activation-wrap">
          <div className="activation-copy">
            <h1 className="page-title">激活你的 CDK</h1>
            <div className="chip-row">
              {chips.map((chip) => (
                <span key={chip.label} className="stat-chip">
                  <span>{chip.label}</span>
                  <strong>{chip.value}</strong>
                </span>
              ))}
            </div>
          </div>

          <div className="activation-grid">
            <section className="surface-card-strong panel-card">
              <div className="card-header-block">
                <h2>确认并开始激活</h2>
                <span className="stat-chip">{detail.template.name}</span>
              </div>

              <div className="toolbar-strip">
                <div className="toolbar-row">
                  <span>当前 CDK</span>
                  <code className="code-pill">{currentCode}</code>
                </div>
              </div>

              <div className="stack-actions">
                <button type="button" className="primary-button" onClick={() => void activate()} disabled={activateLoading}>
                  {activateLoading ? "激活中..." : "开始激活"}
                </button>
                <button type="button" className="secondary-button" onClick={() => setRechargeOpen(true)}>
                  充值到CDK链接
                </button>
              </div>
            </section>

            {support ? (
              <section className="surface-card panel-card support-card">
                <div className="card-header-block">
                  <h2>联系支持</h2>
                </div>
                <a href={support.link} target="_blank" rel="noreferrer" className="support-link">
                  <span>{support.text}</span>
                  <small>{support.link}</small>
                </a>
              </section>
            ) : null}
          </div>

          <RechargeModal
            open={rechargeOpen}
            onClose={() => setRechargeOpen(false)}
            currentCode={detail.cdk.code}
            currentTemplateName={detail.template.name}
            direction="source"
            onConfirmed={(targetCode) => {
              setRechargeOpen(false);
              navigate(`/${encodeURIComponent(targetCode)}`);
            }}
          />
        </section>
      ) : detail.recharge_usage ? (
        <section className="public-stack">
          <section className="surface-card-strong status-panel">
            <div className="status-copy">
              <div className="status-headline">
                <h1>CDK 已使用</h1>
                <StatusBadge tone="neutral">已用于充值</StatusBadge>
              </div>
              <p className="muted-line">使用时间：{formatDate(detail.recharge_usage.confirmed_at ?? detail.used_at)}</p>
              <div className="chip-row">
                <span className="stat-chip">{detail.template.name}</span>
                {detail.recharge_usage.mode ? (
                  <span className="stat-chip">{getRechargeModeLabel(detail.recharge_usage.mode)}</span>
                ) : null}
                {(detail.recharge_usage.target_cdk ?? detail.recharge_usage.targetCdk) ? (
                  <code className="code-pill">
                    {detail.recharge_usage.target_cdk ?? detail.recharge_usage.targetCdk}
                  </code>
                ) : null}
              </div>
            </div>
          </section>

          <section className="surface-card panel-card">
            <div className="card-header-block">
              <h2>已用于充值</h2>
            </div>
            <div className="toolbar-strip">
              该 CDK 已用于为 {detail.recharge_usage.target_cdk ?? detail.recharge_usage.targetCdk} 充值。
            </div>
          </section>
        </section>
      ) : (
        <section className="public-stack">
          <section className="surface-card-strong status-panel">
            <div className="status-copy">
              <div className="status-headline">
                <h1>CDK 已激活</h1>
                <StatusBadge tone={expired ? "warning" : "success"}>{expired ? "已过期" : "已激活"}</StatusBadge>
              </div>
              <p className="muted-line">激活时间：{formatDate(detail.used_at)}</p>
              <div className="chip-row">
                <span className="stat-chip">{detail.template.name}</span>
                <button type="button" className="secondary-button is-inline" onClick={() => setRechargeOpen(true)}>
                  充值到此CDK链接
                </button>
              </div>
            </div>
            {support ? (
              <a href={support.link} target="_blank" rel="noreferrer" className="support-inline">
                <span>{support.text}</span>
                <small>{support.link}</small>
              </a>
            ) : null}
          </section>

          <div className="overview-grid">
            <section className="surface-card panel-card">
              <div className="section-head">
                <div className="section-title">
                  <Gauge size={16} />
                  <h2>配额与使用情况</h2>
                </div>
                {summaryLoading ? <RefreshCw className="spin" size={16} /> : null}
              </div>

              {summary ? (
                <>
                  <div className="stat-grid">
                    {[...packageUsageSummary, ...activeUsageSummary].map((item) => (
                      <InfoTile key={item.label} label={item.label} value={item.value} />
                    ))}
                  </div>

                  <div className="quota-list">
                    {visibleQuotas.map((quota) => (
                      <QuotaRow key={quota.label} quota={quota} />
                    ))}
                  </div>

                  <PartialErrorStrip items={summary.partialErrors} />
                </>
              ) : (
                <div className="toolbar-strip">暂无配额数据</div>
              )}
            </section>

            <section className="surface-card panel-card">
              <div className="section-head">
                <div className="section-title">
                  <Link2 size={16} />
                  <h2>接入信息</h2>
                </div>
              </div>

              {detail.remote_api_key ? (
                <CopyField label="API Key" value={detail.remote_api_key} displayValue={maskSecret(detail.remote_api_key)} />
              ) : null}
              {endpoint ? <CopyField label="接入地址" value={endpoint} /> : null}
            </section>
          </div>

          <section className="surface-card panel-card">
            <div className="section-head">
              <div className="section-title">
                <Activity size={16} />
                <h2>近期调用</h2>
              </div>
              <button
                type="button"
                className="secondary-button is-inline"
                onClick={() => setRefreshNonce((value) => value + 1)}
                disabled={recentLoading}
              >
                {recentLoading ? "刷新中..." : "获取调用日志"}
              </button>
            </div>

            <UsageTablePanel
              data={recent}
              loading={recentLoading}
              modelFilter={recentModel}
              statusFilter={recentStatusCode}
              onModelFilterChange={(value) => {
                setRecentPage(1);
                setRecentModel(value);
              }}
              onStatusFilterChange={(value) => {
                setRecentPage(1);
                setRecentStatusCode(value);
              }}
              onPageChange={setRecentPage}
            />
          </section>

          {detail.content ? (
            <section className="surface-card panel-card">
              <div className="section-head">
                <div className="section-title">
                  <KeyRound size={16} />
                  <h2>说明内容</h2>
                </div>
              </div>
              <MarkdownContent content={detail.content} />
            </section>
          ) : null}

          <RechargeModal
            open={rechargeOpen}
            onClose={() => setRechargeOpen(false)}
            currentCode={detail.cdk.code}
            currentTemplateName={detail.template.name}
            direction="target"
            onConfirmed={() => {
              setRechargeOpen(false);
              setRefreshNonce((value) => value + 1);
            }}
          />
        </section>
      )}
    </AppLayout>
  );
}

function RechargeModal({
  open,
  onClose,
  currentCode,
  currentTemplateName,
  direction,
  onConfirmed
}: {
  open: boolean;
  onClose: () => void;
  currentCode: string;
  currentTemplateName: string;
  direction: "source" | "target";
  onConfirmed: (targetCode: string) => void;
}) {
  const [targetInput, setTargetInput] = useState("");
  const [mode, setMode] = useState<RechargeMode>("extend_duration");
  const [preview, setPreview] = useState<RechargePreview | null>(null);
  const [loading, setLoading] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) {
      setTargetInput("");
      setMode("extend_duration");
      setPreview(null);
      setError(null);
      setLoading(false);
      setConfirming(false);
    }
  }, [open]);

  async function loadPreview() {
    const otherCode = extractCdkCode(targetInput);
    if (!otherCode) return;

    setLoading(true);
    setError(null);
    setPreview(null);

    try {
      const payload = await postJson<RechargePreviewResponse>("/api/redeem/recharge/preview", {
        source_cdk: direction === "source" ? currentCode : otherCode,
        target_cdk: direction === "source" ? otherCode : currentCode,
        mode
      });
      setPreview(payload.data);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "预览失败");
    } finally {
      setLoading(false);
    }
  }

  async function confirmRecharge() {
    const otherCode = extractCdkCode(targetInput);
    if (!otherCode) return;
    if (mode === "overwrite" && !window.confirm("覆盖充值会直接替换当前套餐，确认继续吗？")) return;

    setConfirming(true);
    setError(null);

    try {
      const payload = await postJson<RechargeConfirmResponse>("/api/redeem/recharge/confirm", {
        source_cdk: direction === "source" ? currentCode : otherCode,
        target_cdk: direction === "source" ? otherCode : currentCode,
        mode
      });
      onConfirmed(payload.target_cdk ?? payload.targetCdk ?? otherCode);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "充值失败");
    } finally {
      setConfirming(false);
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={direction === "source" ? "充值到CDK链接" : "充值到此CDK链接"}
      description={direction === "source" ? "输入充值对象CDK链接，再选择充值方式。" : "输入充值用的新CDK链接，再选择充值方式。"}
      footer={
        <>
          <button type="button" className="secondary-button is-inline" onClick={onClose}>
            关闭
          </button>
          <button
            type="button"
            className="primary-button is-inline"
            disabled={loading || confirming || !extractCdkCode(targetInput)}
            onClick={() => void (preview ? confirmRecharge() : loadPreview())}
          >
            {loading || confirming ? "处理中..." : preview ? (mode === "overwrite" ? "继续确认" : "确认充值") : "预览"}
          </button>
        </>
      }
    >
      <div className="modal-stack">
        <label className="field-block">
          <span>{direction === "source" ? "充值对象CDK链接" : "新 CDK链接"}</span>
          <input value={targetInput} onChange={(event) => setTargetInput(event.target.value)} placeholder="请输入 CDK 或完整链接" />
        </label>

        <div className="mode-row">
          {rechargeModes.map((item) => (
            <button
              key={item.value}
              type="button"
              className={cn("mode-chip", mode === item.value && "is-active")}
              onClick={() => {
                setMode(item.value);
                setPreview(null);
                setError(null);
              }}
            >
              {item.label}
            </button>
          ))}
        </div>

        <div className="toolbar-strip">
          当前卡：<code className="code-pill">{currentCode}</code>
          <span className="spacer" />
          <span className="stat-chip">{currentTemplateName}</span>
        </div>

        {error ? <div className="error-banner">{error}</div> : null}

        {preview ? (
          <div className="preview-stack">
            <div className="stat-grid">
              <InfoTile label="模式" value={preview.summary.modeLabel} />
              <InfoTile label={mode === "overwrite" ? "覆盖后日额" : "峰值日额"} value={formatMoney(mode === "overwrite" ? preview.combinedDailyQuotaUsd : preview.peakDailyQuotaUsd)} />
              <InfoTile label={mode === "overwrite" ? "覆盖提醒" : "折算时长"} value={mode === "overwrite" ? "清空旧套餐" : preview.extensionDays == null ? "-" : `${preview.extensionDays.toFixed(1)}天`} />
            </div>

            <div className="toolbar-strip">{getRechargePreviewNote(preview)}</div>

            <div className="compare-grid">
              <CompareCard title="充值前" state={preview.before} />
              <CompareCard title="充值后" state={preview.after} />
            </div>

            <LimitTimeline
              segments={preview.overallBar.segments}
              currentTime={preview.currentTime}
              originalExpiresAt={preview.targetExpiresAtBefore}
            />
          </div>
        ) : null}
      </div>
    </Modal>
  );
}

function CompareCard({ title, state }: { title: string; state: { expiresAt: string | null; effectiveDailyQuotaUsd: number | null; effectiveMonthlyQuotaUsd: number | null; effectiveTotalQuotaUsd: number | null } }) {
  return (
    <div className="surface-card compare-card">
      <p className="page-kicker">{title}</p>
      <div className="compare-lines">
        <div>
          <span>到期时间</span>
          <strong>{formatDate(state.expiresAt)}</strong>
        </div>
        <div>
          <span>日额度</span>
          <strong>{formatMoney(state.effectiveDailyQuotaUsd)}</strong>
        </div>
        <div>
          <span>月额度</span>
          <strong>{formatMoney(state.effectiveMonthlyQuotaUsd)}</strong>
        </div>
        <div>
          <span>总额度</span>
          <strong>{formatMoney(state.effectiveTotalQuotaUsd)}</strong>
        </div>
      </div>
    </div>
  );
}

function QuotaRow({ quota }: { quota: { label: string; usedUsd: number | null; limitUsd: number | null; remainingUsd: number | null; resetAt?: string | null } }) {
  const used = quota.usedUsd ?? 0;
  const limit = quota.limitUsd ?? 0;
  const width = quota.limitUsd == null || limit <= 0 ? 0 : Math.max(0, Math.min(100, (used / limit) * 100));
  const percent = quota.limitUsd == null || limit <= 0 || quota.usedUsd == null ? "" : `${width.toFixed(1)}%`;

  return (
    <div className="quota-row">
      <div className="quota-summary">
        <div className="quota-primary">
          <p>{quota.label}</p>
          <div className="quota-value-line">
            <strong>{quota.remainingUsd == null ? formatMoney(quota.limitUsd) : formatMoney(quota.remainingUsd)}</strong>
            <span className={cn("status-pill", getQuotaStatusClass(quota))}>
              {quota.remainingUsd != null ? "剩余" : "未返回"}
            </span>
          </div>
        </div>
        <div className="quota-progress">
          <div className="quota-progress-meta">
            {quota.usedUsd != null ? <span>已用 {formatUsageUsd(quota.usedUsd)}</span> : <span />}
            <span>{percent}</span>
          </div>
          <div className="quota-bar">
            <div className="quota-fill" style={{ width: `${width}%` }} />
          </div>
        </div>
      </div>

      <div className="quota-meta">
        {quota.usedUsd != null ? (
          <div className="quota-meta-item">
            <p>已用</p>
            <strong>{formatUsageUsd(quota.usedUsd)}</strong>
          </div>
        ) : null}
        {quota.limitUsd != null ? (
          <div className="quota-meta-item">
            <p>上限</p>
            <strong>{formatMoney(quota.limitUsd)}</strong>
          </div>
        ) : null}
        {quota.resetAt ? (
          <div className="quota-meta-item">
            <p>重置额度时间</p>
            <strong>{formatDate(quota.resetAt)}</strong>
          </div>
        ) : null}
      </div>
    </div>
  );
}

function InfoTile({ label, value }: { label: string; value: string }) {
  return (
    <div className="info-tile">
      <p className="page-kicker">{label}</p>
      <strong>{value}</strong>
    </div>
  );
}

function CenteredCard({ text }: { text: string }) {
  return (
    <div className="center-panel">
      <div className="surface-card-strong center-card">{text}</div>
    </div>
  );
}

function CenteredError({ text }: { text: string }) {
  return (
    <div className="center-panel">
      <div className="surface-card-strong center-card is-error">{text}</div>
    </div>
  );
}

function PartialErrorStrip({ items }: { items: Array<{ scope: string; message: string }> }) {
  if (!items.length) return null;

  return (
    <div className="toolbar-strip partial-error-strip">
      <span className="stat-chip">部分数据暂不可用</span>
      {items.slice(0, 3).map((item) => (
        <span key={`${item.scope}-${item.message}`}>{item.scope}: {item.message}</span>
      ))}
    </div>
  );
}

function UsageTablePanel({
  data,
  loading,
  modelFilter,
  statusFilter,
  onModelFilterChange,
  onStatusFilterChange,
  onPageChange
}: {
  data: RecentUsageResponse["data"] | null;
  loading: boolean;
  modelFilter: string;
  statusFilter: string;
  onModelFilterChange: (value: string) => void;
  onStatusFilterChange: (value: string) => void;
  onPageChange: (page: number) => void;
}) {
  const rows = data?.items ?? [];
  const meta = data?.meta ?? { page: 1, pageSize: 20, total: 0, totalPages: 0, maxPages: 50 };
  const filters = data?.filters ?? { availableModels: [], availableStatusCodes: [] };
  const filterCount = Number(modelFilter !== "all") + Number(statusFilter !== "all");

  return (
    <div className="usage-table-font">
      <div className="usage-table-shell usage-toolbar-shell">
        <div className="usage-toolbar-row">
          <div className="usage-toolbar-left">
            <span className="usage-kpi">
              <span className="usage-kpi-label">记录</span>
              <span className="usage-kpi-value">{meta.total}</span>
            </span>
            {filterCount > 0 ? (
              <span className="usage-kpi">
                <span className="usage-kpi-label">筛选</span>
                <span className="usage-kpi-value">{filterCount}</span>
              </span>
            ) : null}
            <select className="usage-filter" value={modelFilter} onChange={(event) => onModelFilterChange(event.target.value)} disabled={loading}>
              <option value="all">全部模型</option>
              {filters.availableModels.map((item) => (
                <option key={item} value={item}>
                  {item}
                </option>
              ))}
            </select>
            <select className="usage-filter" value={statusFilter} onChange={(event) => onStatusFilterChange(event.target.value)} disabled={loading}>
              <option value="all">全部状态</option>
              {filters.availableStatusCodes.map((item) => (
                <option key={item} value={`${item}`}>
                  {item}
                </option>
              ))}
            </select>
          </div>

          <div className="usage-pagination">
            <button type="button" className="icon-button" onClick={() => onPageChange(Math.max(1, meta.page - 1))} disabled={loading || meta.page <= 1}>
              <ChevronLeft size={16} />
            </button>
            <span className="usage-page-indicator">
              {meta.totalPages === 0 ? 0 : meta.page} / {meta.totalPages}
            </span>
            <button
              type="button"
              className="icon-button"
              onClick={() => onPageChange(Math.min(meta.totalPages || 1, meta.page + 1))}
              disabled={loading || meta.totalPages === 0 || meta.page >= meta.totalPages}
            >
              <ChevronRight size={16} />
            </button>
          </div>
        </div>
      </div>

      {loading && !data ? (
        <div className="usage-table-shell usage-empty">正在读取调用日志...</div>
      ) : !rows.length ? (
        <div className="usage-table-shell usage-empty">暂无近期调用记录</div>
      ) : (
        <div className="usage-table-shell usage-table-panel">
          <div className="usage-grid usage-grid-head">
            <span>请求</span>
            <span>模型</span>
            <span>Tokens</span>
            <span>Cache</span>
            <span>性能</span>
            <span className="is-right">成本</span>
            <span className="is-right">状态</span>
          </div>

          <div className="usage-rows">
            {rows.map((item, index) => (
              <UsageRow key={`${item.createdAt}-${item.sessionId ?? item.requestId ?? index}`} item={item} />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function UsageRow({ item }: { item: UsageRecord }) {
  const flags = getUsageFlags(item);

  return (
    <div className="usage-grid usage-row">
      <div className="usage-cell">
        <span className="usage-mobile-label">请求</span>
        <p className="usage-primary">{formatDate(item.createdAt)}</p>
        <div className="usage-substack">
          <p>{truncateRequestId(item.sessionId ?? item.requestId)}</p>
          <p>{item.endpoint ?? item.path ?? "-"}</p>
        </div>
      </div>

      <div className="usage-cell">
        <span className="usage-mobile-label">模型</span>
        <p className="usage-primary">{item.model ?? "未返回模型"}</p>
        <div className="usage-substack">
          <p>{item.providerName ?? "-"}</p>
          <p>{getUsageModelDetail(item)}</p>
        </div>
      </div>

      <div className="usage-cell">
        <span className="usage-mobile-label">Tokens</span>
        <p className="usage-primary usage-mono">
          {formatCompact(item.inputTokens)} / {formatCompact(item.outputTokens)}
        </p>
        <div className="usage-substack">
          <p>输入 / 输出</p>
          <p>Total {formatCompact(item.totalTokens)}</p>
        </div>
      </div>

      <div className="usage-cell">
        <span className="usage-mobile-label">Cache</span>
        <p className="usage-primary usage-mono">
          {formatCompact(item.cacheReadInputTokens)} / {formatCompact(item.cacheCreationInputTokens)}
        </p>
        <div className="usage-substack">
          <p>read / write</p>
        </div>
      </div>

      <div className="usage-cell">
        <span className="usage-mobile-label">性能</span>
        <p className="usage-primary">{formatDurationMs(item.durationMs, "请求中")}</p>
        <div className="usage-substack">
          <p>TTFB {formatDurationMs(item.ttfbMs)}</p>
          <p>{item.retryCount != null && item.retryCount > 0 ? `Retry ${item.retryCount}` : " "}</p>
        </div>
      </div>

      <div className="usage-cell is-right">
        <span className="usage-mobile-label">成本</span>
        <p className="usage-primary">{formatUsageCost(item.costUsd, item.estimatedCostUsd)}</p>
        {flags.length ? (
          <div className="usage-flags">
            {flags.map((flag) => (
              <span key={flag.label} className={cn("usage-flag", flag.className)}>
                {flag.label}
              </span>
            ))}
          </div>
        ) : null}
      </div>

      <div className="usage-cell is-right">
        <span className="usage-mobile-label">状态</span>
        <div className="usage-status-stack">
          <span className={cn("status-pill", getStatusClass(item.statusCode))}>
            {item.statusCode == null ? "请求中" : item.statusCode}
          </span>
        </div>
      </div>
    </div>
  );
}

function getSupport(detail: RedeemDetail | null) {
  if (!detail) return null;
  const contactText = detail.template.contactText ?? detail.template.contact_text ?? "";
  const contactLink = detail.template.contactLink ?? detail.template.contact_link ?? "";

  if (contactLink.trim()) {
    return {
      text: contactText.trim() || "联系方式",
      link: contactLink.trim()
    };
  }

  if (!detail.hide_group_info && detail.qq_group_url?.trim()) {
    return {
      text: detail.qq_group_text?.trim() || "交流群",
      link: detail.qq_group_url.trim()
    };
  }

  return null;
}

function getTemplateChips(template?: RedeemDetail["template"]) {
  if (!template) return [];
  const chips: Array<{ label: string; value: string }> = [];
  const duration = template.duration_days ?? template.durationDays;
  const daily = template.daily_quota_usd ?? template.dailyQuotaUsd;
  const weekly = template.weekly_quota_usd ?? template.weeklyQuotaUsd;
  const monthly = template.monthly_quota_usd ?? template.monthlyQuotaUsd;
  const total = template.total_quota_usd ?? template.totalQuotaUsd;
  const concurrent = template.concurrent_sessions ?? template.concurrentSessions;
  const rpm = template.rpm;

  if (duration != null) chips.push({ label: "有效期", value: `${duration} 天` });
  if (daily != null) chips.push({ label: "日额", value: formatMoney(daily) });
  if (weekly != null) chips.push({ label: "周额", value: formatMoney(weekly) });
  if (monthly != null) chips.push({ label: "月额", value: formatMoney(monthly) });
  if (total != null) chips.push({ label: "总额", value: formatMoney(total) });
  if (concurrent != null) chips.push({ label: "Session", value: `${concurrent}` });
  if (rpm != null) chips.push({ label: "RPM", value: `${rpm}` });

  return chips;
}

function buildPackageUsageSummary(detail: RedeemDetail | null, summary: UsageSummaryResponse["data"] | null) {
  if (!detail?.template || !summary) return [];

  return [
    { label: "当前套餐", value: detail.template.name },
    { label: "套餐额度", value: getPackageQuotaLabel(detail.template, detail.cdk) },
    {
      label:
        summary.expiresAt && summary.finalExpiresAt && summary.expiresAt !== summary.finalExpiresAt ? "最终到期" : "到期",
      value: formatDate(summary.finalExpiresAt)
    },
    { label: "今日已用", value: formatUsageUsd(summary.quotas.daily.usedUsd) }
  ];
}

function getPackageQuotaLabel(template: RedeemDetail["template"], cdk: RedeemDetail["cdk"]) {
  const duration = template.duration_days ?? template.durationDays;
  const daily = cdk.effective_daily_quota_usd ?? cdk.effectiveDailyQuotaUsd ?? template.daily_quota_usd ?? template.dailyQuotaUsd;
  const monthly = cdk.effective_monthly_quota_usd ?? cdk.effectiveMonthlyQuotaUsd ?? template.monthly_quota_usd ?? template.monthlyQuotaUsd;
  const total = cdk.effective_total_quota_usd ?? cdk.effectiveTotalQuotaUsd ?? template.total_quota_usd ?? template.totalQuotaUsd;

  if (total != null) {
    return duration != null ? `${duration} 天 / 总额度 ${formatMoney(total)}` : `总额度 ${formatMoney(total)}`;
  }
  if (monthly != null) {
    return `月额度 ${formatMoney(monthly)}`;
  }
  if (daily != null) {
    return duration != null ? `${duration} 天 / 日额度 ${formatMoney(daily)}` : `日额度 ${formatMoney(daily)}`;
  }
  return "按套餐配置";
}

function getActiveSessionDisplay(summary: UsageSummaryResponse["data"]) {
  if (summary.activeSessionCount != null) {
    return formatInteger(summary.activeSessionCount);
  }
  return "未返回";
}

function getSessionLimitDisplay(detail: RedeemDetail | null, summary: UsageSummaryResponse["data"]) {
  const templateLimit = detail?.template?.concurrent_sessions ?? detail?.template?.concurrentSessions ?? null;
  const derivedLimit = summary.limitConcurrentSessions ?? templateLimit;
  return derivedLimit != null ? formatInteger(derivedLimit) : "未限制";
}

function getRpmDisplay(detail: RedeemDetail | null, summary: UsageSummaryResponse["data"]) {
  const rpm = summary.rpm ?? detail?.template?.rpm ?? null;
  return rpm != null ? formatInteger(rpm) : "未限制";
}

function getVisibleQuotaRows(summary: UsageSummaryResponse["data"]) {
  return [summary.quotas.daily, summary.quotas.weekly, summary.quotas.monthly, summary.quotas.total].filter(
    (quota) => quota.limitUsd != null || quota.remainingUsd != null
  );
}

function getRechargeModeLabel(mode: RechargeMode) {
  return rechargeModes.find((item) => item.value === mode)?.label ?? mode;
}

function getRechargePreviewNote(preview: RechargePreview) {
  if (preview.mode === "extend_duration") {
    const currentTime = new Date(preview.currentTime).getTime();
    const targetExpiresAt = new Date(preview.targetExpiresAtBefore ?? "").getTime();
    if (Number.isFinite(currentTime) && Number.isFinite(targetExpiresAt)) {
      return targetExpiresAt <= currentTime
        ? "目标卡已过期时，直接按新卡的日额度和时长，从当前时间重新开始。"
        : "目标卡未过期时，当前只支持同日额度卡顺延到现有到期时间之后。";
    }
    return "已过期的目标卡会按新卡重新开始，未过期时仍按同日额度顺延。";
  }

  if (preview.mode === "overwrite") {
    return "覆盖充值会清空当前套餐后续效果与今日用量，并将 RPM、Session 上限、日额、到期时间与刷新配置整体替换为新卡。";
  }

  return preview.extensionDays != null
    ? `重叠时间先叠到 ${formatMoney(preview.peakDailyQuotaUsd)}，超出的时间再按 新日额 × 超出时长 ÷ 叠后日额 折算，当前折算出 ${preview.extensionDays.toFixed(1)}天。`
    : `重叠区间直接叠到 ${formatMoney(preview.peakDailyQuotaUsd)}，到新卡结束后恢复原额度。`;
}

function getQuotaStatusClass(quota: { limitUsd: number | null; remainingUsd: number | null }) {
  if (quota.limitUsd == null || quota.remainingUsd == null || quota.limitUsd <= 0) return "status-neutral";
  const ratio = quota.remainingUsd / quota.limitUsd;
  if (ratio <= 0.1) return "status-danger";
  if (ratio <= 0.3) return "status-warning";
  return "status-success";
}

function getStatusClass(statusCode: number | null | undefined) {
  if (statusCode == null) return "status-neutral";
  if (statusCode >= 200 && statusCode < 300) return "status-success";
  if (statusCode >= 400 && statusCode < 500) return "status-warning";
  if (statusCode >= 500) return "status-danger";
  return "status-neutral";
}

function truncateRequestId(value: string | null | undefined) {
  if (!value) return "-";
  return value.length <= 24 ? value : `${value.slice(0, 24)}...`;
}

function getUsageModelDetail(item: UsageRecord) {
  const details: string[] = [];

  if (item.keyName) {
    details.push(`Key ${item.keyName}`);
  } else {
    details.push("Key -");
  }

  if (item.upstreamModel && item.upstreamModel !== item.model) {
    details.push(`上游 ${item.upstreamModel}`);
  }

  return details.join(" · ");
}

function getUsageFlags(item: UsageRecord) {
  const flags: Array<{ label: string; className: string }> = [];

  if (item.context1mApplied) {
    flags.push({ label: "1M", className: "is-sky" });
  }

  if (
    Array.isArray(item.specialSettings) &&
    item.specialSettings.some((setting) => {
      if (!setting || typeof setting !== "object") return false;
      if ((setting as { hit?: unknown }).hit === false) return false;
      const tier = String((setting as { serviceTier?: unknown }).serviceTier ?? "").trim().toLowerCase();
      return tier === "priority" || tier === "fast";
    })
  ) {
    flags.push({ label: "FAST", className: "is-amber" });
  }

  return flags;
}
