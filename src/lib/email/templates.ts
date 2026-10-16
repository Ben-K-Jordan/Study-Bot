// ---------------------------------------------------------------------------
// Account emails for Study Bot (verification, password reset).
// Inline styles and table layout so they render in mail clients; colours
// are the app's Material 3 light roles. Copy follows VOICE.md: calm, direct,
// no jokes, no "we", no dashes or exclamation marks.
// ---------------------------------------------------------------------------

import { getBaseUrl } from "@/lib/config";

/** Escape user-supplied strings before embedding in HTML */
function esc(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

// ── Theme tokens (GM3 light) ────────────────────────────────────────────────

const PAGE_BG = "#F0F4F9"; // surface-container
const CARD_BG = "#FFFFFF"; // surface-container-lowest
const TEXT = "#1F1F1F"; // on-surface
const TEXT_MUTED = "#444746"; // on-surface-variant
const HAIRLINE = "#C4C7C5"; // outline-variant
const PRIMARY = "#0B57D0"; // primary
const ON_PRIMARY = "#FFFFFF"; // on-primary
const FONT =
  "'Google Sans Flex','Google Sans',Roboto,-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif";

// ── Shared layout helpers ───────────────────────────────────────────────────

function layout({ preview, body, footer }: { preview: string; body: string; footer: string }): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<meta name="color-scheme" content="light"/>
<meta name="supported-color-schemes" content="light"/>
</head>
<body style="margin:0;padding:0;background-color:${PAGE_BG};font-family:${FONT};color:${TEXT};">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;">${esc(preview)}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:${PAGE_BG};">
<tr><td align="center" style="padding:32px 16px;">
<table role="presentation" width="560" cellpadding="0" cellspacing="0" style="max-width:560px;width:100%;">
<tr><td style="padding:0 8px 16px;">
${brand()}
</td></tr>
</table>
<table role="presentation" width="560" cellpadding="0" cellspacing="0" style="max-width:560px;width:100%;background-color:${CARD_BG};border:1px solid ${HAIRLINE};border-radius:16px;">
<tr><td style="padding:32px 28px;">
${body}
</td></tr>
</table>
<table role="presentation" width="560" cellpadding="0" cellspacing="0" style="max-width:560px;width:100%;">
<tr><td style="padding:16px 8px;">
<p style="margin:0;font-size:12px;line-height:16px;color:${TEXT_MUTED};">${footer}</p>
<p style="margin:8px 0 0;font-size:12px;line-height:16px;color:${TEXT_MUTED};">Study Bot &middot; <a href="${esc(getBaseUrl())}" style="color:${TEXT_MUTED};text-decoration:underline;">${esc(displayHost())}</a></p>
</td></tr>
</table>
</td></tr>
</table>
</body>
</html>`;
}

function displayHost(): string {
  try {
    return new URL(getBaseUrl()).host;
  } catch {
    return getBaseUrl();
  }
}

/** The app mark (a rounded square in primary) and name, drawn with tables. */
function brand(): string {
  return `<table role="presentation" cellpadding="0" cellspacing="0"><tr>
<td style="width:28px;height:28px;background-color:${PRIMARY};border-radius:8px;" aria-hidden="true">&nbsp;</td>
<td style="padding-left:10px;font-size:16px;line-height:24px;font-weight:500;color:${TEXT};">Study Bot</td>
</tr></table>`;
}

function ctaButton(text: string, href: string): string {
  return `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:24px 0;">
<tr><td style="background-color:${PRIMARY};border-radius:20px;">
<a href="${esc(href)}" style="display:inline-block;padding:10px 24px;color:${ON_PRIMARY};font-size:14px;line-height:20px;font-weight:500;letter-spacing:0.1px;text-decoration:none;border-radius:20px;">${esc(text)}</a>
</td></tr>
</table>`;
}

function heading(text: string): string {
  return `<h1 style="margin:0 0 16px;font-size:24px;line-height:32px;font-weight:400;color:${TEXT};">${esc(text)}</h1>`;
}

function paragraph(html: string): string {
  return `<p style="margin:0 0 14px;font-size:16px;line-height:24px;color:${TEXT};">${html}</p>`;
}

function fallbackLink(url: string): string {
  return `<p style="margin:0;font-size:12px;line-height:16px;color:${TEXT_MUTED};">If the button doesn't work, copy this link into your browser:<br/><a href="${esc(url)}" style="color:${PRIMARY};word-break:break-all;">${esc(url)}</a></p>`;
}

function greeting(name: string): string {
  const trimmed = name.trim();
  return paragraph(trimmed ? `Hi ${esc(trimmed)},` : "Hi,");
}

// ── 1. Email Verification ──────────────────────────────────────────────────

export function emailVerification(
  name: string,
  verifyUrl: string,
): { subject: string; html: string } {
  const subject = "Verify your Study Bot account";

  const html = layout({
    preview: "Verify this address to finish creating your account. The link expires in 24 hours.",
    body: `
${heading("Verify your email")}
${greeting(name)}
${paragraph("Verify this email address to finish creating your Study Bot account.")}
${ctaButton("Verify email", verifyUrl)}
${paragraph("This link expires in 24 hours.")}
${fallbackLink(verifyUrl)}
`,
    footer:
      "You're getting this email because this address was used to create a Study Bot account. If that wasn't you, ignore this email.",
  });

  return { subject, html };
}

// ── 2. Password Reset ──────────────────────────────────────────────────────

export function passwordReset(
  name: string,
  resetUrl: string,
): { subject: string; html: string } {
  const subject = "Reset your Study Bot password";

  const html = layout({
    preview: "Choose a new password for Study Bot. The link expires in 1 hour.",
    body: `
${heading("Reset your password")}
${greeting(name)}
${paragraph("Use this link to choose a new password for your Study Bot account.")}
${ctaButton("Reset password", resetUrl)}
${paragraph("This link expires in 1 hour. If it expires, request a new one from the sign-in page.")}
${fallbackLink(resetUrl)}
`,
    footer:
      "You're getting this email because a password reset was requested for this address. If you didn't ask for it, ignore this email and your password stays the same.",
  });

  return { subject, html };
}
