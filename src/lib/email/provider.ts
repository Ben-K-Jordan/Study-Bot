import nodemailer from "nodemailer";
import { logger } from "@/lib/logger";

export interface EmailProvider {
  send(to: string, subject: string, html: string): Promise<void>;
}

class SmtpProvider implements EmailProvider {
  private transporter: nodemailer.Transporter;
  private from: string;

  constructor() {
    this.from = process.env.SMTP_FROM || "Study Bot <noreply@studybot.app>";
    this.transporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: Number(process.env.SMTP_PORT) || 587,
      secure: Number(process.env.SMTP_PORT) === 465,
      auth: {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASS,
      },
      connectionTimeout: 10_000,
      greetingTimeout: 10_000,
      socketTimeout: 15_000,
    });
  }

  async send(to: string, subject: string, html: string): Promise<void> {
    try {
      await this.transporter.sendMail({
        from: this.from,
        to,
        subject,
        html,
      });
      logger.info("email_sent", { to, subject });
    } catch (err) {
      logger.error("email_send_failed", { to, subject, error: String(err) });
      throw err;
    }
  }
}

class ConsoleProvider implements EmailProvider {
  async send(to: string, subject: string, html: string): Promise<void> {
    const divider = "═".repeat(60);
    // Collect every URL in the email (href attributes and bare URLs) so
    // links like verification/reset URLs are always printed in full, even
    // when the body preview below is truncated.
    const urls = new Set<string>();
    for (const match of html.matchAll(/href="([^"]+)"/g)) urls.add(match[1]);
    for (const match of html.replace(/<[^>]+>/g, " ").matchAll(/https?:\/\/[^\s<>"')\]]+/g)) {
      urls.add(match[0]);
    }
    const linkBlock =
      urls.size > 0
        ? `\n  Links (full, untruncated):\n${[...urls].map((u) => `  ${u}`).join("\n")}\n${divider}`
        : "";
    console.log(`
${divider}
  EMAIL (console provider)
${divider}
  To:      ${to}
  Subject: ${subject}
${divider}
${html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim().slice(0, 500)}
${divider}${linkBlock}
`);
    logger.info("email_sent_console", { to, subject });
  }
}

export function createEmailProvider(): EmailProvider {
  const provider = process.env.EMAIL_PROVIDER || "console";
  if (provider === "smtp") return new SmtpProvider();
  return new ConsoleProvider();
}

export const emailProvider = createEmailProvider();
