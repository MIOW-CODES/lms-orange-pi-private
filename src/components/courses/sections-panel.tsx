import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { GraduationCap, Layers, Plus, Search, Trash2, UserPlus, Users } from "lucide-react";
import { toast } from "sonner";
import {
  type CourseSection,
  type Section,
  createSection,
  enrollSectionStudents,
  listCourseSections,
  listSections,
  setCourseSections,
} from "@/lib/lms";
import { Badge, Card, EmptyState, Modal } from "@/components/lms";
import { cn } from "@/lib/utils";

function levelTone(level: "jhs" | "shs" | "college"): "sky" | "indigo" | "violet" {
  switch (level) {
    case "jhs":
      return "sky";
    case "shs":
      return "indigo";
    case "college":
      return "violet";
    default:
      return "sky";
  }
}

function levelDisplayName(level: "jhs" | "shs" | "college"): string {
  switch (level) {
    case "jhs":
      return "Junior High";
    case "shs":
      return "Senior High";
    case "college":
      return "College";
    default:
      return level;
  }
}

interface LinkSectionsModalProps {
  courseId: string;
  linkedSectionIds: string[];
  open: boolean;
  onClose: () => void;
  onSuccess: () => void;
}

function LinkSectionsModal({
  courseId,
  linkedSectionIds,
  open,
  onClose,
  onSuccess,
}: LinkSectionsModalProps) {
  const [search, setSearch] = useState("");
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set(linkedSectionIds));
  const [saving, setSaving] = useState(false);

  // Sync selectedIds with linkedSectionIds when modal opens
  const [prevOpen, setPrevOpen] = useState(false);
  if (open && !prevOpen) {
    setPrevOpen(true);
    setSelectedIds(new Set(linkedSectionIds));
  } else if (!open && prevOpen) {
    setPrevOpen(false);
  }

  const { data: allSections = [], isPending } = useQuery({
    queryKey: ["all-sections"],
    queryFn: listSections,
    enabled: open,
  });

  const filteredSections = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return allSections;
    return allSections.filter(
      (s) =>
        s.name.toLowerCase().includes(q) ||
        levelDisplayName(s.education_level).toLowerCase().includes(q),
    );
  }, [allSections, search]);

  const toggleSection = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      await setCourseSections(courseId, Array.from(selectedIds));
      toast.success("Linked course sections updated.");
      onSuccess();
      onClose();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to update course sections.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal open={open} onClose={onClose} title="Link school sections" wide>
      <div className="space-y-4">
        <p className="text-xs text-muted-foreground">
          Select existing school cohorts linked to this course. Learners belonging to these sections
          will be associated with the course.
        </p>

        {/* Search */}
        <label className="relative block">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search sections by name or level…"
            className="h-9 w-full rounded-xl border border-input bg-background/80 pl-8 pr-3 text-xs outline-none focus:ring-2 focus:ring-ring"
          />
        </label>

        {/* List of sections */}
        <div className="max-h-72 overflow-y-auto rounded-xl border border-border/60 bg-muted/20 p-2">
          {isPending ? (
            <div className="space-y-2 p-2">
              {[1, 2, 3].map((i) => (
                <div key={i} className="h-10 animate-pulse rounded-lg bg-muted" />
              ))}
            </div>
          ) : filteredSections.length === 0 ? (
            <p className="p-6 text-center text-xs text-muted-foreground">
              {allSections.length === 0
                ? "No sections defined yet. Create a section using the 'New section' option."
                : "No sections match your search."}
            </p>
          ) : (
            <div className="grid gap-1.5 sm:grid-cols-2">
              {filteredSections.map((sec) => {
                const checked = selectedIds.has(sec.id);
                return (
                  <label
                    key={sec.id}
                    className={cn(
                      "flex cursor-pointer items-center justify-between gap-3 rounded-xl border p-2.5 transition-colors",
                      checked
                        ? "border-primary/40 bg-primary/5 text-foreground"
                        : "border-border/60 bg-card/60 text-muted-foreground hover:bg-muted/60",
                    )}
                  >
                    <div className="flex items-center gap-2.5 min-w-0">
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() => toggleSection(sec.id)}
                        className="h-4 w-4 rounded border-input text-primary focus:ring-primary"
                      />
                      <div className="min-w-0">
                        <p className="truncate text-xs font-semibold text-foreground">{sec.name}</p>
                        <p className="text-[11px] text-muted-foreground">
                          {levelDisplayName(sec.education_level)}
                        </p>
                      </div>
                    </div>
                    <Badge tone={levelTone(sec.education_level)}>
                      {sec.education_level.toUpperCase()}
                    </Badge>
                  </label>
                );
              })}
            </div>
          )}
        </div>

        {/* Modal actions */}
        <div className="flex items-center justify-between pt-2">
          <span className="text-xs text-muted-foreground">
            {selectedIds.size} section{selectedIds.size !== 1 ? "s" : ""} selected
          </span>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={onClose}
              disabled={saving}
              className="rounded-xl border border-border px-4 py-2 text-xs font-semibold hover:bg-muted"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleSave}
              disabled={saving}
              className="rounded-xl bg-primary px-4 py-2 text-xs font-semibold text-primary-foreground hover:opacity-90 disabled:opacity-50"
            >
              {saving ? "Saving…" : "Save linked sections"}
            </button>
          </div>
        </div>
      </div>
    </Modal>
  );
}

