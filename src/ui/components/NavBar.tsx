"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const NAV_LINKS = [
  { label: "Dashboard", href: "/" },
  { label: "Learn", href: "/learn" },
  { label: "Chat", href: "/chat" },
  { label: "Flashcards", href: "/flashcards" },
  { label: "Guides", href: "/guides" },
  { label: "Plan", href: "/plan" },
  { label: "Settings", href: "/settings" },
] as const;

const NAV_HEIGHT = 52;

export function NavBar() {
  const pathname = usePathname();

  function isActive(href: string): boolean {
    if (href === "/") return pathname === "/";
    return pathname === href || pathname.startsWith(href + "/");
  }

  const barStyle: React.CSSProperties = {
    position: "fixed",
    top: 0,
    left: 0,
    right: 0,
    height: NAV_HEIGHT,
    background: "#1f2e1f",
    borderBottom: "1px solid #3a5a3a",
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    padding: "0 1.25rem",
    fontFamily: "var(--font-body)",
    zIndex: 9999,
  };

  const brandStyle: React.CSSProperties = {
    color: "#f0dc4e",
    fontSize: "1.4rem",
    fontWeight: "bold",
    textDecoration: "none",
    fontFamily: "var(--font-display)",
    letterSpacing: "0.02em",
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
            color: active ? "#f0dc4e" : "#a89a82",
            textDecoration: "none",
            fontFamily: "var(--font-body)",
            fontSize: "1rem",
            fontWeight: active ? "bold" : "normal",
            borderBottom: active ? "2px solid #f0dc4e" : "2px solid transparent",
            transition: "color 0.15s, border-color 0.15s",
            whiteSpace: "nowrap",
          };

          return (
            <li key={href}>
              <Link
                href={href}
                style={linkStyle}
                onMouseEnter={(e) => {
                  if (!active) e.currentTarget.style.color = "#e8dcc8";
                }}
                onMouseLeave={(e) => {
                  if (!active) e.currentTarget.style.color = "#a89a82";
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
