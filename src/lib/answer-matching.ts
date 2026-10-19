/** Conservative identification matching. Academic aliases remain question-specific. */
export function normalizeIdentification(value: string) {
  return value
    .normalize("NFKC")
    .trim()
    .toLowerCase()
    .replace(/[“”]/g, '"')
    .replace(/[‘’]/g, "'")
    .replace(/\s+/g, " ")
    .replace(/[.,;:!?]+$/, "");
}
export function matchesIdentification(answer: string, key: string) {
  const value = normalizeIdentification(answer);
  if (!value) return false;
  return key.split("||").some((alias) => normalizeIdentification(alias) === value);
}
/** MCQ option labels retain their text and punctuation meaning. */
export function matchesOption(answer: string, key: string) {
  const norm = (s: string) => s.trim().toLowerCase().replace(/\s+/g, " ");
  return norm(answer) === norm(key);
}