export function SectionsPanel({ courseId }: { courseId: string }) {
  const qc = useQueryClient();
  const [linkModalOpen, setLinkModalOpen] = useState(false);
  const [showNewSectionInline, setShowNewSectionInline] = useState(false);
  const [newSectionName, setNewSectionName] = useState("");
  const [newSectionLevel, setNewSectionLevel] = useState<"jhs" | "shs" | "college">("jhs");
  const [creating, setCreating] = useState(false);
  const [unlinkingId, setUnlinkingId] = useState<string | null>(null);
  const [enrollingId, setEnrollingId] = useState<string | null>(null);

  const { data: linkedSections = [], isPending } = useQuery({
    queryKey: ["course-sections", courseId],
    queryFn: () => listCourseSections(courseId),
  });

  const handleCreateSection = async (e: React.FormEvent) => {
    e.preventDefault();
    const name = newSectionName.trim();
    if (!name || creating) return;

    setCreating(true);
    try {
      const created = await createSection({
        name,
        education_level: newSectionLevel,
      });

      // Link newly created section to current course automatically
      const currentIds = linkedSections.map((s) => s.id);
      if (!currentIds.includes(created.id)) {
        await setCourseSections(courseId, [...currentIds, created.id]);
      }

      toast.success(`Created section "${created.name}" and linked to course.`);
      setNewSectionName("");
      setShowNewSectionInline(false);
      qc.invalidateQueries({ queryKey: ["course-sections", courseId] });
      qc.invalidateQueries({ queryKey: ["all-sections"] });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to create section.");
    } finally {
      setCreating(false);
    }
  };

  const handleUnlink = async (section: CourseSection) => {
    setUnlinkingId(section.id);
    try {
      const remainingIds = linkedSections.filter((s) => s.id !== section.id).map((s) => s.id);
      await setCourseSections(courseId, remainingIds);
      toast.success(`Unlinked section "${section.name}".`);
      qc.invalidateQueries({ queryKey: ["course-sections", courseId] });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to unlink section.");
    } finally {
      setUnlinkingId(null);
    }
  };

  const handleEnroll = async (key: string, sectionIds: string[], label: string) => {
    if (enrollingId) return;
    setEnrollingId(key);
    try {
      const result = await enrollSectionStudents(courseId, sectionIds);
      if (result.enrolled > 0) {
        toast.success(
          `Enrolled ${result.enrolled} student${result.enrolled !== 1 ? "s" : ""} from ${label}.`,
        );
      } else {
        toast.success(`Everyone in ${label} is already enrolled.`);
      }
      qc.invalidateQueries({ queryKey: ["enrollments", courseId] });
      qc.invalidateQueries({ queryKey: ["students"] });
      qc.invalidateQueries({ queryKey: ["course-sections", courseId] });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not enroll students.");
    } finally {
      setEnrollingId(null);
    }
  };

  const totalCohortLearners = useMemo(() => {
    return linkedSections.reduce((sum, s) => sum + (s.student_count ?? 0), 0);
  }, [linkedSections]);

  return (
    <Card className="p-5">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border/50 pb-4">
        <div>
          <div className="flex items-center gap-2">
            <Layers className="h-4 w-4 text-primary" />
            <h2 className="text-base font-bold">Linked cohort sections</h2>
          </div>
          <p className="mt-0.5 text-xs text-muted-foreground">
            School sections enrolled in this course and their active student counts.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => setShowNewSectionInline((prev) => !prev)}
            className="flex h-9 items-center gap-1.5 rounded-xl border border-border bg-card px-3 text-xs font-semibold text-foreground hover:bg-muted"
          >
            <Plus className="h-3.5 w-3.5" /> New section
          </button>
          {linkedSections.length > 0 && (
            <button
              type="button"
              onClick={() =>
                handleEnroll(
                  "all",
                  linkedSections.map((s) => s.id),
                  "linked sections",
                )
              }
              disabled={enrollingId !== null}
              title="Enroll every student in the linked sections into this course"
              className="flex h-9 items-center gap-1.5 rounded-xl border border-border bg-card px-3 text-xs font-semibold text-foreground hover:bg-muted disabled:opacity-50"
            >
              <UserPlus className="h-3.5 w-3.5" />
              {enrollingId === "all" ? "Enrolling…" : "Enroll all linked"}
            </button>
          )}
          <button
            type="button"
            onClick={() => setLinkModalOpen(true)}
            className="flex h-9 items-center gap-1.5 rounded-xl bg-primary px-3 text-xs font-semibold text-primary-foreground hover:opacity-90"
          >
            <GraduationCap className="h-3.5 w-3.5" /> Manage linked sections
          </button>
        </div>
      </div>

      {/* Inline Create Form */}
      {showNewSectionInline && (
        <form
          onSubmit={handleCreateSection}
          className="mt-4 rounded-xl border border-primary/20 bg-primary/5 p-4 transition-all"
        >
          <div className="flex items-center justify-between mb-3">
            <span className="text-xs font-bold text-foreground">Create new school section</span>
            <button
              type="button"
              onClick={() => setShowNewSectionInline(false)}
              className="text-xs text-muted-foreground hover:text-foreground"
            >
              Cancel
            </button>
          </div>
          <div className="grid gap-3 sm:grid-cols-3">
            <div className="sm:col-span-2">
              <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                Section name <span className="text-rose-500">*</span>
              </label>
              <input
                type="text"
                value={newSectionName}
                onChange={(e) => setNewSectionName(e.target.value)}
                placeholder="e.g. Grade 10 - Omega"
                required
                className="w-full rounded-xl border border-input bg-background/90 px-3 py-2 text-xs outline-none focus:ring-2 focus:ring-ring"
              />
            </div>
            <div>
              <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                Education level <span className="text-rose-500">*</span>
              </label>
              <select
                value={newSectionLevel}
                onChange={(e) => setNewSectionLevel(e.target.value as "jhs" | "shs" | "college")}
                className="w-full rounded-xl border border-input bg-background/90 px-3 py-2 text-xs outline-none focus:ring-2 focus:ring-ring"
              >
                <option value="jhs">Junior High (JHS)</option>
                <option value="shs">Senior High (SHS)</option>
                <option value="college">College</option>
              </select>
            </div>
          </div>
          <div className="mt-3 flex justify-end">
            <button
              type="submit"
              disabled={creating || !newSectionName.trim()}
              className="rounded-xl bg-primary px-4 py-2 text-xs font-semibold text-primary-foreground hover:opacity-90 disabled:opacity-50"
            >
              {creating ? "Creating…" : "Create & link section"}
            </button>
          </div>
        </form>
      )}

      {/* Sections List */}
      <div className="mt-4">
        {isPending ? (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {[1, 2, 3].map((i) => (
              <div key={i} className="h-20 animate-pulse rounded-xl bg-muted/60" />
            ))}
          </div>
        ) : linkedSections.length === 0 ? (
          <EmptyState
            icon={<Layers className="h-8 w-8" />}
            title="No linked sections"
            sub="No sections linked yet — link an existing section or create a new one."
          />
        ) : (
          <div>
            <div className="mb-3 flex items-center justify-between text-xs text-muted-foreground">
              <span>
                {linkedSections.length} linked section{linkedSections.length !== 1 ? "s" : ""}
              </span>
              <span>
                Total cohort size:{" "}
                <span className="font-semibold text-foreground">
                  {totalCohortLearners} learners
                </span>
              </span>
            </div>

            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {linkedSections.map((sec) => (
                <div
                  key={sec.id}
                  className="flex items-center justify-between gap-3 rounded-xl border border-border/70 bg-card/60 p-3.5 transition hover:border-border"
                >
                  <div className="min-w-0 space-y-1">
                    <div className="flex items-center gap-1.5">
                      <span className="truncate text-sm font-semibold text-foreground">
                        {sec.name}
                      </span>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge tone={levelTone(sec.education_level)}>
                        {sec.education_level.toUpperCase()}
                      </Badge>
                      <span className="flex items-center gap-1 text-xs text-muted-foreground">
                        <Users className="h-3 w-3" />
                        {sec.student_count ?? 0} learner{sec.student_count !== 1 ? "s" : ""}
                      </span>
                    </div>
                  </div>

                  <div className="flex shrink-0 items-center gap-1.5">
                    <button
                      type="button"
                      onClick={() => handleEnroll(sec.id, [sec.id], sec.name)}
                      disabled={enrollingId !== null}
                      title={`Enroll all ${sec.name} students into this course`}
                      aria-label={`Enroll ${sec.name} students`}
                      className="flex h-8 items-center gap-1 rounded-lg border border-border px-2.5 text-xs font-semibold text-muted-foreground transition hover:bg-primary/10 hover:text-primary disabled:opacity-50"
                    >
                      <UserPlus className="h-3.5 w-3.5" />
                      {enrollingId === sec.id ? "Enrolling…" : "Enroll"}
                    </button>
                    <button
                      type="button"
                      onClick={() => handleUnlink(sec)}
                      disabled={unlinkingId === sec.id}
                      title={`Unlink ${sec.name} from this course`}
                      aria-label={`Unlink ${sec.name}`}
                      className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-border text-muted-foreground transition hover:bg-rose-500/10 hover:text-rose-600 disabled:opacity-50"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Link sections picker modal */}
      <LinkSectionsModal
        courseId={courseId}
        linkedSectionIds={linkedSections.map((s) => s.id)}
        open={linkModalOpen}
        onClose={() => setLinkModalOpen(false)}
        onSuccess={() => qc.invalidateQueries({ queryKey: ["course-sections", courseId] })}
      />
    </Card>
  );
}
