import { createFileRoute } from "@tanstack/react-router";
import { ADMIN_NAV, AppShell, useProfile } from "@/components/lms";
import { ArduinoLabSection } from "@/components/arduino-lab-section";

export const Route = createFileRoute("/dashboard/admin/arduino")({
  head: () => ({
    meta: [
      { title: "Arduino Lab | MIOW Admin Console" },
      {
        name: "description",
        content: "Interactive Arduino Uno simulator with real-time pin I/O and serial monitor.",
      },
      {
        property: "og:title",
        content: "Arduino Lab | MIOW Admin Console",
      },
      {
        property: "og:description",
        content: "Interactive Arduino Uno simulator with real-time pin I/O and serial monitor.",
      },
    ],
  }),
  component: AdminArduinoPage,
});

function AdminArduinoPage() {
  const profile = useProfile(["admin"]);
  if (!profile) return null;

  return (
    <AppShell nav={ADMIN_NAV} profile={profile} subtitle="MIOW Admin Console · STEM Robotics Lab">
      <ArduinoLabSection description="Interactive ATmega328P simulation environment for school robotics and microcontrollers curriculum." />
    </AppShell>
  );
}
