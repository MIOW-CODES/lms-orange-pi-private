import { useEffect, useMemo, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ClipboardPaste,
  KeyRound,
  Nfc,
  Plus,
  Search,
  Trash2,
  ChevronLeft,
  ChevronRight,
} from "lucide-react";
import { GRADE_LEVELS } from "@/components/courses/constants";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { toast } from "sonner";
import { LoadingSkeleton, UserAvatar } from "@/components/ui-elements";
import {
  attendancePercent,
  createOrEnrollStudent,
  deleteProfile,
  gradeRemarks,
  listAttendance,
  listCourses,
  listGradesForStudent,
  listStudents,
  transmutedOf,
  updateProfile,
  type Course,
  type Profile,
} from "@/lib/lms";
import {
  ADMIN_NAV,
  AppShell,
  Badge,
  Card,
  EmptyState,
  Modal,
  staffNav,
  useProfile,
} from "@/components/lms";
import { BulkAddStudentsModal } from "@/components/courses/bulk-add-students";
import { gradeLevelLabel } from "@/lib/utils";
import { CreatableSelect } from "@/components/ui/creatable-select";

export const Route = createFileRoute("/dashboard/admin/students")({
  head: () => ({
    meta: [
      { title: "Students | MIOW - Integrated Developmental School" },
      { name: "description", content: "Manage student records, RFID cards and sections." },
      { property: "og:title", content: "Students | MIOW - Integrated Developmental School" },
      { property: "og:description", content: "Manage student records, RFID cards and sections." },
    ],
  }),
  component: StudentsPage,
});

const AVATARS = [
  "https://api.dicebear.com/9.x/adventurer/svg?seed=Felix",
  "https://api.dicebear.com/9.x/adventurer/svg?seed=Aneka",
  "https://api.dicebear.com/9.x/adventurer/svg?seed=Milo",
  "https://api.dicebear.com/9.x/adventurer/svg?seed=Luna",
];

const EMPTY_FORM = {
  full_name: "",
  student_id: "",
  email: "",
  grade_level: "7",
  section: "",
  pin: "",
  rfid_uid: "",
  course_id: "",
};

