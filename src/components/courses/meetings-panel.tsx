import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertCircle, Calendar, Clock, Pencil, Plus, Search, Trash2, Users } from "lucide-react";
import { toast } from "sonner";
import {
  type CourseMeeting,
  type Profile,
  deleteCourseMeeting,
  enrollmentsForCourse,
  listCourseMeetings,
  listMeetingMembers,
  listStudents,
  setMeetingMembers,
  upsertCourseMeeting,
} from "@/lib/lms";
import { Badge, Card, EmptyState, Modal } from "@/components/lms";
import { DAYS } from "@/components/courses/constants";
import { UserAvatar } from "@/components/ui-elements";
import { cn } from "@/lib/utils";

// Time format helpers
function formatTime12(time24: string): string {
  if (!time24) return "";
  const parts = time24.split(":");
  const p0 = parts[0];
  const p1 = parts[1];
  if (!p0 || !p1) return time24;
  const hours = parseInt(p0, 10);
  const minutes = parseInt(p1, 10);
  if (isNaN(hours) || isNaN(minutes)) return time24;
  const period = hours >= 12 ? "PM" : "AM";
  const h12 = hours % 12 === 0 ? 12 : hours % 12;
  const mStr = minutes.toString().padStart(2, "0");
  return `${h12}:${mStr} ${period}`;
}

function formatTimeRange(start: string, end: string): string {
  if (!start && !end) return "Time not set";
  if (!end) return formatTime12(start);
  if (!start) return formatTime12(end);
  return `${formatTime12(start)} – ${formatTime12(end)}`;
}

function parseTimeToMinutes(t: string): number {
  if (!t) return 0;
  const [h = 0, m = 0] = t.split(":").map(Number);
  return h * 60 + m;
}

/** Component to display member count with separate query caching. */
function MeetingMemberCountBadge({
  meetingId,
  capacity,
}: {
  meetingId: string;
  capacity?: number | null;
}) {
  const { data: members, isPending } = useQuery({
    queryKey: ["meeting-members", meetingId],
    queryFn: () => listMeetingMembers(meetingId),
  });

  if (isPending) {
    return <span className="h-4 w-12 animate-pulse rounded bg-muted" />;
  }

  const count = members?.length ?? 0;
  const isOver = capacity != null && count > capacity;

  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 text-xs font-medium",
        isOver ? "font-semibold text-rose-600 dark:text-rose-400" : "text-muted-foreground",
      )}
    >
      <Users className="h-3.5 w-3.5" />
      {capacity != null
        ? `${count} / ${capacity} assigned`
        : `${count} student${count !== 1 ? "s" : ""}`}
    </span>
  );
}

interface MeetingFormModalProps {
  courseId: string;
  meeting: CourseMeeting | null;
  open: boolean;
  onClose: () => void;
  onSuccess: () => void;
}

