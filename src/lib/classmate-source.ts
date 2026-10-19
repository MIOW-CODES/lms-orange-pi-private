/** One uploaded ClassMate source file, with its extracted text. */
export interface SourceFile {
  name: string;
  size: number;
  text: string;
}

/**
 * Total character budget for the source material that is sent to ClassMate.
 *
 * This is intentionally a single, shared constant so the client, the API route,
 * and the system-prompt builder all agree. Previously each layer sliced at an
 * independent 15,000 chars, which silently dropped whole files (the model would
 * report "you mentioned 4 files but I only received 3"). We now distribute the
 * budget across every file so none is ever dropped entirely.
 */
export const SOURCE_MATERIAL_MAX_CHARS = 60_000;

/** Per-file outcome after budgeting. */
export interface SourceMaterialFileInfo {
  name: string;
  /** Full extracted length, before budgeting. */
  chars: number;
  /** Characters actually included in the payload. */
  includedChars: number;
  truncated: boolean;
}

export interface BuiltSourceMaterial {
  text: string;
  files: SourceMaterialFileInfo[];
  totalChars: number;
  /** True when at least one file was shortened to fit the budget. */
  truncated: boolean;
}

/** Marker appended to a file whose content was shortened to fit the budget. */
function truncationMarker(dropped: number): string {
  return `\n…[truncated ${dropped} chars]`;
}

/**
 * Combine every uploaded source file into one labelled context block for the
 * ClassMate assistant, guaranteeing that EVERY non-empty file is represented.
 *
 * A single file is passed through verbatim when it fits the budget. With
 * multiple files the remaining budget (after headers/separators) is split
 * evenly, so the model always sees one header per uploaded file and can count
 * them correctly. Files that exceed their share are marked `[truncated N chars]`
 * rather than being dropped.
 *
 * Empty files (failed/blank extraction) are excluded here and reported by the
 * caller, so the manifest count always matches what the model actually receives.
 */
export function buildSourceMaterial(
  files: SourceFile[],
  budget: number = SOURCE_MATERIAL_MAX_CHARS,
): BuiltSourceMaterial {
  const usable = files.filter((f) => f.text && f.text.trim().length > 0);
  if (usable.length === 0) {
    return { text: "", files: [], totalChars: 0, truncated: false };
  }

  if (usable.length === 1) {
    const f = usable[0]!;
    const full = f.text.trim();
    if (full.length <= budget) {
      return {
        text: full,
        files: [{ name: f.name, chars: full.length, includedChars: full.length, truncated: false }],
        totalChars: full.length,
        truncated: false,
      };
    }
    const keep = Math.max(0, budget - 40);
    const body = full.slice(0, keep) + truncationMarker(full.length - keep);
    return {
      text: body,
      files: [{ name: f.name, chars: full.length, includedChars: body.length, truncated: true }],
      totalChars: body.length,
      truncated: true,
    };
  }

  const headers = usable.map((f, i) => `--- SOURCE MATERIAL ${i + 1}: ${f.name} ---`);
  const headerChars = headers.reduce((n, h) => n + h.length + 1, 0); // +1 for the newline after each
  const separators = (usable.length - 1) * 2; // files joined by "\n\n"
  const perFile = Math.max(0, Math.floor((budget - headerChars - separators) / usable.length));

  const infos: SourceMaterialFileInfo[] = [];
  let truncatedAny = false;
  const parts = usable.map((f, i) => {
    const full = f.text.trim();
    let body = full;
    let truncated = false;
    if (full.length > perFile) {
      const keep = Math.max(0, perFile - 40);
      body = full.slice(0, keep) + truncationMarker(full.length - keep);
      truncated = true;
      truncatedAny = true;
    }
    infos.push({ name: f.name, chars: full.length, includedChars: body.length, truncated });
    return `${headers[i]!}\n${body}`;
  });

  const text = parts.join("\n\n");
  return { text, files: infos, totalChars: text.length, truncated: truncatedAny };
}

/**
 * Combine every uploaded source file into one labelled context block for the
 * ClassMate assistant. A single file is passed through verbatim; multiple files
 * are delimited so the model can tell them apart.
 *
 * NOTE: this is the *display* aggregation (used for the worksheet textarea and
 * previews) and is intentionally unbounded. For the model payload always use
 * {@link buildSourceMaterial}, which budgets across all files.
 */
export function aggregateSourceMaterial(files: SourceFile[]): string {
  if (files.length === 0) return "";
  if (files.length === 1) return files[0]!.text;
  return files
    .map((f, i) => `--- SOURCE MATERIAL ${i + 1}: ${f.name} ---\n${f.text.trim()}`)
    .join("\n\n");
}
