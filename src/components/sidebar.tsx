import { useEffect, useState, type ReactNode } from "react";
import { Link, useRouterState } from "@tanstack/react-router";
import { motion } from "framer-motion";
import { toast } from "sonner";
import { UserAvatar } from "@/components/ui-elements";
import {
  BarChart3,
  BookOpen,
  CalendarCheck,
  ChevronRight,
  ChevronsLeft,
  ChevronsRight,
  ClipboardList,
  Cpu,
  GraduationCap,
  Layers,
  LayoutDashboard,
  Library,
  LogOut,
  Megaphone,
  Menu as MenuIcon,
  MessageSquareWarning,
  Settings,
  Table,
  Users,
  X,
} from "lucide-react";
import type { Profile, Role } from "@/lib/lms";
import { cn } from "@/lib/utils";
import { MiowMark, MiowWordmark } from "@/components/brand";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { ThemeToggle } from "@/components/ui-elements";
import { useSignOut } from "@/hooks";
import { ChatWidget } from "@/components/chat-widget";
import { usePendingTasks } from "@/hooks/usePendingTasks";
import { taskCountForPath } from "@/lib/pending-tasks";

function TaskBadge({
  count,
  compact = false,
  sidebar = true,
}: {
  count: number;
  compact?: boolean;
  sidebar?: boolean;
}) {
  if (count <= 0) return null;
  return (
    <span
      aria-hidden="true"
      data-testid="pending-task-count"
      data-count={count}
      className={cn(
        "inline-flex h-5 min-w-5 shrink-0 items-center justify-center rounded-full px-1.5 text-[11px] font-bold tabular-nums",
        sidebar ? "bg-sidebar-foreground text-sidebar" : "bg-primary text-primary-foreground",
        compact ? "absolute right-0 top-0 h-4 min-w-4 px-1 text-[9px]" : "ml-auto",
      )}
    >
      {count > 99 ? "99+" : count}
    </span>
  );
}

export interface NavItem {
  to: string;
  label: string;
  icon: ReactNode;
}

export const STUDENT_NAV: NavItem[] = [
  { to: "/dashboard/student", label: "Dashboard", icon: <LayoutDashboard className="h-4 w-4" /> },
  { to: "/dashboard/student/courses", label: "Courses", icon: <BookOpen className="h-4 w-4" /> },
  {
    to: "/dashboard/student/assignments",
    label: "Activities",
    icon: <ClipboardList className="h-4 w-4" />,
  },
  {
    to: "/dashboard/student/arduino",
    label: "Arduino Lab",
    icon: <Cpu className="h-4 w-4" />,
  },
  {
    to: "/dashboard/student/attendance",
    label: "Attendance",
    icon: <CalendarCheck className="h-4 w-4" />,
  },
  { to: "/dashboard/student/grades", label: "Grades", icon: <BarChart3 className="h-4 w-4" /> },
  { to: "/dashboard/student/settings", label: "Settings", icon: <Settings className="h-4 w-4" /> },
  {
    to: "/dashboard/student/report",
    label: "Report an issue",
    icon: <MessageSquareWarning className="h-4 w-4" />,
  },
];

export const ADMIN_NAV: NavItem[] = [
  { to: "/dashboard/admin", label: "Dashboard", icon: <LayoutDashboard className="h-4 w-4" /> },
  { to: "/dashboard/admin/students", label: "Students", icon: <Users className="h-4 w-4" /> },
  {
    to: "/dashboard/admin/teachers",
    label: "Teachers",
    icon: <GraduationCap className="h-4 w-4" />,
  },
  { to: "/dashboard/admin/courses", label: "Courses", icon: <BookOpen className="h-4 w-4" /> },
  {
    to: "/dashboard/admin/question-bank",
    label: "Question Bank",
    icon: <Library className="h-4 w-4" />,
  },
  { to: "/dashboard/admin/tos", label: "TOS", icon: <Table className="h-4 w-4" /> },
  {
    to: "/dashboard/admin/announcements",
    label: "Announcements",
    icon: <Megaphone className="h-4 w-4" />,
  },
  {
    to: "/dashboard/admin/attendance",
    label: "Attendance",
    icon: <CalendarCheck className="h-4 w-4" />,
  },
  {
    to: "/dashboard/admin/arduino",
    label: "Arduino Lab",
    icon: <Cpu className="h-4 w-4" />,
  },
  { to: "/dashboard/admin/settings", label: "Settings", icon: <Settings className="h-4 w-4" /> },
  {
    to: "/dashboard/admin/report",
    label: "Report inbox",
    icon: <MessageSquareWarning className="h-4 w-4" />,
  },
];

