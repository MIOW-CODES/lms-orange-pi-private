import {
  calculateRecord,
  indexRecordSources,
  type RecordDraft,
  type RecordSource,
} from "../src/lib/class-record";

const studentCount = 1_000;
const columnCount = 200;
const makeId = (value: number) => `00000000-0000-4000-8000-${String(value).padStart(12, "0")}`;
const studentIds = Array.from({ length: studentCount }, (_, index) => makeId(index + 1));
const categories = ["ww", "ex", "pt"] as const;
const columns = Array.from({ length: columnCount }, (_, index) => {
  const id = makeId(10_001 + index);
  return {
    id,
    title: `Synthetic assessment ${index + 1}`,
    category: categories[index % categories.length]!,
    maximum: 100,
    source: { kind: "quiz" as const, id },
  };
});
const sources: RecordSource[] = columns.map((column) => ({
  id: column.id,
  kind: "quiz",
  title: column.title,
  maximum: column.maximum,
  scores: Object.fromEntries(studentIds.map((studentId) => [studentId, { score: 75, total: 100 }])),
}));
const draft: RecordDraft = {
  start: "",
  end: "",
  columns,
  scores: {},
  attendance: Object.fromEntries(studentIds.map((studentId) => [studentId, { value: 100 }])),
  sessions: [],
};
const sourceIndex = indexRecordSources(sources);

let complete = 0;
const started = performance.now();
for (const studentId of studentIds) {
  if (calculateRecord(draft, sources, studentId, "deped", sourceIndex).complete) complete++;
}
const elapsedMs = performance.now() - started;

if (complete !== studentCount) {
  throw new Error(`Expected ${studentCount} complete records, got ${complete}.`);
}

console.log(
  JSON.stringify({
    platform: `${process.platform}-${process.arch}`,
    studentCount,
    columnCount,
    sourceCount: sources.length,
    complete,
    elapsedMs: Number(elapsedMs.toFixed(1)),
  }),
);