function MeetingFormModal({ courseId, meeting, open, onClose, onSuccess }: MeetingFormModalProps) {
  const isEdit = !!meeting;
  const [kind, setKind] = useState<"lecture" | "lab">(meeting?.kind ?? "lecture");
  const [label, setLabel] = useState(meeting?.label ?? "Lecture");
  const [selectedDays, setSelectedDays] = useState<string[]>(meeting?.days_of_week ?? ["mon"]);
  const [startTime, setStartTime] = useState(meeting?.start_time?.slice(0, 5) ?? "08:00");
  const [endTime, setEndTime] = useState(meeting?.end_time?.slice(0, 5) ?? "10:00");
  const [capacity, setCapacity] = useState<string>(
    meeting?.capacity != null ? String(meeting.capacity) : "",
  );
  const [saving, setSaving] = useState(false);

  // Synchronize state when meeting prop changes.
  // Normalize `undefined` (new meeting) to `null` — otherwise `meeting?.id !==
  // prevMeetingId` compares undefined to null forever and the render-phase sync
  // below loops infinitely (new array identity from `?? ["mon"]` each pass).
  const meetingId = meeting?.id ?? null;
  const [prevMeetingId, setPrevMeetingId] = useState<string | null>(meetingId);
  if (meetingId !== prevMeetingId) {
    setPrevMeetingId(meetingId);
    setKind(meeting?.kind ?? "lecture");
    setLabel(meeting?.label ?? (meeting?.kind === "lab" ? "Lab 1" : "Lecture"));
    setSelectedDays(meeting?.days_of_week ?? ["mon"]);
    setStartTime(meeting?.start_time?.slice(0, 5) ?? "08:00");
    setEndTime(meeting?.end_time?.slice(0, 5) ?? "10:00");
    setCapacity(meeting?.capacity != null ? String(meeting.capacity) : "");
  }

  const handleKindChange = (newKind: "lecture" | "lab") => {
    setKind(newKind);
    if (!meeting) {
      if (newKind === "lecture" && (label === "Lab 1" || !label.trim())) {
        setLabel("Lecture");
      } else if (newKind === "lab" && (label === "Lecture" || !label.trim())) {
        setLabel("Lab 1");
      }
    }
  };

  const toggleDay = (dayCode: string) => {
    setSelectedDays((prev) =>
      prev.includes(dayCode) ? prev.filter((d) => d !== dayCode) : [...prev, dayCode],
    );
  };

  // Validation
  const trimmedLabel = label.trim();
  const startMins = parseTimeToMinutes(startTime);
  const endMins = parseTimeToMinutes(endTime);
  const isTimeOrderValid = startTime && endTime && endMins > startMins;
  const hasDays = selectedDays.length > 0;
  const isValid = trimmedLabel.length > 0 && hasDays && isTimeOrderValid;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!isValid || saving) return;

    setSaving(true);
    try {
      const parsedCapacity = capacity.trim() ? parseInt(capacity.trim(), 10) : null;
      await upsertCourseMeeting({
        ...(meeting?.id ? { id: meeting.id } : {}),
        course_id: courseId,
        kind,
        label: trimmedLabel,
        days_of_week: selectedDays,
        start_time: startTime,
        end_time: endTime,
        capacity: parsedCapacity && !isNaN(parsedCapacity) ? parsedCapacity : null,
      });

      toast.success(isEdit ? "Meeting slot updated." : "Meeting slot created.");
      onSuccess();
      onClose();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to save meeting schedule.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal open={open} onClose={onClose} title={isEdit ? "Edit meeting slot" : "Add meeting slot"}>
      <form onSubmit={handleSubmit} className="space-y-4">
        {/* Kind segmented control */}
        <div>
          <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Meeting type
          </label>
          <div className="grid grid-cols-2 gap-1 rounded-xl bg-muted p-1">
            <button
              type="button"
              onClick={() => handleKindChange("lecture")}
              className={cn(
                "rounded-lg py-1.5 text-xs font-semibold transition-colors",
                kind === "lecture"
                  ? "bg-card text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              Lecture
            </button>
            <button
              type="button"
              onClick={() => handleKindChange("lab")}
              className={cn(
                "rounded-lg py-1.5 text-xs font-semibold transition-colors",
                kind === "lab"
                  ? "bg-card text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              Laboratory
            </button>
          </div>
        </div>

        {/* Label */}
        <div>
          <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Label <span className="text-rose-500">*</span>
          </label>
          <input
            type="text"
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            placeholder={kind === "lecture" ? "Lecture" : "Lab 1"}
            required
            className="w-full rounded-xl border border-input bg-background/80 px-3 py-2 text-sm outline-none transition focus:ring-2 focus:ring-ring"
          />
        </div>

        {/* Days of week chips */}
        <div>
          <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Days of week <span className="text-rose-500">*</span>
          </label>
          <div className="flex flex-wrap gap-1.5">
            {DAYS.map((day) => {
              const active = selectedDays.includes(day.code);
              return (
                <button
                  key={day.code}
                  type="button"
                  onClick={() => toggleDay(day.code)}
                  className={cn(
                    "rounded-lg px-2.5 py-1 text-xs font-semibold transition-all",
                    active
                      ? "bg-primary text-primary-foreground shadow-sm"
                      : "border border-border bg-card/60 text-muted-foreground hover:bg-muted hover:text-foreground",
                  )}
                >
                  {day.label}
                </button>
              );
            })}
          </div>
          {!hasDays && (
            <p className="mt-1 text-xs text-rose-500">Please select at least one day.</p>
          )}
        </div>

        {/* Time inputs */}
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Start time <span className="text-rose-500">*</span>
            </label>
            <input
              type="time"
              value={startTime}
              onChange={(e) => setStartTime(e.target.value)}
              required
              className="w-full rounded-xl border border-input bg-background/80 px-3 py-2 text-sm outline-none transition focus:ring-2 focus:ring-ring"
            />
          </div>
          <div>
            <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              End time <span className="text-rose-500">*</span>
            </label>
            <input
              type="time"
              value={endTime}
              onChange={(e) => setEndTime(e.target.value)}
              required
              className="w-full rounded-xl border border-input bg-background/80 px-3 py-2 text-sm outline-none transition focus:ring-2 focus:ring-ring"
            />
          </div>
        </div>

        {/* Inline time order error */}
        {startTime && endTime && !isTimeOrderValid && (
          <div className="flex items-center gap-1.5 text-xs text-rose-600 dark:text-rose-400">
            <AlertCircle className="h-3.5 w-3.5 shrink-0" />
            <span>End time must be after start time.</span>
          </div>
        )}

        {/* Capacity */}
        <div>
          <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Capacity (optional)
          </label>
          <input
            type="number"
            min={1}
            max={500}
            value={capacity}
            onChange={(e) => setCapacity(e.target.value)}
            placeholder="e.g. 45 slots"
            className="w-full rounded-xl border border-input bg-background/80 px-3 py-2 text-sm outline-none transition focus:ring-2 focus:ring-ring"
          />
          <p className="mt-1 text-[11px] text-muted-foreground">
            Leave blank if there is no student seat limit for this session.
          </p>
        </div>

        {/* Actions */}
        <div className="mt-6 flex justify-end gap-2 pt-2">
          <button
            type="button"
            onClick={onClose}
            disabled={saving}
            className="rounded-xl border border-border px-4 py-2 text-xs font-semibold hover:bg-muted"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={!isValid || saving}
            className="rounded-xl bg-primary px-4 py-2 text-xs font-semibold text-primary-foreground hover:opacity-90 disabled:opacity-50"
          >
            {saving ? "Saving…" : isEdit ? "Update slot" : "Create slot"}
          </button>
        </div>
      </form>
    </Modal>
  );
}

interface AssignMembersModalProps {
  meeting: CourseMeeting | null;
  courseId: string;
  open: boolean;
  onClose: () => void;
  onSuccess: () => void;
}

function AssignMembersModal({
  meeting,
  courseId,
  open,
  onClose,
  onSuccess,
}: AssignMembersModalProps) {
  const qc = useQueryClient();
  const [search, setSearch] = useState("");
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [saving, setSaving] = useState(false);

  // Fetch enrolled students for course
  const { data: enrolledIds = [], isPending: enrollmentsLoading } = useQuery({
    queryKey: ["enrollments", courseId],
    queryFn: () => enrollmentsForCourse(courseId),
    enabled: open && !!courseId,
  });

  const { data: allStudents = [], isPending: studentsLoading } = useQuery({
    queryKey: ["students"],
    queryFn: listStudents,
    enabled: open,
  });

  // Current members of this meeting
  const { data: currentMembers = [], isPending: membersLoading } = useQuery({
    queryKey: ["meeting-members", meeting?.id],
    queryFn: () => (meeting?.id ? listMeetingMembers(meeting.id) : Promise.resolve([])),
    enabled: open && !!meeting?.id,
  });

  // Initialize selected IDs when current members are fetched
  const [loadedMeetingId, setLoadedMeetingId] = useState<string | null>(null);
  if (meeting?.id && meeting.id !== loadedMeetingId && !membersLoading) {
    setLoadedMeetingId(meeting.id);
    setSelectedIds(new Set(currentMembers));
  }

  // Course roster: students enrolled in this course
  const courseRoster = useMemo(() => {
    const enrolledSet = new Set(enrolledIds);
    return allStudents.filter((s) => enrolledSet.has(s.id));
  }, [allStudents, enrolledIds]);

  // Filtered by search query
  const filteredStudents = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return courseRoster;
    return courseRoster.filter(
      (s) =>
        s.full_name.toLowerCase().includes(q) ||
        (s.student_id ?? "").toLowerCase().includes(q) ||
        (s.section ?? "").toLowerCase().includes(q) ||
        (s.email ?? "").toLowerCase().includes(q),
    );
  }, [courseRoster, search]);

  const toggleStudent = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const allFilteredSelected =
    filteredStudents.length > 0 && filteredStudents.every((s) => selectedIds.has(s.id));

  const toggleSelectAllFiltered = () => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (allFilteredSelected) {
        filteredStudents.forEach((s) => next.delete(s.id));
      } else {
        filteredStudents.forEach((s) => next.add(s.id));
      }
      return next;
    });
  };

  const handleSave = async () => {
    if (!meeting) return;
    setSaving(true);
    try {
      await setMeetingMembers(meeting.id, Array.from(selectedIds));
      toast.success(
        `Assigned ${selectedIds.size} student${selectedIds.size !== 1 ? "s" : ""} to ${meeting.label}.`,
      );
      qc.invalidateQueries({ queryKey: ["meeting-members", meeting.id] });
      onSuccess();
      onClose();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to update meeting members.");
    } finally {
      setSaving(false);
    }
  };

  const isOverCapacity = meeting?.capacity != null && selectedIds.size > meeting.capacity;

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={meeting ? `Assign students · ${meeting.label}` : "Assign students"}
      wide
    >
      <div className="space-y-4">
        {/* Subtitle / capacity info */}
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border/50 pb-3 text-xs">
          <div className="text-muted-foreground">
            <span>Enrolled learners: </span>
            {studentsLoading || enrollmentsLoading ? (
              <span className="inline-block h-3.5 w-8 animate-pulse rounded bg-muted align-middle" />
            ) : (
              <span className="font-semibold text-foreground">{courseRoster.length}</span>
            )}
            {meeting?.capacity != null && (
              <>
                <span className="mx-2">·</span>
                <span>Room capacity: </span>
                <span className="font-semibold text-foreground">{meeting.capacity} slots</span>
              </>
            )}
          </div>
          <div
            className={cn(
              "font-medium",
              isOverCapacity ? "text-rose-600 dark:text-rose-400" : "text-primary",
            )}
          >
            {selectedIds.size} selected
            {meeting?.capacity != null && ` (${meeting.capacity} max)`}
          </div>
        </div>

        {isOverCapacity && (
          <div className="flex items-center gap-2 rounded-xl border border-rose-500/30 bg-rose-500/10 p-2.5 text-xs text-rose-600 dark:text-rose-400">
            <AlertCircle className="h-4 w-4 shrink-0" />
            <span>
              The number of selected students ({selectedIds.size}) exceeds the meeting capacity (
              {meeting?.capacity}).
            </span>
          </div>
        )}

        {/* Search bar & select-all toggle */}
        <div className="flex flex-wrap items-center justify-between gap-2">
          <label className="relative flex-1 min-w-[200px]">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search by name, student no., or section"
              className="h-9 w-full rounded-xl border border-input bg-background/80 pl-8 pr-3 text-xs outline-none focus:ring-2 focus:ring-ring"
            />
          </label>
          {filteredStudents.length > 0 && (
            <button
              type="button"
              onClick={toggleSelectAllFiltered}
              className="h-9 rounded-xl border border-border bg-card px-3 text-xs font-semibold hover:bg-muted"
            >
              {allFilteredSelected ? "Deselect filtered" : "Select all filtered"}
            </button>
          )}
        </div>

        {/* Student list */}
        <div className="max-h-72 overflow-y-auto rounded-xl border border-border/60 bg-muted/20 p-2">
          {studentsLoading || membersLoading ? (
            <div className="space-y-2 p-2">
              {[1, 2, 3, 4].map((i) => (
                <div key={i} className="h-10 animate-pulse rounded-lg bg-muted" />
              ))}
            </div>
          ) : courseRoster.length === 0 ? (
            <p className="p-6 text-center text-xs text-muted-foreground">
              No students are currently enrolled in this course. Enroll students from the Students
              tab first.
            </p>
          ) : filteredStudents.length === 0 ? (
            <p className="p-6 text-center text-xs text-muted-foreground">
              No enrolled students match your search.
            </p>
          ) : (
            <div className="grid gap-1.5 sm:grid-cols-2">
              {filteredStudents.map((s) => {
                const checked = selectedIds.has(s.id);
                return (
                  <label
                    key={s.id}
                    className={cn(
                      "flex cursor-pointer items-center gap-3 rounded-xl border p-2.5 transition-colors",
                      checked
                        ? "border-primary/40 bg-primary/5 text-foreground"
                        : "border-border/60 bg-card/60 text-muted-foreground hover:bg-muted/60",
                    )}
                  >
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() => toggleStudent(s.id)}
                      className="h-4 w-4 rounded border-input text-primary focus:ring-primary"
                    />
                    <UserAvatar name={s.full_name} src={s.avatar_url} className="h-7 w-7" />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-xs font-semibold text-foreground">
                        {s.full_name}
                      </p>
                      <p className="truncate text-[11px] text-muted-foreground">
                        {s.student_id ?? "—"}
                        {s.section ? ` · ${s.section}` : ""}
                      </p>
                    </div>
                  </label>
                );
              })}
            </div>
          )}
        </div>

        {/* Actions */}
        <div className="flex justify-end gap-2 pt-2">
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
            {saving ? "Saving…" : "Save assignments"}
          </button>
        </div>
      </div>
    </Modal>
  );
}

