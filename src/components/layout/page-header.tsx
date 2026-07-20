import type { ReactNode } from "react";

export function PageHeader({
  title,
  description,
  action,
}: {
  title: string;
  description?: string;
  action?: ReactNode;
}) {
  return (
    <div className="mb-6 flex items-start justify-between gap-6">
      <div>
        <h1 className="font-headline-lg text-[26px] font-semibold text-ink-primary">{title}</h1>
        {description && <p className="mt-1 text-sm text-ink-secondary">{description}</p>}
      </div>
      {action}
    </div>
  );
}
