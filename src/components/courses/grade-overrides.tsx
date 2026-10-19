import * as React from "react";
import * as PopoverPrimitive from "@radix-ui/react-popover";
import { Flag, MoreVertical, Wand2, X } from "lucide-react";
import type { GradeOverrideFlag } from "@/lib/lms";
import { cn, sanitizeDecimal } from "@/lib/utils";
import { Modal } from "@/components/ui-elements";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

export type ColumnKey = "ww" | "pt" | "ex";

export interface CellState {
  ww: string;
  pt: string;
  ex: string;
}

export type StudentOverrides = Partial<Record<ColumnKey, GradeOverrideFlag | null>>;
export type OverridesState = Record<string, StudentOverrides>;

export const COLUMN_CONFIG: Record<ColumnKey, { short: string; label: string }> = {
  ww: { short: "WW", label: "Written Work" },
  pt: { short: "PT", label: "Performance Task" },
  ex: { short: "Exam", label: "Periodical Exam" },
};

/**
 * Summarizes active override flags for CSV/XLSX export.
 * Example outputs: "PT (Practical activity)", "WW, PT", "WW (Makeup), Exam"
 */
export function formatOverridesSummary(overrides?: StudentOverrides | null): string {
  if (!overrides) return "";
  const parts: string[] = [];
  const keys: ColumnKey[] = ["ww", "pt", "ex"];
  for (const k of keys) {
    const flag = overrides[k];
    if (flag) {
      const note = flag.note?.trim();
      const label = COLUMN_CONFIG[k].short;
      if (note) {
        parts.push(`${label} (${note})`);
      } else {
        parts.push(label);
      }
    }
  }
  return parts.join(", ");
}

/**
 * Extracts payload for upsertGrade. Only flagged columns are included;
 * returns `{}` if nothing is flagged.
 */
export function extractOverrideFlagsPayload(
  overrides?: StudentOverrides | null,
): Record<string, GradeOverrideFlag> {
  const flags: Record<string, GradeOverrideFlag> = {};
  if (!overrides) return flags;
  const keys: ColumnKey[] = ["ww", "pt", "ex"];
  for (const k of keys) {
    const flag = overrides[k];
    if (flag) {
      const trimmed = flag.note?.trim();
      flags[k] = {
        note: trimmed ? trimmed.slice(0, 500) : null,
        ...(flag.by ? { by: flag.by } : {}),
        ...(flag.at ? { at: flag.at } : {}),
      };
    }
  }
  return flags;
}

/**
 * Applies a bulk score and sets teacher override flags for visible students only.
 */
export function applyBulkColumnFill(
  currentCells: Record<string, CellState>,
  currentOverrides: OverridesState,
  visibleStudentIds: string[],
  column: ColumnKey,
  score: string,
  note?: string | null,
): { cells: Record<string, CellState>; overrides: OverridesState } {
  const sanitizedScore = sanitizeDecimal(score);
  const cleanNote = note?.trim() || "Bulk fill";
  const nextCells = { ...currentCells };
  const nextOverrides = { ...currentOverrides };

  for (const id of visibleStudentIds) {
    const studentCell = nextCells[id] ?? { ww: "", pt: "", ex: "" };
    nextCells[id] = {
      ...studentCell,
      [column]: sanitizedScore,
    };

    const studentOvr = nextOverrides[id] ?? {};
    nextOverrides[id] = {
      ...studentOvr,
      [column]: {
        note: cleanNote.slice(0, 500),
      },
    };
  }

  return { cells: nextCells, overrides: nextOverrides };
}

/**
 * Clears override flags for the specified column across visible students only (preserves scores).
 */
export function clearColumnOverridesForRoster(
  currentOverrides: OverridesState,
  visibleStudentIds: string[],
  column: ColumnKey,
): OverridesState {
  const nextOverrides = { ...currentOverrides };
  for (const id of visibleStudentIds) {
    const studentOvr = nextOverrides[id];
    if (studentOvr && studentOvr[column]) {
      const copy = { ...studentOvr };
      delete copy[column];
      nextOverrides[id] = copy;
    }
  }
  return nextOverrides;
}

/**
 * Per-cell override toggle button with popover note editor.
 */
