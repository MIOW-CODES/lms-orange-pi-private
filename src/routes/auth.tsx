import { useEffect, useRef, useState } from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { Eye, EyeOff, KeyRound, Nfc } from "lucide-react";
import { toast } from "sonner";
import { dbg, dbgError } from "@/lib/debug";
import {
  dashboardPathFor,
  findProfileByRfid,
  listAnnouncements,
  loadSession,
  pinLogin,
  saveSession,
  type Profile,
} from "@/lib/lms";
import { useRfidScanner } from "@/components/lms";
import { cn } from "@/lib/utils";
import { MiowLockup } from "@/components/brand";
import { APP_TAGLINE } from "@/lib/brand";

export const Route = createFileRoute("/auth")({
  head: () => ({
    meta: [
      { title: "Sign In | MIOW - Integrated Developmental School" },
      {
        name: "description",
        content:
          "Secure sign-in kiosk for Integrated Developmental School (MIOW). Tap your RFID ID card or use your student number and PIN.",
      },
      { property: "og:title", content: "Sign In | MIOW - Integrated Developmental School" },
      {
        property: "og:description",
        content: "RFID sign-in kiosk for Integrated Developmental School (MIOW).",
      },
      { property: "og:image", content: "/og-cover.jpg" },
      { name: "twitter:image", content: "/og-cover.jpg" },
    ],
  }),
  component: AuthPage,
});

type Mode = "scan" | "pin";
const MODES: readonly Mode[] = ["scan", "pin"];

