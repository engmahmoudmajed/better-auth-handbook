"use client";

import * as React from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import gsap from "gsap";
import { useGSAP } from "@gsap/react";
import { Eye, EyeOff, Loader2, Mail } from "lucide-react";
import { FaDiscord, FaGithub } from "react-icons/fa6";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { authClient } from "@/lib/auth-client";
import { toast } from "sonner";
import { useRouter } from "next/navigation";

gsap.registerPlugin(useGSAP);

const NO_MOTION = "(prefers-reduced-motion: no-preference)";

/* ---------- Schemas ---------- */

const signInSchema = z.object({
  email: z.string().min(1, "Email is required").email("Enter a valid email"),
  password: z.string().min(1, "Password is required"),
});

const signUpSchema = z
  .object({
    name: z.string().min(2, "Name must be at least 2 characters"),
    email: z.string().min(1, "Email is required").email("Enter a valid email"),
    password: z
      .string()
      .min(8, "Password must be at least 8 characters")
      .regex(/[A-Z]/, "Include at least one uppercase letter")
      .regex(/[0-9]/, "Include at least one number"),
    confirmPassword: z.string().min(1, "Please confirm your password"),
  })
  .refine((v) => v.password === v.confirmPassword, {
    message: "Passwords do not match",
    path: ["confirmPassword"],
  });

type SignInValues = z.infer<typeof signInSchema>;
type SignUpValues = z.infer<typeof signUpSchema>;

/* ---------- Animation helpers ---------- */

/** Staggered entrance for every [data-animate] inside. Replays whenever the tab mounts. */
function AnimatedPanel({ children }: { children: React.ReactNode }) {
  const ref = React.useRef<HTMLDivElement>(null);

  useGSAP(
    () => {
      const mm = gsap.matchMedia();
      mm.add(NO_MOTION, () => {
        gsap.from("[data-animate]", {
          y: 16,
          opacity: 0,
          duration: 0.2,
          ease: "power3.out",
          stagger: 0.07,
          clearProps: "transform,opacity",
        });
      });
    },
    { scope: ref }
  );

  return (
    <div ref={ref} className="w-full">
      {children}
    </div>
  );
}

/** Error text that slides in when it mounts. */
function FieldError({ id, message }: { id: string; message: string }) {
  const ref = React.useRef<HTMLParagraphElement>(null);

  useGSAP(
    () => {
      const mm = gsap.matchMedia();
      mm.add(NO_MOTION, () => {
        gsap.from(ref.current, {
          y: -6,
          opacity: 0,
          duration: 0.25,
          ease: "power2.out",
        });
      });
    },
    { dependencies: [message] }
  );

  return (
    <p ref={ref} id={id} role="alert" className="text-sm text-destructive">
      {message}
    </p>
  );
}

/** Quick horizontal shake used when validation fails. */
function shake(el: HTMLElement | null) {
  if (!el) return;
  gsap.matchMedia().add(NO_MOTION, () => {
    gsap.fromTo(
      el,
      { x: -8 },
      { x: 0, duration: 0.5, ease: "elastic.out(1, 0.25)", clearProps: "x" }
    );
  });
}

/* ---------- Reusable fields ---------- */

type FieldProps = React.ComponentProps<typeof Input> & {
  id: string;
  label: string;
  error?: string;
};

function Field({ id, label, error, ...props }: FieldProps) {
  return (
    <div data-animate className="grid w-full gap-2">
      <Label htmlFor={id}>{label}</Label>
      <Input
        id={id}
        className="h-10 w-full"
        aria-invalid={!!error}
        aria-describedby={error ? `${id}-error` : undefined}
        {...props}
      />
      {error && <FieldError id={`${id}-error`} message={error} />}
    </div>
  );
}

