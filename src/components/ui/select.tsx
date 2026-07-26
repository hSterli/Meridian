import { type SelectHTMLAttributes, forwardRef } from "react";
import { ChevronsUpDown } from "lucide-react";
import { clsx } from "clsx";

export const Select = forwardRef<HTMLSelectElement, SelectHTMLAttributes<HTMLSelectElement>>(
  function Select({ className, children, ...props }, ref) {
    return (
      <div className="relative">
        <select
          ref={ref}
          className={clsx(
            "appearance-none rounded-lg border border-border-medium bg-white py-2 pl-3 pr-8 text-sm text-ink-primary shadow-sm transition-colors focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20",
            className
          )}
          {...props}
        >
          {children}
        </select>
        <ChevronsUpDown
          size={13}
          strokeWidth={2}
          className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-ink-tertiary"
        />
      </div>
    );
  }
);
