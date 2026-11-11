"use client";

import * as React from "react";
import gsap from "gsap";
import { useGSAP } from "@gsap/react";

gsap.registerPlugin(useGSAP);

export function BrandPanel() {
  const ref = React.useRef<HTMLElement>(null);

  useGSAP(
    () => {
      const mm = gsap.matchMedia();
      mm.add("(prefers-reduced-motion: no-preference)", () => {
        const tl = gsap.timeline({ defaults: { ease: "power3.out" } });
        tl.from("[data-brand='logo']", { y: -16, opacity: 0, duration: 0.6 })
          .from(
            "[data-brand='quote']",
            { y: 24, opacity: 0, duration: 0.8 },
            "-=0.3"
          )
          .from(
            "[data-brand='footer']",
            { opacity: 0, duration: 0.6 },
            "-=0.4"
          );
      });
    },
    { scope: ref }
  );

  return (
    <aside
      ref={ref}
      className="hidden flex-col justify-between bg-primary p-10 text-primary-foreground lg:flex"
    >
      <div data-brand="logo" className="text-lg font-semibold tracking-tight">
        YourApp
      </div>
      <blockquote className="max-w-md space-y-2">
        <p
          data-brand="quote"
          className="text-2xl font-medium leading-snug"
        >
          Build, ship, and grow your store from one place.
        </p>
        <footer data-brand="footer" className="text-sm opacity-70">
          Welcome back
        </footer>
      </blockquote>
    </aside>
  );
}