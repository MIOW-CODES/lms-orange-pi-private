import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { cn } from "@/lib/utils";
import { MiowWatermark } from "@/components/brand";
import { BRAND_LOGO_SRC } from "@/lib/brand";
import { useTheme } from "@/hooks";

/* ---------- Course accent palette ---------- */

/* ---------- Theme toggle ---------- */

export function ThemeToggle({ className }: { className?: string }) {
  const { dark, toggle } = useTheme();
  return (
    <button
      onClick={toggle}
      title={dark ? "Switch to light mode" : "Switch to dark mode"}
      aria-label="Toggle color theme"
      className={cn(
        "flex h-9 w-9 items-center justify-center rounded-xl border border-border/60 bg-card/60 text-muted-foreground backdrop-blur-md transition-colors hover:bg-muted hover:text-foreground",
        className,
      )}
    >
      <AnimatePresence mode="wait" initial={false}>
        <motion.span
          key={dark ? "moon" : "sun"}
          initial={{ rotate: -60, opacity: 0, scale: 0.6 }}
          animate={{ rotate: 0, opacity: 1, scale: 1 }}
          exit={{ rotate: 60, opacity: 0, scale: 0.6 }}
          transition={{ duration: 0.18 }}
          className="flex"
        >
          {dark ? (
            <svg
              className="h-4 w-4"
              xmlns="http://www.w3.org/2000/svg"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <circle cx="12" cy="12" r="4" />
              <path d="M12 2v2" />
              <path d="M12 20v2" />
              <path d="m4.93 4.93 1.41 1.41" />
              <path d="m17.66 17.66 1.41 1.41" />
              <path d="M2 12h2" />
              <path d="M20 12h2" />
              <path d="m6.34 17.66-1.41 1.41" />
              <path d="m19.07 4.93-1.41 1.41" />
            </svg>
          ) : (
            <svg
              className="h-4 w-4"
              xmlns="http://www.w3.org/2000/svg"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z" />
            </svg>
          )}
        </motion.span>
      </AnimatePresence>
    </button>
  );
}

/* ---------- Primitives ---------- */

const TONES: Record<string, string> = {
  slate: "bg-slate-100 text-slate-700 dark:bg-slate-500/15 dark:text-slate-300",
  indigo: "bg-indigo-100 text-indigo-700 dark:bg-indigo-500/15 dark:text-indigo-300",
  green: "bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300",
  amber: "bg-pink-100 text-pink-800 dark:bg-pink-500/15 dark:text-pink-300",
  red: "bg-rose-100 text-rose-700 dark:bg-rose-500/15 dark:text-rose-300",
  sky: "bg-sky-100 text-sky-700 dark:bg-sky-500/15 dark:text-sky-300",
  violet: "bg-violet-100 text-violet-700 dark:bg-violet-500/15 dark:text-violet-300",
};

export function Badge({ tone = "slate", children }: { tone?: string; children: ReactNode }) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-semibold",
        TONES[tone] ?? TONES["slate"],
      )}
    >
      {children}
    </span>
  );
}

export function Card({ className, children }: { className?: string; children: ReactNode }) {
  return (
    <div
      className={cn(
        "rounded-2xl border border-border/70 bg-card/75 shadow-card backdrop-blur-md",
        className,
      )}
    >
      {children}
    </div>
  );
}

export function MotionCard({
  className,
  children,
  delay = 0,
  onClick,
}: {
  className?: string;
  children: ReactNode;
  delay?: number;
  onClick?: () => void;
}) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35, delay, ease: "easeOut" }}
      whileHover={{ y: -3, transition: { duration: 0.15 } }}
      onClick={onClick}
      className={cn(
        "rounded-2xl border border-border/70 bg-card/75 shadow-card backdrop-blur-md",
        onClick && "cursor-pointer",
        className,
      )}
    >
      {children}
    </motion.div>
  );
}

export function FadeIn({
  children,
  delay = 0,
  className,
}: {
  children: ReactNode;
  delay?: number;
  className?: string;
}) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35, delay, ease: "easeOut" }}
      className={className}
    >
      {children}
    </motion.div>
  );
}

