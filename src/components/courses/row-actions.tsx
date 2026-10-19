import * as React from "react";
import { MoreHorizontal } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

export interface RowAction {
  label: string;
  icon?: React.ReactNode;
  onSelect: () => void;
  /** Rendered in red, separated from the rest (e.g. Delete). */
  destructive?: boolean;
  ariaLabel?: string;
}

/**
 * Compact overflow ("kebab") menu for list rows. Keeps the primary action inline
 * and folds secondary/destructive actions into one menu so cards stay uncluttered.
 */
export function RowActionsMenu({
  actions,
  label = "More actions",
}: {
  actions: RowAction[];
  label?: string;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          aria-label={label}
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-border text-muted-foreground transition hover:bg-muted hover:text-foreground"
        >
          <MoreHorizontal className="h-4 w-4" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        {actions.map((action, i) => (
          <React.Fragment key={action.label}>
            {/* One separator before the destructive group, wherever it starts. */}
            {action.destructive && i > 0 && !actions[i - 1]?.destructive && (
              <DropdownMenuSeparator />
            )}
            <DropdownMenuItem
              onSelect={(e) => {
                e.preventDefault();
                action.onSelect();
              }}
              aria-label={action.ariaLabel ?? action.label}
              className={
                action.destructive
                  ? "text-rose-600 focus:text-rose-600 dark:text-rose-400"
                  : undefined
              }
            >
              {action.icon}
              {action.label}
            </DropdownMenuItem>
          </React.Fragment>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
