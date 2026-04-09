import { useEffect, useMemo, useState } from "react";
import { History } from "lucide-react";
import { useParams } from "react-router-dom";
import { AppLayout } from "../components/Layout";
import { LimitTimeline } from "../components/PublicUi";
import { getJson, HttpError } from "../lib/api";
import { formatDate, formatMoney, rememberCdk } from "../lib/utils";
import type { LimitHistoryResponse } from "../types";

export function CdkHistoryPage() {
  const { cdk = "" } = useParams();
  const [history, setHistory] = useState<LimitHistoryResponse["data"] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

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

    getJson<LimitHistoryResponse>(`/api/redeem/${encodeURIComponent(cdk)}/limit-history`)
      .then((payload) => {
        if (cancelled) return;
        setHistory(payload.data);
        rememberCdk(cdk);
      })
      .catch((cause) => {
        if (cancelled) return;
        setError(cause instanceof HttpError ? cause.message : "加载失败");
      })
      .finally(() => {
        if (cancelled) return;
        setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [cdk]);

  return (
    <AppLayout navItems={navItems} wide>
      {loading ? (
        <div className="center-panel">
          <div className="surface-card-strong center-card">正在加载变化历史...</div>
        </div>
      ) : error || !history ? (
        <div className="center-panel">
          <div className="surface-card-strong center-card is-error">{error ?? "暂无数据"}</div>
        </div>
      ) : (
        <section className="public-stack">
          <section className="surface-card-strong panel-card">
            <div className="section-title">
              <History size={16} />
              <h1 className="panel-title-large">限额变化</h1>
            </div>
            <div className="chip-row">
              <span className="stat-chip">当前查看 {history.cdk}</span>
            </div>
          </section>

          <section className="surface-card panel-card">
            <div className="card-header-block">
              <h2>总览</h2>
            </div>
            <div className="stat-grid">
              <HistoryTile label="激活时间" value={formatDate(history.activatedAt)} />
              <HistoryTile label="原到期" value={formatDate(history.originalExpiresAt)} />
              <HistoryTile label="最终到期" value={formatDate(history.finalExpiresAt)} />
            </div>
            <LimitTimeline
              segments={history.overallBar.segments}
              currentTime={history.currentTime}
              originalExpiresAt={history.originalExpiresAt}
            />
          </section>

          <section className="surface-card panel-card">
            <div className="card-header-block">
              <h2>CDK 列表</h2>
            </div>
            <div className="history-rows">
              {history.rows.map((row, index) => (
                <article key={`${row.kind}-${row.cdk}-${index}`} className="history-row">
                  <div className="history-row-head">
                    <div className="history-row-copy">
                      <span className="stat-chip">{row.kind === "current" ? "当前CDK" : "充值CDK"}</span>
                      <strong>{row.cdk}</strong>
                    </div>
                    <div className="history-row-tags">
                      <span className="soft-tag">
                        {row.mode === "extend_duration"
                          ? "叠加时长"
                          : row.mode === "boost_quota"
                            ? "叠加额度"
                            : row.mode === "overwrite"
                              ? "覆盖充值"
                              : "当前CDK"}
                      </span>
                      {row.templateName ? <span className="soft-tag">{row.templateName}</span> : null}
                      {row.durationDays != null ? <span className="soft-tag">{row.durationDays}天</span> : null}
                      {row.dailyQuotaUsd != null ? <span className="soft-tag">日额 {formatMoney(row.dailyQuotaUsd)}</span> : null}
                    </div>
                  </div>

                  {row.confirmedAt ? <p className="history-note">充值时间：{formatDate(row.confirmedAt)}</p> : null}

                  <LimitTimeline
                    compact
                    segments={row.segments}
                    currentTime={history.currentTime}
                    originalExpiresAt={history.originalExpiresAt}
                  />
                </article>
              ))}
            </div>
          </section>
        </section>
      )}
    </AppLayout>
  );
}

function HistoryTile({ label, value }: { label: string; value: string }) {
  return (
    <div className="info-tile">
      <p className="page-kicker">{label}</p>
      <strong>{value}</strong>
    </div>
  );
}
