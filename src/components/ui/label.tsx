import { type LabelHTMLAttributes } from "react";
import { clsx } from "clsx";

export function Label({ className, ...props }: LabelHTMLAttributes<HTMLLabelElement>) {
  return (
    <label
      className={clsx("mb-1 block text-sm font-ui-label font-semibold text-ink-secondary", className)}
      {...props}
    />
  );
}