export function ProgressBar({ value, barClass }: { value: number; barClass?: string }) {
  const clamped = Math.min(100, Math.max(0, value));
  const isComplete = clamped >= 100;

  return (
    <div
      className={cn(
        "relative h-3 w-full overflow-hidden rounded-full bg-muted/80 transition-all duration-300",
        isComplete && "ring-2 ring-emerald-500/50 shadow-[0_0_16px_rgba(16,185,129,0.4)]",
      )}
      role="progressbar"
      aria-valuenow={clamped}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-label={`${clamped}% complete`}
    >
      <motion.div
        initial={{ width: 0 }}
        animate={{ width: `${clamped}%` }}
        transition={{ duration: 0.8, ease: "easeOut" }}
        className={cn(
          "relative h-full rounded-full transition-colors duration-500 overflow-hidden",
          isComplete
            ? "bg-gradient-to-r from-emerald-500 via-teal-400 to-emerald-500"
            : "bg-primary",
          barClass,
        )}
      >
        {/* Shimmer sweep & pulse animation when complete */}
        {isComplete && (
          <>
            <motion.div
              initial={{ x: "-100%" }}
              animate={{ x: "250%" }}
              transition={{
                repeat: Infinity,
                duration: 1.5,
                ease: "easeInOut",
                repeatDelay: 0.4,
              }}
              className="absolute inset-0 w-1/2 bg-gradient-to-r from-transparent via-white/70 to-transparent skew-x-[-20deg]"
            />
            <motion.div
              animate={{ opacity: [0.6, 1, 0.6] }}
              transition={{
                repeat: Infinity,
                duration: 2,
                ease: "easeInOut",
              }}
              className="absolute inset-0 bg-white/10"
            />
          </>
        )}
      </motion.div>
    </div>
  );
}

export function EmptyState({
  icon,
  title,
  sub,
}: {
  icon?: ReactNode;
  title: string;
  sub?: string;
}) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 rounded-2xl border border-dashed border-border bg-card/40 p-10 text-center backdrop-blur-sm">
      <div className="text-muted-foreground">{icon}</div>
      <p className="font-semibold">{title}</p>
      {sub && <p className="text-sm text-muted-foreground">{sub}</p>}
    </div>
  );
}

