import { type ButtonHTMLAttributes, forwardRef } from "react";
import { clsx } from "clsx";

type Variant = "primary" | "secondary" | "ghost" | "danger";

const variantClasses: Record<Variant, string> = {
  primary: "bg-primary text-white hover:bg-meridian-dark disabled:bg-primary/40",
  secondary:
    "bg-white text-ink-primary border border-border-medium hover:bg-paper-muted",
  ghost: "text-ink-secondary hover:bg-paper-muted",
  danger: "bg-fail text-white hover:bg-fail/90",
};

export const Button = forwardRef<
  HTMLButtonElement,
  ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant }
>(function Button({ className, variant = "primary", ...props }, ref) {
  return (
    <button
      ref={ref}
      className={clsx(
        "inline-flex items-center justify-center gap-2 rounded-lg px-3.5 py-2 text-sm font-ui-label font-semibold transition-all disabled:cursor-not-allowed disabled:opacity-60",
        variantClasses[variant],
        className
      )}
      {...props}
    />
  );
});
