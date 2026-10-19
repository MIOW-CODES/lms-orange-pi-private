import * as React from "react";
import { Check, ChevronDown, Plus, Search } from "lucide-react";
import { cn } from "@/lib/utils";

export interface CreatableSelectProps {
  value: string;
  onChange: (value: string) => void;
  options: string[];
  placeholder?: string;
  searchPlaceholder?: string;
  createPlaceholder?: string;
  emptyText?: string;
  label?: string;
  className?: string;
  disabled?: boolean;
}

/**
 * Responsive creatable combobox / select dropdown.
 * - Displays a curated list of existing options (e.g. Sections or Departments)
 * - Has an inline quick-filter search
 * - Lets users easily select an existing option or click "+ Add [item]" / press Enter to create one on-the-fly
 * - Mobile & desktop friendly, closes on outside click and Escape
 */
export function CreatableSelect({
  value,
  onChange,
  options,
  placeholder = "Select or create...",
  searchPlaceholder = "Search or type new...",
  createPlaceholder = "Add",
  emptyText = "No matches found.",
  label,
  className,
  disabled = false,
}: CreatableSelectProps) {
  const [open, setOpen] = React.useState(false);
  const [search, setSearch] = React.useState("");
  const [activeIndex, setActiveIndex] = React.useState(0);
  const listboxId = React.useId();
  const containerRef = React.useRef<HTMLDivElement>(null);
  const inputRef = React.useRef<HTMLInputElement>(null);
  const listRef = React.useRef<HTMLDivElement>(null);

  // Close dropdown on outside click
  React.useEffect(() => {
    if (!open) return;
    const handleClickOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [open]);

  // Focus the search input after the popover has mounted. requestAnimationFrame
  // reliably runs after the browser paints the newly-rendered input, avoiding a
  // brittle timeout and keeping focus consistent across browsers.
  React.useEffect(() => {
    if (!open) return;
    setSearch("");
    const raf = requestAnimationFrame(() => inputRef.current?.focus());
    return () => cancelAnimationFrame(raf);
  }, [open]);

  // Unique sorted list of options
  const uniqueOptions = React.useMemo(() => {
    const set = new Set(options.map((o) => o?.trim()).filter(Boolean));
    if (value && value.trim()) set.add(value.trim());
    return Array.from(set).sort((a, b) => a.localeCompare(b));
  }, [options, value]);

  const filteredOptions = React.useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return uniqueOptions;
    return uniqueOptions.filter((o) => o.toLowerCase().includes(q));
  }, [uniqueOptions, search]);

  const trimmedSearch = search.trim();
  const exactMatchExists = React.useMemo(() => {
    if (!trimmedSearch) return false;
    return uniqueOptions.some((o) => o.toLowerCase() === trimmedSearch.toLowerCase());
  }, [uniqueOptions, trimmedSearch]);

  // Keep the highlighted option in range as the filtered list changes.
  React.useEffect(() => {
    setActiveIndex((i) => Math.min(i, Math.max(filteredOptions.length - 1, 0)));
  }, [filteredOptions.length]);

  // Keep the highlighted option scrolled into view during keyboard navigation.
  React.useEffect(() => {
    if (!open) return;
    const el = listRef.current?.querySelector<HTMLElement>('[data-active="true"]');
    el?.scrollIntoView({ block: "nearest" });
  }, [activeIndex, open]);

  const handleSelect = (val: string) => {
    onChange(val);
    setOpen(false);
  };

  const handleCreate = () => {
    if (!trimmedSearch) return;
    onChange(trimmedSearch);
    setOpen(false);
  };

  const onInputKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActiveIndex((i) => Math.min(i + 1, Math.max(filteredOptions.length - 1, 0)));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActiveIndex((i) => Math.max(i - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (!exactMatchExists && trimmedSearch) {
        handleCreate();
      } else if (filteredOptions[activeIndex]) {
        handleSelect(filteredOptions[activeIndex]!);
      } else if (filteredOptions.length > 0) {
        handleSelect(filteredOptions[0]!);
      }
    }
  };

  return (
    <div ref={containerRef} className={cn("relative w-full", className)}>
      <button
        type="button"
        disabled={disabled}
        onClick={() => setOpen((prev) => !prev)}
        aria-label={label || placeholder}
        aria-expanded={open}
        className={cn(
          "flex h-11 w-full items-center justify-between rounded-xl border border-input bg-background px-3 text-sm text-left shadow-sm outline-none transition focus:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50",
          !value && "text-muted-foreground",
        )}
      >
        <span className="truncate">{value || placeholder}</span>
        <ChevronDown
          className={cn(
            "ml-2 h-4 w-4 shrink-0 opacity-50 transition-transform",
            open && "rotate-180",
          )}
        />
      </button>

      {open && (
        <div className="absolute left-0 top-[calc(100%+4px)] z-50 w-full min-w-[200px] overflow-hidden rounded-xl border border-border bg-popover text-popover-foreground shadow-lift animate-in fade-in-0 zoom-in-95">
          <div className="p-2 border-b border-border/60">
            <div className="relative flex items-center">
              <Search className="pointer-events-none absolute left-2.5 h-3.5 w-3.5 text-muted-foreground" />
              <input
                ref={inputRef}
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                onKeyDown={onInputKeyDown}
                role="combobox"
                aria-autocomplete="list"
                aria-expanded={open}
                aria-controls={listboxId}
                aria-activedescendant={
                  filteredOptions[activeIndex] ? `${listboxId}-opt-${activeIndex}` : undefined
                }
                placeholder={searchPlaceholder}
                className="h-8 w-full rounded-lg border border-input bg-background pl-8 pr-2 text-xs outline-none focus:ring-1 focus:ring-ring"
              />
            </div>
          </div>

          <div
            ref={listRef}
            id={listboxId}
            role="listbox"
            aria-label={label || placeholder}
            className="max-h-56 overflow-y-auto p-1 text-sm custom-scrollbar"
          >
            {trimmedSearch && !exactMatchExists && (
              <button
                type="button"
                onClick={handleCreate}
                className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-xs font-semibold text-primary hover:bg-primary/10 transition"
              >
                <Plus className="h-3.5 w-3.5 shrink-0" />
                <span className="truncate">
                  {createPlaceholder} "{trimmedSearch}"
                </span>
              </button>
            )}

            {filteredOptions.length === 0 && !trimmedSearch ? (
              <div className="py-4 text-center text-xs text-muted-foreground">{emptyText}</div>
            ) : null}

            {filteredOptions.length === 0 && trimmedSearch && exactMatchExists ? (
              <div className="py-4 text-center text-xs text-muted-foreground">{emptyText}</div>
            ) : null}

            {filteredOptions.map((opt, idx) => {
              const selected = opt === value;
              const active = idx === activeIndex;
              return (
                <button
                  key={opt}
                  id={`${listboxId}-opt-${idx}`}
                  type="button"
                  role="option"
                  aria-selected={selected}
                  data-active={active}
                  onMouseEnter={() => setActiveIndex(idx)}
                  onClick={() => handleSelect(opt)}
                  className={cn(
                    "flex w-full items-center justify-between rounded-lg px-2.5 py-2 text-left text-xs transition",
                    selected
                      ? "bg-accent font-semibold text-accent-foreground"
                      : active
                        ? "bg-muted text-foreground"
                        : "hover:bg-muted text-foreground",
                  )}
                >
                  <span className="truncate">{opt}</span>
                  {selected && <Check className="ml-2 h-3.5 w-3.5 shrink-0 text-primary" />}
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
