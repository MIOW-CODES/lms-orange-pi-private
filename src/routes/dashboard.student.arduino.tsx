import { createFileRoute } from "@tanstack/react-router";
import { AppShell, STUDENT_NAV, useProfile } from "@/components/lms";
import { ArduinoLabSection } from "@/components/arduino-lab-section";

export const Route = createFileRoute("/dashboard/student/arduino")({
  head: () => ({
    meta: [
      { title: "Arduino Lab | MIOW - Integrated Developmental School" },
      {
        name: "description",
        content: "Interactive Arduino Uno simulator with real-time pin I/O and serial monitor.",
      },
      {
        property: "og:title",
        content: "Arduino Lab | MIOW - Integrated Developmental School",
      },
      {
        property: "og:description",
        content: "Interactive Arduino Uno simulator with real-time pin I/O and serial monitor.",
      },
    ],
  }),
  component: StudentArduinoPage,
});

function StudentArduinoPage() {
  const profile = useProfile(["student"]);
  if (!profile) return null;

  return (
    <AppShell
      nav={STUDENT_NAV}
      profile={profile}
      subtitle="Integrated Developmental School · STEM Robotics Lab"
    >
      <ArduinoLabSection description="Write, test, and run Arduino C++ sketches with real-time digital I/O, analog sensors, and serial debugging." />
    </AppShell>
  );
}
