import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  type Course,
  type Attachment,
  COMPONENT_LABELS,
  createAssignment,
  uploadCourseMaterial,
} from "@/lib/lms";
import { Modal } from "@/components/lms";
import { PendingDropzone } from "@/components/courses/pending-dropzone";

interface CreateAssignmentModalProps {
  open: boolean;
  onClose: () => void;
  courses: Course[];
  /** Pre-select this course when the modal opens (course-scoped creation). */
  defaultCourseId?: string;
  onSaved: () => void;
}

export function CreateAssignmentModal({
  open,
  onClose,
  courses,
  defaultCourseId,
  onSaved,
}: CreateAssignmentModalProps) {
  const qc = useQueryClient();
  const [saving, setSaving] = useState(false);
  const [assignForm, setAssignForm] = useState({
    course_id: "",
    title: "",
    description: "",
    opens_at: "",
    due_date: "",
    total_points: "100",
    component_type: "written_work" as const,
  });
  const [assignFiles, setAssignFiles] = useState<File[]>([]);
  const [assignUploadPct, setAssignUploadPct] = useState(0);

  // When opened from inside a course, scope the new assignment to that course.
  useEffect(() => {
    if (!open || !defaultCourseId) return;
    setAssignForm((f) => ({ ...f, course_id: defaultCourseId }));
  }, [open, defaultCourseId]);

  const saveAssignment = async () => {
    if (!assignForm.course_id || !assignForm.title) {
      toast.error("Course and title are required.");
      return;
    }
    setSaving(true);
    setAssignUploadPct(0);
    try {
      const attachments: Attachment[] = [];
      for (let i = 0; i < assignFiles.length; i++) {
        try {
          attachments.push(await uploadCourseMaterial(assignForm.course_id, assignFiles[i]!));
        } catch (e) {
          toast.error(
            `Failed to upload ${assignFiles[i]!.name}: ${e instanceof Error ? e.message : "Upload error"}`,
          );
          setSaving(false);
          setAssignUploadPct(0);
          return;
        }
        setAssignUploadPct(Math.round(((i + 1) / assignFiles.length) * 100));
      }
      await createAssignment({
        course_id: assignForm.course_id,
        title: assignForm.title,
        description: assignForm.description || null,
        opens_at: assignForm.opens_at ? new Date(assignForm.opens_at).toISOString() : null,
        due_date: assignForm.due_date ? new Date(assignForm.due_date).toISOString() : null,
        total_points: parseInt(assignForm.total_points) || 100,
        component_type: assignForm.component_type,
        ...(attachments.length ? { attachments } : {}),
      });
      toast.success("Assignment posted.");
      onSaved();
      setAssignForm({
        course_id: "",
        title: "",
        description: "",
        opens_at: "",
        due_date: "",
        total_points: "100",
        component_type: "written_work",
      });
      setAssignFiles([]);
      onClose();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not post assignment.");
    } finally {
      setSaving(false);
      setAssignUploadPct(0);
    }
  };

  return (
    <Modal open={open} onClose={onClose} title="Post assignment">
      <div className="grid gap-3">
        <select
          value={assignForm.course_id}
          onChange={(e) => setAssignForm((f) => ({ ...f, course_id: e.target.value }))}
          className="h-11 rounded-xl border border-input bg-background px-3 text-sm outline-none focus:ring-2 focus:ring-ring"
        >
          <option value="">Select course *</option>
          {courses.map((c) => (
            <option key={c.id} value={c.id}>
              {c.code} — {c.title}
            </option>
          ))}
        </select>
        <input
          value={assignForm.title}
          onChange={(e) => setAssignForm((f) => ({ ...f, title: e.target.value }))}
          placeholder="Title *"
          className="h-11 rounded-xl border border-input bg-background px-3 text-sm outline-none focus:ring-2 focus:ring-ring"
        />
        <textarea
          value={assignForm.description}
          onChange={(e) => setAssignForm((f) => ({ ...f, description: e.target.value }))}
          placeholder="Instructions"
          rows={3}
          className="rounded-xl border border-input bg-background p-3 text-sm outline-none focus:ring-2 focus:ring-ring"
        />
        <PendingDropzone
          files={assignFiles}
          onChange={setAssignFiles}
          progress={assignUploadPct}
          busy={saving}
        />
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="flex flex-col gap-1 text-xs font-medium text-muted-foreground">
            <span>Opens at (Availability date/time)</span>
            <input
              type="datetime-local"
              value={assignForm.opens_at}
              onChange={(e) => setAssignForm((f) => ({ ...f, opens_at: e.target.value }))}
              aria-label="Assignment opens at"
              className="h-10 rounded-xl border border-input bg-background px-3 text-sm text-foreground outline-none focus:ring-2 focus:ring-ring"
            />
          </label>
          <label className="flex flex-col gap-1 text-xs font-medium text-muted-foreground">
            <span>Due date (Deadline / Hard lock)</span>
            <input
              type="datetime-local"
              value={assignForm.due_date}
              onChange={(e) => setAssignForm((f) => ({ ...f, due_date: e.target.value }))}
              aria-label="Assignment due date"
              className="h-10 rounded-xl border border-input bg-background px-3 text-sm text-foreground outline-none focus:ring-2 focus:ring-ring"
            />
          </label>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <input
            value={assignForm.total_points}
            onChange={(e) => setAssignForm((f) => ({ ...f, total_points: e.target.value }))}
            placeholder="Points"
            inputMode="numeric"
            className="h-11 rounded-xl border border-input bg-background px-3 text-sm outline-none focus:ring-2 focus:ring-ring"
          />
          <select
            value={assignForm.component_type}
            onChange={(e) =>
              setAssignForm((f) => ({
                ...f,
                component_type: e.target.value as typeof f.component_type,
              }))
            }
            className="h-11 rounded-xl border border-input bg-background px-3 text-sm outline-none focus:ring-2 focus:ring-ring"
          >
            {Object.entries(COMPONENT_LABELS).map(([v, l]) => (
              <option key={v} value={v}>
                {l}
              </option>
            ))}
          </select>
        </div>
      </div>
      <button
        onClick={saveAssignment}
        disabled={saving}
        className="mt-4 h-11 w-full rounded-xl bg-primary text-sm font-semibold text-primary-foreground hover:opacity-90 disabled:opacity-50"
      >
        {saving ? "Posting…" : "Post assignment"}
      </button>
    </Modal>
  );
}
