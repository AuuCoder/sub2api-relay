import { useEffect, useMemo, useState } from "react";
import { Pencil, Plus, Power, Trash2 } from "lucide-react";
import { useParams } from "react-router-dom";
import { AppLayout } from "../components/Layout";
import { CopyField, Modal, StatusBadge } from "../components/PublicUi";
import { deleteJson, getJson, patchJson, postJson } from "../lib/api";
import {
  ensureV1Url,
  formatDate,
  formatInteger,
  formatMoney,
  maskSecret,
  rememberCdk
} from "../lib/utils";
import type { ApiKeyItem, ApiKeysResponse, RedeemDetail } from "../types";

type KeyFormState = {
  name: string;
  followPrimaryExpires: boolean;
  expiresAt: string;
  limit5hUsd: string;
  limitDailyUsd: string;
  limitWeeklyUsd: string;
  limitMonthlyUsd: string;
  limitTotalUsd: string;
  limitConcurrentSessions: string;
};

const numericFields: Array<[string, keyof Pick<
  KeyFormState,
  | "limit5hUsd"
  | "limitDailyUsd"
  | "limitWeeklyUsd"
  | "limitMonthlyUsd"
  | "limitTotalUsd"
  | "limitConcurrentSessions"
>]> = [
  ["5H额度", "limit5hUsd"],
  ["日额度", "limitDailyUsd"],
  ["周额度", "limitWeeklyUsd"],
  ["月额度", "limitMonthlyUsd"],
  ["总额度", "limitTotalUsd"],
  ["Session限制", "limitConcurrentSessions"]
];

