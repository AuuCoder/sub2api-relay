import { type ReactNode } from "react";
import { Link, NavLink } from "react-router-dom";
import { cn } from "../lib/utils";

type NavItem = {
  label: string;
  to: string;
};

type LayoutProps = {
  title?: string;
  kicker?: string;
  actions?: ReactNode;
  children: ReactNode;
  navItems?: NavItem[];
  wide?: boolean;
};

export function AppLayout({ title, kicker, actions, children, navItems = [], wide }: LayoutProps) {
  return (
    <div className="app-shell">
      <div className="site-glow site-glow-a" />
      <div className="site-glow site-glow-b" />
      <header className="site-header">
        <div className="site-frame header-row">
          <Link to="/" className="site-brand">
            <span className="site-brand-mark">H</span>
            <span className="site-brand-copy">
              <small>HAOCUN</small>
              <strong>Codex API</strong>
            </span>
          </Link>

          {navItems.length ? (
            <nav className="site-nav">
              {navItems.map((item) => (
                <NavLink
                  key={item.to}
                  to={item.to}
                  end={item.to === "/"}
                  className={({ isActive }) => cn("site-nav-link", isActive && "is-active")}
                >
                  {item.label}
                </NavLink>
              ))}
            </nav>
          ) : (
            <div />
          )}

          <div className="site-actions">{actions}</div>
        </div>
      </header>

      <main className={cn("site-frame site-main", wide && "is-wide")}>
        {title || kicker ? (
          <section className="page-head">
            {kicker ? <p className="page-kicker">{kicker}</p> : null}
            {title ? <h1 className="page-title">{title}</h1> : null}
          </section>
        ) : null}
        {children}
      </main>

      <footer className="site-footer">
        <div className="site-frame footer-row">© {new Date().getFullYear()} HAOCUN Codex API</div>
      </footer>
    </div>
  );
}
