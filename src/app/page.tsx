import Image from "next/image";
import Link from "next/link";
import { Button } from "@/components/ui/button";

export default function Home() {
  return (
    <div className="flex flex-col flex-1 items-center justify-center bg-zinc-50 font-sans dark:bg-black">
            <Button asChild size="lg">
              <Link href="/auth/login">Sign In / Sign Up</Link>
            </Button>
    </div>
  );
}