export function CdkKeysPage() {
  const { cdk = "" } = useParams();
  const [detail, setDetail] = useState<RedeemDetail | null>(null);
  const [keys, setKeys] = useState<ApiKeysResponse["data"] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<ApiKeyItem | null>(null);
  const [form, setForm] = useState<KeyFormState>(emptyForm(null));

  const navItems = useMemo(
    () => [
      { label: "激活首页", to: `/${encodeURIComponent(cdk)}` },
      { label: "限额变化历史", to: `/${encodeURIComponent(cdk)}/history` },
      { label: "API Key管理", to: `/${encodeURIComponent(cdk)}/keys` }
    ],
    [cdk]
  );

  const primary = keys?.items.find((item) => item.isPrimary) ?? null;
  const children = keys?.items.filter((item) => !item.isPrimary) ?? [];
  const endpoint = ensureV1Url(detail?.remote_web_url);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);

    Promise.all([
      getJson<RedeemDetail>(`/api/redeem/${encodeURIComponent(cdk)}`),
      getJson<ApiKeysResponse>(`/api/redeem/${encodeURIComponent(cdk)}/api-keys`)
    ])
      .then(([detailPayload, keysPayload]) => {
        if (cancelled) return;
        setDetail(detailPayload);
        setKeys(keysPayload.data);
        rememberCdk(cdk);
      })
      .catch((cause) => {
        if (cancelled) return;
        setError(cause instanceof Error ? cause.message : "加载失败");
      })
      .finally(() => {
        if (cancelled) return;
        setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [cdk]);

  function openCreate() {
    setEditing(null);
    setForm(emptyForm(keys?.primaryExpiresAt ?? null));
    setModalOpen(true);
  }

  function openEdit(item: ApiKeyItem) {
    setEditing(item);
    setForm(formFromItem(item, keys?.primaryExpiresAt ?? null));
    setModalOpen(true);
  }

  async function reload() {
    const [detailPayload, keysPayload] = await Promise.all([
      getJson<RedeemDetail>(`/api/redeem/${encodeURIComponent(cdk)}`),
      getJson<ApiKeysResponse>(`/api/redeem/${encodeURIComponent(cdk)}/api-keys`)
    ]);
    setDetail(detailPayload);
    setKeys(keysPayload.data);
  }

  async function submitForm() {
    if (!keys) return;
    setBusy(true);
    try {
      const payload = {
        name: form.name.trim(),
        follow_primary_expires: form.followPrimaryExpires,
        expires_at: form.followPrimaryExpires ? null : toIsoString(form.expiresAt),
        limit_5h_usd: parseNullableNumber(form.limit5hUsd),
        limit_daily_usd: parseNullableNumber(form.limitDailyUsd),
        limit_weekly_usd: parseNullableNumber(form.limitWeeklyUsd),
        limit_monthly_usd: parseNullableNumber(form.limitMonthlyUsd),
        limit_total_usd: parseNullableNumber(form.limitTotalUsd),
        limit_concurrent_sessions: parseNullableInteger(form.limitConcurrentSessions)
      };

      if (editing) {
        await patchJson(`/api/redeem/${encodeURIComponent(cdk)}/api-keys/${editing.id}`, payload);
      } else {
        await postJson(`/api/redeem/${encodeURIComponent(cdk)}/api-keys`, payload);
      }

      setModalOpen(false);
      await reload();
    } finally {
      setBusy(false);
    }
  }

  async function toggleEnabled(item: ApiKeyItem) {
    setBusy(true);
    try {
      await postJson(`/api/redeem/${encodeURIComponent(cdk)}/api-keys/${item.id}/enabled`, {
        is_enabled: !item.isEnabled
      });
      await reload();
    } finally {
      setBusy(false);
    }
  }

  async function removeKey(item: ApiKeyItem) {
    if (!window.confirm(`确认删除子 Key「${item.name}」？`)) return;
    setBusy(true);
    try {
      await deleteJson(`/api/redeem/${encodeURIComponent(cdk)}/api-keys/${item.id}`);
      await reload();
    } finally {
      setBusy(false);
    }
  }

  return (
    <AppLayout navItems={navItems} wide>
      {loading ? (
        <div className="center-panel">
          <div className="surface-card-strong center-card">正在加载 API Key...</div>
        </div>
      ) : detail?.recharge_usage ? (
        <div className="center-panel">
          <div className="surface-card-strong center-card">该 CDK 已用于为其他 CDK 充值，不再展示 API Key 管理。</div>
        </div>
      ) : error || !keys ? (
        <div className="center-panel">
          <div className="surface-card-strong center-card is-error">{error ?? "暂无数据"}</div>
        </div>
      ) : (
        <section className="public-stack">
          <section className="surface-card-strong panel-card">
            <div className="card-header-block">
              <h1 className="panel-title-large">API Key 管理</h1>
              <p className="muted-line">{keys.userName || keys.cdk}</p>
            </div>
          </section>

          <section className="surface-card panel-card">
            <div className="card-header-block">
              <h2>主 Key</h2>
            </div>

            {primary ? (
              <div className="key-stack">
                <CopyField label="Key" value={primary.key} displayValue={maskSecret(primary.key)} />
                {endpoint ? <CopyField label="接入地址" value={endpoint} /> : null}
                <KeyUsageGrid item={primary} primaryLimits={keys.primaryLimits} />
              </div>
            ) : (
              <div className="toolbar-strip">未找到主 Key</div>
            )}
          </section>

          <section className="surface-card panel-card">
            <div className="section-head">
              <div className="section-title">
                <h2>子 Key</h2>
              </div>
              <button type="button" className="primary-button is-inline" onClick={openCreate} disabled={busy}>
                <Plus size={16} />
                创建子 Key
              </button>
            </div>

            {children.length ? (
              <div className="child-keys">
                {children.map((item) => (
                  <article key={item.id} className="child-key-card">
                    <div className="child-key-head">
                      <div className="child-key-copy">
                        <span className="stat-chip">子Key</span>
                        <strong>{item.name}</strong>
                        <StatusBadge tone={item.isEnabled ? "success" : "neutral"}>
                          {item.isEnabled ? "启用中" : "已禁用"}
                        </StatusBadge>
                      </div>

                      <div className="child-key-actions">
                        <button type="button" className="icon-button" onClick={() => openEdit(item)} disabled={busy}>
                          <Pencil size={16} />
                        </button>
                        <button type="button" className="icon-button" onClick={() => void toggleEnabled(item)} disabled={busy}>
                          <Power size={16} />
                        </button>
                        <button type="button" className="icon-button" onClick={() => void removeKey(item)} disabled={busy}>
                          <Trash2 size={16} />
                        </button>
                      </div>
                    </div>

                    <CopyField label="Key" value={item.key} displayValue={maskSecret(item.key)} />
                    <KeyUsageGrid item={item} primaryLimits={keys.primaryLimits} />
                  </article>
                ))}
              </div>
            ) : (
              <div className="toolbar-strip">还没有子 Key</div>
            )}
          </section>

          <Modal
            open={modalOpen}
            onClose={() => setModalOpen(false)}
            title={editing ? "编辑子 Key" : "创建子 Key"}
            description={editing ? "留空字段会保持当前值。" : "留空的限额默认跟随主 Key。"}
            footer={
              <>
                <button type="button" className="secondary-button is-inline" onClick={() => setModalOpen(false)}>
                  关闭
                </button>
                <button type="button" className="primary-button is-inline" onClick={() => void submitForm()} disabled={busy}>
                  {busy ? "处理中..." : editing ? "保存" : "创建"}
                </button>
              </>
            }
          >
            <div className="modal-stack">
              <label className="field-block">
                <span>Key 名称</span>
                <input
                  value={form.name}
                  onChange={(event) => setForm((state) => ({ ...state, name: event.target.value }))}
                  placeholder="请输入名称"
                />
              </label>

              <div className="mode-row">
                <button
                  type="button"
                  className={form.followPrimaryExpires ? "mode-chip is-active" : "mode-chip"}
                  onClick={() => setForm((state) => ({ ...state, followPrimaryExpires: true }))}
                >
                  跟随主 Key
                </button>
                <button
                  type="button"
                  className={!form.followPrimaryExpires ? "mode-chip is-active" : "mode-chip"}
                  onClick={() => setForm((state) => ({ ...state, followPrimaryExpires: false }))}
                >
                  自定义
                </button>
              </div>

              {!form.followPrimaryExpires ? (
                <label className="field-block">
                  <span>到期时间</span>
                  <input
                    type="datetime-local"
                    value={form.expiresAt}
                    onChange={(event) => setForm((state) => ({ ...state, expiresAt: event.target.value }))}
                  />
                </label>
              ) : null}

              <div className="form-grid">
                {numericFields.map(([label, key]) => (
                  <label key={key} className="field-block">
                    <span>{label}</span>
                    <input
                      type="number"
                      min="0"
                      step={key === "limitConcurrentSessions" ? "1" : "0.01"}
                      value={form[key]}
                      onChange={(event) =>
                        setForm((state) => ({
                          ...state,
                          [key]: event.target.value
                        }))
                      }
                    />
                  </label>
                ))}
              </div>
            </div>
          </Modal>
        </section>
      )}
    </AppLayout>
  );
}

