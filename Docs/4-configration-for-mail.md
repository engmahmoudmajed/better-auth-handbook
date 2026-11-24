# Mail Service Configuration — Development and Production

How to wire the app's email sending correctly: **Mailpit in development**, **Postal (or a managed SMTP provider) in production**.

> This guide matches the current code in `src/lib/email.ts` and `src/lib/auth.ts`
> (`nodemailer` 10.x, Next.js 16, Better Auth 1.7).
> `Docs/3-mail-service.md` is the longer background/Postal-install walkthrough;
> this file is the current source of truth for **configuration**.

---

## 1. The short version

Only environment variables change between development and production. The
application code is identical.

| | Development | Production |
|---|---|---|
| SMTP server | **Mailpit** (Docker) | **Postal** (self-hosted) or a managed provider |
| `SMTP_HOST` | `127.0.0.1` | provider/Postal host |
| `SMTP_PORT` | `1025` | `587` (STARTTLS) or `465` (implicit TLS) |
| `SMTP_USER` / `SMTP_PASSWORD` | not set | from the provider / Postal credential |
| `EMAIL_FROM` | `My App <noreply@example.com>` | `My App <no-reply@yourdomain.com>` (verified domain) |
| Emails actually delivered | No — caught by Mailpit | Yes |
| Terminal logs the email | Yes | No |
| TLS certificate check | relaxed | strict |
| Domain / DNS needed | No | Yes |

The three files involved:

```
src/lib/email.ts    -> creates the nodemailer transport and sends the message
src/lib/auth.ts     -> decides WHEN to send (verification, password reset)
.env                -> SMTP_* and EMAIL_FROM
```

---

## 2. How the mail path works

```
Browser ── sign up ──► Next.js route handler (Better Auth)
                          │
                          │ 1. creates user (email_verified = false)
                          │ 2. calls sendVerificationEmail({ user, url })
                          ▼
                    src/lib/email.ts  (nodemailer)
                          │
                          │ 3. SMTP using SMTP_HOST / SMTP_PORT
                          ▼
        ┌─────────────────┴──────────────────┐
        │ DEVELOPMENT        PRODUCTION      │
        │ Mailpit            Postal /        │
        │ (local inbox)      managed SMTP    │
        └────────────────────────────────────┘
                          │
                          ▼
                 Inbox ── click link ──► /api/auth/verify-email?token=...
                                           user verified (+ signed in)
```

Important: Better Auth **builds the link and calls your function**. It never
sends email itself. `src/lib/email.ts` is the only place that talks SMTP.

---

## 3. The code contract

### `src/lib/email.ts`

This is the current implementation. Read the comments — each option matters.

```ts
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
```

Why it is written this way:

| Choice | Reason |
|---|---|
| Lazy transport | The Better Auth CLI imports the auth config; it must not crash when SMTP is absent. |
| `host` defaults to `127.0.0.1:1025` | Matches the Mailpit container, so dev works with an empty `.env`. |
| `secure: port === 465` | 465 is implicit TLS; 1025/587/2525 start plain and upgrade with STARTTLS. Hardcoding `secure: false` breaks 465; hardcoding `true` breaks Mailpit. |
| Auth only when `SMTP_PASSWORD` exists | Mailpit needs no credentials. |
| `rejectUnauthorized: isProd` | Local servers use self-signed certs; production must verify certificates. |
| Never throws | A failed email must not fail sign-up. `auth.ts` calls it with `void sendEmail(...)`, so a throw would become an unhandled rejection. |
| Prints the email in dev | You can always grab the link from the terminal, even if Mailpit is down. |

### `src/lib/auth.ts` (the sending triggers)

```ts
emailVerification: {
  sendOnSignUp: true,               // first email after sign up
  sendOnSignIn: true,               // re-send when an unverified user signs in
  autoSignInAfterVerification: true,
  sendVerificationEmail: async ({ user, url }) => {
    // Not awaited on purpose (avoids timing differences).
    // Safe because sendEmail() never throws.
    void sendEmail({ to: user.email, subject: "Verify your email address", html: `...${url}...` });
  },
},

emailAndPassword: {
  enabled: true,
  requireEmailVerification: true,
  resetPasswordTokenExpiresIn: 3600,
  sendResetPassword: async ({ user, url }) => {
    void sendEmail({ to: user.email, subject: "Reset your password", html: `...${url}...` });
  },
},
```