export const TEACHER_NAV: NavItem[] = [
  { to: "/dashboard/teacher", label: "Dashboard", icon: <LayoutDashboard className="h-4 w-4" /> },
  { to: "/dashboard/teacher/students", label: "Students", icon: <Users className="h-4 w-4" /> },
  { to: "/dashboard/teacher/courses", label: "Courses", icon: <BookOpen className="h-4 w-4" /> },
  {
    to: "/dashboard/teacher/announcements",
    label: "Announcements",
    icon: <Megaphone className="h-4 w-4" />,
  },
  { to: "/dashboard/teacher/grades", label: "Gradebook", icon: <Layers className="h-4 w-4" /> },
  {
    to: "/dashboard/teacher/question-bank",
    label: "Question Bank",
    icon: <Library className="h-4 w-4" />,
  },
  { to: "/dashboard/teacher/tos", label: "TOS", icon: <Table className="h-4 w-4" /> },
  {
    to: "/dashboard/teacher/arduino",
    label: "Arduino Lab",
    icon: <Cpu className="h-4 w-4" />,
  },
  {
    to: "/dashboard/teacher/attendance",
    label: "Attendance",
    icon: <CalendarCheck className="h-4 w-4" />,
  },
  { to: "/dashboard/teacher/settings", label: "Settings", icon: <Settings className="h-4 w-4" /> },
  {
    to: "/dashboard/teacher/report",
    label: "Report an issue",
    icon: <MessageSquareWarning className="h-4 w-4" />,
  },
];

export function staffNav(role: Role): NavItem[] {
  return role === "admin" ? ADMIN_NAV : TEACHER_NAV;
}

export function settingsPathFor(role: Role): string {
  if (role === "admin") return "/dashboard/admin/settings";
  if (role === "teacher") return "/dashboard/teacher/settings";
  return "/dashboard/student/settings";
}

/**
 * The few destinations worth keeping visible on small screens. Everything
 * else lives behind the mobile "Menu" drawer so nothing hides behind
 * sideways scrolling.
 */
function mobileQuickNav(nav: NavItem[]): NavItem[] {
  const pick = (labels: string[]) => nav.find((n) => labels.includes(n.label));
  return [
    pick(["Dashboard"]),
    pick(["Students", "Courses"]),
    pick(["Attendance"]),
    pick(["Settings"]),
  ].filter((n): n is NavItem => Boolean(n));
}

function pathMatches(pathname: string, to: string): boolean {
  return pathname.replace(/\/+$/, "") === to.replace(/\/+$/, "");
}

const SIDEBAR_KEY = "miow-sidebar-collapsed";

function Breadcrumbs({ nav, subtitle }: { nav: NavItem[]; subtitle: string }) {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const current = nav.find((n) => pathMatches(pathname, n.to));
  return (
    <nav aria-label="Breadcrumb" className="flex items-center gap-1.5 text-sm">
      <span className="font-medium text-muted-foreground">{subtitle}</span>
      {current && (
        <>
          <ChevronRight className="h-3.5 w-3.5 text-muted-foreground/60" />
          <span className="font-semibold text-foreground">{current.label}</span>
        </>
      )}
    </nav>
  );
}

