"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";

// Consolidated top-level destinations. Chat, Flashcards, and Guides are
// reachable from the Learn page's quick actions and learning path.
const NAV_LINKS = [
  { label: "Dashboard", href: "/" },
  { label: "Learn", href: "/learn" },
  { label: "Plan", href: "/plan" },
  { label: "Settings", href: "/settings" },
] as const;

const NAV_HEIGHT = 52;

export function NavBar() {
  const pathname = usePathname();
  const [menuOpen, setMenuOpen] = useState(false);
  const navRef = useRef<HTMLElement>(null);
  const hamburgerRef = useRef<HTMLButtonElement>(null);

  // Active study sessions (including break screens) live under /s/ — sacred
  // focus time, so the nav recedes to brand + a single quiet exit.
  const inSession = pathname === "/s" || pathname.startsWith("/s/");

  function isActive(href: string): boolean {
    if (href === "/") return pathname === "/";
    return pathname === href || pathname.startsWith(href + "/");
  }

  function handleLinkClick() {
    setMenuOpen(false);
  }

  // Close menu on Escape key
  const handleKeyDown = useCallback((e: KeyboardEvent) => {
    if (e.key === "Escape" && menuOpen) {
      setMenuOpen(false);
      hamburgerRef.current?.focus();
    }
  }, [menuOpen]);

  useEffect(() => {
    if (menuOpen) {
      document.addEventListener("keydown", handleKeyDown);
      return () => document.removeEventListener("keydown", handleKeyDown);
    }
  }, [menuOpen, handleKeyDown]);

  // Focus trap: keep Tab within menu when open
  useEffect(() => {
    if (!menuOpen || !navRef.current) return;

    function trapFocus(e: KeyboardEvent) {
      if (e.key !== "Tab") return;
      const nav = navRef.current;
      if (!nav) return;
      const focusable = nav.querySelectorAll<HTMLElement>(
        'a[href], button:not([disabled]), [tabindex]:not([tabindex="-1"])'
      );
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    }

    document.addEventListener("keydown", trapFocus);
    return () => document.removeEventListener("keydown", trapFocus);
  }, [menuOpen]);

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
    fontWeight: 600,
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

  // In-session: minimal chrome — brand as plain text (not a link) plus one
  // quiet exit back to the dashboard. No link grid, no hamburger.
  if (inSession) {
    return (
      <nav
        style={barStyle}
        className="nav-container"
        role="navigation"
        aria-label="Main navigation"
      >
        <span style={brandStyle}>Study Bot</span>
        <Link
          href="/"
          style={{
            color: "var(--color-text-muted)",
            textDecoration: "none",
            fontFamily: "var(--font-body)",
            fontSize: "0.9rem",
            padding: "0.35rem 0.75rem",
            whiteSpace: "nowrap",
            transition: "color 0.15s",
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.color = "var(--color-text)";
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.color = "var(--color-text-muted)";
          }}
        >
          Exit
        </Link>
      </nav>
    );
  }

  return (
    <nav
      ref={navRef}
      style={barStyle}
      className="nav-container"
      role="navigation"
      aria-label="Main navigation"
    >
      <Link href="/" style={brandStyle} onClick={handleLinkClick}>
        Study Bot
      </Link>

      <button
        ref={hamburgerRef}
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
            fontWeight: active ? 600 : 400,
            borderBottom: active ? "2px solid var(--color-primary)" : "2px solid transparent",
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
