"use client";

import { useState } from "react";
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
  const [menuOpen, setMenuOpen] = useState(false);

  function isActive(href: string): boolean {
    if (href === "/") return pathname === "/";
    return pathname === href || pathname.startsWith(href + "/");
  }

  function handleLinkClick() {
    setMenuOpen(false);
  }

  const barStyle: React.CSSProperties = {
    position: "fixed",
    top: 0,
    left: 0,
    right: 0,
    height: NAV_HEIGHT,
    background: "var(--color-bg-darkest)",
    borderBottom: "1px solid var(--color-border-subtle)",
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    padding: "0 1.25rem",
    fontFamily: "var(--font-body)",
    zIndex: 9999,
  };

  const brandStyle: React.CSSProperties = {
    color: "var(--color-primary)",
    fontSize: "1.4rem",
    fontWeight: "bold",
    textDecoration: "none",
    fontFamily: "var(--font-display)",
    letterSpacing: "0.02em",
    flexShrink: 0,
  };

  const navListStyle: React.CSSProperties = {
    listStyle: "none",
    margin: 0,
    padding: 0,
    gap: "0.25rem",
    overflow: "auto",
  };

  return (
    <nav
      style={barStyle}
      className="nav-container"
      role="navigation"
      aria-label="Main navigation"
    >
      <Link href="/" style={brandStyle} onClick={handleLinkClick}>
        Study Bot
      </Link>

      <button
        className="nav-hamburger"
        aria-label="Toggle menu"
        aria-expanded={menuOpen}
        onClick={() => setMenuOpen((prev) => !prev)}
      >
        <span className="nav-hamburger-line" />
      </button>

      <ul
        style={navListStyle}
        className={`nav-links${menuOpen ? " open" : ""}`}
      >
        {NAV_LINKS.map(({ label, href }) => {
          const active = isActive(href);
          const linkStyle: React.CSSProperties = {
            display: "block",
            padding: "0.35rem 0.75rem",
            color: active ? "var(--color-primary)" : "var(--color-text-muted)",
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
                aria-current={active ? "page" : undefined}
                onClick={handleLinkClick}
                onMouseEnter={(e) => {
                  if (!active) e.currentTarget.style.color = "var(--color-text)";
                }}
                onMouseLeave={(e) => {
                  if (!active) e.currentTarget.style.color = "var(--color-text-muted)";
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
