import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  Outlet,
  Link,
  createRootRouteWithContext,
  useRouter,
  HeadContent,
  Scripts,
  type ErrorComponentProps,
} from "@tanstack/react-router";
import { useEffect, type ReactNode } from "react";
import { Toaster } from "sonner";

import appCss from "../styles.css?url";
import { reportError } from "../lib/error-reporting";
import { isAssessmentActive, subscribeAssessmentMode } from "../lib/assessment-mode";
import { clearLegacyPreferences } from "../lib/settings";
import { clearLegacyNavigationCaches } from "../lib/pwa-cache";

function NotFoundComponent() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="max-w-md text-center">
        <h1 className="text-7xl font-bold text-foreground">404</h1>
        <h2 className="mt-4 text-xl font-semibold text-foreground">Page not found</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          The page you're looking for doesn't exist or has been moved.
        </p>
        <div className="mt-6">
          <Link
            to="/"
            className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          >
            Go home
          </Link>
        </div>
      </div>
    </div>
  );
}

function ErrorComponent({ error, reset }: ErrorComponentProps) {
  const router = useRouter();
  useEffect(() => {
    reportError(error, { boundary: "tanstack_root_error_component" });
  }, [error]);

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="max-w-md text-center">
        <h1 className="text-xl font-semibold tracking-tight text-foreground">
          This page didn't load
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Something went wrong on our end. You can try refreshing or head back home.
        </p>
        <div className="mt-6 flex flex-wrap justify-center gap-2">
          <button
            onClick={() => {
              router.invalidate();
              reset();
            }}
            className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          >
            Try again
          </button>
          <a
            href="/"
            className="inline-flex items-center justify-center rounded-md border border-input bg-background px-4 py-2 text-sm font-medium text-foreground transition-colors hover:bg-accent"
          >
            Go home
          </a>
        </div>
      </div>
    </div>
  );
}

export const Route = createRootRouteWithContext<{ queryClient: QueryClient }>()({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      {
        name: "viewport",
        content: "width=device-width, initial-scale=1, viewport-fit=cover",
      },
      { title: "MIOW - Integrated Developmental School" },
      {
        name: "description",
        content:
          "Integrated Developmental School (MIOW): RFID kiosk attendance, courses, timed worksheets, and DepEd-compliant grading for junior and senior high school.",
      },
      { name: "author", content: "Joseph Alan B. Vergara, Kent Alexis T. Alia" },
      { name: "theme-color", content: "#800000" },
      // iOS / WebKit home-screen (PWA) metadata — Safari ignores manifest icons.
      { name: "apple-mobile-web-app-capable", content: "yes" },
      { name: "apple-mobile-web-app-status-bar-style", content: "black-translucent" },
      { name: "apple-mobile-web-app-title", content: "MIOW LMS" },
      { property: "og:site_name", content: "MIOW LMS" },
      { property: "og:title", content: "MIOW - Integrated Developmental School" },
      {
        property: "og:description",
        content: "RFID kiosk attendance, courses, timed worksheets, and DepEd-compliant grading.",
      },
      { property: "og:type", content: "website" },
      { property: "og:image", content: "https://miow-lms.ter-ids.online/og-cover.jpg" },
      { name: "twitter:card", content: "summary_large_image" },
      { name: "twitter:title", content: "MIOW - Integrated Developmental School" },
      {
        name: "twitter:description",
        content: "RFID kiosk attendance, courses, timed worksheets, and DepEd-compliant grading.",
      },
      { name: "twitter:image", content: "https://miow-lms.ter-ids.online/og-cover.jpg" },
    ],
    links: [
      { rel: "stylesheet", href: appCss },
      { rel: "icon", href: "/favicon.svg?v=pink", type: "image/svg+xml" },
      { rel: "apple-touch-icon", href: "/apple-touch-icon-180x180.png?v=pink" },
      { rel: "manifest", href: "/manifest.webmanifest" },
      { rel: "preconnect", href: "https://fonts.googleapis.com" },
      { rel: "preconnect", href: "https://fonts.gstatic.com", crossOrigin: "anonymous" },
      {
        rel: "stylesheet",
        href: "https://fonts.googleapis.com/css2?family=Outfit:wght@300;400;500;600;700;800&display=swap",
      },
    ],
  }),
  shellComponent: RootShell,
  component: RootComponent,
  notFoundComponent: NotFoundComponent,
  errorComponent: ErrorComponent,
});

function RootShell({ children }: { children: ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script
          dangerouslySetInnerHTML={{
            __html:
              'try{var t=localStorage.getItem("miow-theme");var d=t==="dark"||((t==="system"||!t)&&window.matchMedia("(prefers-color-scheme: dark)").matches);if(d)document.documentElement.classList.add("dark");var f=localStorage.getItem("miow-fontsize");if(f==="small")document.documentElement.classList.add("font-small");else if(f==="large")document.documentElement.classList.add("font-large");if(localStorage.getItem("miow-contrast")==="1")document.documentElement.classList.add("high-contrast")}catch(e){}',
          }}
        />
        <HeadContent />
      </head>
      <body>
        {children}
        <Scripts />
      </body>
    </html>
  );
}

function RootComponent() {
  const { queryClient } = Route.useRouteContext();

  // One-time cleanup of dead pre-rename keys (see clearLegacyPreferences).
  useEffect(() => {
    clearLegacyPreferences();
    // Delete pages cached by earlier service-worker versions before any
    // account switch can reuse them. Current navigations are network-only.
    void clearLegacyNavigationCaches();

    // PWA service worker: production-only and browser-only (this code also runs
    // during SSR, where navigator/window do not exist).
    if (import.meta.env.PROD && typeof window !== "undefined" && "serviceWorker" in navigator) {
      import("virtual:pwa-register")
        .then(({ registerSW }) => {
          let pendingActivation = false;
          let pendingReload = false;
          const flushUpdate = () => {
            if (isAssessmentActive()) return;
            if (pendingReload) {
              window.location.reload();
              return;
            }
            if (pendingActivation) {
              pendingActivation = false;
              void updateSW(true);
            }
          };
          const updateSW = registerSW({
            immediate: true,
            onNeedRefresh() {
              pendingActivation = true;
              flushUpdate();
            },
            onNeedReload() {
              pendingReload = true;
              flushUpdate();
            },
            onRegisteredSW(_swUrl, registration) {
              // Long-running kiosk displays stay open for days — poll hourly
              // so a redeploy is picked up without a manual refresh.
              if (registration) {
                window.setInterval(() => registration.update(), 60 * 60 * 1000);
              }
            },
            onRegisterError(error) {
              reportError(error, { boundary: "pwa_service_worker_registration" });
            },
          });
          subscribeAssessmentMode(flushUpdate);
        })
        .catch((error) => {
          reportError(error, { boundary: "pwa_register_module_load" });
        });
    }
  }, []);

  return (
    <QueryClientProvider client={queryClient}>
      {/* Required: nested routes render here. Removing <Outlet /> breaks all child routes. */}
      <Outlet />
      <Toaster richColors position="top-right" />
    </QueryClientProvider>
  );
}