function PasswordField({ id, label, error, ...props }: FieldProps) {
  const [show, setShow] = React.useState(false);

  return (
    <div data-animate className="grid w-full gap-2">
      <Label htmlFor={id}>{label}</Label>
      <div className="relative">
        <Input
          id={id}
          type={show ? "text" : "password"}
          className="h-10 w-full pr-10"
          aria-invalid={!!error}
          aria-describedby={error ? `${id}-error` : undefined}
          {...props}
        />
        <button
          type="button"
          onClick={() => setShow((s) => !s)}
          aria-label={show ? "Hide password" : "Show password"}
          className="absolute inset-y-0 right-0 flex w-10 items-center justify-center text-muted-foreground transition-colors hover:text-foreground"
        >
          {show ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
        </button>
      </div>
      {error && <FieldError id={`${id}-error`} message={error} />}
    </div>
  );
}

function SubmitButton({
  loading,
  children,
}: {
  loading: boolean;
  children: React.ReactNode;
}) {
  const ref = React.useRef<HTMLButtonElement>(null);

  const press = (scale: number) =>
    gsap.matchMedia().add(NO_MOTION, () => {
      gsap.to(ref.current, { scale, duration: 0.15, ease: "power2.out" });
    });

  return (
    <Button
      ref={ref}
      data-animate
      type="submit"
      className="h-10 w-full"
      disabled={loading}
      onPointerDown={() => press(0.97)}
      onPointerUp={() => press(1)}
      onPointerLeave={() => press(1)}
    >
      {loading && <Loader2 className="mr-2 size-4 animate-spin" />}
      {children}
    </Button>
  );
}

/* ---------- Social login (GitHub + Discord) ---------- */

type Provider = "github" | "discord";

const PROVIDERS: { id: Provider; label: string; Icon: React.ElementType }[] = [
  { id: "github", label: "GitHub", Icon: FaGithub },
  { id: "discord", label: "Discord", Icon: FaDiscord },
];

function SocialButtons() {
  const [loading, setLoading] = React.useState<Provider | null>(null);

  const handleSocial = async (provider: Provider) => {
    setLoading(provider);
    try {
      await authClient.signIn.social(
        { provider, callbackURL: "/" },
        {
          onError: (ctx) => {
            toast.error(
              ctx.error.message || `Failed to continue with ${provider}`
            );
            setLoading(null);
          },
        }
      );
      // On success the browser redirects to the provider, so the
      // loading state stays on until the page unloads.
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Something went wrong");
      setLoading(null);
    }
  };

  return (
    <div data-animate className="grid w-full gap-4">
      <div className="flex items-center gap-3 text-sm text-muted-foreground">
        <span className="h-px flex-1 bg-border" />
        or continue with
        <span className="h-px flex-1 bg-border" />
      </div>
      <div className="grid grid-cols-2 gap-3">
        {PROVIDERS.map(({ id, label, Icon }) => (
          <Button
            key={id}
            type="button"
            variant="outline"
            className="h-10"
            disabled={loading !== null}
            onClick={() => handleSocial(id)}
          >
            {loading === id ? (
              <Loader2 className="mr-2 size-4 animate-spin" />
            ) : (
              <Icon className="mr-2 size-4" />
            )}
            {label}
          </Button>
        ))}
      </div>
    </div>
  );
}

/* ---------- Email verification notice ---------- */

/** Shown after sign up: tells the user to check their inbox, with a resend option. */
function VerifyEmailNotice({
  email,
  onBack,
}: {
  email: string;
  onBack: () => void;
}) {
  const [resending, setResending] = React.useState(false);

  const resend = async () => {
    setResending(true);
    try {
      await authClient.sendVerificationEmail(
        { email, callbackURL: "/" },
        {
          onSuccess: () => {
            toast.success("Verification email sent again");
          },
          onError: (ctx) => {
            toast.error(ctx.error.message || "Failed to resend the email");
          },
        }
      );
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setResending(false);
    }
  };

  return (
    <div data-animate className="grid w-full gap-5 text-center">
      <div className="mx-auto flex size-12 items-center justify-center rounded-full bg-muted">
        <Mail className="size-6" />
      </div>
      <div className="grid gap-1">
        <p className="font-medium">Check your email</p>
        <p className="text-sm text-muted-foreground">
          We sent a verification link to{" "}
          <span className="font-medium text-foreground">{email}</span>. Click
          it to activate your account, then sign in.
        </p>
      </div>
      <div className="grid gap-2">
        <Button
          type="button"
          variant="outline"
          className="h-10 w-full"
          onClick={resend}
          disabled={resending}
        >
          {resending && <Loader2 className="mr-2 size-4 animate-spin" />}
          Resend email
        </Button>
        <Button
          type="button"
          variant="ghost"
          className="h-10 w-full"
          onClick={onBack}
        >
          Use a different email
        </Button>
      </div>
    </div>
  );
}

/* ---------- Forms ---------- */

function SignInForm() {
  const router = useRouter();
  const formRef = React.useRef<HTMLFormElement>(null);
  const {
    register,
    handleSubmit,
    setError,
    formState: { errors, isSubmitting },
  } = useForm<SignInValues>({
    resolver: zodResolver(signInSchema),
    defaultValues: { email: "", password: "" },
  });

  const onSubmit = async ({ email, password }: SignInValues) => {
    try {
      await authClient.signIn.email(
        { email, password, callbackURL: "/" },
        {
          onError: (ctx) => {
            // 403 means the account exists but the email is not verified yet.
            // Better Auth re-sends the verification email automatically
            // (emailVerification.sendOnSignIn = true on the server).
            const message =
              ctx.error.status === 403
                ? "Please verify your email first. We sent you a new link."
                : ctx.error.message || "Failed to sign in";
            setError("root", { message });
            toast.error(message);
            shake(formRef.current);
          },
          onSuccess: () => {
            toast.success("Welcome back");
            router.push("/");
            router.refresh();
          },
        }
      );
    } catch (err) {
      // Unexpected failures (network down, etc.)
      setError("root", {
        message: err instanceof Error ? err.message : "Something went wrong",
      });
      shake(formRef.current);
    }
  };

  return (
    <form
      ref={formRef}
      onSubmit={handleSubmit(onSubmit, () => shake(formRef.current))}
      noValidate
      className="grid w-full gap-5"
    >
      <Field
        id="signin-email"
        label="Email"
        type="email"
        placeholder="you@example.com"
        autoComplete="email"
        error={errors.email?.message}
        {...register("email")}
      />
      <PasswordField
        id="signin-password"
        label="Password"
        autoComplete="current-password"
        error={errors.password?.message}
        {...register("password")}
      />
      {errors.root?.message && (
        <FieldError id="signin-root-error" message={errors.root.message} />
      )}
      <SubmitButton loading={isSubmitting}>Sign In</SubmitButton>
    </form>
  );
}

function SignUpForm({ onSent }: { onSent: (email: string | null) => void }) {
  const formRef = React.useRef<HTMLFormElement>(null);
  const {
    register,
    handleSubmit,
    setError,
    formState: { errors, isSubmitting },
  } = useForm<SignUpValues>({
    resolver: zodResolver(signUpSchema),
    defaultValues: { name: "", email: "", password: "", confirmPassword: "" },
  });

  const onSubmit = async ({ name, email, password }: SignUpValues) => {
    try {
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
            // No session yet: the user must verify their email first,
            // so show the "check your email" notice instead of redirecting.
            toast.success("Account created. Check your email.");
            onSent(email);
          },
        }
      );
    } catch (err) {
      // Unexpected failures (network down, etc.)
      setError("root", {
        message: err instanceof Error ? err.message : "Something went wrong",
      });
      shake(formRef.current);
    }
  };

  return (
    <form
      ref={formRef}
      onSubmit={handleSubmit(onSubmit, () => shake(formRef.current))}
      noValidate
      className="grid w-full gap-5"
    >
      <Field
        id="signup-name"
        label="Full name"
        placeholder="Your name"
        autoComplete="name"
        error={errors.name?.message}
        {...register("name")}
      />
      <Field
        id="signup-email"
        label="Email"
        type="email"
        placeholder="you@example.com"
        autoComplete="email"
        error={errors.email?.message}
        {...register("email")}
      />
      <PasswordField
        id="signup-password"
        label="Password"
        autoComplete="new-password"
        error={errors.password?.message}
        {...register("password")}
      />
      <PasswordField
        id="signup-confirm"
        label="Confirm password"
        autoComplete="new-password"
        error={errors.confirmPassword?.message}
        {...register("confirmPassword")}
      />
      {errors.root?.message && (
        <FieldError id="signup-root-error" message={errors.root.message} />
      )}
      <SubmitButton loading={isSubmitting}>Create account</SubmitButton>
    </form>
  );
}