> **Serverless note:** `void sendEmail(...)` may be cut off when the function
> returns (Vercel and similar). If emails go missing only in production, await
> the send there or use the platform's `waitUntil`.

### `.env` variables

```dotenv
# --- SMTP (the only block that changes per environment) ---
SMTP_HOST=127.0.0.1
SMTP_PORT=1025
SMTP_USER=
SMTP_PASSWORD=
EMAIL_FROM="My App <noreply@example.com>"
```

Rules:

- `SMTP_USER` / `SMTP_PASSWORD` can be left out entirely for Mailpit.
- `EMAIL_FROM` may include a display name. Quotes around the value are stripped
  by dotenv/Next.
- Never prefix any of these with `NEXT_PUBLIC_`.
- Restart `npm run dev` after changing `.env`.

---

## 4. Development — Mailpit

Mailpit is a fake SMTP server with a web inbox. It accepts every message and
delivers nothing to the internet. No domain, DNS, or credentials needed.

### 4.1 Start it

```bash
docker compose up -d
docker compose ps        # db (healthy) + mailpit (running)
```

The compose file exposes:

| Port | Purpose |
|---|---|
| `1025` | SMTP — what the app connects to |
| `8025` | Web inbox — open http://localhost:8025 |

### 4.2 Configure `.env`

```dotenv
SMTP_HOST=127.0.0.1
SMTP_PORT=1025
EMAIL_FROM="My App <noreply@example.com>"
```

Leave `SMTP_USER` and `SMTP_PASSWORD` out.

### 4.3 Test the whole flow

1. `npm run dev`
2. Open http://localhost:3000/auth/login → **Sign Up**
3. Use a **brand-new email address**. Any address works, e.g. `test+1@example.com`.
4. Open http://localhost:8025 → the message should be there.
5. Click **Verify email** → you are redirected and signed in.
6. The terminal running `npm run dev` also prints the email and link.

### 4.4 Verify from the command line

```bash
# How many messages are in Mailpit?
curl -s http://localhost:8025/api/v1/messages | head -c 300

# Did the user get created / verified?
docker compose exec db psql -U postgres -d better_auth_tutorial \
  -c 'SELECT email, email_verified FROM "user" ORDER BY created_at DESC;'
```

A raw SMTP smoke test that bypasses the app entirely:

```bash
node -e "
const n=require('nodemailer');
n.createTransport({host:'127.0.0.1',port:1025,secure:false})
 .sendMail({from:'My App <noreply@example.com>',to:'test@example.com',subject:'smoke test',html:'<p>hi</p>'})
 .then(r=>console.log('sent',r.messageId),e=>console.error('failed',e));
"
```

If this works but the app does not, the problem is in the app (Better Auth
trigger, Arcjet, or validation) — not in SMTP.

### 4.5 The "inbox stays empty" trap

This project hit it, and it is **not** a nodemailer bug:

- Better Auth sends the verification email **only for a new account**.
- Signing up again with an existing email returns a **fake `200 OK`** (a decoy
  user object; the database is not changed) and sends **nothing**. This is
  intentional, to avoid revealing which accounts exist.
- If that existing account is already verified, no resend happens either.

So the UI can say "Check your email" while Mailpit stays empty.

Check the database to know which case you are in:

```bash
docker compose exec db psql -U postgres -d better_auth_tutorial \
  -c 'SELECT email, email_verified, created_at FROM "user" ORDER BY created_at DESC;'
```

- New row created, `email_verified = false` → email was sent (look in Mailpit).
- No new row → you reused an existing email, or the request was blocked before
  Better Auth.

Other reasons a sign-up never reaches the mail code:

| Symptom | Cause | Fix |
|---|---|---|
| Sign-up returns `403` with no body | Arcjet denied it (bot/shield) | Check the terminal; retry from a normal browser |
| Sign-up returns `429` | Arcjet rate limit (`10 / 10m` for sign-up) | Wait, or test with a different network |
| Sign-up returns `400` with a message | Arcjet email rules (`DISPOSABLE`, `INVALID`, `NO_MX_RECORDS`) | Use a real, non-disposable address |
| UI validation error | Zod rules (8+ chars, uppercase, number) | Use a valid password |

