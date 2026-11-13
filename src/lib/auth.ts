import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { nextCookies } from "better-auth/next-js";
import { db } from "@/db"; // use "../db" if auth:generate can't resolve the alias
import * as schema from "../db/schema/auth-schema";
import { sendEmail } from "./email";

// Prevents HTML injection through the user's name inside the email body
function escapeHtml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export const auth = betterAuth({
emailAndPassword: {
  enabled: true,
  requireEmailVerification: true,
  resetPasswordTokenExpiresIn: 3600, // 1 hour
  sendResetPassword: async ({ user, url }) => {
    // Not awaited on purpose (avoids timing differences that reveal whether the email exists).
    void sendEmail({
      to: user.email,
      subject: "Reset your password",
      html: `
        <div style="font-family: sans-serif; max-width: 480px; margin: 0 auto;">
          <h2>Reset your password</h2>
          <p>Hi ${escapeHtml(user.name || "there")},</p>
          <p>Click the button below to choose a new password. This link expires in 1 hour.</p>
          <p>
            <a href="${url}"
               style="display:inline-block;padding:10px 20px;background:#000;color:#fff;
                      text-decoration:none;border-radius:6px;">
              Reset password
            </a>
          </p>
          <p style="color:#666;font-size:13px;">
            If you didn't request this, you can ignore this email.
          </p>
        </div>
      `,
    });
  },
},

  emailVerification: {
    sendOnSignUp: true, // send the email right after sign up
    sendOnSignIn: true, // re-send when an unverified user tries to sign in
    autoSignInAfterVerification: true,
    sendVerificationEmail: async ({ user, url }) => {
      // Not awaited on purpose (avoids timing differences between requests).
      void sendEmail({
        to: user.email,
        subject: "Verify your email address",
        html: `
          <div style="font-family: sans-serif; max-width: 480px; margin: 0 auto;">
            <h2>Verify your email</h2>
            <p>Hi ${escapeHtml(user.name || "there")},</p>
            <p>Click the button below to verify your email address.</p>
            <p>
              <a href="${url}"
                 style="display:inline-block;padding:10px 20px;background:#000;color:#fff;
                        text-decoration:none;border-radius:6px;">
                Verify email
              </a>
            </p>
            <p style="color:#666;font-size:13px;">
              If you didn't create an account, you can ignore this email.
            </p>
          </div>
        `,
      });
    },
  },

  session: {
    cookieCache: {
      enabled: true,
      maxAge: 60,
    },
  },

  socialProviders: {
    discord: {
      clientId: process.env.DISCORD_CLIENT_ID as string,
      clientSecret: process.env.DISCORD_CLIENT_SECRET as string,
    },
    github: {
      clientId: process.env.GITHUB_CLIENT_ID as string,
      clientSecret: process.env.GITHUB_CLIENT_SECRET as string,
    },
  },

  account: {
    accountLinking: {
      enabled: true,
      trustedProviders: ["github", "discord"],
    },
  },

  plugins: [nextCookies()], // keep this as the last plugin

  database: drizzleAdapter(db, {
    provider: "pg",
    schema,
  }),
});