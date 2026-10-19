import { createFileRoute } from "@tanstack/react-router";
import { AppShell, TEACHER_NAV, useProfile } from "@/components/lms";
import { ArduinoLabSection } from "@/components/arduino-lab-section";

export const Route = createFileRoute("/dashboard/teacher/arduino")({
  head: () => ({
    meta: [
      { title: "Arduino Lab | MIOW Teacher Portal" },
      {
        name: "description",
        content: "Interactive Arduino Uno simulator with real-time pin I/O and serial monitor.",
      },
      {
        property: "og:title",
        content: "Arduino Lab | MIOW Teacher Portal",
      },
      {
        property: "og:description",
        content: "Interactive Arduino Uno simulator with real-time pin I/O and serial monitor.",
      },
    ],
  }),
  component: TeacherArduinoPage,
});

function TeacherArduinoPage() {
  const profile = useProfile(["teacher", "admin"]);
  if (!profile) return null;

  return (
    <AppShell
      nav={TEACHER_NAV}
      profile={profile}
      subtitle="MIOW Teacher Portal · Practical Robotics Lab"
    >
      <ArduinoLabSection description="Prepare practical activities, test student code sketches, and demonstrate embedded microcontrollers." />
    </AppShell>
  );
}
