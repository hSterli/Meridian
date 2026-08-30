"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { clsx } from "clsx";
import {
  LayoutDashboard,
  FolderKanban,
  LogOut,
  ChevronDown,
  Plus,
  HelpCircle,
  BarChart3,
  Settings as SettingsIcon,
  PanelLeftClose,
  PanelLeftOpen,
} from "lucide-react";
import { useState, useSyncExternalStore } from "react";
import { signOut } from "@/lib/actions/auth";
import { switchActiveOrg } from "@/lib/actions/orgs";
import type { OrgRole } from "@/lib/types/database";

const NAV = [
  { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { href: "/projects", label: "Projects", icon: FolderKanban },
  { href: "/reports", label: "Reports", icon: BarChart3 },
  { href: "/settings", label: "Settings", icon: SettingsIcon },
];

const COLLAPSED_STORAGE_KEY = "meridian-sidebar-collapsed";
const COLLAPSED_CHANGE_EVENT = "meridian-sidebar-collapsed-change";

// useSyncExternalStore (not useEffect+setState) reads localStorage without a
// hydration mismatch: React renders getServerSnapshot() on the server and
// during initial client hydration, then swaps to the real getSnapshot()
// value right after — no "setState during an effect" render cascade, and no
// server/client markup mismatch. The native "storage" event only fires in
// *other* tabs, so toggleCollapsed() dispatches a custom event too, letting
// this same tab's subscribers know to re-read the snapshot.
function subscribeToCollapsed(callback: () => void) {
  window.addEventListener(COLLAPSED_CHANGE_EVENT, callback);
  window.addEventListener("storage", callback);
  return () => {
    window.removeEventListener(COLLAPSED_CHANGE_EVENT, callback);
    window.removeEventListener("storage", callback);
  };
}

function getCollapsedSnapshot() {
  return localStorage.getItem(COLLAPSED_STORAGE_KEY) === "true";
}

function getCollapsedServerSnapshot() {
  return false;
}

export function Sidebar({
  orgs,
  activeOrgId,
  activeOrgName,
  activeRole,
  userEmail,
  userName,
}: {
  orgs: { id: string; name: string }[];
  activeOrgId: string | null;
  activeOrgName: string;
  activeRole: OrgRole | null;
  userEmail: string | null;
  userName: string | null;
}) {
  const pathname = usePathname();
  const [switcherOpen, setSwitcherOpen] = useState(false);
  const collapsed = useSyncExternalStore(
    subscribeToCollapsed,
    getCollapsedSnapshot,
    getCollapsedServerSnapshot
  );

  function toggleCollapsed() {
    localStorage.setItem(COLLAPSED_STORAGE_KEY, String(!collapsed));
    window.dispatchEvent(new Event(COLLAPSED_CHANGE_EVENT));
  }

  return (
    <aside
      className={clsx(
        "flex shrink-0 flex-col bg-ink-primary py-6 shadow-sm transition-all print:hidden",
        collapsed ? "w-16 px-2" : "w-60 px-4"
      )}
    >
      <div className="mb-8 px-2">
        <div className={clsx("flex items-center", collapsed ? "justify-center" : "justify-between")}>
          {!collapsed && (
            <h1 className="font-headline-sm text-[21px] font-semibold text-primary-fixed-dim tracking-tight">
              Meridian QA
            </h1>
          )}
          <button
            type="button"
            onClick={toggleCollapsed}
            title={collapsed ? "Expand sidebar" : "Collapse sidebar"}
            className="rounded-lg p-1.5 text-ink-tertiary hover:bg-white/5 hover:text-white"
          >
            {collapsed ? <PanelLeftOpen size={16} /> : <PanelLeftClose size={16} />}
          </button>
        </div>
        {!collapsed && (
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
        )}
        {!collapsed && activeRole && (
          <span className="mt-2 inline-block rounded-full bg-white/10 px-2 py-0.5 text-[11px] font-ui-label font-bold capitalize text-primary-fixed-dim">
            {activeRole}
          </span>
        )}
      </div>

      <nav className="flex-1 space-y-2">
        {NAV.map((item) => {
          const active = pathname?.startsWith(item.href);
          const Icon = item.icon;
          return (
            <Link
              key={item.href}
              href={item.href}
              title={collapsed ? item.label : undefined}
              className={clsx(
                "flex items-center gap-3 rounded-r-lg p-2 text-sm font-ui-label font-semibold transition-all",
                collapsed && "justify-center",
                active
                  ? "translate-x-1 border-l-4 border-primary-fixed-dim bg-meridian-dark text-primary-fixed"
                  : "text-ink-tertiary hover:bg-white/5 hover:text-white"
              )}
            >
              <Icon size={16} />
              {!collapsed && item.label}
            </Link>
          );
        })}
      </nav>

      <div className="mt-auto space-y-2 border-t border-white/10 pt-6">
        <Link
          href="/projects/new"
          title={collapsed ? "New Project" : undefined}
          className={clsx(
            "mb-2 flex w-full items-center gap-2 rounded-lg bg-primary-container py-2.5 text-sm font-ui-label font-bold text-on-primary-container transition-opacity hover:opacity-90",
            collapsed ? "justify-center" : "justify-center"
          )}
        >
          <Plus size={16} />
          {!collapsed && "New Project"}
        </Link>
        {!collapsed && (
          <Link
            href="/settings/profile"
            title={userEmail ?? undefined}
            className="block truncate px-2 text-xs text-ink-tertiary hover:text-white"
          >
            {userName ?? userEmail}
          </Link>
        )}
        <Link
          href="/onboarding"
          title={collapsed ? "Help Center" : undefined}
          className={clsx(
            "flex w-full items-center gap-3 rounded-lg p-2 text-sm text-ink-tertiary hover:bg-white/5 hover:text-white",
            collapsed && "justify-center"
          )}
        >
          <HelpCircle size={16} />
          {!collapsed && "Help Center"}
        </Link>
        <form action={signOut}>
          <button
            type="submit"
            title={collapsed ? "Log Out" : undefined}
            className={clsx(
              "flex w-full items-center gap-3 rounded-lg p-2 text-sm text-ink-tertiary hover:bg-white/5 hover:text-white",
              collapsed && "justify-center"
            )}
          >
            <LogOut size={16} />
            {!collapsed && "Log Out"}
          </button>
        </form>
      </div>
    </aside>
  );
}
