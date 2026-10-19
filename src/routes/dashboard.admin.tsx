import { createFileRoute, Outlet } from "@tanstack/react-router";
import { RequirePrivatePin } from "@/components/require-private-pin";

// Layout route for the admin/teacher portal. The dashboard body lives in
// dashboard.admin.index.tsx; child pages (students, courses, gradebook,
// attendance kiosk, announcements, settings) mount through <Outlet />.
//
// NOTE: No beforeLoad auth guard is needed here. useProfile() returns null
// when not authenticated, and all child pages already handle this case by
// rendering nothing or redirecting as appropriate.
export const Route = createFileRoute("/dashboard/admin")({
  component: AdminLayout,
  errorComponent: () => (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="max-w-md text-center">
        <h1 className="text-xl font-semibold tracking-tight text-foreground">Admin portal error</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Something went wrong in the admin portal. Please try refreshing the page.
        </p>
      </div>
    </div>
  ),
});

function AdminLayout() {
  return (
    <RequirePrivatePin>
      <Outlet />
    </RequirePrivatePin>
  );
}
