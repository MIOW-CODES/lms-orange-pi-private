import { useEffect, useRef, useState } from "react";
import { Maximize2, Minimize2 } from "lucide-react";
import { ArduinoLab } from "@/components/arduino-lab";
import { cn } from "@/lib/utils";

/** Fullscreen the entire page section without remounting the live circuit. */
export function ArduinoLabSection({ description }: { description: string }) {
  const sectionRef = useRef<HTMLElement | null>(null);
  const [fullscreen, setFullscreen] = useState(false);
  const [supported, setSupported] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    setSupported(!!document.fullscreenEnabled && !!sectionRef.current?.requestFullscreen);
    const sync = () => setFullscreen(document.fullscreenElement === sectionRef.current);
    document.addEventListener("fullscreenchange", sync);
    return () => document.removeEventListener("fullscreenchange", sync);
  }, []);

  const toggleFullscreen = async () => {
    try {
      setError("");
      if (document.fullscreenElement === sectionRef.current) await document.exitFullscreen();
      else await sectionRef.current?.requestFullscreen();
    } catch {
      setError("Fullscreen is unavailable. You can continue using the lab here.");
    }
  };

  return (
    <section
      ref={sectionRef}
      data-testid="arduino-lab-section"
      aria-label="Arduino Lab"
      className="min-w-0 space-y-6 [&:fullscreen]:h-full [&:fullscreen]:overflow-y-auto [&:fullscreen]:bg-background [&:fullscreen]:p-4 sm:[&:fullscreen]:p-6"
    >
      <header
        className={cn(
          "flex flex-wrap items-start justify-between gap-4",
          fullscreen && "sticky top-0 z-30 bg-background pb-4",
        )}
      >
        <div className="min-w-0 flex-1">
          <h1 className="font-display text-2xl font-bold sm:text-3xl">Arduino Lab</h1>
          <p className="mt-1 text-sm text-muted-foreground">{description}</p>
        </div>
        <button
          type="button"
          onClick={() => {
            void toggleFullscreen();
          }}
          disabled={!supported}
          aria-label={fullscreen ? "Exit Arduino Lab fullscreen" : "View Arduino Lab fullscreen"}
          className="inline-flex min-h-11 shrink-0 items-center gap-2 rounded-xl border border-border bg-card px-4 py-2 text-sm font-semibold hover:bg-muted disabled:cursor-not-allowed disabled:opacity-50"
        >
          {fullscreen ? <Minimize2 className="h-4 w-4" /> : <Maximize2 className="h-4 w-4" />}
          {fullscreen ? "Exit fullscreen" : "Fullscreen"}
        </button>
      </header>
      {error && (
        <p role="status" className="text-sm text-muted-foreground">
          {error}
        </p>
      )}
      <ArduinoLab />
    </section>
  );
}
