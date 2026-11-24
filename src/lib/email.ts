import nodemailer, { type Transporter } from "nodemailer";

type SendEmailInput = {
  to: string;
  subject: string;
  html: string;
};

const isProd = process.env.NODE_ENV === "production";

// Created lazily so the module can be imported (for example by the
// Better Auth CLI) even when SMTP is not configured.
let transporter: Transporter | null = null;

function getTransporter(): Transporter {
  if (transporter) return transporter;

  // Mailpit listens on 1025 by default (docker-compose.yml).
  const host = process.env.SMTP_HOST ?? "127.0.0.1";
  const port = Number(process.env.SMTP_PORT ?? 1025);

  transporter = nodemailer.createTransport({
    host,
    port,
    // 465 uses implicit TLS; Mailpit (1025) and providers on 587 use
    // plain SMTP with STARTTLS.
    secure: port === 465,
    // Mailpit needs no auth; only log in when a password is configured.
    auth: process.env.SMTP_PASSWORD
      ? {
          user: process.env.SMTP_USER ?? "postal",
          pass: process.env.SMTP_PASSWORD,
        }
      : undefined,
    tls: {
      // Local Mailpit/Postal use self-signed certificates. Strict in production.
      rejectUnauthorized: isProd,
    },
    connectionTimeout: 10_000,
    greetingTimeout: 10_000,
    socketTimeout: 15_000,
  });

  return transporter;
}

export async function sendEmail({ to, subject, html }: SendEmailInput) {
  // Dev convenience: print the message so the verification/reset link is
  // always available even if SMTP is unreachable. Never logged in production.
  if (!isProd) {
    console.log("\n--- EMAIL (dev) ---");
    console.log("To:", to);
    console.log("Subject:", subject);
    console.log(html);
    console.log("-------------------\n");
  }

  try {
    const info = await getTransporter().sendMail({
      from: process.env.EMAIL_FROM ?? "My App <noreply@example.com>",
      to,
      subject,
      html,
    });

    if (!isProd) {
      console.log(`Email sent to ${to} (${info.messageId})`);
    }

    return info;
  } catch (error) {
    // Never throw: a failed email must not break sign-up or password reset.
    console.error(
      `Failed to send email to ${to}. In development, check that Mailpit is ` +
        `running (docker compose up -d) and that SMTP_HOST/SMTP_PORT are correct.`,
      error,
    );

    return null;
  }
}
