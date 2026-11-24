
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { nextCookies } from "better-auth/next-js";
import { db } from "@/db";
import * as schema from "../db/schema/auth-schema";
import { sendEmail } from "./email";

// Prevent HTML injection through the user's name
function escapeHtml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export const auth = betterAuth({
  database: drizzleAdapter(db, {
    provider: "pg",
    schema,
  }),

  emailAndPassword: {
    enabled: true,
    requireEmailVerification: true,
    resetPasswordTokenExpiresIn: 3600,

    sendResetPassword: async ({ user, url }) => {
      void sendEmail({
        to: user.email,
        subject: "Reset your password",
        html: `
          <div style="font-family: sans-serif; max-width: 480px; margin: 0 auto;">
            <h2>Reset your password</h2>
            <p>Hi ${escapeHtml(user.name || "there")},</p>
            <p>Click the button below to choose a new password. This link expires in 1 hour.</p>
            <a href="${url}"
              style="display:inline-block;padding:10px 20px;background:#000;color:#fff;text-decoration:none;border-radius:6px;">
              Reset password
            </a>
            <p style="color:#666;font-size:13px;">
              If you didn't request this, you can ignore this email.
            </p>
          </div>
        `,
      });
    },
  },

  emailVerification: {
    sendOnSignUp: true,
    sendOnSignIn: true,
    autoSignInAfterVerification: true,

    sendVerificationEmail: async ({ user, url }) => {
      void sendEmail({
        to: user.email,
        subject: "Verify your email address",
        html: `
          <div style="font-family: sans-serif; max-width: 480px; margin: 0 auto;">
            <h2>Verify your email</h2>
            <p>Hi ${escapeHtml(user.name || "there")},</p>
            <p>Click the button below to verify your email address.</p>
            <a href="${url}"
              style="display:inline-block;padding:10px 20px;background:#000;color:#fff;text-decoration:none;border-radius:6px;">
              Verify email
            </a>
            <p style="color:#666;font-size:13px;">
              If you didn't create an account, you can ignore this email.
            </p>
          </div>
        `,
      });
    },
  },

  // Welcome email hook
  databaseHooks: {
    user: {
      create: {
        after: async (user) => {
          await sendEmail({
            to: user.email,
            subject: "Welcome to My App!",
            html: `
              <div style="font-family: sans-serif; max-width: 480px; margin: 0 auto; padding: 24px;">
                <h1>Welcome, ${escapeHtml(user.name || "there")}! 🎉</h1>

                <p>We're excited to have you with us.</p>

                <p>
                  Your account has been created successfully.
                  Thank you for joining our community!
                </p>

                <p>
                  You can now explore everything our application has to offer.
                </p>

                <p style="color:#666;font-size:13px;">
                  Thanks for joining us!
                </p>
              </div>
            `,
          });

          console.log("Welcome email processed for:", user.email);
        },
      },
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

  plugins: [nextCookies()],
});