export function FilterTabs<T extends string>({
  options,
  value,
  onChange,
  counts,
}: {
  options: ReadonlyArray<{ value: T; label: string }>;
  value: T;
  onChange: (v: T) => void;
  counts?: Partial<Record<T, number>>;
}) {
  return (
    <div className="inline-flex flex-wrap items-center gap-1.5 rounded-2xl border border-border/60 bg-muted/40 p-1.5 backdrop-blur-md">
      {options.map((o) => {
        const active = value === o.value;
        return (
          <button
            key={o.value}
            onClick={() => onChange(o.value)}
            className={cn(
              "inline-flex items-center gap-2 rounded-xl px-4 py-2 text-sm font-semibold transition-all duration-150",
              active
                ? "bg-card text-foreground shadow-sm ring-1 ring-border/50"
                : "text-muted-foreground hover:bg-muted/60 hover:text-foreground",
            )}
          >
            <span>{o.label}</span>
            {counts && counts[o.value] != null && (
              <span
                className={cn(
                  "flex h-5 min-w-5 items-center justify-center rounded-full px-1.5 text-xs font-bold transition-colors",
                  active
                    ? "bg-primary text-primary-foreground"
                    : "bg-muted-foreground/15 text-muted-foreground",
                )}
              >
                {counts[o.value]}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}

/* ---------- Settings primitives ---------- */

export function Field({
  label,
  hint,
  error,
  id,
  className,
  ...props
}: {
  label: string;
  /** Small help text under the input — explains what the setting does. */
  hint?: string;
  /** Inline validation message; replaces the hint while set. */
  error?: string;
} & React.InputHTMLAttributes<HTMLInputElement>) {
  const autoId = useId();
  const inputId = id ?? autoId;
  const describedBy = hint || error ? `${inputId}-desc` : undefined;
  return (
    <label className="block" htmlFor={inputId}>
      <span className="mb-1 block text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        {label}
      </span>
      <input
        {...props}
        id={inputId}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy}
        className={cn(
          "w-full rounded-xl border border-input bg-background/70 px-3 py-2 text-sm outline-none backdrop-blur-sm transition-shadow focus:ring-2 focus:ring-ring disabled:opacity-60",
          error && "border-rose-400 focus:ring-rose-400/40",
          className,
        )}
      />
      {(hint || error) && (
        <span
          id={describedBy}
          className={cn(
            "mt-1 block text-[11px]",
            error ? "font-medium text-rose-600 dark:text-rose-400" : "text-muted-foreground",
          )}
        >
          {error ?? hint}
        </span>
      )}
    </label>
  );
}

/** Select sibling of `Field` — same label, help text and focus treatment. */
export function SelectField({
  label,
  hint,
  id,
  className,
  children,
  ...props
}: {
  label: string;
  hint?: string;
} & React.SelectHTMLAttributes<HTMLSelectElement>) {
  const autoId = useId();
  const selectId = id ?? autoId;
  const describedBy = hint ? `${selectId}-desc` : undefined;
  return (
    <label className="block" htmlFor={selectId}>
      <span className="mb-1 block text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        {label}
      </span>
      <select
        {...props}
        id={selectId}
        aria-describedby={describedBy}
        className={cn(
          "w-full rounded-xl border border-input bg-background/70 px-3 py-2 text-sm outline-none backdrop-blur-sm transition-shadow focus:ring-2 focus:ring-ring disabled:opacity-60",
          className,
        )}
      >
        {children}
      </select>
      {hint && (
        <span id={describedBy} className="mt-1 block text-[11px] text-muted-foreground">
          {hint}
        </span>
      )}
    </label>
  );
}

export function Toggle({
  checked,
  onChange,
  label,
  description,
  disabled,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label: string;
  description?: string;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className="flex w-full items-center justify-between gap-4 rounded-xl border border-border/60 bg-card/60 px-4 py-3 text-left transition-colors hover:bg-muted/50 disabled:cursor-not-allowed disabled:opacity-60"
    >
      <span className="min-w-0">
        <span className="block text-sm font-semibold">{label}</span>
        {description && <span className="block text-xs text-muted-foreground">{description}</span>}
      </span>
      <span
        className={cn(
          "relative h-6 w-11 shrink-0 rounded-full transition-colors",
          checked ? "bg-primary" : "bg-muted-foreground/30",
        )}
      >
        <span
          className={cn(
            "absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-all",
            checked ? "left-[22px]" : "left-0.5",
          )}
        />
      </span>
    </button>
  );
}

/* ---------- Modal ---------- */

const MODAL_FOCUSABLE_SELECTOR = [
  "a[href]",
  "button:not([disabled])",
  "input:not([disabled])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  '[tabindex]:not([tabindex="-1"])',
].join(", ");

function getFocusableElements(container: HTMLElement): HTMLElement[] {
  return Array.from(container.querySelectorAll<HTMLElement>(MODAL_FOCUSABLE_SELECTOR)).filter(
    (el) =>
      !el.closest("[inert]") &&
      (el.offsetWidth > 0 || el.offsetHeight > 0 || el.getClientRects().length > 0),
  );
}

/**
 * Marks everything outside `node` (the modal overlay) as `inert` + `aria-hidden`
 * so the background cannot receive focus or be read by assistive tech while the
 * dialog is open. Walks up the ancestor chain and marks each sibling subtree,
 * which correctly handles modals rendered inline inside the page content.
 * Nested modals are safe: ancestor overlays are never marked, and subtrees that
 * host another open dialog are left untouched.
 */
function inertOutside(node: HTMLElement): () => void {
  const marked: HTMLElement[] = [];
  let el: HTMLElement | null = node;
  while (el && el.parentElement && el !== document.body) {
    const parent: HTMLElement = el.parentElement;
    for (const sibling of Array.from(parent.children)) {
      if (!(sibling instanceof HTMLElement) || sibling === el) continue;
      if (sibling.hasAttribute("inert")) continue;
      if (sibling.querySelector('[role="dialog"][aria-modal="true"]')) continue;
      sibling.setAttribute("inert", "");
      sibling.setAttribute("aria-hidden", "true");
      marked.push(sibling);
    }
    el = parent;
  }
  return () => {
    for (const sibling of marked) {
      sibling.removeAttribute("inert");
      sibling.removeAttribute("aria-hidden");
    }
  };
}

export function Modal({
  open,
  onClose,
  title,
  children,
  wide,
  fullscreen,
  hideClose,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  wide?: boolean;
  fullscreen?: boolean;
  hideClose?: boolean;
}) {
  const overlayRef = useRef<HTMLDivElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const restoreFocusRef = useRef<HTMLElement | null>(null);
  const onCloseRef = useRef(onClose);
  const titleId = useId();

  useEffect(() => {
    onCloseRef.current = onClose;
  });

  useEffect(() => {
    if (!open) return;

    const overlay = overlayRef.current;
    const dialog = dialogRef.current;
    if (!dialog) return;

    // Remember previous active element to restore focus on close
    restoreFocusRef.current =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;

    // Move focus into the dialog: first focusable element, else the container
    const focusScope = fullscreen
      ? (dialog.querySelector<HTMLElement>("[data-fullscreen-content]") ?? dialog)
      : dialog;
    const focusable = getFocusableElements(focusScope);
    (focusable[0] ?? dialog).focus();

    // Make the background inert + hidden while the dialog is open
    const releaseBackground = overlay ? inertOutside(overlay) : undefined;

    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        onCloseRef.current();
        return;
      }

      if (e.key === "Tab") {
        const dialogNode = dialogRef.current;
        if (!dialogNode) return;
        const items = getFocusableElements(focusScope);
        if (items.length === 0) {
          e.preventDefault();
          dialogNode.focus();
          return;
        }

        const first = items[0];
        const last = items[items.length - 1];

        if (e.shiftKey) {
          if (document.activeElement === first || !dialogNode.contains(document.activeElement)) {
            e.preventDefault();
            last?.focus();
          }
        } else {
          if (document.activeElement === last || !dialogNode.contains(document.activeElement)) {
            e.preventDefault();
            first?.focus();
          }
        }
      }
    };

    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      releaseBackground?.();
      const restore = restoreFocusRef.current;
      if (restore && restore.isConnected && typeof restore.focus === "function") {
        restore.focus();
      }
    };
  }, [open, fullscreen]);

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          ref={overlayRef}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.18 }}
          className={cn(
            "fixed inset-0 z-50 flex items-center justify-center bg-slate-950/50 backdrop-blur-sm",
            !fullscreen && "p-4",
          )}
          onClick={onClose}
        >
          <motion.div
            ref={dialogRef}
            tabIndex={-1}
            initial={{ opacity: 0, scale: 0.95, y: 16 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.96, y: 8 }}
            transition={{ duration: 0.22, ease: "easeOut" }}
            role="dialog"
            aria-modal="true"
            aria-label={title}
            aria-labelledby={titleId}
            className={cn(
              "flex max-h-[90vh] w-full flex-col overflow-hidden rounded-2xl border border-border/70 bg-card/95 shadow-lift backdrop-blur-xl outline-none",
              fullscreen
                ? "relative h-[100dvh] max-h-[100dvh] max-w-none rounded-none"
                : wide
                  ? "max-w-3xl"
                  : "max-w-lg",
            )}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex shrink-0 items-center justify-between border-b border-border/40 px-6 py-4">
              <h3 id={titleId} className="text-lg font-bold">
                {title}
              </h3>
              {!hideClose && (
                <button
                  onClick={onClose}
                  aria-label="Close dialog"
                  className="rounded-lg px-2 py-1 text-sm text-muted-foreground transition hover:bg-muted"
                >
                  ✕
                </button>
              )}
            </div>
            <div
              role="region"
              aria-label={`${title} content`}
              className="custom-scrollbar flex-1 overflow-y-auto px-6 py-4"
            >
              {children}
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

/* ---------- User Avatar ---------- */

function getInitials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]!.toUpperCase())
    .join("");
}

