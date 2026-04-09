import { FormEvent, useEffect, useState } from "react";
import { ArrowRight } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { AppLayout } from "../components/Layout";
import { extractCdkCode, getRememberedCdk } from "../lib/utils";

export function HomePage() {
  const navigate = useNavigate();
  const [input, setInput] = useState("");

  useEffect(() => {
    const remembered = getRememberedCdk();
    if (!remembered) return;
    navigate(`/${encodeURIComponent(remembered)}`, { replace: true });
  }, [navigate]);

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const code = extractCdkCode(input);
    if (!code) return;
    navigate(`/${encodeURIComponent(code)}`);
  }

  return (
    <AppLayout wide>
      <section className="home-grid">
        <div className="home-copy">
          <h1 className="page-title">HAOCUN Codex API</h1>
        </div>

        <div className="surface-card-strong home-card">
          <div className="card-header-block">
            <h2>开始提取</h2>
          </div>

          <form className="stack-form" onSubmit={onSubmit}>
            <label className="field-block" htmlFor="cdk-input">
              <span>CDK</span>
              <input
                id="cdk-input"
                value={input}
                onChange={(event) => setInput(event.target.value)}
                placeholder="粘贴你的 CDK..."
                autoComplete="off"
              />
            </label>

            <button type="submit" className="primary-button" disabled={!extractCdkCode(input)}>
              进入激活页
              <ArrowRight size={16} />
            </button>
          </form>

          <div className="toolbar-strip">
            <div className="toolbar-row">
              <span>访问方式</span>
              <code className="code-pill">/{`{cdk}`}</code>
            </div>
          </div>
        </div>
      </section>
    </AppLayout>
  );
}
