"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const NAV_LINKS = [
  { label: "Dashboard", href: "/" },
  { label: "Plan", href: "/plan" },
  { label: "Settings", href: "/settings" },
] as const;

const NAV_HEIGHT = 52;

export function NavBar() {
  const pathname = usePathname();

  function isActive(href: string): boolean {
    if (href === "/") return pathname === "/";
    return pathname.startsWith(href);
  }

  const barStyle: React.CSSProperties = {
    position: "fixed",
    top: 0,
    left: 0,
    right: 0,
    height: NAV_HEIGHT,
    background: "#0d1117",
    borderBottom: "1px solid #1e2a3a",
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    padding: "0 1.25rem",
    fontFamily: "monospace",
    zIndex: 9999,
  };

  const brandStyle: React.CSSProperties = {
    color: "#00ff88",
    fontSize: "1.1rem",
    fontWeight: "bold",
    textDecoration: "none",
    fontFamily: "monospace",
    letterSpacing: "0.05em",
    flexShrink: 0,
  };

  const navListStyle: React.CSSProperties = {
    display: "flex",
    listStyle: "none",
    margin: 0,
    padding: 0,
    gap: "0.25rem",
    overflow: "auto",
  };

  return (
    <nav style={barStyle}>
      <Link href="/" style={brandStyle}>
        Study Bot
      </Link>

      <ul style={navListStyle}>
        {NAV_LINKS.map(({ label, href }) => {
          const active = isActive(href);
          const linkStyle: React.CSSProperties = {
            display: "block",
            padding: "0.35rem 0.75rem",
            color: active ? "#00ff88" : "#888",
            textDecoration: "none",
            fontFamily: "monospace",
            fontSize: "0.85rem",
            fontWeight: active ? "bold" : "normal",
            borderBottom: active ? "2px solid #00ff88" : "2px solid transparent",
            transition: "color 0.15s, border-color 0.15s",
            whiteSpace: "nowrap",
          };

          return (
            <li key={href}>
              <Link
                href={href}
                style={linkStyle}
                onMouseEnter={(e) => {
                  if (!active) e.currentTarget.style.color = "#ccc";
                }}
                onMouseLeave={(e) => {
                  if (!active) e.currentTarget.style.color = "#888";
                }}
              >
                {label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

export { NAV_HEIGHT };