export function MeetingsPanel({ courseId }: { courseId: string }) {
  const qc = useQueryClient();
  const [formOpen, setFormOpen] = useState(false);
  const [editingMeeting, setEditingMeeting] = useState<CourseMeeting | null>(null);
  const [assignMeeting, setAssignMeeting] = useState<CourseMeeting | null>(null);
  const [deletingMeeting, setDeletingMeeting] = useState<CourseMeeting | null>(null);
  const [deleting, setDeleting] = useState(false);

  const { data: meetings = [], isPending } = useQuery({
    queryKey: ["course-meetings", courseId],
    queryFn: () => listCourseMeetings(courseId),
  });

  const handleOpenAdd = () => {
    setEditingMeeting(null);
    setFormOpen(true);
  };

  const handleOpenEdit = (m: CourseMeeting) => {
    setEditingMeeting(m);
    setFormOpen(true);
  };

  const handleDelete = async () => {
    if (!deletingMeeting) return;
    setDeleting(true);
    try {
      await deleteCourseMeeting(deletingMeeting.id);
      toast.success(`Removed meeting "${deletingMeeting.label}".`);
      qc.invalidateQueries({ queryKey: ["course-meetings", courseId] });
      setDeletingMeeting(null);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to remove meeting.");
    } finally {
      setDeleting(false);
    }
  };

  return (
    <Card className="p-5">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border/50 pb-4">
        <div>
          <div className="flex items-center gap-2">
            <Clock className="h-4 w-4 text-primary" />
            <h2 className="text-base font-bold">Meeting schedule</h2>
          </div>
          <p className="mt-0.5 text-xs text-muted-foreground">
            Configure lecture and lab timetable slots, set room capacity, and assign learners.
          </p>
        </div>
        <button
          type="button"
          onClick={handleOpenAdd}
          className="flex h-9 items-center gap-1.5 rounded-xl bg-primary px-3.5 text-xs font-semibold text-primary-foreground transition hover:opacity-90"
        >
          <Plus className="h-3.5 w-3.5" /> Add meeting slot
        </button>
      </div>

      {/* Content */}
      <div className="mt-4">
        {isPending ? (
          <div className="space-y-3">
            {[1, 2].map((i) => (
              <div key={i} className="h-20 animate-pulse rounded-xl bg-muted/60" />
            ))}
          </div>
        ) : meetings.length === 0 ? (
          <EmptyState
            icon={<Calendar className="h-8 w-8" />}
            title="No meetings yet"
            sub="No meetings yet — add a lecture or lab slot to get started."
          />
        ) : (
          <div className="grid gap-3">
            {meetings.map((meeting) => (
              <div
                key={meeting.id}
                className="flex flex-col justify-between gap-3 rounded-xl border border-border/70 bg-card/60 p-4 transition-all hover:border-border sm:flex-row sm:items-center"
              >
                {/* Left: Kind, Label, Time, Days */}
                <div className="min-w-0 space-y-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge tone={meeting.kind === "lab" ? "violet" : "indigo"}>
                      {meeting.kind === "lab" ? "Laboratory" : "Lecture"}
                    </Badge>
                    <span className="font-semibold text-sm text-foreground">{meeting.label}</span>
                    <span className="text-xs text-muted-foreground">
                      · {formatTimeRange(meeting.start_time, meeting.end_time)}
                    </span>
                  </div>

                  {/* Day chips */}
                  <div className="flex flex-wrap items-center gap-1">
                    {DAYS.map((d) => {
                      const isActive = meeting.days_of_week.includes(d.code);
                      if (!isActive) return null;
                      return (
                        <span
                          key={d.code}
                          className="rounded-md border border-border/60 bg-muted/70 px-2 py-0.5 text-[11px] font-semibold text-foreground"
                        >
                          {d.label}
                        </span>
                      );
                    })}
                  </div>
                </div>

                {/* Right: Capacity, Members badge & Actions */}
                <div className="flex flex-wrap items-center gap-3">
                  <div className="flex flex-col items-start gap-1 sm:items-end">
                    <MeetingMemberCountBadge meetingId={meeting.id} capacity={meeting.capacity} />
                    <span className="text-[11px] text-muted-foreground">
                      {meeting.capacity ? `${meeting.capacity} slots max` : "No capacity limit"}
                    </span>
                  </div>

                  <div className="flex items-center gap-1.5">
                    <button
                      type="button"
                      onClick={() => setAssignMeeting(meeting)}
                      className="flex h-8 items-center gap-1.5 rounded-lg border border-border bg-card px-2.5 text-xs font-semibold text-foreground hover:bg-muted"
                      title="Assign students to this meeting"
                    >
                      <Users className="h-3.5 w-3.5 text-primary" /> Assign students
                    </button>
                    <button
                      type="button"
                      onClick={() => handleOpenEdit(meeting)}
                      className="flex h-8 w-8 items-center justify-center rounded-lg border border-border text-muted-foreground transition hover:bg-muted hover:text-foreground"
                      title="Edit meeting"
                      aria-label={`Edit ${meeting.label}`}
                    >
                      <Pencil className="h-3.5 w-3.5" />
                    </button>
                    <button
                      type="button"
                      onClick={() => setDeletingMeeting(meeting)}
                      className="flex h-8 w-8 items-center justify-center rounded-lg border border-border text-muted-foreground transition hover:bg-rose-500/10 hover:text-rose-600 dark:hover:text-rose-400"
                      title="Delete meeting"
                      aria-label={`Delete ${meeting.label}`}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Add / Edit modal */}
      <MeetingFormModal
        courseId={courseId}
        meeting={editingMeeting}
        open={formOpen}
        onClose={() => setFormOpen(false)}
        onSuccess={() => qc.invalidateQueries({ queryKey: ["course-meetings", courseId] })}
      />

      {/* Assign members modal */}
      <AssignMembersModal
        meeting={assignMeeting}
        courseId={courseId}
        open={!!assignMeeting}
        onClose={() => setAssignMeeting(null)}
        onSuccess={() => qc.invalidateQueries({ queryKey: ["meeting-members", assignMeeting?.id] })}
      />

      {/* Confirm delete modal */}
      <Modal
        open={!!deletingMeeting}
        onClose={() => setDeletingMeeting(null)}
        title="Remove meeting slot"
      >
        <div className="space-y-4">
          <p className="text-xs text-muted-foreground">
            Are you sure you want to remove{" "}
            <span className="font-semibold text-foreground">{deletingMeeting?.label}</span>? This
            will unassign all students currently scheduled for this slot.
          </p>
          <div className="flex justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={() => setDeletingMeeting(null)}
              disabled={deleting}
              className="rounded-xl border border-border px-4 py-2 text-xs font-semibold hover:bg-muted"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleDelete}
              disabled={deleting}
              className="rounded-xl border border-rose-500/40 bg-rose-500/10 px-4 py-2 text-xs font-semibold text-rose-600 hover:bg-rose-500/20 disabled:opacity-50"
            >
              {deleting ? "Removing…" : "Remove slot"}
            </button>
          </div>
        </div>
      </Modal>
    </Card>
  );
}
