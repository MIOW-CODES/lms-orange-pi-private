import { useMemo, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { Search } from "lucide-react";
import { ATTENDANCE_LIMIT_REPORTS, GRADE_LEVELS } from "@/components/courses/constants";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  attendancePercent,
  enrollmentsForCourse,
  gradeRemarks,
  listAllAttendance,
  listAttendance,
  listCourses,
  listGradesForStudent,
  listStudents,
  transmutedOf,
  type AttendanceLog,
  type Grade,
  type Profile,
} from "@/lib/lms";
import { LoadingSkeleton, UserAvatar } from "@/components/ui-elements";
import {
  AppShell,
  Badge,
  Card,
  EmptyState,
  Modal,
  TEACHER_NAV,
  useProfile,
} from "@/components/lms";
import { gradeLevelLabel } from "@/lib/utils";

export const Route = createFileRoute("/dashboard/teacher/students")({
  head: () => ({
    meta: [
      { title: "Students Info | MIOW - Integrated Developmental School" },
      {
        name: "description",
        content: "Students in your courses — grades, attendance and sections.",
      },
      { property: "og:title", content: "Students Info | MIOW - Integrated Developmental School" },
    ],
  }),
  component: TeacherStudentsPage,
});

function TeacherStudentsPage() {
  const profile = useProfile(["teacher", "admin"]);
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

  // Batch-fetch recent attendance (single query instead of N). The server
  // schema caps `limit` at 500, so 10000 always threw and silently blanked the
  // stats. Distinct queryKey from the admin page's ["attendance-all"] feed to
  // stop the cache collision (shared entry + shared error state).
  const { data: allAttendance } = useQuery({
    queryKey: ["attendance-all", "teacher-students"],
    queryFn: () => listAllAttendance(ATTENDANCE_LIMIT_REPORTS),
    enabled: !!profile,
  });

  // Build attendance map: studentId → logs[]
  const attendanceByStudent = useMemo(() => {
    const map = new Map<string, AttendanceLog[]>();
    for (const log of allAttendance ?? []) {
      const arr = map.get(log.student_id) ?? [];
      arr.push(log);
      map.set(log.student_id, arr);
    }
    return map;
  }, [allAttendance]);

  const [search, setSearch] = useState("");
  const [gradeFilter, setGradeFilter] = useState("all");
  const [sectionFilter, setSectionFilter] = useState("all");
  const [selected, setSelected] = useState<Profile | null>(null);

  // Teacher's own courses; admin sees all
  const teacherCourses = useMemo(() => {
    if (!profile || !courses) return [];
    if (profile.role === "admin") return courses;
    return courses.filter((c) => c.teacher_id === profile.id);
  }, [profile, courses]);

  const teacherCourseIds = useMemo(() => {
    if (!profile || !courses) return [];
    if (profile.role === "admin") return (courses ?? []).map((c) => c.id);
    return (courses ?? []).filter((c) => c.teacher_id === profile.id).map((c) => c.id);
  }, [profile, courses]);

  // Fetch enrollments for teacher's courses (parallel, single query per course)
  const { data: enrolledStudentIds } = useQuery({
    queryKey: ["teacher-enrolled-students", teacherCourseIds],
    queryFn: async () => {
      if (!teacherCourseIds.length) return [];
      const results = await Promise.all(teacherCourseIds.map((id) => enrollmentsForCourse(id)));
      return [...new Set(results.flat())];
    },
    enabled: !!profile && teacherCourseIds.length > 0,
  });

  // Filter students to only those enrolled in teacher's courses
  const enrolledStudents = useMemo(() => {
    if (!students || !enrolledStudentIds) return [];
    if (profile?.role === "admin") return students;
    const idSet = new Set(enrolledStudentIds);
    return students.filter((s) => idSet.has(s.id));
  }, [students, enrolledStudentIds, profile]);

  const sections = useMemo(() => {
    const set = new Set(enrolledStudents.map((s) => s.section).filter(Boolean));
    return Array.from(set).sort();
  }, [enrolledStudents]);

  // Only batch-fetch grades when student list is manageable (≤ 100)
  const { data: batchGrades } = useQuery({
    queryKey: [
      "batch-grades",
      enrolledStudents
        .map((s) => s.id)
        .sort()
        .join(","),
    ],
    queryFn: async () => {
      const ids = enrolledStudents.map((s) => s.id);
      const results = await Promise.all(ids.map((id) => listGradesForStudent(id).catch(() => [])));
      const map = new Map<string, Grade[]>();
      ids.forEach((id, i) => map.set(id, results[i]!));
      return map;
    },
    enabled: enrolledStudents.length > 0 && enrolledStudents.length <= 100,
    staleTime: 60_000,
  });

  const gradesMap = batchGrades ?? new Map<string, Grade[]>();

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return enrolledStudents.filter((s) => {
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
  }, [enrolledStudents, search, gradeFilter, sectionFilter]);

  const isLoading = !students || !courses;

  if (!profile) return null;

  if (isLoading)
    return (
      <AppShell nav={TEACHER_NAV} profile={profile} subtitle="Teacher Portal">
        <LoadingSkeleton />
      </AppShell>
    );

  return (
    <AppShell nav={TEACHER_NAV} profile={profile} subtitle="Teacher Portal">
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="font-display text-2xl font-bold sm:text-3xl">Students Info</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {profile.role === "admin"
              ? `${filtered.length} of ${enrolledStudents.length} enrolled learners`
              : `${filtered.length} of ${enrolledStudents.length} learners · ${teacherCourses.length} courses you lead`}
          </p>
        </div>
      </div>

      <div className="mb-5 flex flex-wrap gap-3">
        <div className="relative min-w-56 flex-1">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search name, student no., email or section…"
            className="h-11 w-full rounded-xl border border-input bg-background pl-9 pr-3 text-sm outline-none focus:ring-2 focus:ring-ring"
          />
        </div>
        <Select value={gradeFilter} onValueChange={setGradeFilter}>
          <SelectTrigger className="h-11 w-[160px] rounded-xl">
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
          <SelectTrigger className="h-11 w-[160px] rounded-xl">
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
          title={enrolledStudents.length ? "No matches" : "No students yet"}
          sub={
            enrolledStudents.length
              ? "Try a different search or filter."
              : teacherCourses.length === 0
                ? "You are not leading any courses yet."
                : "No students enrolled in your courses yet."
          }
        />
      ) : (
        <Card className="custom-scrollbar overflow-x-auto">
          <table className="w-full min-w-[720px] text-sm">
            <thead>
              <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-muted-foreground">
                <th className="p-4">Student</th>
                <th className="p-4">Student No.</th>
                <th className="p-4">Grade & Section</th>
                <th className="p-4">RFID</th>
                <th className="p-4">Attendance</th>
                <th className="p-4">GWA</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {filtered.map((s) => (
                <tr
                  key={s.id}
                  onClick={() => setSelected(s)}
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
                      {gradeLevelLabel(s.grade_level, true)} · {s.section ?? "—"}
                    </Badge>
                  </td>
                  <td className="p-4 font-mono text-xs">{s.has_rfid ? "••••••••" : "—"}</td>
                  <td className="p-4">
                    {(() => {
                      const logs = attendanceByStudent.get(s.id);
                      if (!logs) return <span className="text-xs text-muted-foreground">—</span>;
                      const pct = attendancePercent(logs);
                      return (
                        <span className="text-xs font-semibold">
                          {pct != null ? `${pct}%` : "—"}
                        </span>
                      );
                    })()}
                  </td>
                  <td className="p-4">
                    {(() => {
                      const grades = gradesMap.get(s.id);
                      if (!grades) return <span className="text-xs text-muted-foreground">—</span>;
                      const att = attendancePercent(attendanceByStudent.get(s.id) ?? []);
                      const transmuted = grades
                        .map((g) => transmutedOf(g, att))
                        .filter((t): t is number => t != null);
                      const gwa = transmuted.length
                        ? Math.round(
                            (transmuted.reduce((a, b) => a + b, 0) / transmuted.length) * 10,
                          ) / 10
                        : null;
                      return <span className="text-xs font-semibold">{gwa ?? "—"}</span>;
                    })()}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}

      <StudentInfoModal student={selected} onClose={() => setSelected(null)} />
    </AppShell>
  );
}

function StudentInfoModal({ student, onClose }: { student: Profile | null; onClose: () => void }) {
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
      <div className="rounded-xl bg-muted/70 p-4">
        <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Academic standing
        </p>
        {gwa == null ? (
          <p className="mt-1 text-sm text-muted-foreground">No grades encoded yet.</p>
        ) : (
          <div className="mt-1 flex items-center gap-3">
            <p className="font-display text-2xl font-bold">{gwa}</p>
            <Badge tone={gwa >= 90 ? "green" : gwa >= 85 ? "indigo" : gwa >= 75 ? "amber" : "red"}>
              {gradeRemarks(gwa)}
            </Badge>
          </div>
        )}
        <p className="mt-2 text-xs text-muted-foreground">
          Attendance: {att != null ? `${att}%` : "—"} · {logs?.length ?? 0} log(s)
        </p>
      </div>
    </Modal>
  );
}
