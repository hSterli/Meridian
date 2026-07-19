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
} from "lucide-react";
import { useState } from "react";
import { signOut } from "@/lib/actions/auth";
import { switchActiveOrg } from "@/lib/actions/orgs";
import type { OrgRole } from "@/lib/types/database";

const NAV = [
  { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { href: "/projects", label: "Projects", icon: FolderKanban },
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
    <aside className="flex w-60 shrink-0 flex-col border-r border-slate-200 bg-white">
      <div className="border-b border-slate-200 p-4">
        <div className="text-sm font-semibold text-indigo-600">Meridian QA</div>
        <div className="relative mt-2">
          <button
            type="button"
            onClick={() => setSwitcherOpen((v) => !v)}
            className="flex w-full items-center justify-between rounded-md border border-slate-200 px-2 py-1.5 text-sm text-slate-700 hover:bg-slate-50"
          >
            <span className="truncate">{activeOrgName || "Select team"}</span>
            <ChevronDown size={14} />
          </button>
          {switcherOpen && orgs.length > 1 && (
            <div className="absolute z-10 mt-1 w-full rounded-md border border-slate-200 bg-white py-1 shadow-lg">
              {orgs.map((org) => (
                <form key={org.id} action={switchActiveOrg.bind(null, org.id)}>
                  <button
                    type="submit"
                    className={clsx(
                      "block w-full truncate px-3 py-1.5 text-left text-sm hover:bg-slate-50",
                      org.id === activeOrgId && "font-medium text-indigo-600"
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
          <span className="mt-2 inline-block rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium capitalize text-slate-600">
            {activeRole}
          </span>
        )}
      </div>

      <nav className="flex-1 space-y-0.5 p-3">
        {NAV.map((item) => {
          const active = pathname?.startsWith(item.href);
          const Icon = item.icon;
          return (
            <Link
              key={item.href}
              href={item.href}
              className={clsx(
                "flex items-center gap-2 rounded-md px-3 py-2 text-sm font-medium transition-colors",
                active ? "bg-indigo-50 text-indigo-700" : "text-slate-600 hover:bg-slate-100"
              )}
            >
              <Icon size={16} />
              {item.label}
            </Link>
          );
        })}
      </nav>

      <div className="border-t border-slate-200 p-3">
        <div className="mb-2 truncate px-1 text-xs text-slate-500">{userEmail}</div>
        <form action={signOut}>
          <button
            type="submit"
            className="flex w-full items-center gap-2 rounded-md px-3 py-2 text-sm text-slate-600 hover:bg-slate-100"
          >
            <LogOut size={16} />
            Sign out
          </button>
        </form>
      </div>
    </aside>
  );
}
