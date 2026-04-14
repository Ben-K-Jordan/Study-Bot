// ---------------------------------------------------------------------------
// Email templates for Study Bot
// All HTML uses inline styles (email-safe) with the app's dark green theme.
// ---------------------------------------------------------------------------

const APP_URL = process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";

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
<a href="${href}" style="color:${CTA_TEXT};font-weight:700;font-size:16px;text-decoration:none;display:inline-block;">${text}</a>
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

// ── 1. Study Reminder ───────────────────────────────────────────────────────

const STUDY_SUBJECTS = [
  "Your brain called. It wants a workout.",
  "Quick reminder: knowledge doesn't download itself",
  "Your flashcards are starting to feel neglected",
  "This email will self-destruct if you don't study today",
  "Your future self is begging present you to open this",
];

function pickRandom<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

export function studyReminder(
  name: string,
  items: string[],
  minutes: number,
): { subject: string; html: string } {
  const subject = pickRandom(STUDY_SUBJECTS);

  const itemList = items
    .map(
      (item) =>
        `<li style="margin:0 0 8px;font-size:15px;color:${TEXT};">${item}</li>`,
    )
    .join("\n");

  const html = layout(`
${heading("Time to study!")}
${paragraph(`Hi ${name},`)}
${paragraph(
  "Your study plan says you should be reviewing today. Your study plan is very wise. You should listen to it.",
)}
${paragraph("Here's what's on the agenda:")}
<ul style="margin:0 0 16px;padding-left:20px;">
${itemList}
</ul>
${paragraph(
  `Estimated time: <strong style="color:${ACCENT};">${minutes} minutes</strong>. That's less time than you spent deciding what to watch last night.`,
)}
${ctaButton("Open Study Bot", APP_URL)}
${signOff("— Study Bot (The only bot that actually wants you to succeed)")}
  `);

  return { subject, html };
}

// ── 2. Streak Warning ───────────────────────────────────────────────────────

const STREAK_SUBJECTS = [
  "STREAK EMERGENCY",
  (streak: number) => `Your ${streak}-day streak is on life support`,
];

export function streakWarning(
  name: string,
  streak: number,
): { subject: string; html: string } {
  const subjectPick = pickRandom(STREAK_SUBJECTS);
  const subject =
    typeof subjectPick === "function" ? subjectPick(streak) : subjectPick;

  const html = layout(`
${heading("STREAK ALERT")}
${paragraph(`Hi ${name},`)}
${paragraph(
  `Your <strong style="color:${ACCENT};">${streak}-day</strong> study streak is in critical condition. The doctors say it needs just 5 minutes of your time to survive.`,
)}
${paragraph("Don't let it flatline. You've come so far.")}
${paragraph(
  "Open the app. Do one flashcard review. Save a streak's life.",
)}
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:20px 0;">
<tr><td style="background-color:#3a1a1a;border:1px solid #ff6b6b;border-radius:8px;padding:16px;text-align:center;">
<p style="margin:0;font-size:48px;">&#128680;</p>
<p style="margin:8px 0 0;font-size:14px;color:#ff6b6b;font-weight:700;">STREAK STATUS: CRITICAL</p>
</td></tr>
</table>
${ctaButton("Save My Streak", APP_URL)}
${signOff(
  "— Study Bot (We're not being dramatic. OK maybe a little.)",
)}
  `);

  return { subject, html };
}

// ── 3. Weekly Digest ────────────────────────────────────────────────────────

interface WeeklyStats {
  sessions: number;
  xp: number;
  accuracy: number;
  streak: number;
}

function commentary(accuracy: number): string {
  if (accuracy >= 85)
    return "Honestly? We're running out of compliments. You're making the other students look bad.";
  if (accuracy >= 70)
    return "Solid week! Your neurons are throwing a party up there.";
  if (accuracy >= 50)
    return "Not your strongest week, but hey, showing up counts. Your brain appreciates the effort.";
  return "OK so... this week happened. But here's the thing: next week is a blank canvas. Let's paint it with knowledge (and maybe a few tears, we don't judge).";
}

export function weeklyDigest(
  name: string,
  stats: WeeklyStats,
): { subject: string; html: string } {
  const subject =
    "Your week in numbers (spoiler: you're either crushing it or we need to talk)";

  const statRow = (label: string, value: string) =>
    `<tr>
<td style="padding:10px 12px;font-size:14px;color:${TEXT_MUTED};border-bottom:1px solid #4a5e4a;">${label}</td>
<td style="padding:10px 12px;font-size:16px;font-weight:700;color:${ACCENT};text-align:right;border-bottom:1px solid #4a5e4a;">${value}</td>
</tr>`;

  const html = layout(`
${heading("Your Weekly Digest")}
${paragraph(`Hi ${name},`)}
${paragraph("Here's how your week went — by the numbers:")}
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:16px 0;background-color:${BG};border-radius:8px;overflow:hidden;">
${statRow("Study Sessions", String(stats.sessions))}
${statRow("XP Earned", `${stats.xp} XP`)}
${statRow("Accuracy", `${stats.accuracy}%`)}
${statRow("Current Streak", `${stats.streak} days`)}
</table>
${paragraph(`<strong>Our take:</strong> ${commentary(stats.accuracy)}`)}
${ctaButton("Keep It Going", APP_URL)}
${signOff(
  "— Study Bot (Your weekly accountability partner, delivered to your inbox)",
)}
  `);

  return { subject, html };
}

// ── 4. Missed Session ───────────────────────────────────────────────────────

export function missedSession(
  name: string,
  sessionTitle: string,
): { subject: string; html: string } {
  const subject =
    "We noticed you missed a study session. Not judging. (OK maybe a little.)";

  const html = layout(`
${heading("Missed Session")}
${paragraph(`Hi ${name},`)}
${paragraph(
  `So, <strong style="color:${ACCENT};">${sessionTitle}</strong> was on your schedule today... and it didn't happen. We're not mad, just disappointed. (Kidding. Mostly.)`,
)}
${paragraph(
  "Life happens. Dogs need walking, snacks need eating, existential crises need... existing. We get it.",
)}
${paragraph(
  "But here's the good news: you can reschedule this session right now and pretend today went exactly as planned. We won't tell anyone.",
)}
${ctaButton("Reschedule Session", `${APP_URL}/plans`)}
${signOff(
  "— Study Bot (Not judging. OK fine, judging a tiny bit. But lovingly.)",
)}
  `);

  return { subject, html };
}
