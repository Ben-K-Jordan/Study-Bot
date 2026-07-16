// ---------------------------------------------------------------------------
// Email templates for Study Bot
// All HTML uses inline styles (email-safe) with the app's dark green theme.
// ---------------------------------------------------------------------------

const APP_URL = process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";

/** Escape user-supplied strings before embedding in HTML */
function esc(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

// ── Theme tokens ────────────────────────────────────────────────────────────

const BG = "#2a3d2a";
const BG_CARD = "#344a34";
const TEXT = "#e8dcc8";
const TEXT_MUTED = "#b8b0a0";
const ACCENT = "#f0dc4e";
const CTA_BG = "#f0dc4e";
const CTA_TEXT = "#2a3d2a";

// ── Shared layout helpers ───────────────────────────────────────────────────

function layout(body: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head><meta charset="utf-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/></head>
<body style="margin:0;padding:0;background-color:${BG};font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:${TEXT};">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:${BG};">
<tr><td align="center" style="padding:32px 16px;">
<table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;background-color:${BG_CARD};border-radius:12px;overflow:hidden;">
<tr><td style="padding:32px 28px;">
${body}
</td></tr>
</table>
<!-- Footer -->
<table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;">
<tr><td style="padding:16px 28px;text-align:center;">
<p style="margin:0;font-size:12px;color:${TEXT_MUTED};">
You&rsquo;re receiving this because you have email reminders enabled in Study Bot.<br/>
<a href="${APP_URL}/settings#notifications" style="color:${TEXT_MUTED};text-decoration:underline;">Unsubscribe or change notification preferences</a>
</p>
</td></tr>
</table>
</td></tr>
</table>
</body>
</html>`;
}

function ctaButton(text: string, href: string): string {
  return `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:24px 0;">
<tr><td style="background-color:${CTA_BG};border-radius:8px;padding:14px 28px;">
<a href="${esc(href)}" style="color:${CTA_TEXT};font-weight:700;font-size:16px;text-decoration:none;display:inline-block;">${esc(text)}</a>
</td></tr>
</table>`;
}

function heading(text: string): string {
  return `<h1 style="margin:0 0 16px;font-size:24px;color:${ACCENT};">${text}</h1>`;
}

function paragraph(text: string): string {
  return `<p style="margin:0 0 14px;font-size:15px;line-height:1.6;color:${TEXT};">${text}</p>`;
}

function signOff(text: string): string {
  return `<p style="margin:24px 0 0;font-size:13px;color:${TEXT_MUTED};font-style:italic;">${text}</p>`;
}

// ── 1. Email Verification ──────────────────────────────────────────────────

export function emailVerification(
  name: string,
  verifyUrl: string,
): { subject: string; html: string } {
  const subject = "Verify your Study Bot account";

  const html = layout(`
${heading("Almost there!")}
${paragraph(`Hi ${esc(name)},`)}
${paragraph(
  "Welcome to Study Bot! Before we can start your journey to academic greatness, we need to make sure you're a real human and not a very studious robot.",
)}
${paragraph(
  "Click the button below to verify your email. This link expires in 24 hours — which is still more time than you spend studying. (We'll fix that.)",
)}
${ctaButton("Verify My Email", verifyUrl)}
${paragraph(
  `<span style="font-size:13px;color:${TEXT_MUTED};">If the button doesn't work, copy this link into your browser:<br/><a href="${esc(verifyUrl)}" style="color:${ACCENT};word-break:break-all;">${esc(verifyUrl)}</a></span>`,
)}
${signOff("— Study Bot (Yes, we verify emails. We're responsible like that.)")}
  `);

  return { subject, html };
}

// ── 2. Password Reset ──────────────────────────────────────────────────────

export function passwordReset(
  name: string,
  resetUrl: string,
): { subject: string; html: string } {
  const subject = "Reset your Study Bot password";

  const html = layout(`
${heading("Password Reset")}
${paragraph(`Hi ${esc(name)},`)}
${paragraph(
  "Someone (hopefully you) requested a password reset. If this wasn't you, just ignore this email and your password will stay the same.",
)}
${paragraph(
  "This link expires in 1 hour. If you miss the window, just request another one. We've got plenty.",
)}
${ctaButton("Reset My Password", resetUrl)}
${paragraph(
  `<span style="font-size:13px;color:${TEXT_MUTED};">If the button doesn't work, copy this link:<br/><a href="${esc(resetUrl)}" style="color:${ACCENT};word-break:break-all;">${esc(resetUrl)}</a></span>`,
)}
${signOff("— Study Bot (Keeping your account safe since... well, today.)")}
  `);

  return { subject, html };
}
