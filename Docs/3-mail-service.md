# Email Service Guide: Development and Production

How email verification works in this project, what each package and Docker image does, and how to run the mail service in development and production.

> Written for this stack: Next.js 16, Better Auth, Drizzle, PostgreSQL, Docker. Postal's configuration changes between versions, so check the official Postal docs (https://docs.postalserver.io) for anything that behaves differently from this guide.

---

## 1. The big picture

Your app never "delivers" email to the internet itself. It hands the message to an **SMTP server**, and that server delivers it.

```
Browser ──sign up──► Next.js + Better Auth
                          │
                          │ 1. creates the user (email_verified = false)
                          │ 2. calls sendVerificationEmail({ user, url })
                          ▼
                     src/lib/email.ts  (nodemailer)
                          │
                          │ 3. SMTP (host/port/user/password from .env)
                          ▼
        ┌─────────────────┴──────────────────┐
        │ DEVELOPMENT        PRODUCTION      │
        │ Mailpit            Postal (own     │
        │ (catches mail,     server) or a    │
        │ shows it in a      managed SMTP    │
        │ web inbox)         provider        │
        └────────────────────────────────────┘
                          │
                          ▼
              User's inbox ─ clicks link ─► /api/auth/verify-email?token=...
                                            ► user is marked verified (+ signed in)
```

The key idea: **only the `SMTP_*` environment variables change between development and production.** The application code is identical.

---

## 2. What each piece does

### npm packages

| Package | Type | Role |
|---|---|---|
| `better-auth` | dependency | Creates users and verification tokens, builds the verification URL, and calls your `sendVerificationEmail` function. It does **not** send email itself. |
| `nodemailer` | dependency | The SMTP client. `src/lib/email.ts` uses it to connect to Mailpit, Postal or any provider and send the message. |
| `@types/nodemailer` | devDependency | TypeScript types for `nodemailer`. No runtime effect. |
| `dotenv` | dependency | Loads `.env` for scripts and tools that run outside Next.js (Drizzle Kit, the Better Auth CLI, test scripts). Next.js loads `.env` by itself. |
| `tsx` | devDependency | Runs a TypeScript file directly (for example a test script) with `npx tsx file.ts`. |

Install the mail-related ones with:

```bash
npm install nodemailer
npm install -D @types/nodemailer
```

### Docker images (from `docker-compose.yml`)

| Service | Image | Role | Used in |
|---|---|---|---|
| `db` | `postgres:17` | Your app's database (users, sessions, accounts, verification tokens). | Dev + prod |
| `mailpit` | `axllent/mailpit` | A fake SMTP server for development. It accepts every email and shows it in a web inbox. Nothing is delivered to the internet. | Dev only |
| `postal-db` | `mariadb:11` | Postal's own database (Postal needs MariaDB/MySQL, not PostgreSQL). | Postal (optional) |
| `postal-web` | `ghcr.io/postalserver/postal` | Postal's web interface and API. | Postal (optional) |
| `postal-smtp` | `ghcr.io/postalserver/postal` | Postal's SMTP server. This is what your app connects to. | Postal (optional) |
| `postal-worker` | `ghcr.io/postalserver/postal` | Background worker that processes the queue and delivers messages. | Postal (optional) |

The three Postal services use the same image with a different `command` (`postal web-server`, `postal smtp-server`, `postal worker`).

The Postal services are behind a Compose **profile**, so they only start when you ask:

```bash
docker compose up -d                    # db + mailpit (daily development)
docker compose --profile postal up -d   # also start Postal
```

### Project files

| File | Role |
|---|---|
| `docker-compose.yml` | Defines the containers above. |
| `postal/config/postal.yml` | Postal's configuration (only if you use Postal). Contains secrets, so don't commit it. |
| `postal/config/signing.key` | Postal's private signing key (only if you use Postal). Don't commit it. |
| `.env` | SMTP settings, `BETTER_AUTH_URL`, OAuth keys. Never commit it. |
| `src/lib/email.ts` | `sendEmail()`: connects to SMTP with nodemailer and sends the message. |
| `src/lib/auth.ts` | Better Auth config: turns on verification and defines the email content. |
| `src/lib/auth-client.ts` | Browser-side Better Auth client. |
| `src/components/auth-tabs.tsx` | Sign in / sign up UI, the "check your email" notice and the resend button. |
| `src/app/api/auth/[...all]/route.ts` | Better Auth's API route. It also serves the verification link, so no extra route is needed. |

---

## 3. Code reference

### `src/lib/email.ts`

