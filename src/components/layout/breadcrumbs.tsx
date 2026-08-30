import Link from "next/link";
import { ChevronRight } from "lucide-react";

export interface BreadcrumbItem {
  label: string;
  href?: string;
}

export function Breadcrumbs({ items }: { items: BreadcrumbItem[] }) {
  return (
    <nav aria-label="Breadcrumb" className="mb-2 flex flex-wrap items-center gap-1.5 text-sm">
      {items.map((item, i) => (
        <span key={i} className="flex items-center gap-1.5">
          {i > 0 && <ChevronRight size={12} className="text-ink-tertiary" />}
          {item.href ? (
            <Link href={item.href} className="text-ink-tertiary hover:text-ink-primary hover:underline">
              {item.label}
            </Link>
          ) : (
            <span className="font-medium text-ink-secondary">{item.label}</span>
          )}
        </span>
      ))}
    </nav>
  );
}