export function AppShell({
  nav,
  profile,
  subtitle,
  children,
}: {
  nav: NavItem[];
  profile: Profile;
  subtitle: string;
  children: ReactNode;
}) {
  const signOut = useSignOut();
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const [collapsed, setCollapsed] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const quickLinks = mobileQuickNav(nav);
  const pending = usePendingTasks(profile);
  const countFor = (path: string) => taskCountForPath(path, profile.role, pending);
  const linkLabel = (n: NavItem) =>
    countFor(n.to)
      ? `${n.label}, ${countFor(n.to)} pending task${countFor(n.to) === 1 ? "" : "s"}`
      : n.label;
  const totalPending = pending
    ? pending.activities + pending.worksheets + pending.grading + pending.scoreReleases
    : 0;

  useEffect(() => {
    try {
      setCollapsed(localStorage.getItem(SIDEBAR_KEY) === "1");
    } catch {
      /* ignore */
    }
  }, []);

  const toggleCollapsed = () => {
    setCollapsed((c) => {
      try {
        localStorage.setItem(SIDEBAR_KEY, c ? "0" : "1");
      } catch {
        /* ignore */
      }
      return !c;
    });
  };

  const links = nav.map((n) => {
    const active = pathMatches(pathname, n.to);
    return (
      <Link
        key={n.to}
        to={n.to}
        title={collapsed ? linkLabel(n) : undefined}
        aria-label={linkLabel(n)}
        className={cn(
          "relative flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition-colors",
          collapsed && "justify-center px-0",
          active
            ? "bg-sidebar-primary text-sidebar-primary-foreground shadow-lift"
            : "text-sidebar-foreground/80 hover:bg-sidebar-accent hover:text-sidebar-foreground",
        )}
      >
        {n.icon}
        {!collapsed && <span className="truncate">{n.label}</span>}
        <TaskBadge count={countFor(n.to)} compact={collapsed} />
        {active && !collapsed && (
          <motion.span
            layoutId="nav-active"
            className="absolute left-0.5 top-1/2 h-5 w-1 -translate-y-1/2 rounded-full bg-sidebar-primary-foreground/70"
          />
        )}
      </Link>
    );
  });

  return (
    <div className="relative min-h-screen bg-background lg:flex">
      <div aria-hidden className="pointer-events-none fixed inset-0 -z-10 overflow-hidden">
        <div className="absolute -top-40 right-[-10%] h-[28rem] w-[28rem] rounded-full bg-indigo-400/15 blur-3xl dark:bg-indigo-500/10" />
        <div className="absolute bottom-[-20%] left-[-10%] h-[26rem] w-[26rem] rounded-full bg-sky-400/10 blur-3xl dark:bg-violet-500/10" />
      </div>

      <aside
        className={cn(
          "hidden shrink-0 flex-col bg-sidebar p-4 transition-[width] duration-300 lg:sticky lg:top-0 lg:flex lg:min-h-screen",
          collapsed ? "w-[84px]" : "w-64",
        )}
      >
        <div
          className={cn(
            "mb-6 flex items-center gap-2.5 px-2 pt-2",
            collapsed && "justify-center px-0",
          )}
        >
          <MiowMark className="h-9 w-9 shrink-0 rounded-xl shadow-lift" />
          {!collapsed && (
            <div className="min-w-0">
              <MiowWordmark size="sm" tone="sidebar" />
              <p className="mt-1 truncate text-xs font-semibold text-sidebar-foreground/70">
                {subtitle}
              </p>
            </div>
          )}
        </div>
        <nav className="flex flex-1 flex-col gap-1">{links}</nav>
        <button
          onClick={toggleCollapsed}
          aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          className="mb-3 flex items-center justify-center gap-2 rounded-xl py-2 text-xs font-semibold text-sidebar-foreground/60 transition-colors hover:bg-sidebar-accent hover:text-sidebar-foreground"
        >
          {collapsed ? <ChevronsRight className="h-4 w-4" /> : <ChevronsLeft className="h-4 w-4" />}
          {!collapsed && "Collapse"}
        </button>
        <div className="rounded-xl bg-sidebar-accent/80 p-3">
          <div className={cn("flex items-center gap-2.5", collapsed && "flex-col")}>
            <UserAvatar
              src={profile.avatar_url}
              name={profile.full_name}
              className="h-9 w-9 ring-2 ring-sidebar-primary/40"
            />
            {!collapsed && (
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-semibold text-sidebar-foreground">
                  {profile.full_name}
                </p>
                <p className="truncate text-xs capitalize text-sidebar-foreground/60">
                  {profile.role}
                </p>
              </div>
            )}
            <Link
              to={settingsPathFor(profile.role)}
              title="Settings"
              aria-label="Open settings"
              className="rounded-lg p-1.5 text-sidebar-foreground/70 hover:bg-sidebar-primary/30 hover:text-sidebar-foreground"
            >
              <Settings className="h-4 w-4" />
            </Link>
            <button
              onClick={signOut}
              title="Sign out"
              aria-label="Sign out"
              className="rounded-lg p-1.5 text-sidebar-foreground/70 hover:bg-sidebar-primary/30 hover:text-sidebar-foreground"
            >
              <LogOut className="h-4 w-4" />
            </button>
          </div>
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-20 hidden items-center justify-between border-b border-border/60 bg-background/70 px-6 py-3 backdrop-blur-md lg:flex">
          <Breadcrumbs nav={nav} subtitle={subtitle} />
          <div className="flex items-center gap-2">
            <ThemeToggle />
            <Link
              to={settingsPathFor(profile.role)}
              aria-label={`Open settings for ${profile.full_name}`}
              title="Settings"
              className="flex items-center gap-2 rounded-full border border-border/70 bg-card/70 py-1 pl-1 pr-3 text-sm font-semibold transition-colors hover:bg-muted"
            >
              <UserAvatar
                src={profile.avatar_url}
                name={profile.full_name}
                className="h-7 w-7 ring-1 ring-primary/30"
              />
              <span className="max-w-[10rem] truncate">{profile.full_name}</span>
              <Settings className="h-3.5 w-3.5 text-muted-foreground" />
            </Link>
          </div>
        </header>

        <header className="sticky top-0 z-20 flex items-center gap-3 border-b border-border/60 bg-background/80 px-4 py-3 backdrop-blur-md lg:hidden">
          <MiowMark className="h-8 w-8 shrink-0 rounded-lg" />
          <div className="min-w-0">
            <p className="font-display text-sm font-extrabold tracking-[0.08em]">MIOW</p>
            <p className="truncate text-[10px] text-muted-foreground">IDS</p>
          </div>
          <div className="ml-auto flex items-center gap-1.5">
            <Sheet open={menuOpen} onOpenChange={setMenuOpen}>
              <SheetTrigger asChild>
                <button
                  type="button"
                  aria-controls="mobile-menu-drawer"
                  className="flex items-center gap-1.5 rounded-full border border-border/70 bg-card/70 px-3.5 py-2 text-sm font-semibold text-foreground transition-colors hover:bg-muted"
                >
                  <MenuIcon className="h-4 w-4" aria-hidden />
                  Menu
                  <TaskBadge count={totalPending} sidebar={false} />
                  {totalPending > 0 && (
                    <span className="sr-only">{totalPending} pending tasks</span>
                  )}
                </button>
              </SheetTrigger>
              <SheetContent
                id="mobile-menu-drawer"
                side="left"
                aria-modal="true"
                className="flex w-[min(19rem,85vw)] flex-col gap-0 bg-sidebar p-0 text-sidebar-foreground sm:max-w-sm [&>button]:hidden"
              >
                <SheetHeader className="flex-row items-center gap-3 space-y-0 border-b border-border/40 px-4 py-3 text-left">
                  <div className="flex min-w-0 items-center gap-2.5">
                    <MiowMark className="h-8 w-8 shrink-0 rounded-lg" />
                    <div className="min-w-0">
                      <SheetTitle className="font-display text-sm font-extrabold tracking-[0.08em]">
                        Menu
                      </SheetTitle>
                      <SheetDescription className="truncate text-xs text-muted-foreground">
                        {subtitle}
                      </SheetDescription>
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => setMenuOpen(false)}
                    className="ml-auto flex shrink-0 items-center gap-1.5 rounded-full border border-border/60 bg-card/60 px-3 py-1.5 text-xs font-semibold text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                  >
                    <X className="h-3.5 w-3.5" aria-hidden />
                    Close
                  </button>
                </SheetHeader>
                <nav
                  aria-label="All portal destinations"
                  className="flex flex-1 flex-col gap-1 overflow-y-auto p-4"
                >
                  {nav.map((n) => {
                    const active = pathMatches(pathname, n.to);
                    return (
                      <Link
                        key={n.to}
                        to={n.to}
                        onClick={() => setMenuOpen(false)}
                        aria-label={linkLabel(n)}
                        aria-current={active ? "page" : undefined}
                        className={cn(
                          "flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition-colors",
                          active
                            ? "bg-sidebar-primary text-sidebar-primary-foreground shadow-lift"
                            : "text-sidebar-foreground/80 hover:bg-sidebar-accent hover:text-sidebar-foreground",
                        )}
                      >
                        {n.icon}
                        <span className="truncate">{n.label}</span>
                        <TaskBadge count={countFor(n.to)} />
                      </Link>
                    );
                  })}
                </nav>
                <div className="border-t border-border/40 p-4">
                  <div className="flex items-center gap-2.5 rounded-xl bg-sidebar-accent/80 p-3">
                    <UserAvatar
                      src={profile.avatar_url}
                      name={profile.full_name}
                      className="h-9 w-9 ring-2 ring-sidebar-primary/40"
                    />
                    <div className="min-w-0">
                      <p className="truncate text-sm font-semibold text-sidebar-foreground">
                        {profile.full_name}
                      </p>
                      <p className="truncate text-xs capitalize text-sidebar-foreground/60">
                        {profile.role}
                      </p>
                    </div>
                  </div>
                </div>
              </SheetContent>
            </Sheet>
            <ThemeToggle />
            <button
              onClick={signOut}
              aria-label="Sign out"
              className="rounded-lg p-2 text-muted-foreground hover:bg-muted"
            >
              <LogOut className="h-4 w-4" />
            </button>
          </div>
        </header>

        <nav
          aria-label="Quick navigation"
          className="flex flex-wrap items-center gap-2 border-b border-border/60 bg-background/60 px-4 py-2.5 backdrop-blur-md lg:hidden"
        >
          {quickLinks.map((n) => {
            const active = pathMatches(pathname, n.to);
            return (
              <Link
                key={n.to}
                to={n.to}
                aria-label={linkLabel(n)}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "flex items-center gap-1.5 whitespace-nowrap rounded-full px-3.5 py-1.5 text-xs font-semibold transition-colors",
                  active
                    ? "bg-primary text-primary-foreground shadow-sm"
                    : "bg-muted text-muted-foreground hover:text-foreground",
                )}
              >
                {n.icon}
                {n.label}
                <TaskBadge count={countFor(n.to)} sidebar={false} />
              </Link>
            );
          })}
        </nav>
        <main className="mx-auto w-full max-w-6xl flex-1 p-4 sm:p-6 lg:p-8">{children}</main>
        <footer className="border-t border-border/40 py-4 text-center text-xs text-muted-foreground">
          <p>© {new Date().getFullYear()} Integrated Developmental School (MIOW)</p>
          <p className="mt-1 text-xs text-muted-foreground">
            Web Developers:{" "}
            <a
              href="https://www.joalvergs.tech/"
              target="_blank"
              rel="noopener noreferrer"
              className="text-primary hover:underline font-medium"
            >
              Joseph Alan B. Vergara
            </a>
            {", "}
            <a
              href="https://github.com/laeyue"
              target="_blank"
              rel="noopener noreferrer"
              className="text-primary hover:underline font-medium"
            >
              Kent Alexis T. Alia
            </a>
          </p>
        </footer>
      </div>
      {/* ClassMate Assistant is staff-only — students never see the launcher. */}
      {profile.role !== "student" && <ChatWidget profile={profile} />}
    </div>
  );
}