function AuthPage() {
  const navigate = useNavigate();
  // PIN-first is the everyday sign-in and must remain stable through hydration.
  // RFID remains available as an explicit tab; automatically switching modes
  // after mount can hide a PIN form while a student is filling or submitting it.
  const [mode, setMode] = useState<Mode>("pin");
  const [uid, setUid] = useState("");
  const [login, setLogin] = useState("");
  const [pin, setPin] = useState("");
  const [showPin, setShowPin] = useState(false);
  const [showPinHelp, setShowPinHelp] = useState(false);
  const [busy, setBusy] = useState(false);
  const [hydrated, setHydrated] = useState(false);
  const modeTabs = useRef<Partial<Record<Mode, HTMLButtonElement | null>>>({});
  // Live DOM refs for the sign-in inputs. Browser/password-manager autofill
  // can populate the fields without firing React onChange (mobile autofill
  // in particular), which would leave the controlled state empty and keep
  // the Sign In button disabled ("sign in is disabled"). Reading the values
  // from the DOM at submit time makes autofilled sign-ins work.
  const loginInputRef = useRef<HTMLInputElement | null>(null);
  const pinInputRef = useRef<HTMLInputElement | null>(null);

  // Non-critical kiosk chrome: a transient backend blip must never take the
  // sign-in page down, so this query degrades to an empty list instead of
  // surfacing as a page-level error. Sign-in itself still reports failures.
  const { data: announcements } = useQuery({
    queryKey: ["announcements"],
    staleTime: 0,
    refetchOnMount: "always",
    queryFn: () => listAnnouncements().catch(() => []),
  });

  useEffect(() => {
    setHydrated(true);
    const existing = loadSession();
    if (existing) navigate({ to: dashboardPathFor(existing.role), replace: true });
  }, [navigate]);

  const handleModeKeyDown = (e: React.KeyboardEvent) => {
    const i = MODES.indexOf(mode);
    let target: Mode | null = null;
    if (e.key === "ArrowRight" || e.key === "ArrowDown")
      target = MODES[(i + 1) % MODES.length] ?? null;
    else if (e.key === "ArrowLeft" || e.key === "ArrowUp")
      target = MODES[(i - 1 + MODES.length) % MODES.length] ?? null;
    else if (e.key === "Home") target = MODES[0] ?? null;
    else if (e.key === "End") target = MODES[MODES.length - 1] ?? null;
    if (!target) return;
    e.preventDefault();
    setMode(target);
    modeTabs.current[target]?.focus();
  };

  const handleUid = async (code: string) => {
    if (busy) return;
    dbg("auth", "RFID tap", { uid: code.trim() });
    setBusy(true);
    try {
      const p = await findProfileByRfid(code.trim());
      if (p) {
        saveSession(p);
        toast.success(`Welcome, ${p.full_name?.split(" ")[0] || p.full_name || "User"}!`);
        navigate({ to: dashboardPathFor(p.role) });
      } else toast.error("Card not recognized. Please register your RFID with the registrar.");
    } catch {
      toast.error("Scanner error — please try again.");
    } finally {
      setBusy(false);
    }
  };

  useRfidScanner(handleUid, mode === "scan");

  const handlePin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (busy) return;
    // Read the live DOM values first: password-manager autofill on mobile can
    // fill the inputs without firing React onChange, leaving the controlled
    // state empty while the fields display filled values.
    const loginValue = (loginInputRef.current?.value ?? login).trim();
    const pinValue = (pinInputRef.current?.value ?? pin).trim();
    if (!loginValue || !pinValue) {
      toast.error("Enter your account ID and PIN to sign in.");
      return;
    }
    if (loginValue !== login) setLogin(loginValue);
    if (pinValue !== pin) setPin(pinValue);
    dbg("auth", "PIN login clicked", { login: loginValue, pinLength: pinValue.length });
    setBusy(true);
    try {
      const res = await pinLogin(loginValue, pinValue);
      dbg("auth", "pinLogin result", {
        ok: res.ok,
        reason: "reason" in res ? res.reason : undefined,
        profile: "profile" in res ? res.profile?.role : undefined,
      });
      if (res.ok) {
        saveSession(res.profile);
        toast.success(
          `Welcome, ${res.profile.full_name?.split(" ")[0] || res.profile.full_name || "User"}!`,
        );
        navigate({ to: dashboardPathFor(res.profile.role) });
      } else if (res.reason === "locked") {
        toast.error(
          `Account locked after too many failed attempts — try again in ~${res.retryAfterMinutes ?? 15} min.`,
        );
      } else {
        toast.error(
          `Invalid credentials${
            typeof res.attemptsLeft === "number"
              ? ` — ${res.attemptsLeft} attempt${res.attemptsLeft === 1 ? "" : "s"} left before lockout`
              : ""
          }.`,
        );
      }
    } catch (e) {
      dbgError("auth", "PIN login error", e);
      toast.error("Sign-in failed — please try again.");
    } finally {
      setBusy(false);
    }
  };

  const marqueeText = (announcements ?? []).map((a) => a.title).join("  •  ");

  return (
    <div className="flex min-h-screen bg-background">
      {/* Brand panel */}
      <div className="relative hidden w-[44%] flex-col justify-between overflow-hidden bg-sidebar p-10 lg:flex">
        <div className="pointer-events-none absolute -left-24 -top-24 h-80 w-80 rounded-full bg-indigo-500/20 blur-3xl" />
        <div className="pointer-events-none absolute -bottom-32 -right-16 h-96 w-96 rounded-full bg-emerald-500/10 blur-3xl" />
        <div className="relative flex items-center gap-3">
          <MiowLockup size="md" tone="sidebar" subLabel={APP_TAGLINE} className="max-w-sm" />
        </div>
        <div className="relative space-y-6">
          <p className="font-display text-4xl font-bold leading-tight text-sidebar-foreground">
            One tap.
            <br />
            One glance.
            <br />
            <span className="text-sidebar-primary">You're in class.</span>
          </p>
          <p className="max-w-sm text-sm leading-relaxed text-sidebar-foreground/70">
            RFID attendance, DepEd-computed grades, worksheets and announcements — the whole campus
            in one learning platform.
          </p>
          <div className="flex flex-wrap gap-2">
            <span className="inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-semibold bg-indigo-100 text-indigo-700 dark:bg-indigo-500/15 dark:text-indigo-300">
              RFID Attendance
            </span>
            <span className="inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-semibold bg-sky-100 text-sky-700 dark:bg-sky-500/15 dark:text-sky-300">
              DepEd Transmutation
            </span>
          </div>
        </div>
        <div className="relative overflow-hidden rounded-xl border border-sidebar-border bg-sidebar-accent/60 py-2.5">
          <div className="animate-marquee whitespace-nowrap text-xs font-medium text-sidebar-foreground/70">
            <span className="px-4">
              {marqueeText || "Welcome to MIOW — SY 2026–2027 enrollment now open"}
            </span>
          </div>
        </div>
      </div>

      {/* Auth panel */}
      <div className="flex flex-1 items-center justify-center p-3 sm:p-8 min-w-0 max-w-full">
        <div className="w-full max-w-md min-w-0 break-words">
          <div className="mb-6 flex items-center gap-3 lg:hidden min-w-0">
            <MiowLockup size="sm" className="min-w-0 max-w-full" />
          </div>

          <div className="rounded-2xl border border-border bg-card p-5 shadow-lift sm:p-8 min-w-0 max-w-full">
            <h1 className="sr-only">Sign in to Integrated Developmental School (MIOW)</h1>
            <MiowLockup size="lg" aria-hidden className="min-w-0 max-w-full" />
            <p className="mt-1 text-sm text-muted-foreground">
              Tap your RFID card at the kiosk, or sign in with your account ID and PIN.
            </p>

            <div
              role="tablist"
              aria-label="Sign-in method"
              onKeyDown={handleModeKeyDown}
              className="mt-5 grid grid-cols-2 gap-1 rounded-xl bg-muted p-1"
            >
              {(
                [
                  ["scan", "RFID Card", Nfc],
                  ["pin", "PIN Login", KeyRound],
                ] as const
              ).map(([m, label, Icon]) => (
                <button
                  key={m}
                  ref={(el) => {
                    modeTabs.current[m] = el;
                  }}
                  type="button"
                  role="tab"
                  id={`auth-tab-${m}`}
                  aria-selected={mode === m}
                  aria-controls={`auth-panel-${m}`}
                  tabIndex={mode === m ? 0 : -1}
                  onClick={() => setMode(m)}
                  className={cn(
                    "flex items-center justify-center gap-2 rounded-lg px-3 py-2 text-sm font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                    mode === m
                      ? "bg-card shadow-sm text-foreground"
                      : "text-muted-foreground hover:text-foreground",
                  )}
                >
                  <Icon className="h-4 w-4" />
                  {label}
                </button>
              ))}
            </div>

            <div
              id="auth-panel-scan"
              role="tabpanel"
              aria-labelledby="auth-tab-scan"
              hidden={mode !== "scan"}
              className="mt-6 space-y-4"
            >
              <p className="text-[11px] font-medium text-muted-foreground">Kiosk / RFID reader</p>
              <div className="flex flex-col items-center gap-3 rounded-2xl border border-dashed border-primary/40 bg-primary/5 p-6 text-center">
                <div className="animate-pulse-ring flex h-16 w-16 items-center justify-center rounded-full bg-primary/10">
                  <Nfc className="h-8 w-8 text-primary" />
                </div>
                <p className="text-sm font-semibold">Listening for card tap…</p>
                <p className="text-xs text-muted-foreground">
                  Hold your ID near the reader, or enter the UID below to simulate a tap.
                </p>
              </div>
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  if (uid.trim()) handleUid(uid);
                }}
                className="space-y-1.5"
              >
                <label
                  htmlFor="rfid-uid"
                  className="block text-xs font-medium text-muted-foreground"
                >
                  Card UID
                </label>
                <div className="flex gap-2">
                  <input
                    id="rfid-uid"
                    value={uid}
                    onChange={(e) => setUid(e.target.value)}
                    placeholder="RFID UID (e.g. 0412345678)"
                    aria-label="RFID UID"
                    aria-describedby="rfid-uid-help"
                    className="h-10 min-w-0 flex-1 rounded-xl border border-input bg-background px-3 text-sm outline-none focus:ring-2 focus:ring-ring"
                  />
                  <button
                    type="submit"
                    disabled={busy}
                    className="h-10 shrink-0 rounded-xl bg-primary px-4 text-sm font-semibold text-primary-foreground hover:opacity-90 disabled:opacity-50"
                  >
                    Tap
                  </button>
                </div>
                <p id="rfid-uid-help" className="text-[11px] text-muted-foreground">
                  10–13 digits, printed on your ID card.
                </p>
              </form>
            </div>

            <div
              id="auth-panel-pin"
              role="tabpanel"
              aria-labelledby="auth-tab-pin"
              hidden={mode !== "pin"}
              className="mt-6"
            >
              <form onSubmit={handlePin} className="space-y-3.5">
                <p className="rounded-xl border border-red-600/30 bg-red-600/5 px-3 py-2 text-xs font-medium text-red-600 dark:border-red-400/30 dark:bg-red-400/10 dark:text-red-400">
                  Accounts lock for 15 minutes after 5 failed attempts. If you forget your PIN or
                  get locked out, contact your class adviser or the ICT admin.
                </p>
                <div className="space-y-1">
                  <label
                    htmlFor="login-id"
                    className="block text-xs font-medium text-muted-foreground"
                  >
                    Account ID / Username
                  </label>
                  <input
                    id="login-id"
                    ref={loginInputRef}
                    value={login}
                    onChange={(e) => setLogin(e.target.value)}
                    placeholder="e.g. 2026-0042 or juan.delacruz"
                    aria-label="Student ID, email, or username"
                    aria-describedby="login-id-help"
                    autoComplete="username"
                    className="h-11 w-full rounded-xl border border-input bg-background px-3 text-sm outline-none focus:ring-2 focus:ring-ring"
                  />
                  <p id="login-id-help" className="text-[11px] text-muted-foreground">
                    Student number (2026-0042), employee ID (FAC-2026-014), school email, or
                    username.
                  </p>
                </div>
                <div className="space-y-1">
                  <div className="flex items-center justify-between">
                    <label
                      htmlFor="login-pin"
                      className="block text-xs font-medium text-muted-foreground"
                    >
                      Security PIN
                    </label>
                    <button
                      type="button"
                      aria-expanded={showPinHelp}
                      aria-controls="pin-recovery-help"
                      onClick={() => setShowPinHelp((v) => !v)}
                      className="rounded-md text-[11px] font-medium text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    >
                      Forgot PIN?
                    </button>
                  </div>
                  <div className="relative">
                    <input
                      id="login-pin"
                      ref={pinInputRef}
                      value={pin}
                      onChange={(e) => setPin(e.target.value)}
                      placeholder="Enter your PIN or password"
                      type={showPin ? "text" : "password"}
                      aria-label="PIN or password"
                      aria-describedby="login-pin-help"
                      autoComplete="current-password"
                      className="h-11 w-full rounded-xl border border-input bg-background px-3 pr-11 text-sm outline-none focus:ring-2 focus:ring-ring"
                    />
                    <button
                      type="button"
                      aria-pressed={showPin}
                      aria-label={showPin ? "Hide PIN" : "Show PIN"}
                      onClick={() => setShowPin((v) => !v)}
                      className="absolute inset-y-0 right-0 flex w-11 items-center justify-center rounded-r-xl text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    >
                      {showPin ? (
                        <EyeOff className="h-4 w-4" aria-hidden="true" />
                      ) : (
                        <Eye className="h-4 w-4" aria-hidden="true" />
                      )}
                    </button>
                  </div>
                  <p id="login-pin-help" className="text-[11px] text-muted-foreground">
                    Junior High (Grade 7–10) default PIN is 1234. College default PIN is your
                    Student ID number.
                  </p>
                </div>
                <div
                  id="pin-recovery-help"
                  hidden={!showPinHelp}
                  className="space-y-2 rounded-xl border border-border bg-muted/50 px-3.5 py-3 text-xs"
                >
                  <p className="font-semibold text-foreground">Forgot or default PIN?</p>
                  <ol className="list-decimal space-y-1 pl-4 text-muted-foreground">
                    <li>
                      <strong>Junior High (Grade 7–10):</strong> default PIN is{" "}
                      <span className="font-mono font-medium text-foreground">1234</span>.
                    </li>
                    <li>
                      <strong>College students:</strong> default PIN is your{" "}
                      <span className="font-mono font-medium text-foreground">Student ID</span>{" "}
                      (e.g. 2025-2517).
                    </li>
                    <li>
                      If your account is locked after 5 failed attempts, the lock automatically
                      clears after 15 minutes.
                    </li>
                    <li>To reset a changed PIN, contact your class adviser or ICT admin.</li>
                  </ol>
                  <p className="text-muted-foreground">
                    Email the MIOW Admin Office:{" "}
                    <a
                      href="mailto:admin@g.msuiit.edu.ph"
                      className="font-medium text-primary hover:underline"
                    >
                      admin@g.msuiit.edu.ph
                    </a>
                  </p>
                  {/* School contact placeholder — replace with the office room and hours. */}
                  <p className="text-muted-foreground">Walk-in: [office room and hours]</p>
                </div>
                <button
                  type="submit"
                  disabled={!hydrated || busy}
                  className="h-11 w-full rounded-xl bg-primary text-sm font-semibold text-primary-foreground hover:opacity-90 disabled:opacity-50"
                >
                  Sign In
                </button>
              </form>
            </div>
          </div>
          <p className="mt-4 text-center text-xs text-muted-foreground">
            Integrated Developmental School
          </p>
          <p className="mt-1 text-center text-[10px] text-muted-foreground/80">
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
        </div>
      </div>
    </div>
  );
}
