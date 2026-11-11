import { auth } from "@/lib/auth"
import { toNextJsHandler } from "better-auth/next-js"
import arcjet, {
  BotOptions,
  detectBot,
  EmailOptions,
  protectSignup,
  shield,
  slidingWindow,
  SlidingWindowRateLimitOptions,
} from "@arcjet/next"
import { findIp } from "@arcjet/ip"
//-----------------  Arcjet 
const aj = arcjet({
  key: process.env.ARCJET_API_KEY!,
  characteristics: ["userIdOrIp"],
  rules: [shield({ mode: "LIVE" })],
})

const botSettings = {
  mode: "LIVE",
  allow: ["STRIPE_WEBHOOK"],
} satisfies BotOptions

const restrictiveRateLimitSettings = {
  mode: "LIVE",
  max: 10,
  interval: "10m",
} satisfies SlidingWindowRateLimitOptions<[]>

const laxRateLimitSettings = {
  mode: "LIVE",
  max: 60,
  interval: "1m",
} satisfies SlidingWindowRateLimitOptions<[]>

const emailSettings = {
  mode: "LIVE",
  deny: ["DISPOSABLE", "INVALID", "NO_MX_RECORDS"],
} satisfies EmailOptions

async function checkArcjet(request: Request) {
  // Read the body from a clone so the original stays intact for Better Auth
  const body = (await request
    .clone()
    .json()
    .catch(() => null)) as unknown

  const session = await auth.api.getSession({ headers: request.headers })
  const userIdOrIp = (session?.user.id ?? findIp(request)) || "127.0.0.1"

  const pathname = new URL(request.url).pathname

  if (pathname.endsWith("/sign-up/email")) {
    if (
      body &&
      typeof body === "object" &&
      "email" in body &&
      typeof body.email === "string"
    ) {
      return aj
        .withRule(
          protectSignup({
            email: emailSettings,
            bots: botSettings,
            rateLimit: restrictiveRateLimitSettings,
          })
        )
        .protect(request, { email: body.email, userIdOrIp })
    }

    return aj
      .withRule(detectBot(botSettings))
      .withRule(slidingWindow(restrictiveRateLimitSettings))
      .protect(request, { userIdOrIp })
  }

  return aj
    .withRule(detectBot(botSettings))
    .withRule(slidingWindow(laxRateLimitSettings))
    .protect(request, { userIdOrIp })
}


// ---------------- Auth
const authHandlers = toNextJsHandler(auth)
export const { GET } = authHandlers

export async function POST(request: Request) {
  const decision = await checkArcjet(request)

  if (decision.isDenied()) {
    if (decision.reason.isRateLimit()) {
      return new Response(null, { status: 429 })
    }

    if (decision.reason.isEmail()) {
      let message = "Invalid email."

      if (decision.reason.emailTypes.includes("INVALID")) {
        message = "Email address format is invalid."
      } else if (decision.reason.emailTypes.includes("DISPOSABLE")) {
        message = "Disposable email addresses are not allowed."
      } else if (decision.reason.emailTypes.includes("NO_MX_RECORDS")) {
        message = "Email domain is not valid."
      }

      return Response.json({ message }, { status: 400 })
    }

    return new Response(null, { status: 403 })
  }

  // The original request body is still unread here
  return authHandlers.POST(request)
}
// --------------------------------- 
