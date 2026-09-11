"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { checkBillingStatus } from "@/lib/actions/billing";

const POLL_INTERVAL_MS = 2000;
const MAX_WAIT_MS = 15000;

export default function BillingUpgradeSuccessPage() {
  const router = useRouter();
  const [message, setMessage] = useState("Setting up your account…");

  useEffect(() => {
    const startedAt = Date.now();

    const interval = setInterval(async () => {
      const { billingStatus } = await checkBillingStatus();

      if (billingStatus === "active") {
        clearInterval(interval);
        router.push("/dashboard");
        return;
      }

      if (Date.now() - startedAt > MAX_WAIT_MS) {
        clearInterval(interval);
        setMessage("This is taking longer than expected — continuing anyway.");
        router.push("/dashboard?pending=1");
      }
    }, POLL_INTERVAL_MS);

    return () => clearInterval(interval);
  }, [router]);

  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center gap-3 text-center">
      <div className="h-8 w-8 animate-spin rounded-full border-2 border-primary border-t-transparent" />
      <p className="text-sm text-ink-secondary">{message}</p>
    </div>
  );
}