### 4.6 Mailpit notes

- Mailpit data is temporary: restarting the container clears the inbox.
- `8025` is the UI, `1025` is SMTP. Do not swap them.
- If you run the app inside a container, `127.0.0.1` points at the app container,
  not at Mailpit. Use the service name (`mailpit`) or `host.docker.internal`.

---

## 5. Production — Postal (self-hosted)

Postal is a full mail server. It is the right choice only if you want to run
your own mail infrastructure. It needs real DNS and a server that can send on
port 25.

> The Postal services in this repo's `docker-compose.yml` are **commented out**
> and are for local practice only. A laptop cannot deliver mail to real inboxes
> (no public IP, port 25 usually blocked, no PTR). For production, install
> Postal on a real server with its official installer, or use a managed
> provider (section 6).

### 5.1 Server prerequisites

- A server with a **public IP** and enough RAM
- **Outbound port 25 open** (many VPS providers block it by default)
- A domain you control, e.g. `yourdomain.com`
- A hostname for the Postal UI, e.g. `postal.yourdomain.com`
- **Reverse DNS (PTR)** for the server IP that matches the mail hostname
- HTTPS for the web interface (Postal's docs use Caddy)

### 5.2 Install and initialise

```bash
postal bootstrap postal.yourdomain.com   # generates postal.yml + signing.key
# edit /opt/postal/config/postal.yml (database password, hostnames)
postal initialize
postal make-user
postal start
```

Follow the official guide for exact steps:
https://docs.postalserver.io/getting-started/installation

### 5.3 Create the sending identity

In the Postal web UI:

1. Create an **organization**.
2. Create a **mail server**.
3. Add your **sending domain** and publish every DNS record Postal shows.
4. Create an **SMTP credential** and copy the key.

### 5.4 DNS records that must exist

| Record | What it proves |
|---|---|
| **SPF** (TXT) | Which servers may send mail for your domain |
| **DKIM** (TXT) | The message really came from your domain and was not altered |
| **Return path** (CNAME) | Where bounces go |
| **DMARC** (TXT at `_dmarc.yourdomain.com`) | What receivers do when SPF/DKIM fail. Start with `v=DMARC1; p=none` |
| **PTR / reverse DNS** | The sending IP maps back to your mail hostname |

Without SPF + DKIM, mail lands in spam or is rejected.

### 5.5 Production `.env`

Set these in the hosting dashboard, never in git:

```dotenv
NODE_ENV=production

BETTER_AUTH_URL=https://yourdomain.com
BETTER_AUTH_SECRET=<new long random value>   # openssl rand -base64 32

SMTP_HOST=postal.yourdomain.com
SMTP_PORT=587
SMTP_USER=<postal credential user>           # often org-short-name/server-short-name
SMTP_PASSWORD=<postal credential key>
EMAIL_FROM="My App <no-reply@yourdomain.com>" # domain verified in Postal
```

Notes:

- Port `587` uses STARTTLS. If your provider uses `465`, the code already sets
  `secure: true` for it.
- `EMAIL_FROM` must be on the verified domain.
- Production sets `rejectUnauthorized: true`, so Postal **must** present a valid
  certificate. A self-signed certificate will fail in production.
- If SMTP login fails, try `SMTP_USER=<org-short-name>/<server-short-name>`.
  Check Postal's SMTP auth docs for your version.

---

## 6. Production alternative — managed SMTP (recommended)

Running Postal well is real work (IP reputation, blocklists, port 25, PTR). A
managed provider handles all of it. You only verify your domain and copy SMTP
credentials.

Examples: Postmark, Amazon SES, Mailgun, Brevo, SendGrid, Resend (SMTP).

Steps:

1. Create an account and add your **domain**.
2. Publish the **SPF / DKIM / DMARC** records it gives you.
3. Wait until the domain shows as **verified**.
4. Create **SMTP credentials**.
5. Set the same five env vars (`SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`,
   `SMTP_PASSWORD`, `EMAIL_FROM`) on the host.

No code changes. This is the lowest-risk production setup.

---

## 7. Switching environments safely

| Step | Development | Production |
|---|---|---|
| 1. Mail server | `docker compose up -d` (Mailpit) | Postal running, or provider account |
| 2. `.env` | `SMTP_HOST=127.0.0.1`, `SMTP_PORT=1025` | provider host/port |
| 3. Credentials | none | `SMTP_USER` + `SMTP_PASSWORD` |
| 4. Sender | `noreply@example.com` | `no-reply@yourdomain.com` (verified) |
| 5. `BETTER_AUTH_URL` | `http://localhost:3000` | `https://yourdomain.com` |
| 6. Restart | `npm run dev` | redeploy |
| 7. Test | sign up with a new email → Mailpit | sign up with a real address → inbox + spam |

### Production checklist

- [ ] `NODE_ENV=production`
- [ ] `BETTER_AUTH_URL` is the real HTTPS URL, no trailing slash
- [ ] New `BETTER_AUTH_SECRET` (different from development)
- [ ] Sending domain verified (Postal or provider)
- [ ] SPF and DKIM published and passing
- [ ] DMARC published
- [ ] PTR / reverse DNS set (self-hosted only)
- [ ] `SMTP_*` and `EMAIL_FROM` set on the host
- [ ] Migrations applied (`npm run db:migrate`)
- [ ] Real test: sign up with a real address, check inbox **and** spam
- [ ] Email headers show SPF, DKIM, DMARC = `pass`
- [ ] OAuth callback URLs point at the production domain
- [ ] Terminal email logging is off (it is, because `NODE_ENV=production`)

---

## 8. Security notes

- Never commit `.env`; commit only `.env.example`.
- Never put SMTP credentials in `NEXT_PUBLIC_*`.
- Keep `requireEmailVerification` on in production so nobody can pre-register
  someone else's address.
- Never log verification/reset links in production. The dev log in
  `sendEmail` only runs when `NODE_ENV !== "production"`.
- Use different credentials and secrets for development and production.
- Rotate any credential that was pasted into chat, a screenshot, or a repo.
- Do not expose the database or Postal UI to the public internet without HTTPS
  and strong passwords.

---

## 9. Troubleshooting

| Problem | Likely cause | Fix |
|---|---|---|
| Mailpit inbox empty, UI says "check your email" | Reused an existing email; Better Auth sent nothing | Sign up with a new address; check the `user` table |
| Mailpit inbox empty, no new DB row | Request blocked before Better Auth (Arcjet 403/429/400) | Check the terminal and the browser network tab |
| `Failed to send email ... ECONNREFUSED` | Mailpit is not running, or wrong host/port | `docker compose up -d`; check `SMTP_HOST` / `SMTP_PORT` |
| Terminal prints the email, Mailpit empty | SMTP connection failing | Look for the `Failed to send email` log; test SMTP directly |
| `.env` changes ignored | Dev server not restarted | Restart `npm run dev` |
| Verification link points to the wrong host | `BETTER_AUTH_URL` wrong | Set it exactly and restart |
| Link invalid or expired | Old email used | Use the newest message |
| Production mail in spam | Missing SPF/DKIM/DMARC, new IP reputation | Publish records; warm up a self-hosted IP |
| `self-signed certificate` in production | Postal cert not trusted | Install a valid certificate; do not disable TLS checks in prod |
| Mail works locally, not on Vercel | `void sendEmail` cut off after response | Await the send or use `waitUntil` |
| `Cannot find namespace 'nodemailer'` | Wrong type import | `import nodemailer, { type Transporter } from "nodemailer"` |

---

## 10. TL;DR

```dotenv
# Development
SMTP_HOST=127.0.0.1
SMTP_PORT=1025
EMAIL_FROM="My App <noreply@example.com>"
```

```dotenv
# Production (Postal or managed SMTP)
SMTP_HOST=mail.yourdomain.com
SMTP_PORT=587
SMTP_USER=...
SMTP_PASSWORD=...
EMAIL_FROM="My App <no-reply@yourdomain.com>"
```

Same code, same five variables, different values. Start Mailpit with
`docker compose up -d`, and always test with a **new** email address.
