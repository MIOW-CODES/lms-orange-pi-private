import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ClipboardPaste, Search, UserPlus } from "lucide-react";
import { toast } from "sonner";
import { enrollStudents, listStudents, type Profile } from "@/lib/lms";
import { Modal } from "@/components/lms";
import { UserAvatar } from "@/components/ui-elements";
import { CreatableSelect } from "@/components/ui/creatable-select";
import { BulkAddStudentsContent } from "@/components/courses/bulk-add-students";
import { ALL_SECTIONS_LABEL, ALL_SECTIONS_VALUE, resolveSectionFilter } from "@/lib/constants";
import { cn } from "@/lib/utils";

/**
 * Enroll students into one course. Two modes:
 *  - "pick": every student not already enrolled, with search + multi-select;
 *  - "paste": the bulk-add flow for pasting a whole class list at once.
 * Enrolling is idempotent server-side, so double-clicks / repeats are safe.
 */
export function EnrollStudentsModal({
  courseId,
  courseLabel,
  open,
  onClose,
  enrolledIds,
  onEnrolled,
}: {
  courseId: string;
  courseLabel?: string;
  open: boolean;
  onClose: () => void;
  enrolledIds: string[];
  onEnrolled?: () => void;
}) {
  const qc = useQueryClient();
  const [mode, setMode] = useState<"pick" | "paste">("pick");
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [sectionFilter, setSectionFilter] = useState(ALL_SECTIONS_VALUE);
  const [saving, setSaving] = useState(false);

  // Reuses the shared ["students"] roster cache (same queryFn as the students
  // pages / course roster). Filtering is client-side; if a school ever exceeds a
  // few thousand learners this should move to a paginated server search.
  const { data: students, isPending } = useQuery({
    queryKey: ["students"],
    queryFn: listStudents,
    enabled: open,
  });

  const enrolled = useMemo(() => new Set(enrolledIds), [enrolledIds]);

  const availableSections = useMemo(() => {
    const set = new Set<string>();
    (students ?? []).forEach((s) => {
      if (s.section?.trim()) set.add(s.section.trim());
    });
    return Array.from(set).sort((a, b) => a.localeCompare(b));
  }, [students]);

  const candidates = useMemo(() => {
    const q = search.trim().toLowerCase();
    return (students ?? []).filter((s) => {
      if (enrolled.has(s.id)) return false;
      if (sectionFilter !== ALL_SECTIONS_VALUE && (s.section ?? "") !== sectionFilter) return false;
      if (!q) return true;
      return (
        s.full_name.toLowerCase().includes(q) ||
        (s.student_id ?? "").toLowerCase().includes(q) ||
        (s.email ?? "").toLowerCase().includes(q) ||
        (s.section ?? "").toLowerCase().includes(q)
      );
    });
  }, [students, enrolled, search, sectionFilter]);

  const toggle = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const submit = async () => {
    if (selected.size === 0) return;
    setSaving(true);
    const ids = [...selected];
    try {
      // Single batched call (one SELECT + one INSERT server-side).
      const { enrolled } = await enrollStudents(ids, courseId);
      toast.success(`Enrolled ${enrolled} student${enrolled !== 1 ? "s" : ""}.`);
      qc.invalidateQueries({ queryKey: ["enrollments", courseId] });
      qc.invalidateQueries({ queryKey: ["students"] });
      onEnrolled?.();
      onClose();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not enroll the selected students.");
    } finally {
      setSaving(false);
      setSelected(new Set());
    }
  };

  const close = () => {
    if (saving) return;
    setSelected(new Set());
    setSearch("");
    setMode("pick");
    onClose();
  };

  const count = selected.size;
  const submitLabel = saving
    ? "Enrolling…"
    : count > 0
      ? `Enroll ${count} student${count === 1 ? "" : "s"}`
      : "Enroll students";

  return (
    <Modal
      open={open}
      onClose={close}
      title={courseLabel ? `Enroll students — ${courseLabel}` : "Enroll students"}
      wide
    >
      {/* Mode switch: pick from the roster, or paste a whole class list. */}
      <div className="mb-4 flex flex-wrap gap-1 rounded-xl bg-muted/80 p-1 backdrop-blur-sm">
        <button
          type="button"
          onClick={() => setMode("pick")}
          className={cn(
            "flex items-center gap-1.5 rounded-lg px-3.5 py-1.5 text-sm font-semibold transition-colors",
            mode === "pick"
              ? "bg-card text-foreground shadow-sm"
              : "text-muted-foreground hover:text-foreground",
          )}
        >
          <UserPlus className="h-3.5 w-3.5" /> Choose from roster
        </button>
        <button
          type="button"
          onClick={() => setMode("paste")}
          className={cn(
            "flex items-center gap-1.5 rounded-lg px-3.5 py-1.5 text-sm font-semibold transition-colors",
            mode === "paste"
              ? "bg-card text-foreground shadow-sm"
              : "text-muted-foreground hover:text-foreground",
          )}
        >
          <ClipboardPaste className="h-3.5 w-3.5" /> Paste a class list
        </button>
      </div>

      {mode === "paste" ? (
        <BulkAddStudentsContent
          onClose={close}
          courseId={courseId}
          {...(courseLabel ? { courseLabel } : {})}
          courseLocked
          onDone={() => {
            qc.invalidateQueries({ queryKey: ["enrollments", courseId] });
            qc.invalidateQueries({ queryKey: ["students"] });
            onEnrolled?.();
          }}
        />
      ) : (
        <>
          <div className="mb-3 flex flex-col gap-2 sm:flex-row sm:items-center">
            <label className="relative flex-1 block">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                aria-label="Search students to enroll"
                placeholder="Search name, student no., email or section…"
                className="h-11 w-full rounded-xl border border-input bg-background pl-9 pr-3 text-sm outline-none focus:ring-2 focus:ring-ring"
              />
            </label>
            <div className="w-full sm:w-48">
              <CreatableSelect
                value={sectionFilter === ALL_SECTIONS_VALUE ? "" : sectionFilter}
                onChange={(val) => setSectionFilter(resolveSectionFilter(val))}
                options={[ALL_SECTIONS_LABEL, ...availableSections]}
                placeholder={ALL_SECTIONS_LABEL}
                searchPlaceholder="Filter section..."
                createPlaceholder="Filter"
                emptyText="No sections found."
                label="Filter students by section"
              />
            </div>
          </div>

          {isPending ? (
            <div className="grid gap-1.5 sm:grid-cols-2">
              {[1, 2, 3, 4].map((i) => (
                <div key={i} className="h-14 animate-pulse rounded-xl bg-muted" />
              ))}
            </div>
          ) : candidates.length === 0 ? (
            <p className="rounded-xl border border-dashed border-border bg-muted/30 p-6 text-center text-sm text-muted-foreground">
              {(students ?? []).length === 0
                ? "No students exist yet — add a student first."
                : "Every matching student is already enrolled in this course."}
            </p>
          ) : (
            <ul className="grid gap-1.5 sm:grid-cols-2">
              {candidates.map((s: Profile) => {
                const checked = selected.has(s.id);
                return (
                  <li key={s.id}>
                    <button
                      type="button"
                      onClick={() => toggle(s.id)}
                      aria-pressed={checked}
                      aria-label={`${checked ? "Deselect" : "Select"} ${s.full_name}`}
                      className={cn(
                        "flex w-full items-center gap-3 rounded-xl border px-3 py-2 text-left transition",
                        checked
                          ? "border-primary bg-primary/5 ring-1 ring-primary"
                          : "border-border/70 bg-background/50 hover:bg-muted",
                      )}
                    >
                      <span
                        className={cn(
                          "flex h-4 w-4 shrink-0 items-center justify-center rounded border text-[10px] font-bold",
                          checked
                            ? "border-primary bg-primary text-primary-foreground"
                            : "border-muted-foreground/40",
                        )}
                        aria-hidden
                      >
                        {checked ? "✓" : ""}
                      </span>
                      <UserAvatar name={s.full_name} src={s.avatar_url} className="h-8 w-8" />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-semibold">{s.full_name}</span>
                        <span className="block truncate text-[11px] text-muted-foreground">
                          {s.student_id ?? "—"}
                          {s.section ? ` · ${s.section}` : ""}
                        </span>
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}

          <button
            onClick={submit}
            disabled={saving || selected.size === 0}
            className="mt-4 flex h-11 w-full items-center justify-center gap-1.5 rounded-xl bg-primary text-sm font-semibold text-primary-foreground hover:opacity-90 disabled:opacity-50"
          >
            <UserPlus className="h-4 w-4" />
            {submitLabel}
          </button>
        </>
      )}
    </Modal>
  );
}