```ts
import nodemailer, { type Transporter } from "nodemailer";

type SendEmailInput = { to: string; subject: string; html: string };

const isProd = process.env.NODE_ENV === "production";

// Created lazily so the module can be imported (for example by the
// Better Auth CLI) even when SMTP is not configured.
let transporter: Transporter | null = null;

function getTransporter() {
  if (transporter) return transporter;

  transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT ?? 2525),
    secure: false, // STARTTLS (ports 25, 587, 2525, 1025)
    auth: process.env.SMTP_PASSWORD
      ? {
          user: process.env.SMTP_USER ?? "postal",
          pass: process.env.SMTP_PASSWORD,
        }
      : undefined,
    tls: {
      // Local servers use self-signed certificates. Strict in production.
      rejectUnauthorized: isProd,
    },
  });

  return transporter;
}

export async function sendEmail({ to, subject, html }: SendEmailInput) {
  // Development only: print the email so you can grab the link.
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
```

**Port 465 note:** if your production provider uses port **465** (implicit TLS), change `secure: false` to:

```ts
secure: Number(process.env.SMTP_PORT) === 465,
```

### Verification settings in `src/lib/auth.ts`

```ts
emailAndPassword: {
  enabled: true,
  requireEmailVerification: true, // password users must verify before signing in
},

emailVerification: {
  sendOnSignUp: true,              // send the email right after sign up
  sendOnSignIn: true,              // re-send if an unverified user tries to sign in
  autoSignInAfterVerification: true,
  sendVerificationEmail: async ({ user, url }) => {
    // Not awaited on purpose (avoids timing differences between requests).
    void sendEmail({
      to: user.email,
      subject: "Verify your email address",
      html: `<p>Hi ${escapeHtml(user.name || "there")},</p>
             <p><a href="${url}">Verify your email</a></p>`,
    });
  },
},
```

What each option does:

- `requireEmailVerification`: blocks password sign-in until the email is verified. Unverified users get a 403 error.
- `sendOnSignUp`: sends the first email automatically.
- `sendOnSignIn`: sends a new email when an unverified user tries to sign in.
- `autoSignInAfterVerification`: signs the user in after clicking the link.
- `escapeHtml` is a small helper that escapes the user's name so it can't inject HTML into the email.

Social logins (GitHub, Discord) are not affected, because the provider already confirmed the email.

---

## 4. Development setup (Mailpit)

Mailpit is the recommended development mail service. It needs no domain, no DNS and no credentials.

### Step 1: Start the containers

```bash
docker compose up -d
```

Check the services:

```bash
docker compose ps
```

You should see `db` (healthy) and `mailpit` running.

### Step 2: Environment variables (`.env`)

```dotenv
BETTER_AUTH_URL=http://localhost:3000

SMTP_HOST=localhost
SMTP_PORT=1025
EMAIL_FROM="MyApp <no-reply@myapp.test>"
```

Leave `SMTP_USER` and `SMTP_PASSWORD` out. The helper only logs in when `SMTP_PASSWORD` is set. Restart `npm run dev` after changing `.env`.

### Step 3: Test the flow

1. Run `npm run dev` and open the sign-up form.
2. Sign up with **a new email** (any address works, for example `test@example.com`).
3. Open the Mailpit inbox at **http://localhost:8025** and open the message.
4. Click **Verify email**. You'll be redirected to your app and signed in.
5. Check the database if you want:
   ```bash
   docker compose exec db psql -U postgres -d better_auth_tutorial \
     -c 'SELECT email, email_verified FROM "user";'
   ```

The email and link are also printed in the terminal running `npm run dev`.

### What works in development

| Check | Result |
|---|---|
| Email reaches Mailpit | Yes, for any recipient address |
| Email reaches a real inbox | No (by design: Mailpit never delivers externally) |
| Domain / DNS needed | No |
| Verification link | Works, points to `BETTER_AUTH_URL` |

### Tips

- **Existing email:** with email verification required, signing up again with an email that already exists doesn't send a new email, by design. Use a new address, or sign in once with the old one to get a new link.
- **Mailpit ports:** `8025` is the web inbox, `1025` is the SMTP port your app uses.
- **Mailpit data** is temporary. Restarting the container clears the inbox.

---

## 5. Optional: Postal in development

Use Postal locally only if you want to practice the same setup you'll use in production. It is heavier than Mailpit, and **it will not deliver to real inboxes from your laptop** (no public IP, ISPs usually block port 25, no DNS records).

### Setup

```bash
# 1. Config folder and secrets
mkdir -p postal/config
openssl genrsa -out postal/config/signing.key 2048
```

Create `postal/config/postal.yml`:

