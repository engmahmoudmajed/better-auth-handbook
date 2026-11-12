import { AuthTabs } from "@/components/auth-tabs";
import { BrandPanel } from "@/components/brand-panel";

export default function Page() {
  return (
    <main className="grid min-h-svh lg:grid-cols-2">
      <BrandPanel />
      <section className="flex min-w-0 items-center justify-center px-4 py-10 sm:px-8">
        <AuthTabs />
      </section>
    </main>
  );
}