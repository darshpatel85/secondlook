import type { ReactNode } from "react";
import { Link, NavLink } from "react-router";
import { isMock } from "../api/client";
import { Logo } from "./Logo";
import { McpStatusBar } from "./McpStatusBar";
import { ThemePicker } from "./ThemePicker";

type LayoutProps = {
  children: ReactNode;
  wide?: boolean;
};

export function Layout({ children, wide = false }: LayoutProps) {
  return (
    <div className="app">
      <header className="topbar">
        <Link to="/" className="brand" aria-label="Second Look, home">
          <Logo />
        </Link>
        <nav className="topbar-nav" aria-label="Main">
          <NavLink to="/pulls" className={({ isActive }) => (isActive ? "topbar-link active" : "topbar-link")}>
            Pull requests
          </NavLink>
          <NavLink to="/stats" className={({ isActive }) => (isActive ? "topbar-link active" : "topbar-link")}>
            Stats
          </NavLink>
          <NavLink to="/settings" className={({ isActive }) => (isActive ? "topbar-link active" : "topbar-link")}>
            Settings
          </NavLink>
        </nav>
        {isMock ? <span className="topbar-note">mock data</span> : null}
        <McpStatusBar />
        <ThemePicker />
      </header>
      <main className={wide ? "page page-wide" : "page"}>{children}</main>
    </div>
  );
}