```yaml
version: 2

postal:
  web_hostname: localhost:5000
  web_protocol: http
  smtp_hostname: localhost
  signing_key_path: /config/signing.key

web_server:
  default_bind_address: "0.0.0.0"   # required, or the web UI is unreachable from Docker

main_db:
  host: postal-db
  username: root
  password: postal
  database: postal

message_db:
  host: postal-db
  username: root
  password: postal
  prefix: postal

smtp_server:
  default_bind_address: "::"

rails:
  secret_key: PASTE_A_RANDOM_VALUE_HERE
```

Generate the secret and insert it:

```bash
sed -i "s|PASTE_A_RANDOM_VALUE_HERE|$(openssl rand -hex 64)|" postal/config/postal.yml
```

Start the database, create Postal's tables and your admin user, then start everything:

```bash
docker compose --profile postal up -d postal-db
docker compose --profile postal run --rm postal-web postal initialize
docker compose --profile postal run --rm postal-web postal make-user
docker compose --profile postal up -d
```

Open **http://localhost:5000** and log in.

### In the Postal UI

1. Create an **organization**.
2. Create a **mail server** (choose Development mode if your version offers it).
3. Add a **domain**. Postal normally refuses to send from a domain it hasn't verified, and verification needs a real DNS TXT record. Without a real domain you can't complete this step in the normal way.
4. Create an **SMTP credential** and copy its key.

### `.env` for Postal

```dotenv
SMTP_HOST=localhost
SMTP_PORT=2525
SMTP_USER=postal
SMTP_PASSWORD=<credential key>
EMAIL_FROM="MyApp <no-reply@yourdomain.com>"
```

If login fails, try `SMTP_USER=<org-short-name>/<server-short-name>`. Check the Postal SMTP authentication docs for the exact format in your version.

### Postal commands you'll use

```bash
docker compose --profile postal logs -f postal-web      # web UI logs
docker compose --profile postal logs -f postal-smtp     # SMTP logs
docker compose --profile postal logs -f postal-worker   # delivery logs
docker compose --profile postal restart postal-web      # after changing postal.yml
docker compose --profile postal down                    # stop Postal
```

---

## 6. Production

In production you need a mail service that really delivers to inboxes. You have two options.

### Option A: managed SMTP provider (recommended)

Providers such as Resend, Amazon SES, Mailgun, Postmark, Brevo or SendGrid run the servers, IP reputation and deliverability for you. You only verify your domain and get SMTP credentials.

Steps:

1. Create an account and **add your domain** in the provider's dashboard.
2. Add the **DNS records** they give you (SPF, DKIM, sometimes a return path or DMARC) at your DNS provider.
3. Wait until the provider shows the domain as **verified**.
4. Create SMTP credentials.
5. Set the environment variables on your host (see below).

Your code doesn't change.

### Option B: self-hosted Postal on a server

Choose this only if you want to run your own mail infrastructure. It takes real effort to get good deliverability.

