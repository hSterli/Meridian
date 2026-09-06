"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";

const MESSAGES: Record<string, string> = {
  "read-only": "Your trial has ended — add payment to continue. That action was blocked.",
};

export function ActionErrorBanner() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const error = searchParams.get("error");

  if (!error || !MESSAGES[error]) return null;

  function dismiss() {
    const params = new URLSearchParams(searchParams.toString());
    params.delete("error");
    const query = params.toString();
    router.replace(query ? `${pathname}?${query}` : pathname);
  }

  return (
    <div className="flex items-center justify-between gap-4 bg-fail-soft px-4 py-2 text-sm text-fail">
      <span>{MESSAGES[error]}</span>
      <button type="button" onClick={dismiss} className="font-semibold hover:underline">
        Dismiss
      </button>
    </div>
  );
}
