"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { clsx } from "clsx";
import {
  LayoutDashboard,
  FolderKanban,
  Users,
  LogOut,
  ChevronDown,
  Plus,
  HelpCircle,
  BarChart3,
  Settings as SettingsIcon,
} from "lucide-react";
import { useState } from "react";
import { signOut } from "@/lib/actions/auth";
import { switchActiveOrg } from "@/lib/actions/orgs";
import type { OrgRole } from "@/lib/types/database";

const NAV = [
  { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { href: "/projects", label: "Projects", icon: FolderKanban },
  { href: "/reports", label: "Reports", icon: BarChart3 },
  { href: "/settings", label: "Settings", icon: SettingsIcon },
  { href: "/settings/members", label: "Team", icon: Users },
];

export function Sidebar({
  orgs,
  activeOrgId,
  activeOrgName,
  activeRole,
  userEmail,
}: {
  orgs: { id: string; name: string }[];
  activeOrgId: string | null;
  activeOrgName: string;
  activeRole: OrgRole | null;
  userEmail: string | null;
}) {
  const pathname = usePathname();
  const [switcherOpen, setSwitcherOpen] = useState(false);

  return (
    <aside className="flex w-60 shrink-0 flex-col bg-ink-primary py-6 px-4 shadow-sm">
      <div className="mb-8 px-2">
        <h1 className="font-headline-sm text-[21px] font-semibold text-primary-fixed-dim tracking-tight">
          Meridian QA
        </h1>
        <div className="relative mt-3">
          <button
            type="button"
            onClick={() => setSwitcherOpen((v) => !v)}
            className="flex w-full items-center justify-between rounded-lg border border-white/10 px-2 py-1.5 text-sm text-ink-tertiary hover:bg-white/5"
          >
            <span className="truncate">{activeOrgName || "Select team"}</span>
            <ChevronDown size={14} />
          </button>
          {switcherOpen && orgs.length > 1 && (
            <div className="absolute z-10 mt-1 w-full rounded-lg border border-border-light bg-white py-1 shadow-lg">
              {orgs.map((org) => (
                <form key={org.id} action={switchActiveOrg.bind(null, org.id)}>
                  <button
                    type="submit"
                    className={clsx(
                      "block w-full truncate px-3 py-1.5 text-left text-sm text-ink-primary hover:bg-paper-muted",
                      org.id === activeOrgId && "font-bold text-primary"
                    )}
                  >
                    {org.name}
                  </button>
                </form>
              ))}
            </div>
          )}
        </div>
        {activeRole && (
          <span className="mt-2 inline-block rounded-full bg-white/10 px-2 py-0.5 text-[11px] font-ui-label font-bold capitalize text-primary-fixed-dim">
            {activeRole}
          </span>
        )}
      </div>

      <nav className="flex-1 space-y-2">
        {NAV.map((item) => {
          const active =
            item.href === "/settings"
              ? pathname === "/settings"
              : pathname?.startsWith(item.href);
          const Icon = item.icon;
          return (
            <Link
              key={item.href}
              href={item.href}
              className={clsx(
                "flex items-center gap-3 rounded-r-lg p-2 text-sm font-ui-label font-semibold transition-all",
                active
                  ? "translate-x-1 border-l-4 border-primary-fixed-dim bg-meridian-dark text-primary-fixed"
                  : "text-ink-tertiary hover:bg-white/5 hover:text-white"
              )}
            >
              <Icon size={16} />
              {item.label}
            </Link>
          );
        })}
      </nav>

      <div className="mt-auto space-y-2 border-t border-white/10 pt-6">
        <Link
          href="/projects/new"
          className="mb-2 flex w-full items-center justify-center gap-2 rounded-lg bg-primary-container py-2.5 text-sm font-ui-label font-bold text-on-primary-container transition-opacity hover:opacity-90"
        >
          <Plus size={16} />
          New Project
        </Link>
        <div className="truncate px-2 text-xs text-ink-tertiary">{userEmail}</div>
        <Link
          href="/onboarding"
          className="flex w-full items-center gap-3 rounded-lg p-2 text-sm text-ink-tertiary hover:bg-white/5 hover:text-white"
        >
          <HelpCircle size={16} />
          Help Center
        </Link>
        <form action={signOut}>
          <button
            type="submit"
            className="flex w-full items-center gap-3 rounded-lg p-2 text-sm text-ink-tertiary hover:bg-white/5 hover:text-white"
          >
            <LogOut size={16} />
            Log Out
          </button>
        </form>
      </div>
    </aside>
  );
}