Requirements (check Postal's prerequisites page for the current list):

- A server with a **public IP address** and a decent amount of RAM
- **Outbound port 25 open.** Many VPS providers block it by default, and home internet providers usually do. Check with your provider before you start.
- A **domain** with DNS control, and a hostname for the Postal web interface (for example `postal.yourdomain.com`)
- A **reverse DNS (PTR)** record for the server IP that matches your mail hostname
- HTTPS for the web interface (Postal's docs use Caddy for this)

Postal's official install uses its own `postal` helper tool, which is different from the dev compose file in this guide:

```bash
postal bootstrap postal.yourdomain.com   # generates postal.yml, signing.key, Caddyfile
# edit /opt/postal/config/postal.yml (database passwords, etc.)
postal initialize
postal make-user
postal start
```

Then run a web proxy such as Caddy for HTTPS and log in to the web interface. Follow the official installation guide for the exact steps: https://docs.postalserver.io/getting-started/installation

After Postal is running:

1. Create an organization and a mail server.
2. Add your **sending domain** and publish the TXT/DNS records Postal shows for it: ownership verification, **SPF**, **DKIM** and the **return path**.
3. Create an **SMTP credential**.
4. Point your app's `SMTP_*` variables at it.

### DNS records every sender needs

| Record | What it proves | Where it matters |
|---|---|---|
| **SPF** (TXT) | Which servers may send mail for your domain | Spam filters |
| **DKIM** (TXT) | The message really came from your domain and wasn't changed | Spam filters |
| **DMARC** (TXT at `_dmarc.yourdomain.com`) | What receivers should do when SPF/DKIM fail | Gmail and Yahoo expect it for bulk senders |
| **Return path** (CNAME) | Where bounces go | Self-hosted setups like Postal |
| **PTR / reverse DNS** | The sending IP maps back to your hostname | Self-hosted only |

A minimal DMARC record to start with is `v=DMARC1; p=none`.

### Production environment variables

Set these in your hosting dashboard, not in git:

```dotenv
NODE_ENV=production

BETTER_AUTH_URL=https://yourdomain.com
BETTER_AUTH_SECRET=<new long random value>   # openssl rand -base64 32

SMTP_HOST=smtp.your-provider.com
SMTP_PORT=587
SMTP_USER=<from your provider>
SMTP_PASSWORD=<from your provider>
EMAIL_FROM="MyApp <no-reply@yourdomain.com>"
```

The `EMAIL_FROM` domain must be the one you verified.

### Production checklist

- [ ] Sending domain verified at the provider (or in Postal)
- [ ] SPF and DKIM records published and passing
- [ ] DMARC record published
- [ ] `BETTER_AUTH_URL` is the real HTTPS URL, with no trailing slash
- [ ] OAuth apps use production callback URLs (`https://yourdomain.com/api/auth/callback/github` and `.../discord`)
- [ ] `SMTP_*` and `EMAIL_FROM` set on the host
- [ ] Database migrations applied to the production database (`npm run db:migrate`)
- [ ] Send a real test: sign up with a real address, check the inbox **and** the spam folder
- [ ] Click the link and confirm you're verified and signed in
- [ ] Check the headers of a received email: SPF, DKIM and DMARC should show `pass`

### Serverless hosting note

The sample code uses `void sendEmail(...)` so sign up doesn't wait for SMTP. On serverless platforms (for example Vercel), the function can stop before the email finishes sending. If emails go missing there, make sure the send completes, for example with `waitUntil`, or await the send for that environment. Check the Better Auth email docs for the recommended approach on your platform.

---

## 7. Switching environments

| | Development (Mailpit) | Production (provider or Postal) |
|---|---|---|
| `BETTER_AUTH_URL` | `http://localhost:3000` | `https://yourdomain.com` |
| `SMTP_HOST` | `localhost` | provider host |
| `SMTP_PORT` | `1025` | `587` (or what your provider says) |
| `SMTP_USER` / `SMTP_PASSWORD` | not set | from the provider |
| `EMAIL_FROM` | `no-reply@myapp.test` | `no-reply@yourdomain.com` (verified) |
| Emails go to | Mailpit inbox at `localhost:8025` | Real inboxes |
| Terminal email log | Yes | No |
| TLS certificate checks | Relaxed | Strict |
| Domain and DNS | Not needed | Required |

---

## 8. Troubleshooting

| Problem | Likely cause | Fix |
|---|---|---|
| Sign up works but no email appears anywhere | Signed up with an email that already exists, or `auth.ts` is missing the `emailVerification` block | Use a new email; check `auth.ts`; restart the dev server |
| The terminal prints the email but Mailpit is empty | SMTP connection failing | `docker compose ps` (is `mailpit` up?); check `SMTP_HOST` and `SMTP_PORT`; look for `Failed to send email:` in the terminal |
| `Cannot find namespace 'nodemailer'` | Wrong type import | Use `import nodemailer, { type Transporter } from "nodemailer"` |
| Callback type error `string \| number` is not assignable | Arrow function returns the toast id | Wrap in braces: `onSuccess: () => { toast.success("..."); }` |
| Verification link goes to the wrong host | `BETTER_AUTH_URL` wrong or missing | Set it exactly and restart |
| Link says invalid or expired | Old email used | Use the newest message; sign in once to get a fresh link |
| Sign in says verify your email | Account not verified yet | Click the link in the latest email |
| `account_not_linked` with GitHub or Discord | Existing password user is unverified | Verify the email first (the account must have `email_verified = true`) |
| Postal web UI doesn't open on `localhost:5000` | Web server bound to `127.0.0.1` inside the container | Add `web_server.default_bind_address: "0.0.0.0"` to `postal.yml` and restart `postal-web` |
| Postal rejects the From address | Sending domain is not verified | Verify the domain with real DNS records |
| Emails land in spam in production | Missing SPF, DKIM or DMARC, new IP reputation | Publish the records; for self-hosted Postal, warm up the IP slowly |
| SMTP login fails on Postal | Username format | Try `org-short-name/server-short-name` as the username |
| Timeouts connecting to a provider | Outbound port blocked | Try another port (587, 2525) or check the host's firewall |

---

## 9. Security notes

- Never commit `.env`, `postal/config/postal.yml` or `postal/config/signing.key`. Add them to `.gitignore`.
- Use different secrets and credentials for development and production.
- The Postal passwords in the dev compose file (`postal`) are for local use only.
- Keep `requireEmailVerification` on in production so nobody can pre-register someone else's email.
- Never log verification links in production. The terminal log in `sendEmail` only runs when `NODE_ENV` is not `production`.
- Rotate any key or password that was ever pasted into a chat, screenshot or public repo.
- Don't expose the Postal web interface or the database ports to the public internet without HTTPS and strong passwords.