export function UserAvatar({
  src,
  name,
  className = "h-8 w-8",
}: {
  src?: string | null;
  name: string;
  className?: string;
}) {
  const isAdmin = name.toLowerCase().includes("admin");
  const avatarSrc = src || (isAdmin ? BRAND_LOGO_SRC : null);

  if (avatarSrc) {
    return (
      <img
        src={avatarSrc}
        alt={name}
        loading="lazy"
        decoding="async"
        width={32}
        height={32}
        className={cn("rounded-full object-cover bg-white/10 p-0.5", className)}
      />
    );
  }
  return (
    <span
      className={cn(
        "grid place-items-center rounded-full bg-primary/10 text-primary text-xs font-bold",
        className,
      )}
    >
      {getInitials(name)}
    </span>
  );
}

/* ---------- Loading Skeleton ---------- */

export function LoadingSkeleton({ rows = 5 }: { rows?: number }) {
  return (
    <div className="space-y-3 py-8">
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="flex items-center gap-4">
          <div className="h-10 w-10 animate-pulse rounded-full bg-muted" />
          <div className="flex-1 space-y-2">
            <div className="h-4 w-1/3 animate-pulse rounded bg-muted" />
            <div className="h-3 w-1/5 animate-pulse rounded bg-muted/60" />
          </div>
        </div>
      ))}
    </div>
  );
}

/* ---------- Query Load Error ---------- */

/**
 * Terminal state for a failed data load — shown instead of an endless loading
 * placeholder so a rejected server call (expired session, network error, …)
 * is visible and recoverable via retry.
 */
export function LoadError({ what, onRetry }: { what: string; onRetry?: () => void }) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 rounded-2xl border border-dashed border-border bg-card/40 p-10 text-center backdrop-blur-sm">
      <p className="font-semibold">Couldn't load {what}</p>
      <p className="text-sm text-muted-foreground">
        Something went wrong while fetching this data. Try again — if it keeps happening, sign out
        and back in.
      </p>
      {onRetry && (
        <button
          onClick={onRetry}
          className="rounded-xl bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground hover:opacity-90"
        >
          Try again
        </button>
      )}
    </div>
  );
}