export function OverrideFlagToggle({
  studentName,
  columnKey,
  override,
  onToggle,
  onUpdateNote,
}: {
  studentName: string;
  columnKey: ColumnKey;
  override?: GradeOverrideFlag | null;
  onToggle: () => void;
  onUpdateNote: (note: string) => void;
}) {
  const isOverridden = !!override;
  const colConfig = COLUMN_CONFIG[columnKey];
  const [open, setOpen] = React.useState(false);
  const [noteText, setNoteText] = React.useState(override?.note ?? "");

  React.useEffect(() => {
    setNoteText(override?.note ?? "");
  }, [override?.note, open]);

  const commitNote = () => {
    onUpdateNote(noteText);
  };

  return (
    <PopoverPrimitive.Root
      open={isOverridden && open}
      onOpenChange={(nextOpen) => {
        if (!nextOpen && isOverridden) {
          commitNote();
        }
        setOpen(nextOpen);
      }}
    >
      <PopoverPrimitive.Trigger asChild>
        <button
          type="button"
          onClick={(e) => {
            if (!isOverridden) {
              e.preventDefault();
              onToggle();
            } else {
              setOpen(true);
            }
          }}
          title={
            isOverridden
              ? override?.note
                ? `Overridden: ${override.note} (click to edit note or remove)`
                : "Overridden by teacher (click to edit note or remove)"
              : `Mark ${colConfig.short} as teacher override`
          }
          aria-label={
            isOverridden
              ? `Teacher override active for ${colConfig.label} score for ${studentName}${override?.note ? `: ${override.note}` : ""}. Click to edit note or remove.`
              : `Mark ${colConfig.label} score as override for ${studentName}`
          }
          className={cn(
            "relative inline-flex h-8 w-6 shrink-0 items-center justify-center rounded transition-colors focus:outline-none focus:ring-1 focus:ring-ring",
            isOverridden
              ? "text-amber-600 hover:text-amber-700 dark:text-amber-400 dark:hover:text-amber-300"
              : "text-muted-foreground/35 hover:text-muted-foreground",
          )}
        >
          <Flag
            className={cn(
              "h-3.5 w-3.5 transition-transform",
              isOverridden &&
                "fill-amber-500/30 text-amber-600 dark:fill-amber-400/30 dark:text-amber-400",
            )}
          />
          {isOverridden && (
            <span
              className="absolute -top-0.5 -right-0.5 h-1.5 w-1.5 rounded-full bg-amber-500 dark:bg-amber-400"
              aria-hidden="true"
            />
          )}
        </button>
      </PopoverPrimitive.Trigger>

      <PopoverPrimitive.Portal>
        <PopoverPrimitive.Content
          align="center"
          side="top"
          sideOffset={6}
          className="z-50 w-72 rounded-xl border border-border bg-popover p-3 text-popover-foreground shadow-lg outline-none data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95"
        >
          <div className="mb-2 flex items-center justify-between border-b border-border pb-1.5">
            <div className="flex items-center gap-1.5">
              <span className="h-2 w-2 rounded-full bg-amber-500" />
              <span className="text-xs font-semibold">
                {colConfig.short} Override · {studentName}
              </span>
            </div>
          </div>

          <div className="space-y-2">
            <div>
              <label className="mb-1 block text-[11px] font-medium text-muted-foreground">
                Reason / Note (optional, max 500 chars)
              </label>
              <input
                type="text"
                maxLength={500}
                autoFocus
                value={noteText}
                onChange={(e) => setNoteText(e.target.value.slice(0, 500))}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    commitNote();
                    setOpen(false);
                  }
                }}
                placeholder="e.g. Excused, makeup activity, medical..."
                aria-label={`Override note for ${colConfig.label}`}
                className="h-8 w-full rounded-lg border border-input bg-background px-2.5 text-xs outline-none focus:ring-1 focus:ring-ring"
              />
            </div>

            <div className="flex items-center justify-between pt-1">
              <button
                type="button"
                onClick={() => {
                  onToggle();
                  setOpen(false);
                }}
                className="text-xs font-medium text-destructive hover:underline"
              >
                Remove override
              </button>
              <button
                type="button"
                onClick={() => {
                  commitNote();
                  setOpen(false);
                }}
                className="h-7 rounded-lg bg-primary px-3 text-xs font-semibold text-primary-foreground hover:opacity-90"
              >
                Done
              </button>
            </div>
          </div>
        </PopoverPrimitive.Content>
      </PopoverPrimitive.Portal>
    </PopoverPrimitive.Root>
  );
}

/**
 * Dropdown menu embedded in column headers to trigger bulk fill or clear overrides.
 */