function StudentsPage() {
  const profile = useProfile(["admin", "teacher"]);
  const qc = useQueryClient();
  const { data: students } = useQuery({
    queryKey: ["students"],
    queryFn: listStudents,
    enabled: !!profile,
  });
  const { data: courses } = useQuery({
    queryKey: ["courses"],
    queryFn: listCourses,
    enabled: !!profile,
  });
  const [open, setOpen] = useState(false);
  const [bulkOpen, setBulkOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);
  const [search, setSearch] = useState("");
  const [gradeFilter, setGradeFilter] = useState("all");
  const [sectionFilter, setSectionFilter] = useState("all");
  const [selected, setSelected] = useState<Profile | null>(null);
  const [page, setPage] = useState(1);
  const pageSize = 40;

  const sections = useMemo(() => {
    const set = new Set<string>();
    (students ?? []).forEach((s) => {
      if (s.section?.trim()) set.add(s.section.trim());
    });
    return Array.from(set).sort((a, b) => a.localeCompare(b));
  }, [students]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return (students ?? []).filter((s) => {
      if (gradeFilter !== "all" && s.grade_level !== parseInt(gradeFilter)) return false;
      if (sectionFilter !== "all" && s.section !== sectionFilter) return false;
      if (!q) return true;
      return (
        s.full_name.toLowerCase().includes(q) ||
        (s.student_id ?? "").toLowerCase().includes(q) ||
        (s.email ?? "").toLowerCase().includes(q) ||
        (s.section ?? "").toLowerCase().includes(q)
      );
    });
  }, [students, search, gradeFilter, sectionFilter]);

  const totalPages = Math.ceil(filtered.length / pageSize) || 1;
  const paginatedStudents = useMemo(() => {
    const start = (page - 1) * pageSize;
    return filtered.slice(start, start + pageSize);
  }, [filtered, page, pageSize]);

  // Reset to page 1 when search or filter changes
  useEffect(() => {
    setPage(1);
  }, [search, gradeFilter, sectionFilter]);

  const isLoading = !students;

  if (!profile) return null;

  if (isLoading)
    return (
      <AppShell
        nav={staffNav(profile.role)}
        profile={profile}
        subtitle={profile.role === "admin" ? "Admin Console" : "Teacher Portal"}
      >
        <LoadingSkeleton />
      </AppShell>
    );

  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm((f) => ({ ...f, [k]: e.target.value }));

  const save = async () => {
    if (!form.full_name || !form.student_id) {
      toast.error("Name and student number are required.");
      return;
    }
    setSaving(true);
    try {
      const { created, enrolled } = await createOrEnrollStudent(
        {
          full_name: form.full_name,
          student_id: form.student_id,
          email: form.email || null,
          role: "student",
          grade_level: parseInt(form.grade_level) || 7,
          section: form.section || null,
          pin: form.pin || null,
          rfid_uid: form.rfid_uid || null,
          avatar_url: AVATARS[Math.floor(Math.random() * AVATARS.length)] ?? null,
        },
        form.course_id || null,
      );
      const who = created ? form.full_name : "Existing student";
      toast.success(
        enrolled
          ? `${who} enrolled into the selected course.`
          : created
            ? `${form.full_name} added.`
            : `${who} updated.`,
      );
      setOpen(false);
      setForm(EMPTY_FORM);
      qc.invalidateQueries({ queryKey: ["students"] });
      qc.invalidateQueries({ queryKey: ["enrollments"] });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not save student.");
    } finally {
      setSaving(false);
    }
  };

  const remove = async (id: string, name: string) => {
    try {
      await deleteProfile(id);
      toast.success("Student removed.");
      setSelected(null);
      qc.invalidateQueries({ queryKey: ["students"] });
    } catch {
      toast.error("Delete failed.");
    }
  };

  return (
    <AppShell
      nav={staffNav(profile.role)}
      profile={profile}
      subtitle={profile.role === "admin" ? "Admin Console" : "Teacher Portal"}
    >
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="font-display text-2xl font-bold sm:text-3xl">Students</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {filtered.length} of {students?.length ?? 0} enrolled learners
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setBulkOpen(true)}
            className="flex items-center gap-1.5 rounded-xl border border-border bg-card px-4 py-2.5 text-sm font-semibold hover:bg-muted"
          >
            <ClipboardPaste className="h-4 w-4" /> Bulk add
          </button>
          <button
            onClick={() => setOpen(true)}
            className="flex items-center gap-1.5 rounded-xl bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground hover:opacity-90"
          >
            <Plus className="h-4 w-4" /> Add student
          </button>
        </div>
      </div>

      {/* Search + grade filter */}
      <div className="mb-5 flex flex-wrap gap-3">
        <div className="relative min-w-56 flex-1">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            aria-label="Search students"
            placeholder="Search name, student no., email or section…"
            className="h-11 w-full rounded-xl border border-input bg-background pl-9 pr-3 text-sm outline-none focus:ring-2 focus:ring-ring"
          />
        </div>
        <Select value={gradeFilter} onValueChange={setGradeFilter}>
          <SelectTrigger className="h-11 w-[160px] rounded-xl" aria-label="Filter by grade level">
            <SelectValue placeholder="All grades" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All grades</SelectItem>
            {GRADE_LEVELS.map((g) => (
              <SelectItem key={g} value={String(g)}>
                {gradeLevelLabel(g)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={sectionFilter} onValueChange={setSectionFilter}>
          <SelectTrigger className="h-11 w-[160px] rounded-xl" aria-label="Filter by section">
            <SelectValue placeholder="All sections" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All sections</SelectItem>
            {sections.map((sec) => (
              <SelectItem key={sec} value={sec!}>
                {sec}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {filtered.length === 0 ? (
        <EmptyState
          title={students?.length ? "No matches" : "No students yet"}
          sub={
            students?.length
              ? "Try a different search or filter."
              : "Enroll your first student to get started."
          }
        />
      ) : (
        <Card className="custom-scrollbar overflow-x-auto">
          <table className="w-full min-w-[720px] text-sm">
            <thead>
              <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-muted-foreground">
                <th className="p-4">Student</th>
                <th className="p-4">Student No.</th>
                <th className="p-4">Grade &amp; Section</th>
                <th className="p-4">RFID UID</th>
                <th className="p-4">PIN</th>
                <th className="p-4" />
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {paginatedStudents.map((s) => (
                <tr
                  key={s.id}
                  onClick={() => setSelected(s)}
                  role="button"
                  tabIndex={0}
                  aria-label={`View details for ${s.full_name}`}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      setSelected(s);
                    }
                  }}
                  className="cursor-pointer transition-colors hover:bg-muted/50"
                >
                  <td className="p-4">
                    <div className="flex items-center gap-2.5">
                      <UserAvatar src={s.avatar_url} name={s.full_name} />
                      <div>
                        <p className="font-semibold">{s.full_name}</p>
                        <p className="text-xs text-muted-foreground">{s.email}</p>
                      </div>
                    </div>
                  </td>
                  <td className="p-4">{s.student_id}</td>
                  <td className="p-4">
                    <Badge tone="indigo">
                      {gradeLevelLabel(s.grade_level, true)} · {s.section}
                    </Badge>
                  </td>
                  <td className="p-4 font-mono text-xs">{s.has_rfid ? "••••••••" : "—"}</td>
                  <td className="p-4 font-mono text-xs">{s.has_pin ? "••••" : "—"}</td>
                  <td className="p-4 text-right">
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        remove(s.id, s.full_name);
                      }}
                      aria-label={`Remove ${s.full_name}`}
                      className="rounded-lg p-2 text-muted-foreground hover:bg-rose-50 hover:text-rose-600 dark:hover:bg-rose-500/10"
                      title="Remove student"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          {/* Pagination Controls */}
          {totalPages > 1 && (
            <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border px-4 py-3 text-xs text-muted-foreground">
              <span>
                Showing {(page - 1) * pageSize + 1}–{Math.min(page * pageSize, filtered.length)} of{" "}
                {filtered.length} students
              </span>
              <div className="flex items-center gap-1.5">
                <button
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                  disabled={page === 1}
                  className="inline-flex items-center gap-1 rounded-lg border border-border px-2.5 py-1 font-medium hover:bg-muted disabled:opacity-40 transition"
                  aria-label="Previous page"
                >
                  <ChevronLeft className="h-3.5 w-3.5" /> Previous
                </button>
                <span className="px-2 font-medium text-foreground">
                  Page {page} of {totalPages}
                </span>
                <button
                  onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                  disabled={page === totalPages}
                  className="inline-flex items-center gap-1 rounded-lg border border-border px-2.5 py-1 font-medium hover:bg-muted disabled:opacity-40 transition"
                  aria-label="Next page"
                >
                  Next <ChevronRight className="h-3.5 w-3.5" />
                </button>
              </div>
            </div>
          )}
        </Card>
      )}

      {/* Add student */}
      <Modal open={open} onClose={() => setOpen(false)} title="Add or enroll a student">
        <div className="grid gap-3 sm:grid-cols-2">
          <input
            value={form.full_name}
            onChange={set("full_name")}
            aria-label="Full name"
            placeholder="Full name *"
            className="h-11 rounded-xl border border-input bg-background px-3 text-sm outline-none focus:ring-2 focus:ring-ring sm:col-span-2"
          />
          <input
            value={form.student_id}
            onChange={set("student_id")}
            aria-label="Student number"
            placeholder="Student number * (e.g. 2026-0042)"
            className="h-11 rounded-xl border border-input bg-background px-3 text-sm outline-none focus:ring-2 focus:ring-ring"
          />
          <input
            value={form.email}
            onChange={set("email")}
            aria-label="Email"
            placeholder="Email"
            className="h-11 rounded-xl border border-input bg-background px-3 text-sm outline-none focus:ring-2 focus:ring-ring"
          />
          <Select
            value={form.grade_level}
            onValueChange={(v) => setForm((f) => ({ ...f, grade_level: v }))}
          >
            <SelectTrigger className="h-11 rounded-xl" aria-label="Grade level">
              <SelectValue placeholder="Grade level" />
            </SelectTrigger>
            <SelectContent>
              {GRADE_LEVELS.map((g) => (
                <SelectItem key={g} value={String(g)}>
                  {gradeLevelLabel(g)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <CreatableSelect
            value={form.section}
            onChange={(val) => setForm((f) => ({ ...f, section: val }))}
            options={sections}
            placeholder="Section (e.g. Omega)"
            searchPlaceholder="Search or type new section..."
            createPlaceholder="Add"
            emptyText="No sections found."
            label="Section"
          />
          <input
            value={form.pin}
            onChange={set("pin")}
            aria-label="Student PIN"
            placeholder="PIN (4–8 digits)"
            className="h-11 rounded-xl border border-input bg-background px-3 text-sm outline-none focus:ring-2 focus:ring-ring"
          />
          <input
            value={form.rfid_uid}
            onChange={set("rfid_uid")}
            aria-label="RFID UID"
            placeholder="RFID UID (6–20 digits)"
            className="h-11 rounded-xl border border-input bg-background px-3 text-sm outline-none focus:ring-2 focus:ring-ring"
          />
          <Select
            value={form.course_id || "none"}
            onValueChange={(v) => setForm((f) => ({ ...f, course_id: v === "none" ? "" : v }))}
          >
            <SelectTrigger
              className="h-11 rounded-xl sm:col-span-2"
              aria-label="Enroll into course (optional)"
            >
              <SelectValue placeholder="Enroll into course (optional)" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="none">No course — just save the student</SelectItem>
              {(courses ?? []).map((c: Course) => (
                <SelectItem key={c.id} value={c.id}>
                  {c.code} · {c.title}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <p className="mt-3 text-xs text-muted-foreground">
          If the student number or email already exists, the record is reused and (optionally)
          enrolled into the course above instead of creating a duplicate.
        </p>
        <button
          onClick={save}
          disabled={saving}
          className="mt-4 h-11 w-full rounded-xl bg-primary text-sm font-semibold text-primary-foreground hover:opacity-90 disabled:opacity-50"
        >
          {saving ? "Saving…" : "Enroll student"}
        </button>
      </Modal>

      {/* Bulk add — paste a whole class list */}
      <BulkAddStudentsModal
        open={bulkOpen}
        onClose={() => setBulkOpen(false)}
        onDone={() => {
          qc.invalidateQueries({ queryKey: ["students"] });
          qc.invalidateQueries({ queryKey: ["enrollments"] });
        }}
      />

      {/* Student profile + rebind */}
      <StudentProfileModal
        student={selected}
        sections={sections}
        onClose={() => setSelected(null)}
        onChanged={() => {
          qc.invalidateQueries({ queryKey: ["students"] });
          qc.invalidateQueries({ queryKey: ["grades"] });
        }}
      />
    </AppShell>
  );
}

function StudentProfileModal({
  student,
  sections = [],
  onClose,
  onChanged,
}: {
  student: Profile | null;
  sections?: string[];
  onClose: () => void;
  onChanged: () => void;
}) {
  const [newRfid, setNewRfid] = useState("");
  const [newPin, setNewPin] = useState("");
  const [editSection, setEditSection] = useState("");
  const [busy, setBusy] = useState(false);

  const studentId = student?.id;
  const studentSection = student?.section;

  // Seed the section editor only when a genuinely different student is opened
  // (or its stored section changes), so a background roster refetch returning a
  // new object reference never clobbers an in-progress edit.
  useEffect(() => {
    setEditSection(studentSection ?? "");
  }, [studentId, studentSection]);

  const { data: grades } = useQuery({
    queryKey: ["student-grades", student?.id],
    queryFn: () => listGradesForStudent(student!.id),
    enabled: !!student,
  });
  const { data: logs } = useQuery({
    queryKey: ["attendance", student?.id],
    queryFn: () => listAttendance(student!.id),
    enabled: !!student,
  });

  if (!student) return null;

  const att = attendancePercent(logs ?? []);
  const transmuted = (grades ?? [])
    .map((g) => transmutedOf(g, att))
    .filter((t): t is number => t != null);
  const gwa = transmuted.length
    ? Math.round((transmuted.reduce((a, b) => a + b, 0) / transmuted.length) * 10) / 10
    : null;

  const rebind = async (kind: "rfid" | "pin") => {
    const value = kind === "rfid" ? newRfid.trim() : newPin.trim();
    const valid = kind === "rfid" ? /^\d{6,20}$/.test(value) : /^\d{4,8}$/.test(value);
    if (!valid) {
      toast.error(kind === "rfid" ? "RFID UID must be 6–20 digits." : "PIN must be 4–8 digits.");
      return;
    }
    setBusy(true);
    try {
      await updateProfile(student.id, kind === "rfid" ? { rfid_uid: value } : { pin: value });
      toast.success(kind === "rfid" ? "RFID card rebound." : "PIN reset.");
      if (kind === "rfid") setNewRfid("");
      else setNewPin("");
      onChanged();
    } catch {
      toast.error("Update failed — try again.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal open={!!student} onClose={onClose} title={student.full_name}>
      <div className="mb-4 flex items-center gap-3">
        <UserAvatar
          src={student.avatar_url}
          name={student.full_name}
          className="h-14 w-14 ring-2 ring-primary/30"
        />
        <div>
          <p className="text-sm font-semibold">{student.student_id}</p>
          <p className="text-xs text-muted-foreground">{student.email ?? "No email"}</p>
          <Badge tone="indigo">
            {gradeLevelLabel(student.grade_level)} · {student.section ?? "—"}
          </Badge>
        </div>
      </div>

      {/* Section update */}
      <div className="mb-4 rounded-xl bg-muted/40 p-4">
        <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Section Assignment
        </p>
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
          <div className="flex-1">
            <CreatableSelect
              value={editSection}
              onChange={setEditSection}
              options={sections}
              placeholder="Assign section (e.g. Omega)"
              searchPlaceholder="Search or type section..."
              createPlaceholder="Assign"
              label="Student section"
            />
          </div>
          <button
            onClick={async () => {
              if (editSection.trim() === (student.section ?? "")) return;
              setBusy(true);
              try {
                await updateProfile(student.id, { section: editSection.trim() || null });
                toast.success("Section updated.");
                onChanged();
              } catch {
                toast.error("Failed to update section.");
              } finally {
                setBusy(false);
              }
            }}
            disabled={busy || editSection.trim() === (student.section ?? "")}
            className="h-11 rounded-xl bg-primary px-4 text-sm font-semibold text-primary-foreground hover:opacity-90 disabled:opacity-50"
          >
            Update Section
          </button>
        </div>
      </div>

      {/* Academic standing */}
      <div className="mb-4 rounded-xl bg-muted/70 p-4">
        <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Academic standing
        </p>
        {gwa == null ? (
          <p className="mt-1 text-sm text-muted-foreground">No grades encoded yet.</p>
        ) : (
          <div className="mt-1 flex items-center gap-3">
            <p className="font-display text-2xl font-bold">{gwa}</p>
            <Badge tone={gwa >= 90 ? "green" : gwa >= 80 ? "indigo" : gwa >= 75 ? "amber" : "red"}>
              {gradeRemarks(gwa)}
            </Badge>
            <p className="text-xs text-muted-foreground">
              GWA across {transmuted.length} course grade(s)
            </p>
          </div>
        )}
      </div>

      {/* Credential rebinding */}
      <div className="space-y-3">
        <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Credentials
        </p>
        <div className="flex gap-2">
          <div className="relative flex-1">
            <Nfc className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <input
              value={newRfid}
              onChange={(e) => setNewRfid(e.target.value.replace(/\D/g, ""))}
              aria-label="New RFID UID"
              placeholder={student.has_rfid ? "New RFID UID (card bound)" : "New RFID UID"}
              inputMode="numeric"
              className="h-10 w-full rounded-xl border border-input bg-background pl-9 pr-3 text-sm outline-none focus:ring-2 focus:ring-ring"
            />
          </div>
          <button
            onClick={() => rebind("rfid")}
            disabled={busy || !newRfid.trim()}
            className="h-10 rounded-xl border border-border bg-card px-4 text-sm font-semibold hover:bg-muted disabled:opacity-50"
          >
            Rebind card
          </button>
        </div>
        <div className="flex gap-2">
          <div className="relative flex-1">
            <KeyRound className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <input
              value={newPin}
              onChange={(e) => setNewPin(e.target.value.replace(/\D/g, ""))}
              aria-label="New PIN"
              placeholder={student.has_pin ? "New PIN (already set)" : "New PIN"}
              inputMode="numeric"
              className="h-10 w-full rounded-xl border border-input bg-background pl-9 pr-3 text-sm outline-none focus:ring-2 focus:ring-ring"
            />
          </div>
          <button
            onClick={() => rebind("pin")}
            disabled={busy || !newPin.trim()}
            className="h-10 rounded-xl border border-border bg-card px-4 text-sm font-semibold hover:bg-muted disabled:opacity-50"
          >
            Reset PIN
          </button>
        </div>
      </div>
    </Modal>
  );
}
