import { type InputHTMLAttributes, forwardRef } from "react";
import { clsx } from "clsx";

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(
  function Input({ className, ...props }, ref) {
    return (
      <input
        ref={ref}
        className={clsx(
          "block w-full rounded-lg border border-border-medium bg-white px-3 py-2 text-sm text-ink-primary shadow-sm placeholder:text-ink-tertiary focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20",
          className
        )}
        {...props}
      />
    );
  }
);
