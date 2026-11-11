import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { db } from "@/db"; // your drizzle instance
import { nextCookies } from "better-auth/next-js";
import * as schema from "../db/schema/auth-schema";


export const auth = betterAuth({
  emailAndPassword: { 
    enabled: true, 
  }, 
  session:{
    cookieCache:{
      enabled:true,
      maxAge:60
    }
  },
  plugins:[nextCookies()],
    database: drizzleAdapter(db, {
        provider: "pg",
        schema,
    }),
});