export function BulkColumnMenu({
  columnKey,
  columnTitle,
  visibleCount,
  onOpenFill,
  onClear,
  disabled,
}: {
  columnKey: ColumnKey;
  columnTitle: string;
  visibleCount: number;
  onOpenFill: () => void;
  onClear: () => void;
  disabled?: boolean;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          disabled={disabled || visibleCount === 0}
          aria-label={`Bulk actions for ${columnTitle} column (${visibleCount} visible students)`}
          title={`Bulk actions for ${columnTitle}`}
          className="inline-flex h-5 w-5 items-center justify-center rounded text-muted-foreground/60 transition-colors hover:bg-muted hover:text-foreground focus:outline-none focus:ring-1 focus:ring-ring disabled:opacity-30"
        >
          <MoreVertical className="h-3.5 w-3.5" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        <DropdownMenuItem onClick={onOpenFill} className="cursor-pointer text-xs">
          <Wand2 className="mr-2 h-3.5 w-3.5 text-primary" />
          Fill column ({visibleCount} visible {visibleCount === 1 ? "student" : "students"})…
        </DropdownMenuItem>
        <DropdownMenuItem
          onClick={onClear}
          className="cursor-pointer text-xs text-destructive focus:text-destructive"
        >
          <X className="mr-2 h-3.5 w-3.5" />
          Clear column overrides ({visibleCount} visible{" "}
          {visibleCount === 1 ? "student" : "students"})
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/**
 * Modal dialog for inputting score and note for bulk column fill.
 */
export function BulkFillModal({
  open,
  onClose,
  columnKey,
  columnTitle,
  visibleCount,
  activeSection,
  onApply,
}: {
  open: boolean;
  onClose: () => void;
  columnKey: ColumnKey | null;
  columnTitle: string;
  visibleCount: number;
  activeSection?: string;
  onApply: (score: string, note: string) => void;
}) {
  const [score, setScore] = React.useState("");
  const [note, setNote] = React.useState("");

  React.useEffect(() => {
    if (open) {
      setScore("");
      setNote("");
    }
  }, [open]);

  if (!open || !columnKey) return null;

  const numVal = Number(score.trim());
  const isValid = score.trim() !== "" && !isNaN(numVal) && numVal >= 0 && numVal <= 100;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!isValid) return;
    onApply(score, note);
    onClose();
  };

  return (
    <Modal open={open} onClose={onClose} title={`Fill ${columnTitle} Column`}>
      <form onSubmit={handleSubmit} className="space-y-4 pt-1">
        <p className="text-sm text-muted-foreground">
          Apply a uniform score to all <strong className="text-foreground">{visibleCount}</strong>{" "}
          currently visible {visibleCount === 1 ? "student" : "students"} and mark every cell as a
          teacher override.
        </p>

        {activeSection && activeSection !== "all" && (
          <div className="rounded-lg bg-amber-500/10 px-3 py-2 text-xs font-medium text-amber-700 dark:text-amber-300">
            Active section filter: <strong>{activeSection}</strong>. Students outside this section
            will not be affected.
          </div>
        )}

        <div className="space-y-1.5">
          <label className="block text-xs font-semibold text-foreground">
            Score (0–100) <span className="text-destructive">*</span>
          </label>
          <input
            type="number"
            min={0}
            max={100}
            step="any"
            required
            autoFocus
            value={score}
            onChange={(e) => setScore(sanitizeDecimal(e.target.value))}
            placeholder="e.g. 95"
            aria-label={`Bulk score for ${columnTitle}`}
            className="h-10 w-full rounded-xl border border-input bg-background px-3 text-sm outline-none focus:ring-2 focus:ring-ring"
          />
        </div>

        <div className="space-y-1.5">
          <label className="block text-xs font-semibold text-foreground">
            Reason / Note (optional, max 500 chars)
          </label>
          <input
            type="text"
            maxLength={500}
            value={note}
            onChange={(e) => setNote(e.target.value.slice(0, 500))}
            placeholder="e.g. Practical activity (defaults to 'Bulk fill')"
            aria-label="Bulk override note"
            className="h-10 w-full rounded-xl border border-input bg-background px-3 text-sm outline-none focus:ring-2 focus:ring-ring"
          />
        </div>

        <div className="flex items-center justify-end gap-2 pt-2">
          <button
            type="button"
            onClick={onClose}
            className="h-10 rounded-xl border border-border px-4 text-sm font-semibold hover:bg-muted"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={!isValid}
            className="h-10 rounded-xl bg-primary px-5 text-sm font-semibold text-primary-foreground hover:opacity-90 disabled:opacity-50"
          >
            Apply to {visibleCount} visible {visibleCount === 1 ? "student" : "students"}
          </button>
        </div>
      </form>
    </Modal>
  );
}
