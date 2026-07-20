import { type HTMLAttributes } from "react";
import { clsx } from "clsx";

export function Card({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={clsx(
        "rounded-xl border border-border-light bg-white shadow-sm",
        className
      )}
      {...props}
    />
  );
}

export function Badge({
  className,
  tone = "slate",
  ...props
}: HTMLAttributes<HTMLSpanElement> & {
  tone?: "slate" | "green" | "red" | "amber" | "indigo" | "blue";
}) {
  const tones: Record<string, string> = {
    slate: "bg-surface-container-highest text-ink-secondary",
    green: "bg-pass-soft text-pass",
    red: "bg-fail-soft text-fail",
    amber: "bg-blocked-soft text-blocked",
    indigo: "bg-meridian-soft text-meridian-dark",
    blue: "bg-blue-50 text-blue-700",
  };
  return (
    <span
      className={clsx(
        "inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[11px] font-ui-label font-bold",
        tones[tone],
        className
      )}
      {...props}
    />
  );
}
