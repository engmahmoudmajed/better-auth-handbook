# Better Auth: OAuth (GitHub + Discord) and Email Verification

Guide for Development and Production, Next.js + Drizzle + PostgreSQL.

> Written against `better-auth` 1.7 with Next.js 16. Better Auth changes between versions, so if an option name differs, check the official docs for your installed version.

---

## 1. The big picture

Three things must line up for OAuth to work with no errors:

1. **Same URL everywhere:** the URL your app runs on, `BETTER_AUTH_URL`, and the callback URL registered in GitHub/Discord must agree exactly.
2. **Separate OAuth apps for dev and prod:** each environment has its own client ID/secret and callback URL.
3. **Verified emails:** Better Auth only auto-links a social login to an existing user when it can trust the email match. Unverified password accounts block linking (`account_not_linked`).

---

## 2. Environment variables

### Development: `.env`

```dotenv
DATABASE_URL=postgresql://postgres:password@localhost:5433/better_auth_tutorial

BETTER_AUTH_SECRET=dev-secret-at-least-32-chars-long
BETTER_AUTH_URL=http://localhost:3000

# OAuth apps for DEVELOPMENT
GITHUB_CLIENT_ID=...
GITHUB_CLIENT_SECRET=...
DISCORD_CLIENT_ID=...
DISCORD_CLIENT_SECRET=...

# Email (see section 6)
RESEND_API_KEY=...
EMAIL_FROM="Your App <onboarding@resend.dev>"
```

### Production: set in your host's dashboard (Vercel, Dokploy, etc.), never in git

```dotenv
DATABASE_URL=postgresql://USER:STRONG_PASSWORD@HOST:5432/DBNAME

BETTER_AUTH_SECRET=<new long random value, different from dev>
BETTER_AUTH_URL=https://yourdomain.com

# OAuth apps for PRODUCTION (different from dev)
GITHUB_CLIENT_ID=...
GITHUB_CLIENT_SECRET=...
DISCORD_CLIENT_ID=...
DISCORD_CLIENT_SECRET=...

RESEND_API_KEY=...
EMAIL_FROM="Your App <no-reply@yourdomain.com>"
```

Generate a secret with `openssl rand -base64 32`.

Rules:

- `BETTER_AUTH_URL` has **no trailing slash**.
- Production uses `https://`. OAuth providers and secure cookies need HTTPS.
- Never prefix secrets with `NEXT_PUBLIC_`.
- Keep `.env` in `.gitignore`.

---

## 3. GitHub OAuth

GitHub OAuth Apps traditionally allow a single callback URL, so create **two apps**: one for dev, one for prod.

Path: GitHub → Settings → Developer settings → OAuth Apps → New OAuth App.

| Field | Development | Production |
|---|---|---|
| Application name | `MyApp (dev)` | `MyApp` |
| Homepage URL | `http://localhost:3000` | `https://yourdomain.com` |
| Authorization callback URL | `http://localhost:3000/api/auth/callback/github` | `https://yourdomain.com/api/auth/callback/github` |

Then click **Generate a new client secret** and copy both values into the matching env file.

Notes:

- The callback path is always `/api/auth/callback/github`. It comes from the Better Auth route handler at `app/api/auth/[...all]/route.ts`.
- The user needs an email on their GitHub account that GitHub shares. Without an email, sign-in can fail.

---

## 4. Discord OAuth