function KeyUsageGrid({
  item,
  primaryLimits
}: {
  item: ApiKeyItem;
  primaryLimits: ApiKeysResponse["data"]["primaryLimits"];
}) {
  const usage = item.usage;
  const rows = [
    ["5H 已用", `${formatMoney(usage.cost5h.current)} / ${formatMoney(usage.cost5h.limit ?? item.limit5hUsd ?? primaryLimits.limit5hUsd)}`],
    ["日已用", `${formatMoney(usage.costDaily.current)} / ${formatMoney(usage.costDaily.limit ?? item.limitDailyUsd ?? primaryLimits.limitDailyUsd)}`],
    ["周已用", `${formatMoney(usage.costWeekly.current)} / ${formatMoney(usage.costWeekly.limit ?? item.limitWeeklyUsd ?? primaryLimits.limitWeeklyUsd)}`],
    ["月已用", `${formatMoney(usage.costMonthly.current)} / ${formatMoney(usage.costMonthly.limit ?? item.limitMonthlyUsd ?? primaryLimits.limitMonthlyUsd)}`],
    ["总已用", `${formatMoney(usage.costTotal.current)} / ${formatMoney(usage.costTotal.limit ?? item.limitTotalUsd ?? primaryLimits.limitTotalUsd)}`],
    ["Session", `${formatInteger(usage.concurrentSessions.current)} / ${formatInteger(usage.concurrentSessions.limit ?? item.limitConcurrentSessions ?? primaryLimits.limitConcurrentSessions)}`],
    ["到期", formatDate(item.effectiveExpiresAt)],
    ["请求", formatInteger(usage.summary.totalRequests)],
    ["成本", formatMoney(usage.summary.totalCost)]
  ];

  return (
    <div className="key-usage-grid">
      {rows.map(([label, value]) => (
        <div key={label} className="info-tile">
          <p className="page-kicker">{label}</p>
          <strong>{value}</strong>
        </div>
      ))}
    </div>
  );
}

function emptyForm(primaryExpiresAt: string | null): KeyFormState {
  return {
    name: "",
    followPrimaryExpires: true,
    expiresAt: toLocalValue(primaryExpiresAt),
    limit5hUsd: "",
    limitDailyUsd: "",
    limitWeeklyUsd: "",
    limitMonthlyUsd: "",
    limitTotalUsd: "",
    limitConcurrentSessions: ""
  };
}

function formFromItem(item: ApiKeyItem, primaryExpiresAt: string | null): KeyFormState {
  return {
    name: item.name,
    followPrimaryExpires: !item.expiresAt || item.expiresAt === primaryExpiresAt,
    expiresAt: toLocalValue(item.effectiveExpiresAt),
    limit5hUsd: item.limit5hUsd == null ? "" : String(item.limit5hUsd),
    limitDailyUsd: item.limitDailyUsd == null ? "" : String(item.limitDailyUsd),
    limitWeeklyUsd: item.limitWeeklyUsd == null ? "" : String(item.limitWeeklyUsd),
    limitMonthlyUsd: item.limitMonthlyUsd == null ? "" : String(item.limitMonthlyUsd),
    limitTotalUsd: item.limitTotalUsd == null ? "" : String(item.limitTotalUsd),
    limitConcurrentSessions: item.limitConcurrentSessions == null ? "" : String(item.limitConcurrentSessions)
  };
}

function parseNullableNumber(value: string) {
  const trimmed = value.trim();
  if (!trimmed) return null;
  const parsed = Number(trimmed);
  return Number.isFinite(parsed) ? parsed : null;
}

function parseNullableInteger(value: string) {
  const trimmed = value.trim();
  if (!trimmed) return null;
  const parsed = Number(trimmed);
  return Number.isInteger(parsed) ? parsed : null;
}

function toIsoString(value: string) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function toLocalValue(value: string | null) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const pad = (input: number) => String(input).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}
