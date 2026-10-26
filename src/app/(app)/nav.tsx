"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const items = [
  { href: "/", label: "Overview", icon: "M3 12l9-8 9 8M5 10v10h5v-6h4v6h5V10" },
  { href: "/transactions", label: "Transactions", icon: "M4 6h16M4 12h16M4 18h10" },
  { href: "/reports", label: "Reports", icon: "M5 20V10M12 20V4M19 20v-7" },
  { href: "/automation", label: "Automation", icon: "M4 12a8 8 0 0114-5.3M20 12a8 8 0 01-14 5.3M18 3v4h-4M6 21v-4h4" },
  { href: "/notifications", label: "Alerts", icon: "M6 16V11a6 6 0 0112 0v5l2 2H4l2-2zM10 21h4" },
] as const;

// Desktop sidebar only; on phones these are reached from the header and the Overview.
const secondary = [
  { href: "/budgets", label: "Budgets", icon: "M4 19h16M6 15V9M12 15V5M18 15v-3" },
  { href: "/settings", label: "Settings", icon: "M12 8a4 4 0 100 8 4 4 0 000-8zM12 3v2M12 19v2M3 12h2M19 12h2M5.6 5.6l1.4 1.4M17 17l1.4 1.4M5.6 18.4L7 17M17 7l1.4-1.4" },
] as const;

function isActive(pathname: string, href: string) {
  return href === "/" ? pathname === "/" : pathname.startsWith(href);
}

// Unread alert count on the Alerts item. The number is in the accessible name too.
function UnreadBadge({ count }: { count: number }) {
  if (count === 0) return null;
  return (
    <span className="ml-auto min-w-5 rounded-full bg-danger px-1.5 text-center text-[11px] font-semibold leading-5 text-white" data-testid="unread-alerts">
      {count > 99 ? "99+" : count}
    </span>
  );
}

const unreadLabel = (href: string, count: number) => (href === "/notifications" && count > 0 ? `, ${count} unread` : "");

function Icon({ d }: { d: string }) {
  return (
    <svg viewBox="0 0 24 24" className="h-6 w-6" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d={d} />
    </svg>
  );
}

export function SideNav({ unreadAlerts = 0 }: { unreadAlerts?: number }) {
  const pathname = usePathname();
  return (
    <nav aria-label="Main" className="flex flex-col gap-1">
      {[...items, ...secondary].map((item) => (
        <Link
          key={item.href}
          href={item.href}
          aria-current={isActive(pathname, item.href) ? "page" : undefined}
          className="flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium text-muted hover:bg-background aria-[current=page]:bg-brand aria-[current=page]:text-brand-contrast"
        >
          <Icon d={item.icon} />
          {item.label}
          <span className="sr-only">{unreadLabel(item.href, unreadAlerts)}</span>
          {item.href === "/notifications" && <UnreadBadge count={unreadAlerts} />}
        </Link>
      ))}
    </nav>
  );
}

export function TabBar({ unreadAlerts = 0 }: { unreadAlerts?: number }) {
  const pathname = usePathname();
  return (
    <nav
      aria-label="Main"
      className="fixed inset-x-0 bottom-0 z-10 grid grid-cols-5 border-t border-border bg-surface pb-[env(safe-area-inset-bottom)] md:hidden"
    >
      {items.map((item) => (
        <Link
          key={item.href}
          href={item.href}
          aria-current={isActive(pathname, item.href) ? "page" : undefined}
          className="relative flex flex-col items-center gap-0.5 py-2 text-[11px] font-medium text-muted aria-[current=page]:text-brand"
        >
          <Icon d={item.icon} />
          {item.label}
          <span className="sr-only">{unreadLabel(item.href, unreadAlerts)}</span>
          {item.href === "/notifications" && unreadAlerts > 0 && (
            <span aria-hidden className="absolute top-1 left-1/2 ml-2 min-w-4 rounded-full bg-danger px-1 text-center text-[10px] font-semibold leading-4 text-white">
              {unreadAlerts > 99 ? "99+" : unreadAlerts}
            </span>
          )}
        </Link>
      ))}
    </nav>
  );
}