/** Switches between the sign up form and the "check your email" notice. */
function SignUpPanel() {
  const [sentTo, setSentTo] = React.useState<string | null>(null);

  if (sentTo) {
    return <VerifyEmailNotice email={sentTo} onBack={() => setSentTo(null)} />;
  }

  return (
    <>
      <SignUpForm onSent={setSentTo} />
      <SocialButtons />
    </>
  );
}

/* ---------- Tabs ---------- */

export function AuthTabs() {
  return (
    <Tabs
      defaultValue="signin"
      orientation="horizontal"
      className="flex w-full max-w-md flex-col gap-6"
    >
      <TabsList className="grid h-11 w-full grid-cols-2">
        <TabsTrigger value="signin">Sign In</TabsTrigger>
        <TabsTrigger value="signup">Sign Up</TabsTrigger>
      </TabsList>

      <TabsContent value="signin" className="w-full">
        <AnimatedPanel>
          <Card className="w-full border-0 shadow-none sm:border sm:shadow-sm">
            <CardHeader className="px-0 sm:px-6">
              <CardTitle
                data-animate
                className="text-2xl font-bold tracking-tight sm:text-3xl"
              >
                Welcome back
              </CardTitle>
              <CardDescription data-animate>
                Enter your email and password to sign in.
              </CardDescription>
            </CardHeader>
            <CardContent className="grid gap-5 px-0 sm:px-6">
              <SignInForm />
              <SocialButtons />
            </CardContent>
          </Card>
        </AnimatedPanel>
      </TabsContent>

      <TabsContent value="signup" className="w-full">
        <AnimatedPanel>
          <Card className="w-full border-0 shadow-none sm:border sm:shadow-sm">
            <CardHeader className="px-0 sm:px-6">
              <CardTitle
                data-animate
                className="text-2xl font-bold tracking-tight sm:text-3xl"
              >
                Create an account
              </CardTitle>
              <CardDescription data-animate>
                Fill in your details to get started.
              </CardDescription>
            </CardHeader>
            <CardContent className="grid gap-5 px-0 sm:px-6">
              <SignUpPanel />
            </CardContent>
          </Card>
        </AnimatedPanel>
      </TabsContent>
    </Tabs>
  );
}