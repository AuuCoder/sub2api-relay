import { FormEvent, useState } from "react";
import { useNavigate } from "react-router-dom";
import { AppLayout } from "../components/Layout";
import { postJson } from "../lib/api";

const securityHighlights = [
  {
    label: "写操作保护",
    value: "CSRF 校验 + HttpOnly Cookie"
  },
  {
    label: "会话策略",
    value: "绝对过期与空闲超时双重控制"
  },
  {
    label: "登录防护",
    value: "失败限流与短时锁定"
  }
];

export function AdminLoginPage() {
  const navigate = useNavigate();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setPending(true);

    try {
      await postJson("/api/admin/login", { username, password });
      navigate("/muyu");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "登录失败");
    } finally {
      setPending(false);
    }
  }

  return (
    <AppLayout kicker="Admin Console" title="运营与安全控制台" wide>
      <section className="admin-login-shell">
        <article className="glass admin-login-brief">
          <p className="kicker">安全入口</p>
          <h2>仅允许已授权管理员进入</h2>
          <p className="muted-line">
            后台写操作已启用会话校验、来源限制与 CSRF 令牌保护。建议在部署时同步配置
            `ADMIN_USERNAME` 与 `ADMIN_PASSWORD`，避免继续使用默认口令。
          </p>

          <div className="admin-highlight-grid">
            {securityHighlights.map((item) => (
              <article key={item.label} className="admin-highlight-card">
                <span>{item.label}</span>
                <strong>{item.value}</strong>
              </article>
            ))}
          </div>

          <div className="toolbar-strip">
            <p className="toolbar-note">
              建议仅从你的主域名或本机调试入口访问后台，避免跨来源暴露管理会话。
            </p>
          </div>
        </article>

        <article className="glass form-card admin-login-panel">
          <div className="admin-login-panel-head">
            <p className="kicker">身份验证</p>
            <h2>登录管理后台</h2>
            <p className="muted-line">请输入管理员账号与密码以继续。</p>
          </div>

          <form className="stack-form" onSubmit={onSubmit}>
            <label>
              <span>管理员账号</span>
              <input
                autoComplete="username"
                value={username}
                onChange={(event) => setUsername(event.target.value)}
                placeholder="请输入管理员账号"
              />
            </label>
            <label>
              <span>管理员密码</span>
              <input
                type="password"
                autoComplete="current-password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                placeholder="请输入管理员密码"
              />
            </label>
            {error ? <p className="error-text">{error}</p> : null}
            <button className="primary-button" type="submit" disabled={pending || !username || !password}>
              {pending ? "正在验证身份..." : "进入控制台"}
            </button>
          </form>
        </article>
      </section>
    </AppLayout>
  );
}
