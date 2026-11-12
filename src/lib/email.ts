import nodemailer, { type Transporter } from "nodemailer";

type SendEmailInput = {
  to: string;
  subject: string;
  html: string;
};

const isProd = process.env.NODE_ENV === "production";

// Created lazily so the module can be imported (e.g. by the Better Auth CLI)
// even when SMTP is not configured.
let transporter: Transporter | null = null;

function getTransporter() {
  if (transporter) return transporter;

  transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT ?? 2525),
    secure: false, // Postal uses STARTTLS on the submission port
    auth: process.env.SMTP_PASSWORD
      ? {
          user: process.env.SMTP_USER ?? "postal",
          pass: process.env.SMTP_PASSWORD,
        }
      : undefined,
    tls: {
      // Local Postal uses a self-signed certificate. Strict in production.
      rejectUnauthorized: isProd,
    },
  });

  return transporter;
}

export async function sendEmail({ to, subject, html }: SendEmailInput) {
  // Dev convenience: always print the email so you can grab the verification
  // link even if delivery fails. Never logged in production.
  if (!isProd) {
    console.log("\n--- EMAIL (dev) ---");
    console.log("To:", to);
    console.log("Subject:", subject);
    console.log(html);
    console.log("-------------------\n");
  }

  if (!process.env.SMTP_HOST) {
    if (isProd) console.error("SMTP_HOST is not set, email was not sent");
    return;
  }

  try {
    await getTransporter().sendMail({
      from: process.env.EMAIL_FROM,
      to,
      subject,
      html,
    });
  } catch (error) {
    // Don't throw: a failed email must not crash sign up.
    console.error("Failed to send email:", error);
  }
}