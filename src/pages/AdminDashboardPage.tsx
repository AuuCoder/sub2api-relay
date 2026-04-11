import { FormEvent, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { AppLayout } from "../components/Layout";
import { getJson, HttpError, postJson } from "../lib/api";
import {
  copyText,
  formatCompact,
  formatDate,
  formatDurationMs,
  formatMoney,
  formatUsageCost,
  formatUsageUsd,
  isExpiredAt,
  truncateMiddle
} from "../lib/utils";
import { AdminDashboard, SessionInfo } from "../types";

type TemplateMode = "daily_pass" | "weekly_pass" | "monthly_pass" | "token_pack";
type CdkStatusFilter = "all" | "unused" | "used" | "expired";

type TemplateFormState = {
  templateType: TemplateMode;
  name: string;
  content: string;
  durationDays: string;
  dailyQuotaUsd: string;
  totalQuotaUsd: string;
  providerGroup: string;
  contactText: string;
  contactLink: string;
};

const emptyTemplate: TemplateFormState = {
  templateType: "monthly_pass",
  name: "",
  content: "",
  durationDays: "30",
  dailyQuotaUsd: "45",
  totalQuotaUsd: "180",
  providerGroup: "",
  contactText: "",
  contactLink: ""
};

export function AdminDashboardPage() {
  const navigate = useNavigate();
  const [session, setSession] = useState<SessionInfo | null>(null);
  const [dashboard, setDashboard] = useState<AdminDashboard | null>(null);
  const [form, setForm] = useState<TemplateFormState>(emptyTemplate);
  const [templateFilter, setTemplateFilter] = useState<"all" | TemplateMode>("all");
  const [cdkStatusFilter, setCdkStatusFilter] = useState<CdkStatusFilter>("all");
  const [templateQuery, setTemplateQuery] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  async function load() {
    setError(null);
    const nextSession = await getJson<SessionInfo>("/api/admin/session");
    setSession(nextSession);
    if (!nextSession.is_admin) {
      navigate("/muyu/login");
      return;
    }
    const nextDashboard = await getJson<Partial<AdminDashboard>>("/api/admin/dashboard");
    setDashboard(normalizeAdminDashboard(nextDashboard));
  }

  useEffect(() => {
    load().catch((cause) => {
      if (cause instanceof HttpError && cause.status === 401) {
        navigate("/muyu/login");
        return;
      }
      setError(cause instanceof Error ? cause.message : "后台加载失败");
    });
  }, [navigate]);

  async function onCreateTemplate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setNotice(null);

    try {
      await postJson("/api/admin/templates", {
        templateType: form.templateType,
        name: form.name,
        content: form.content,
        durationDays: form.templateType === "token_pack" ? form.durationDays : null,
        dailyQuotaUsd: form.templateType === "token_pack" ? null : form.dailyQuotaUsd,
        totalQuotaUsd: form.templateType === "token_pack" ? form.totalQuotaUsd : null,
        providerGroup: form.providerGroup,
        contactText: form.contactText,
        contactLink: form.contactLink
      });
      setForm(emptyTemplate);
      setNotice("模板已创建并同步刷新");
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "创建失败");
    }
  }

  async function onGenerateCdks(templateId: string, count: number) {
    setError(null);
    setNotice(null);

    try {
      await postJson(`/api/admin/templates/${templateId}/cdks`, { count });
      setNotice(`已生成 ${count} 个 CDK`);
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "生成 CDK 失败");
    }
  }

  async function onLogout() {
    try {
      await postJson("/api/admin/logout", {});
    } finally {
      navigate("/muyu/login");
    }
  }

  if (!dashboard) {
    return (
      <AppLayout kicker="Admin Console" title="正在初始化控制台" wide>
        <section className="glass section-card">
          <p>{error ?? "正在读取模板、订单、调用与安全状态..."}</p>
        </section>
      </AppLayout>
    );
  }

  const paymentModeLabel = dashboard.stats.paymentMode === "manual_review" ? "人工审核" : "自动模拟";
  const metrics = [
    { label: "模板总数", value: formatCompact(dashboard.stats.templateCount), hint: "当前可发售套餐模板" },
    { label: "活跃 CDK", value: formatCompact(dashboard.stats.activeCdkCount), hint: "已激活且仍有效的卡密" },
    { label: "调用总量", value: formatCompact(dashboard.stats.usageCount), hint: "累计网关请求次数" },
    { label: "待处理订单", value: formatCompact(dashboard.stats.pendingOrderCount), hint: "待人工确认或补单" },
    { label: "累计成本", value: formatUsageUsd(dashboard.stats.totalCostUsd), hint: "全站已累计消耗" },
    { label: "上游模式", value: dashboard.stats.upstreamMode, hint: `${paymentModeLabel} 支付模式` }
  ];

  const normalizedQuery = templateQuery.trim().toLowerCase();
  const templateCards = dashboard.templates
    .map((template) => {
      const mode = getTemplateMode(template);
      const matchesTemplateType = templateFilter === "all" || templateFilter === mode;
      const matchesTemplateQuery =
        !normalizedQuery ||
        template.name.toLowerCase().includes(normalizedQuery) ||
        template.content.toLowerCase().includes(normalizedQuery);

      const visibleCdks = template.cdks.filter((cdk) => {
        const status = getCdkLifecycleStatus(cdk);
        const matchesStatus = cdkStatusFilter === "all" || cdkStatusFilter === status;
        const matchesCdkQuery =
          !normalizedQuery ||
          cdk.code.toLowerCase().includes(normalizedQuery) ||
          cdk.localApiKey.toLowerCase().includes(normalizedQuery);

        return matchesStatus && (matchesTemplateQuery || matchesCdkQuery);
      });

      return {
        template,
        mode,
        visibleCdks,
        totalSummary: summarizeCdkStatuses(template.cdks),
        visibleSummary: summarizeCdkStatuses(visibleCdks),
        matchesTemplateType,
        matchesTemplateQuery
      };
    })
    .filter((card) => {
      if (!card.matchesTemplateType) return false;
      if (card.visibleCdks.length > 0) return true;
      return cdkStatusFilter === "all" && !normalizedQuery;
    });

  const exportRows = templateCards.flatMap((card) =>
    card.visibleCdks.map((cdk) => buildExportRow(card.template, card.mode, cdk))
  );

  async function exportTxtRows(rows: typeof exportRows, scopeLabel: string) {
    if (!rows.length) {
      setNotice("当前筛选结果没有可导出的 CDK");
      return;
    }

    const scope = escapeFilenameSegment(scopeLabel) || "current";
    const filename = `cdk-export-${scope}-${Date.now()}.txt`;
    const content = rows.map((item) => item.cdkCode).join("\n");
    downloadBlob(filename, new Blob([content], { type: "text/plain;charset=utf-8" }));
    setNotice(`已导出 ${rows.length} 个 CDK 到 TXT`);
  }

  async function exportXlsxRows(rows: typeof exportRows, scopeLabel: string) {
    if (!rows.length) {
      setNotice("当前筛选结果没有可导出的 CDK");
      return;
    }

    const XLSX = await import("xlsx");
    const worksheet = XLSX.utils.json_to_sheet(
      rows.map((item) => ({
        模板类型: item.templateTypeLabel,
        模板名称: item.templateName,
        CDK状态: item.statusLabel,
        CDK: item.cdkCode,
        APIKey: item.localApiKey,
        渠道分组: item.providerGroup,
        创建时间: formatExportDate(item.createdAt),
        激活时间: formatExportDate(item.redeemedAt),
        到期时间: formatExportDate(item.expiresAt),
        日额度USD: item.dailyQuotaUsd ?? "",
        总额度USD: item.totalQuotaUsd ?? "",
        累计费用USD: item.totalCostUsd.toFixed(4),
        已续费到: item.rechargeTargetCode ?? ""
      }))
    );
    worksheet["!cols"] = [
      { wch: 10 },
      { wch: 22 },
      { wch: 10 },
      { wch: 34 },
      { wch: 38 },
      { wch: 18 },
      { wch: 18 },
      { wch: 18 },
      { wch: 18 },
      { wch: 12 },
      { wch: 12 },
      { wch: 14 },
      { wch: 34 }
    ];

    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, "CDK");
    const scope = escapeFilenameSegment(scopeLabel) || "current";
    XLSX.writeFile(
      workbook,
      `cdk-export-${scope}-${Date.now()}.xlsx`
    );
    setNotice(`已导出 ${rows.length} 个 CDK 到 XLSX`);
  }

  async function onExportTxt() {
    await exportTxtRows(exportRows, `${templateFilter}-${cdkStatusFilter}`);
  }

  async function onExportXlsx() {
    await exportXlsxRows(exportRows, `${templateFilter}-${cdkStatusFilter}`);
  }

  const visibleCdkCount = exportRows.length;
  const recentUsagePreview = dashboard.recentUsage.slice(0, 6);
  const filteredStatusSummary = templateCards.reduce(
    (summary, card) => ({
      unused: summary.unused + card.visibleSummary.unused,
      used: summary.used + card.visibleSummary.used,
      expired: summary.expired + card.visibleSummary.expired
    }),
    { unused: 0, used: 0, expired: 0 }
  );

  return (
    <AppLayout
      kicker="Admin Console"
      title={`${dashboard.site.title} 管理控制台`}
      wide
      actions={
        <button className="ghost-button" onClick={() => void onLogout()}>
          退出登录
        </button>
      }
    >
      {notice ? <div className="floating-banner">{notice}</div> : null}

      <div className="admin-dashboard-stack">
        <section className="admin-overview-grid">
          <article className="glass section-card admin-overview-card">
            <div className="admin-overview-copy">
              <p className="kicker">运营总览</p>
              <h2>欢迎回来，{session?.username ?? "admin"}</h2>
              <p className="muted-line">
                这里集中管理 <strong>{dashboard.site.title}</strong> 的模板、CDK、Sub2API 对接与调用审计。
                当前支付模式为 <strong>{paymentModeLabel}</strong>，上游模式为{" "}
                <strong>{dashboard.stats.upstreamMode}</strong>。
              </p>
            </div>

            <div className="chip-row">
              <span className="soft-tag">Remote Web: {dashboard.site.remoteWebUrl || "未配置"}</span>
              <span className="soft-tag">Allowlist: {dashboard.security.allowedOrigins.length} 个来源</span>
              <span className="soft-tag">模板支持直接生成 CDK</span>
              <span className="soft-tag">
                社群入口: {dashboard.site.qqGroupUrl ? "已配置" : "未配置"}
              </span>
            </div>

            <div className="admin-overview-meta-grid">
              <div className="admin-overview-meta-card">
                <span>站点环境</span>
                <strong>{dashboard.site.appEnv || "production"}</strong>
              </div>
              <div className="admin-overview-meta-card">
                <span>支付通道</span>
                <strong>{dashboard.site.paymentChannelLabel || paymentModeLabel}</strong>
              </div>
              <div className="admin-overview-meta-card">
                <span>邀请码机制</span>
                <strong>{dashboard.site.inviteEnabled ? "已启用" : "未启用"}</strong>
              </div>
              <div className="admin-overview-meta-card">
                <span>社群链接</span>
                <strong>{dashboard.site.qqGroupUrl ? "已接入" : "未设置"}</strong>
              </div>
            </div>
          </article>

          <article className="glass section-card admin-session-panel">
            <div className="card-header-block">
              <div>
                <p className="kicker">会话安全</p>
                <h2>后台会话与风控</h2>
              </div>
              <span className={getSecurityTone(session?.credentialRotationRecommended)}>
                {session?.credentialRotationRecommended ? "建议轮换口令" : "已启用防护"}
              </span>
            </div>

            <div className="admin-session-list">
              <div className="admin-security-row">
                <span>会话到期</span>
                <strong>{formatExpiryLine(session?.expiresAt)}</strong>
              </div>
              <div className="admin-security-row">
                <span>空闲超时</span>
                <strong>{formatExpiryLine(session?.idleExpiresAt)}</strong>
              </div>
              <div className="admin-security-row">
                <span>最近活动</span>
                <strong>{formatDate(session?.lastSeenAt)}</strong>
              </div>
              <div className="admin-security-row">
                <span>Cookie 策略</span>
                <strong>{session?.secureCookie ? "Secure + HttpOnly" : "HttpOnly (HTTP 开发模式)"}</strong>
              </div>
              <div className="admin-security-row">
                <span>写操作防护</span>
                <strong>
                  {session?.csrfProtectionEnabled && session?.writeProtectionEnabled ? "CSRF 已启用" : "未启用"}
                </strong>
              </div>
              <div className="admin-security-row">
                <span>登录锁定阈值</span>
                <strong>
                  {dashboard.security.loginMaxFailures} 次失败 / {dashboard.security.lockoutMinutes} 分钟锁定
                </strong>
              </div>
            </div>
          </article>
        </section>

        <section className="admin-summary-grid">
        {metrics.map((metric) => (
          <article key={metric.label} className="glass admin-summary-card">
            <span className="admin-summary-label">{metric.label}</span>
            <strong>{metric.value}</strong>
            <p className="admin-summary-hint">{metric.hint}</p>
          </article>
        ))}
        </section>

        {error ? <p className="error-text admin-global-error">{error}</p> : null}

        <section className="admin-main-grid">
          <article className="glass section-card admin-usage-panel">
            <div className="card-header-block">
              <div>
                <p className="kicker">调用审计</p>
                <h2>最近调用预览</h2>
              </div>
              <span className="soft-tag">最近 {recentUsagePreview.length} 条</span>
            </div>

            <p className="admin-card-note">
              {dashboard.stats.upstreamMode === "sub2api"
                ? "Sub2API 的后台日志接口不会稳定返回真实错误状态；已记录并计费的成功调用会按 200 展示，方便你快速排查可用请求。"
                : "这里展示最近进入本地网关的调用，用于查看模型、路径、耗时、费用与状态。"}
            </p>

            {dashboard.recentUsage.length > recentUsagePreview.length ? (
              <div className="admin-filter-pills">
                <span className="soft-tag">总记录 {dashboard.recentUsage.length}</span>
                <span className="soft-tag">首页仅展示最近 6 条</span>
              </div>
            ) : null}

            <div className="admin-usage-list admin-usage-list-compact">
              {recentUsagePreview.length ? (
                recentUsagePreview.map((item) => {
                  const statusInfo = getAdminUsageStatusInfo(item.statusCode);
                  return (
                    <article
                      key={item.id ?? `${item.createdAt}-${item.requestId ?? item.model ?? "usage"}`}
                      className="admin-usage-item is-compact"
                    >
                      <div className="admin-usage-item-head">
                        <div className="admin-usage-item-title is-compact">
                          <strong>{item.model ?? "-"}</strong>
                          <span>{item.path ?? item.endpoint ?? "-"}</span>
                        </div>
                        <span className={`admin-usage-status ${statusInfo.className}`}>{statusInfo.label}</span>
                      </div>

                      <div className="admin-usage-inline-meta">
                        <span className="soft-tag">{formatDate(item.createdAt)}</span>
                        <span className="soft-tag">{item.providerName ?? "本地网关"}</span>
                        <span className="soft-tag">{item.keyName ?? item.clientKey ?? "-"}</span>
                        <span className="soft-tag">{formatDurationMs(item.durationMs)}</span>
                        <span className="soft-tag">{formatUsageCost(item.costUsd, item.estimatedCostUsd)}</span>
                        <span className="soft-tag">{truncateMiddle(item.requestId, 10, 6)}</span>
                      </div>
                    </article>
                  );
                })
              ) : (
                <div className="admin-template-empty">暂时还没有调用数据。</div>
              )}
            </div>
          </article>

          <div className="admin-sidebar">
            <article className="glass form-card admin-form-panel">
              <div className="card-header-block">
                <div>
                  <p className="kicker">模板工作台</p>
                  <h2>新增套餐模板</h2>
                </div>
                <span className="soft-tag">{getTemplateFormSummary(form.templateType)}</span>
              </div>

              <div className="admin-form-tip">
                包天、包周、包月只需要设置日额度；Token 量模式再额外设置有效天数与总额度。
              </div>

              <form className="stack-form" onSubmit={onCreateTemplate}>
                <label>
                  <span>模板名称</span>
                  <input
                    value={form.name}
                    onChange={(event) => setForm((state) => ({ ...state, name: event.target.value }))}
                    placeholder="例如：月卡 180"
                  />
                </label>
                <label>
                  <span>套餐说明</span>
                  <textarea
                    rows={4}
                    value={form.content}
                    onChange={(event) => setForm((state) => ({ ...state, content: event.target.value }))}
                    placeholder="写给前台用户看的套餐说明，例如适用模型、额度规则和使用提醒。"
                  />
                </label>

                <div className="field-grid">
                  <label>
                    <span>模板类型</span>
                    <select
                      value={form.templateType}
                      onChange={(event) =>
                        setForm((state) => ({
                          ...state,
                          templateType: event.target.value as TemplateMode
                        }))
                      }
                    >
                      <option value="daily_pass">包天</option>
                      <option value="weekly_pass">包周</option>
                      <option value="monthly_pass">包月</option>
                      <option value="token_pack">Token量</option>
                    </select>
                  </label>
                  <label>
                    <span>渠道分组</span>
                    <input
                      value={form.providerGroup}
                      onChange={(event) => setForm((state) => ({ ...state, providerGroup: event.target.value }))}
                      placeholder="留空或填写 default 使用默认分组，或填写 openai:premium / premium"
                    />
                  </label>
                </div>

                <div className="field-grid">
                  <label>
                    <span>{form.templateType === "token_pack" ? "有效期(天)" : "固定有效期"}</span>
                    {form.templateType === "token_pack" ? (
                      <input
                        value={form.durationDays}
                        onChange={(event) => setForm((state) => ({ ...state, durationDays: event.target.value }))}
                        placeholder="30"
                      />
                    ) : (
                      <input
                        value={
                          form.templateType === "daily_pass"
                            ? "1 天"
                            : form.templateType === "weekly_pass"
                              ? "7 天"
                              : "30 天"
                        }
                        disabled
                      />
                    )}
                  </label>
                  <label>
                    <span>{form.templateType === "token_pack" ? "总额度($)" : "日额度($)"}</span>
                    <input
                      value={form.templateType === "token_pack" ? form.totalQuotaUsd : form.dailyQuotaUsd}
                      onChange={(event) =>
                        setForm((state) => ({
                          ...state,
                          ...(state.templateType === "token_pack"
                            ? { totalQuotaUsd: event.target.value }
                            : { dailyQuotaUsd: event.target.value })
                        }))
                      }
                      placeholder={form.templateType === "token_pack" ? "180" : "45"}
                    />
                  </label>
                </div>

                <div className="field-grid">
                  <label>
                    <span>联系文案</span>
                    <input
                      value={form.contactText}
                      onChange={(event) => setForm((state) => ({ ...state, contactText: event.target.value }))}
                      placeholder="例如：联系运维开通企业套餐"
                    />
                  </label>
                  <label>
                    <span>联系链接</span>
                    <input
                      value={form.contactLink}
                      onChange={(event) => setForm((state) => ({ ...state, contactLink: event.target.value }))}
                      placeholder="https://..."
                    />
                  </label>
                </div>

                <button className="primary-button" type="submit">
                  创建模板
                </button>
              </form>
            </article>

            <article className="glass section-card admin-security-panel">
              <div className="card-header-block">
                <div>
                  <p className="kicker">安全策略</p>
                  <h2>后台防护面板</h2>
                </div>
              </div>

              <div className="toolbar-strip">
                <p className="toolbar-note">
                  会话绝对时长 {session?.sessionTtlMinutes ?? dashboard.security.sessionTtlMinutes} 分钟，空闲超时{" "}
                  {session?.idleTimeoutMinutes ?? dashboard.security.idleTimeoutMinutes} 分钟，所有写操作必须携带有效
                  CSRF 令牌。
                </p>
              </div>

              <div className="admin-policy-pills">
                {dashboard.security.allowedOrigins.length ? (
                  dashboard.security.allowedOrigins.map((origin) => (
                    <code key={origin} className="code-pill">
                      {origin}
                    </code>
                  ))
                ) : (
                  <span className="soft-tag">未配置允许来源</span>
                )}
              </div>

              <div className="admin-policy-note">
                <strong>凭据建议</strong>
                <p className="muted-line">
                  {session?.credentialRotationRecommended
                    ? "检测到默认管理员口令仍可能生效，建议立即在环境变量中替换默认账号密码。"
                    : "当前未检测到默认口令风险，建议继续按周期轮换后台凭据。"}
                </p>
              </div>
            </article>
          </div>
        </section>

        <section className="glass section-card admin-catalog-panel">
          <div className="admin-toolbar">
            <div>
              <p className="kicker">CDK 管理</p>
              <h2>按模板名称查看卡密</h2>
              <p className="muted-line">支持按套餐类型、使用状态和关键词筛选，并可直接导出当前结果。</p>
            </div>

            <div className="admin-toolbar-actions">
              <button className="ghost-button is-inline" onClick={() => void onExportTxt()} disabled={!visibleCdkCount}>
                导出 TXT
              </button>
              <button
                className="secondary-button is-inline"
                onClick={() => void onExportXlsx()}
                disabled={!visibleCdkCount}
              >
                导出 XLSX
              </button>
            </div>
          </div>

          <div className="admin-filter-grid">
            <label>
              <span>分类筛选</span>
              <select
                value={templateFilter}
                onChange={(event) => setTemplateFilter(event.target.value as "all" | TemplateMode)}
              >
                <option value="all">全部</option>
                <option value="daily_pass">日卡</option>
                <option value="weekly_pass">周卡</option>
                <option value="monthly_pass">月卡</option>
                <option value="token_pack">Token 包</option>
              </select>
            </label>
            <label>
              <span>状态筛选</span>
              <select
                value={cdkStatusFilter}
                onChange={(event) => setCdkStatusFilter(event.target.value as CdkStatusFilter)}
              >
                <option value="all">全部状态</option>
                <option value="unused">未使用</option>
                <option value="used">已使用</option>
                <option value="expired">过期</option>
              </select>
            </label>
            <label>
              <span>关键词查询</span>
              <input
                value={templateQuery}
                onChange={(event) => setTemplateQuery(event.target.value)}
                placeholder="按模板名、CDK、API Key 过滤"
              />
            </label>
          </div>

          <div className="admin-filter-pills">
            <span className="soft-tag">模板 {templateCards.length}</span>
            <span className="soft-tag">命中 CDK {visibleCdkCount}</span>
            <span className="soft-tag">未使用 {filteredStatusSummary.unused}</span>
            <span className="soft-tag">已使用 {filteredStatusSummary.used}</span>
            <span className="soft-tag">过期 {filteredStatusSummary.expired}</span>
          </div>

          <div className="admin-export-strip">
            <div className="admin-export-copy">
              <strong>导出当前筛选结果</strong>
              <p className="muted-line">
                当前命中 {visibleCdkCount} 个 CDK，可直接导出为 `TXT` 或 `XLSX`。
              </p>
            </div>
            <div className="admin-toolbar-actions">
              <button className="ghost-button is-inline" onClick={() => void onExportTxt()} disabled={!visibleCdkCount}>
                导出当前 TXT
              </button>
              <button
                className="secondary-button is-inline"
                onClick={() => void onExportXlsx()}
                disabled={!visibleCdkCount}
              >
                导出当前 XLSX
              </button>
            </div>
          </div>

          <div className="admin-template-groups">
            {templateCards.length ? (
              templateCards.map(({ template, mode, visibleCdks, totalSummary, visibleSummary }) => (
                <article key={template.id} className="admin-template-group">
                  <div className="admin-template-group-head">
                    <div className="admin-template-group-main">
                      <div className="admin-template-title-row">
                        <h3>{template.name}</h3>
                        <span className="soft-tag">{getTemplateTypeLabel(mode)}</span>
                      </div>
                      <p className="admin-template-description">{template.content || "暂无模板说明"}</p>
                    </div>

                    <div className="admin-template-group-meta">
                      <span className="soft-tag">{getTemplateQuotaSummary(template)}</span>
                      <span className="soft-tag">
                        分组 {formatTemplateProviderGroupLabel(template.providerGroup ?? template.provider_group ?? null)}
                      </span>
                      <span className="soft-tag">总计 {formatCompact(template.cdkCount)}</span>
                      <span className="soft-tag">命中 {formatCompact(visibleCdks.length)}</span>
                      <span className="soft-tag">未使用 {visibleSummary.unused}</span>
                      <span className="soft-tag">已使用 {visibleSummary.used}</span>
                      <span className="soft-tag">过期 {visibleSummary.expired}</span>
                    </div>

                    <div className="admin-inline-actions admin-template-actions">
                      <button
                        className="ghost-button is-inline"
                        onClick={() => void copyText(visibleCdks.map((item) => item.code).join("\n"))}
                        disabled={!visibleCdks.length}
                      >
                        复制本模板
                      </button>
                      <button className="secondary-button is-inline" onClick={() => void onGenerateCdks(template.id, 1)}>
                        生成1个
                      </button>
                      <button className="primary-button is-inline" onClick={() => void onGenerateCdks(template.id, 5)}>
                        生成5个
                      </button>
                      <button
                        className="ghost-button is-inline"
                        onClick={() =>
                          void exportTxtRows(
                            visibleCdks.map((cdk) => buildExportRow(template, mode, cdk)),
                            `${template.id}-txt`
                          )
                        }
                        disabled={!visibleCdks.length}
                      >
                        导出TXT
                      </button>
                      <button
                        className="secondary-button is-inline"
                        onClick={() =>
                          void exportXlsxRows(
                            visibleCdks.map((cdk) => buildExportRow(template, mode, cdk)),
                            `${template.id}-xlsx`
                          )
                        }
                        disabled={!visibleCdks.length}
                      >
                        导出XLSX
                      </button>
                    </div>
                  </div>

                  <div className="admin-filter-pills">
                    <span className="soft-tag">模板库存 {formatCompact(totalSummary.unused)}</span>
                    <span className="soft-tag">已激活 {formatCompact(totalSummary.used)}</span>
                    <span className="soft-tag">已失效 {formatCompact(totalSummary.expired)}</span>
                  </div>

                  {visibleCdks.length ? (
                    <>
                      <div className="table-shell admin-desktop-only">
                        <table className="admin-cdk-list-table admin-group-table">
                          <thead>
                            <tr>
                              <th>状态</th>
                              <th>CDK</th>
                              <th>API Key</th>
                              <th>激活时间</th>
                              <th>到期时间</th>
                              <th>累计费用</th>
                              <th>操作</th>
                            </tr>
                          </thead>
                          <tbody>
                            {visibleCdks.map((cdk) => (
                              <tr key={cdk.id}>
                                <td>
                                  <span className={getCdkStatusClass(cdk)}>{getCdkStatusLabel(cdk)}</span>
                                </td>
                                <td>
                                  <button className="copy-inline" onClick={() => void copyText(cdk.code)}>
                                    {truncateMiddle(cdk.code, 12, 8)}
                                  </button>
                                </td>
                                <td>
                                  <button className="copy-inline" onClick={() => void copyText(cdk.localApiKey)}>
                                    {truncateMiddle(cdk.localApiKey, 14, 8)}
                                  </button>
                                </td>
                                <td>{formatDate(cdk.redeemedAt)}</td>
                                <td>{formatDate(cdk.expiresAt)}</td>
                                <td>{formatUsageUsd(cdk.totalCostUsd)}</td>
                                <td>
                                  <div className="admin-inline-actions">
                                    <button className="ghost-button is-inline" onClick={() => void copyText(cdk.code)}>
                                      复制CDK
                                    </button>
                                    <button
                                      className="secondary-button is-inline"
                                      onClick={() => void copyText(cdk.localApiKey)}
                                    >
                                      复制Key
                                    </button>
                                  </div>
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>

                      <div className="admin-cdk-mobile-list admin-mobile-only">
                        {visibleCdks.map((cdk) => (
                          <article key={cdk.id} className="admin-cdk-mobile-card">
                            <div className="admin-cdk-mobile-head">
                              <span className={getCdkStatusClass(cdk)}>{getCdkStatusLabel(cdk)}</span>
                              <span className="soft-tag">{formatUsageUsd(cdk.totalCostUsd)}</span>
                            </div>

                            <div className="admin-cdk-mobile-fields">
                              <div className="admin-detail-field">
                                <span>CDK</span>
                                <strong>{truncateMiddle(cdk.code, 14, 10)}</strong>
                              </div>
                              <div className="admin-detail-field">
                                <span>API Key</span>
                                <strong>{truncateMiddle(cdk.localApiKey, 16, 10)}</strong>
                              </div>
                              <div className="admin-detail-field">
                                <span>激活时间</span>
                                <strong>{formatDate(cdk.redeemedAt)}</strong>
                              </div>
                              <div className="admin-detail-field">
                                <span>到期时间</span>
                                <strong>{formatDate(cdk.expiresAt)}</strong>
                              </div>
                            </div>

                            <div className="admin-inline-actions">
                              <button className="ghost-button is-inline" onClick={() => void copyText(cdk.code)}>
                                复制CDK
                              </button>
                              <button
                                className="secondary-button is-inline"
                                onClick={() => void copyText(cdk.localApiKey)}
                              >
                                复制Key
                              </button>
                            </div>
                          </article>
                        ))}
                      </div>
                    </>
                  ) : (
                    <div className="admin-template-empty">该模板下没有符合当前筛选条件的 CDK。</div>
                  )}
                </article>
              ))
            ) : (
              <div className="admin-template-empty">当前筛选条件下没有可显示的 CDK。</div>
            )}
          </div>
        </section>
      </div>
    </AppLayout>
  );
}

function normalizeAdminDashboard(raw: Partial<AdminDashboard> | null | undefined): AdminDashboard {
  return {
    stats: {
      templateCount: raw?.stats?.templateCount ?? 0,
      cdkCount: raw?.stats?.cdkCount ?? 0,
      activeCdkCount: raw?.stats?.activeCdkCount ?? 0,
      orderCount: raw?.stats?.orderCount ?? 0,
      pendingOrderCount: raw?.stats?.pendingOrderCount ?? 0,
      usageCount: raw?.stats?.usageCount ?? 0,
      totalCostUsd: raw?.stats?.totalCostUsd ?? 0,
      upstreamMode: raw?.stats?.upstreamMode ?? "unknown",
      paymentMode: raw?.stats?.paymentMode ?? "manual_review"
    },
    security: {
      allowedOrigins: Array.isArray(raw?.security?.allowedOrigins) ? raw.security.allowedOrigins : [],
      loginMaxFailures: raw?.security?.loginMaxFailures ?? 5,
      lockoutMinutes: raw?.security?.lockoutMinutes ?? 15,
      sessionTtlMinutes: raw?.security?.sessionTtlMinutes ?? 720,
      idleTimeoutMinutes: raw?.security?.idleTimeoutMinutes ?? 120
    },
    site: {
      title: raw?.site?.title ?? "HAOCUN",
      appEnv: raw?.site?.appEnv ?? "production",
      remoteWebUrl: raw?.site?.remoteWebUrl ?? "",
      qqGroupText: raw?.site?.qqGroupText ?? "",
      qqGroupUrl: raw?.site?.qqGroupUrl ?? "",
      qqGroupQrcodeAvailable: raw?.site?.qqGroupQrcodeAvailable ?? false,
      paymentMode: raw?.site?.paymentMode ?? "manual_review",
      paymentChannelLabel: raw?.site?.paymentChannelLabel ?? "手动支付",
      paymentAccountName: raw?.site?.paymentAccountName ?? null,
      paymentAccountNo: raw?.site?.paymentAccountNo ?? null,
      paymentQrCodeUrl: raw?.site?.paymentQrCodeUrl ?? null,
      paymentInstructions: raw?.site?.paymentInstructions ?? "",
      inviteEnabled: raw?.site?.inviteEnabled ?? false,
      inviteDiscountPercent: raw?.site?.inviteDiscountPercent ?? 0,
      inviteRewardTotalUsd: raw?.site?.inviteRewardTotalUsd ?? 0
    },
    templates: Array.isArray(raw?.templates) ? raw.templates : [],
    recentUsage: Array.isArray(raw?.recentUsage) ? raw.recentUsage : [],
    recentOrders: Array.isArray(raw?.recentOrders) ? raw.recentOrders : []
  };
}

function getTemplateMode(template: AdminDashboard["templates"][number]): TemplateMode {
  const explicitMode = template.templateType ?? template.template_type;
  if (
    explicitMode === "daily_pass" ||
    explicitMode === "weekly_pass" ||
    explicitMode === "monthly_pass" ||
    explicitMode === "token_pack"
  ) {
    return explicitMode;
  }
  if (
    (template.totalQuotaUsd ?? template.total_quota_usd) != null &&
    (template.dailyQuotaUsd ?? template.daily_quota_usd) == null
  ) {
    return "token_pack";
  }
  const durationDays = template.durationDays ?? template.duration_days;
  if (durationDays === 1) {
    return "daily_pass";
  }
  if (durationDays === 7) {
    return "weekly_pass";
  }
  return "monthly_pass";
}

function getTemplateTypeLabel(mode: TemplateMode) {
  if (mode === "daily_pass") return "包天";
  if (mode === "weekly_pass") return "包周";
  if (mode === "monthly_pass") return "包月";
  return "Token量";
}

function getTemplateQuotaSummary(template: AdminDashboard["templates"][number]) {
  const mode = getTemplateMode(template);
  if (mode === "token_pack") {
    return `${template.durationDays ?? template.duration_days ?? 0} 天 / ${formatMoney(
      template.totalQuotaUsd ?? template.total_quota_usd
    )}`;
  }

  const validityLabel = mode === "daily_pass" ? "1 天" : mode === "weekly_pass" ? "7 天" : "30 天";
  return `${validityLabel} / 日额度 ${formatMoney(
    template.dailyQuotaUsd ?? template.daily_quota_usd
  )}`;
}

function getTemplateFormSummary(mode: TemplateMode) {
  if (mode === "daily_pass") return "固定 1 天，仅配置日额度";
  if (mode === "weekly_pass") return "固定 7 天，仅配置日额度";
  if (mode === "monthly_pass") return "固定 30 天，仅配置日额度";
  return "按有效期 + 总额度出售";
}

function summarizeCdkStatuses(cdks: AdminDashboard["templates"][number]["cdks"]) {
  return cdks.reduce(
    (summary, cdk) => {
      const status = getCdkLifecycleStatus(cdk);
      summary[status] += 1;
      return summary;
    },
    { unused: 0, used: 0, expired: 0 }
  );
}

function getCdkLifecycleStatus(cdk: AdminDashboard["templates"][number]["cdks"][number]): Exclude<CdkStatusFilter, "all"> {
  if (isExpiredAt(cdk.expiresAt ?? cdk.expires_at)) {
    return "expired";
  }
  if (cdk.rechargeTargetCode ?? cdk.recharge_target_code) {
    return "used";
  }
  if (cdk.redeemedAt ?? cdk.redeemed_at) {
    return "used";
  }
  if (cdk.disabled) {
    return "used";
  }
  return "unused";
}

function getCdkStatusLabel(cdk: AdminDashboard["templates"][number]["cdks"][number]) {
  if (isExpiredAt(cdk.expiresAt ?? cdk.expires_at)) return "过期";
  if (cdk.rechargeTargetCode ?? cdk.recharge_target_code) return "已续费";
  if (cdk.redeemedAt ?? cdk.redeemed_at) return "已使用";
  if (cdk.disabled) return "已停用";
  return "未使用";
}

function getCdkStatusClass(cdk: AdminDashboard["templates"][number]["cdks"][number]) {
  const status = getCdkLifecycleStatus(cdk);
  if (status === "expired") return "status-badge is-danger";
  if (status === "used") return "status-badge is-warning";
  return "status-badge is-success";
}

function formatTemplateProviderGroupLabel(providerGroup: string | null | undefined) {
  const normalized = String(providerGroup ?? "").trim();
  if (!normalized) return "默认分组";
  if (normalized.toLowerCase() === "default" || normalized === "默认") {
    return "默认分组";
  }
  return normalized;
}

function buildExportRow(
  template: AdminDashboard["templates"][number],
  mode: TemplateMode,
  cdk: AdminDashboard["templates"][number]["cdks"][number]
) {
  return {
    templateName: template.name,
    templateTypeLabel: getTemplateTypeLabel(mode),
    cdkCode: cdk.code,
    localApiKey: cdk.localApiKey,
    statusLabel: getCdkStatusLabel(cdk),
    createdAt: cdk.createdAt ?? cdk.created_at ?? null,
    redeemedAt: cdk.redeemedAt ?? cdk.redeemed_at ?? null,
    expiresAt: cdk.expiresAt ?? cdk.expires_at ?? null,
    totalCostUsd: cdk.totalCostUsd ?? cdk.total_cost_usd ?? 0,
    dailyQuotaUsd: cdk.effectiveDailyQuotaUsd ?? cdk.effective_daily_quota_usd ?? null,
    totalQuotaUsd: cdk.effectiveTotalQuotaUsd ?? cdk.effective_total_quota_usd ?? null,
    providerGroup: formatTemplateProviderGroupLabel(template.providerGroup ?? template.provider_group ?? null),
    rechargeTargetCode: cdk.rechargeTargetCode ?? cdk.recharge_target_code ?? null
  };
}

function formatExportDate(value: string | null | undefined) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";

  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  const hour = String(date.getHours()).padStart(2, "0");
  const minute = String(date.getMinutes()).padStart(2, "0");
  const second = String(date.getSeconds()).padStart(2, "0");
  return `${year}-${month}-${day} ${hour}:${minute}:${second}`;
}

function escapeFilenameSegment(value: string) {
  return value.replace(/[^a-zA-Z0-9_-]+/g, "-");
}

function downloadBlob(filename: string, blob: Blob) {
  const objectUrl = window.URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = objectUrl;
  anchor.download = filename;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  window.URL.revokeObjectURL(objectUrl);
}

function getSecurityTone(hasRisk: boolean | null | undefined) {
  return hasRisk ? "status-badge is-warning" : "status-badge is-success";
}

function getAdminUsageStatusInfo(statusCode: number | null | undefined) {
  if (statusCode == null) {
    return {
      label: "未返回",
      className: "status-badge is-neutral"
    };
  }

  if (statusCode >= 200 && statusCode < 300) {
    return {
      label: String(statusCode),
      className: "status-badge is-success"
    };
  }

  if (statusCode >= 400 && statusCode < 500) {
    return {
      label: String(statusCode),
      className: "status-badge is-warning"
    };
  }

  if (statusCode >= 500) {
    return {
      label: String(statusCode),
      className: "status-badge is-danger"
    };
  }

  return {
    label: String(statusCode),
    className: "status-badge is-neutral"
  };
}

function formatExpiryLine(value: string | null | undefined) {
  if (!value) return "-";
  return `${formatDate(value)} · ${formatRemaining(value)}`;
}

function formatRemaining(value: string | null | undefined) {
  if (!value) return "-";
  const target = new Date(value).getTime();
  if (Number.isNaN(target)) return "-";

  const diffMs = target - Date.now();
  if (diffMs <= 0) return "已到期";

  const minutes = Math.ceil(diffMs / 60000);
  if (minutes < 60) return `${minutes} 分钟后`;

  const hours = Math.ceil(minutes / 60);
  if (hours < 24) return `${hours} 小时后`;

  const days = Math.ceil(hours / 24);
  return `${days} 天后`;
}
