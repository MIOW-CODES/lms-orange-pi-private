import { createFileRoute, Outlet } from "@tanstack/react-router";
import { RequirePrivatePin } from "@/components/require-private-pin";

// Layout for /dashboard/teacher/* — teacher portal. Child routes (index, students, settings) mount via <Outlet />.
//
// NOTE: No beforeLoad auth guard is needed here. useProfile() returns null
// when not authenticated, and all child pages already handle this case by
// rendering nothing or redirecting as appropriate.
export const Route = createFileRoute("/dashboard/teacher")({
  component: TeacherLayout,
  errorComponent: () => (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="max-w-md text-center">
        <h1 className="text-xl font-semibold tracking-tight text-foreground">
          Teacher portal error
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Something went wrong in the teacher portal. Please try refreshing the page.
        </p>
      </div>
    </div>
  ),
});

function TeacherLayout() {
  return (
    <RequirePrivatePin>
      <Outlet />
    </RequirePrivatePin>
  );
}