Path: [Discord Developer Portal](https://discord.com/developers/applications) → New Application → OAuth2.

Discord lets you register several redirect URLs on one app, but using separate apps for dev and prod keeps secrets isolated and is still the cleaner choice.

| Field | Development | Production |
|---|---|---|
| Redirects | `http://localhost:3000/api/auth/callback/discord` | `https://yourdomain.com/api/auth/callback/discord` |

Copy the **Client ID** and reset/copy the **Client Secret** into the matching env file.

Notes:

- Press **Save Changes** after adding a redirect. Forgetting this is a common cause of `redirect_uri_mismatch`.
- Redirect URLs must match character for character: scheme, host, port, path, no trailing slash.

---

## 5. Server config: `src/lib/auth.ts`

This is the complete config with OAuth, account linking, and email verification.

```ts
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { nextCookies } from "better-auth/next-js";
import { db } from "../db"; // relative import so the Better Auth CLI can resolve it
import * as schema from "../db/schema/auth-schema";
import { sendEmail } from "./email";

export const auth = betterAuth({
  baseURL: process.env.BETTER_AUTH_URL,

  // Origins allowed to call the auth API (add every real domain you use)
  trustedOrigins: [process.env.BETTER_AUTH_URL as string],

  database: drizzleAdapter(db, {
    provider: "pg",
    schema,
  }),

  emailAndPassword: {
    enabled: true,
    requireEmailVerification: true, // must verify before password sign-in
  },

  emailVerification: {
    sendOnSignUp: true,              // send the email right after sign up
    sendOnSignIn: true,              // re-send if an unverified user tries to sign in
    autoSignInAfterVerification: true,
    sendVerificationEmail: async ({ user, url }) => {
      // Don't `await` this: it avoids timing differences between requests.
      // On serverless hosts, make sure the send still finishes
      // (for example with `waitUntil` or by awaiting in that environment).
      void sendEmail({
        to: user.email,
        subject: "Verify your email address",
        html: `
          <p>Hi ${user.name ?? "there"},</p>
          <p>Click the link below to verify your email:</p>
          <p><a href="${url}">Verify email</a></p>
          <p>If you didn't create an account, ignore this email.</p>
        `,
      });
    },
  },

  socialProviders: {
    github: {
      clientId: process.env.GITHUB_CLIENT_ID as string,
      clientSecret: process.env.GITHUB_CLIENT_SECRET as string,
    },
    discord: {
      clientId: process.env.DISCORD_CLIENT_ID as string,
      clientSecret: process.env.DISCORD_CLIENT_SECRET as string,
    },
  },

  account: {
    accountLinking: {
      enabled: true,
      trustedProviders: ["github", "discord"],
    },
  },

  session: {
    cookieCache: { enabled: true, maxAge: 60 },
  },

  plugins: [nextCookies()], // keep this as the LAST plugin
});
```

What each part does:

- `baseURL` and `trustedOrigins` make dev and prod work from the same code. Only the env values change.
- `requireEmailVerification` blocks password sign-in until the email is verified.
- `sendOnSignUp` sends the first verification email. `sendOnSignIn` re-sends when an unverified user tries to log in.
- `accountLinking` lets GitHub or Discord log in to an existing account with the same email, but only when the existing user is verified (see section 8).

---

## 6. Sending emails

Better Auth lets you bring your own email provider. This guide uses [Resend](https://resend.com), but any provider works: you only need a function that sends an email.

```bash
npm install resend
```

### `src/lib/email.ts`

```ts
import { Resend } from "resend";

const resend = new Resend(process.env.RESEND_API_KEY);

type SendEmailInput = {
  to: string;
  subject: string;
  html: string;
};

export async function sendEmail({ to, subject, html }: SendEmailInput) {
  // Development fallback: no API key? Print the email (and its link) to the terminal.
  if (!process.env.RESEND_API_KEY) {
    console.log("\n--- EMAIL (dev, not sent) ---");
    console.log("To:", to);
    console.log("Subject:", subject);
    console.log(html);
    console.log("-----------------------------\n");
    return;
  }

  const { error } = await resend.emails.send({
    from: process.env.EMAIL_FROM as string,
    to,
    subject,
    html,
  });

  if (error) {
    console.error("Failed to send email:", error);
  }
}
```

### Development vs production sending

- **Development:** with no `RESEND_API_KEY`, the verification link is printed in the terminal. Copy it into the browser. No email setup needed.
- **Testing with Resend:** Resend's shared test sender (`onboarding@resend.dev`) is intended for testing and typically only delivers to your own account email. Check Resend's docs for the current limits.
- **Production:** add and verify your own domain in Resend (DNS records: SPF/DKIM), then use `no-reply@yourdomain.com` as `EMAIL_FROM`. Without a verified domain, mail may fail or land in spam.

---

## 7. Client changes

### `src/lib/auth-client.ts`

```ts
import { createAuthClient } from "better-auth/react";

export const authClient = createAuthClient({
  // Only needed if the API is on a different origin than the frontend
  // baseURL: process.env.NEXT_PUBLIC_APP_URL,
});
```

### Sign up: don't redirect straight to the app

With `requireEmailVerification`, a new password user has **no session** until they verify. So after sign up, show a "check your email" message instead of `router.push("/")`.

```tsx
await authClient.signUp.email(
  {
    name,
    email,
    password,
    callbackURL: "/", // where the user lands after clicking the email link
  },
  {
    onError: (ctx) => {
      const message = ctx.error.message || "Failed to sign up";
      setError("root", { message });
      toast.error(message);
      shake(formRef.current);
    },
    onSuccess: () => {
      toast.success("Account created. Check your email to verify your address.");
      // Don't router.push("/") here: the user isn't signed in yet.
    },
  }
);
```

### Sign in: handle "email not verified"

An unverified user who tries to sign in with a password gets a 403 error. Show a clear message:

```tsx
await authClient.signIn.email(
  { email, password },
  {
    onError: (ctx) => {
      if (ctx.error.status === 403) {
        const message = "Please verify your email. We sent you a new link.";
        setError("root", { message });
        toast.error(message);
      } else {
        const message = ctx.error.message || "Failed to sign in";
        setError("root", { message });
        toast.error(message);
      }
      shake(formRef.current);
    },
    onSuccess: () => {
      toast.success("Welcome back");
      router.push("/");
      router.refresh();
    },
  }
);
```

### Manually resend the verification email (optional "Resend" button)

```ts
await authClient.sendVerificationEmail({
  email: "user@email.com",
  callbackURL: "/",
});
```

### Social buttons

Social logins don't need verification from you: GitHub and Discord confirm the email. Keep using:

```ts
await authClient.signIn.social({
  provider: "github", // or "discord"
  callbackURL: "/",
  errorCallbackURL: "/auth/login", // optional: show errors on your own page
});
```

---

## 8. Why `account_not_linked` happens and how it's fixed

When a social login returns an email that already belongs to a user, Better Auth only links the new provider if it can trust the match. Two things must be true:

1. The provider is in `trustedProviders`.
2. The existing local user has `emailVerified: true`.

A user who signed up with a password and never verified has `emailVerified: false`, so linking is refused and you see `account_not_linked`.

Email verification (this guide) fixes the root cause for new users. For users that already exist in your database:

```sql
-- Development only: mark everyone verified
UPDATE "user" SET email_verified = true;

-- Or one specific user
UPDATE "user" SET email_verified = true WHERE email = 'real@email.com';
```

Run it with:

```bash
docker compose exec db psql -U postgres -d better_auth_tutorial \
  -c "UPDATE \"user\" SET email_verified = true;"
```

Check the real column name in `src/db/schema/auth-schema.ts` if you get a "column does not exist" error.

**In production, don't mass-verify real users.** Instead, ask them to click a verification link (use `sendVerificationEmail` for unverified users) or sign in with the provider they originally used, then link the new one.

### Optional: let signed-in users link providers manually

This is the safest way to link, because the user proves ownership of the original account first:

```ts
await authClient.linkSocial({ provider: "discord", callbackURL: "/settings" });
```

---

## 9. Deploying to production: step by step

1. **Create production OAuth apps** (sections 3 and 4) with `https://yourdomain.com/...` callback URLs.
2. **Set production env vars** on your host (section 2). Use a new `BETTER_AUTH_SECRET`.
3. **Set `BETTER_AUTH_URL`** to the exact public URL (`https://yourdomain.com`).
4. **Set up your production database** and run migrations against it:
   ```bash
   npm run db:migrate
   ```
   (run with the production `DATABASE_URL`, either locally or in your CI/deploy step)
5. **Verify your email domain** in Resend (or your provider) and set `EMAIL_FROM`.
6. **Deploy**, then test every flow on the real domain (checklist below).

### Preview deployments (Vercel and similar)

Preview URLs change on every deploy, so OAuth callbacks registered for `yourdomain.com` won't match. Options:

- Test OAuth only on the production domain or a stable staging domain with its own OAuth apps.
- Don't expect social login to work on random preview URLs.

### Multiple domains (www and non-www, staging)

Add every origin to `trustedOrigins`:

```ts
trustedOrigins: [
  "https://yourdomain.com",
  "https://www.yourdomain.com",
  "https://staging.yourdomain.com",
],
```

and register a callback URL for each domain you actually sign in from.

---

## 10. Test checklist

Run these in **development first**, then again in **production**.

- [ ] Sign up with email and password → verification email arrives (or link prints in the terminal in dev)
- [ ] Clicking the link verifies the email and signs the user in
- [ ] Signing in with a password **before** verifying shows the "verify your email" message
- [ ] Sign in with GitHub → lands on `/` signed in
- [ ] Sign in with Discord → lands on `/` signed in
- [ ] A user with password + GitHub + Discord and the same email ends up with **one** user and several rows in `account`
- [ ] Sign out and back in works for each method
- [ ] Wrong password shows an error toast

Check linking in the database:

```bash
docker compose exec db psql -U postgres -d better_auth_tutorial \
  -c "SELECT provider_id, user_id FROM account;"
```

You should see `credential`, `github` and `discord` rows sharing a `user_id`.

---

## 11. Troubleshooting

| Problem | Cause | Fix |
|---|---|---|
| `redirect_uri_mismatch` / invalid redirect | Callback URL in GitHub/Discord doesn't match exactly | Compare scheme, host, port, path, trailing slash. Click Save in Discord. |
| Redirects to the wrong host (e.g. localhost in prod) | `BETTER_AUTH_URL` not set in production | Set it to the real HTTPS URL and redeploy |
| `account_not_linked` | Existing user has `emailVerified: false`, or provider not in `trustedProviders` | Verify the user's email (section 8); check `trustedProviders` |
| Social login works in dev, fails in prod | Prod is still using the dev OAuth app, or the prod callback URL is missing | Create a prod OAuth app and use its credentials |
| Cookie/session not kept in production | Site isn't on HTTPS, or `BETTER_AUTH_URL` is wrong | Use HTTPS; check env values |
| Invalid origin / CSRF error | Domain missing in `trustedOrigins` | Add the exact origin |
| Verification email never arrives | Bad API key, unverified sender domain, or spam folder | Check provider logs; verify the domain; in dev read the link in the terminal |
| Verification email sent but sign-up shows the user as logged in | Client still calls `router.push("/")` after sign up | Show the "check your email" message instead |
| GitHub login fails with no email | GitHub account has no shared email | Add and share an email on GitHub |
| Changes to `.env` ignored | Server wasn't restarted | Restart `npm run dev` / redeploy |
| `Couldn't read your auth config` in `auth:generate` | `@/` alias or missing `.env` loading in files the CLI imports | Use relative imports; add `import "dotenv/config"` in `src/db/index.ts` |

---

## 12. Security notes

- Only put providers in `trustedProviders` if they verify user emails (GitHub and Discord do for the emails they return as verified).
- Keep `requireEmailVerification` on in production so nobody can pre-register someone else's email and block or hijack their social login.
- Use different secrets and OAuth apps for dev and prod.
- Rotate any secret that was ever pasted in a public place (chat, screenshot, repo).
- Never log verification URLs in production. The dev console fallback in `sendEmail` should only run without an API key.