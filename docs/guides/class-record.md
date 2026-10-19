# Recording and publishing class grades

Open **Gradebook → Class Record**, select the course and quarter/college period, then set its start and end dates. The class record also appears inside a course workspace. Administrators can view records; only the course teacher can save or publish them.

## Set up the assessment columns

Use **Load LMS assessments** to create initial mappings: worksheets become Written Works, assignments become Performance Tasks, and worksheets with “exam” in their title become Examination. Review every mapping before publishing: loading assessments does not infer which period they belong to. Add individual LMS assessments with the source/category selectors, or choose **Manual / offline assessment** and enter the title and maximum score. Use Q1, Q2, … and PT1, PT2, … for paper-based assessments.

The four weights are fixed: Attendance 10%, Written Works 20%, Quarterly Examination 30%, Performance Tasks 40%. A category uses total earned points divided by total possible points. For example, 10/10 and 20/40 become 30/50 = 60%, rather than averaging the two percentages. Linked scores with different attempt denominators are normalized to the column maximum. IT10 always keeps the highest retake percentage; all attempts remain available for inspection. An explicit teacher override still takes precedence.

Enter a reason before overriding an LMS score or entering a manual attendance percentage. Clear an overridden score to restore its automatic value. Teacher changes are stamped with the account and save time on the server.

## Class attendance

Choose **Record class attendance** and add held class sessions within the period. Mark each learner present, late, excused or absent. Present and excused count 100%, late 85%, and absent 0%. Cancelled sessions do not count. Unmarked attendance remains incomplete; gate scans are not silently treated as class attendance or absences. You can instead enter a verified attendance percentage with an override reason.

## Drafts and publication

**Save draft** stores work without changing student grades. Blank assessment scores stay incomplete; enter an explicit zero for missed work. Every category and Attendance must be complete for a selected student before publishing. Missing scores appear in the final column.

Select the students to publish and choose **Publish selected**. Publication is atomic: if any selected student is incomplete, the whole request fails and existing published grades stay unchanged. Published attendance and calculations are snapshots, so later gate scans, retakes and draft edits do not silently change the report card. Republish when the revised record is ready. A record changed in another window must be reloaded before saving; export unsaved work first if necessary.

High school uses the existing DepEd transmutation. College uses the reference workbook’s 1.00–5.00 equivalents and remarks, applied to the same 10/20/30/40 weighted percentage. College averages are displayed separately from high school averages. Existing grades are preserved until explicitly republished. Records already published from Class Record must be revised there, rather than through the legacy category-summary form.

## Import, export and print

Download **Blank template** after setting up columns. Fill in raw scores without changing maxima, then choose **Import scores**. Select the worksheet and preview the import. The importer matches student IDs first, otherwise exact normalized names from the enrolled roster. Ambiguous/unmatched names are skipped, duplicate students and invalid points block application. Confirm replacement of matched nonblank values, apply to the draft, inspect, save and publish.

The supplied IAE106 workbook’s first sheet is supported as a grouped raw-score reference. Its old weights, percentage totals and final grades are not imported. Other sheets can be selected explicitly. Attendance absent from a spreadsheet must still be entered. Import never enrolls students or publishes grades.

CSV and Excel exports include assessment maxima, category totals, weighted contributions, completeness and grade equivalents. **Print** opens a landscape record without the application sidebar. Exports and printouts reflect the currently displayed draft and filters; incomplete totals are provisional.

## Reviewing grading reports

Open the affected worksheet’s attempt roster and inspect the student’s saved answers. **Review this answer** changes one correctness decision with a mandatory reason and preserves the response, integrity deduction and review history. **Preview identification corrections** lists previously uncredited answers that match the current question’s verified aliases; approve individual corrections. Existing question reviews are excluded from automatic proposals. Total-score overrides remain authoritative.

Identification accepts case, whitespace, Unicode compatibility formatting, harmless trailing punctuation, and explicit question-specific aliases. Ambiguous semantic answers need teacher judgment; arbitrary substrings and guesses do not receive credit. The resistor-explanation regression now accepts the verb “gives” while still rejecting bare keyword lists.

An Enter key in either the worksheet answer or Arduino code editor adds a newline. Worksheet controls cannot implicitly submit a surrounding form. Arduino code and wiring are retained in session storage per student, worksheet and question; worksheet answers, sampled questions and the submission idempotency key survive reloads. PWA activation/reloads wait until assessment mode ends. Intentional timeouts and real integrity violations retain their existing submission behavior.

## Deployment and recovery

Apply migrations `20261019140001` through `20261019140004` before deploying the application. The first introduces class-record drafts, published snapshots and IT10 policy enforcement; the second adds audited question corrections; the third adds verified light-intensity aliases; the fourth deduplicates recovery grants across maintenance retries. Both database backends use the same RPC transactions. New tables and mutation RPCs are unavailable to anonymous/authenticated database clients.

Back up affected attempts, overrides, retake grants, reports and published grades before production corrections. Preview answer corrections, apply only verified cases, and record before/after scores and reasons. Do not republish course grades as part of a report repair. For uncertain academic decisions, retain **In review** with a precise teacher action. An additional attempt grant does not reopen an assessment after its closing time; the teacher must schedule a recovery window.

To roll back the application, redeploy the preceding versioned image with the Docker Compose procedure in the Orange Pi deployment plan. Keep additive tables and original attempt history. Corrected questions have an append-only review trail and can be reviewed again with a reason; restore a backed-up published grade only after checking for intervening teacher changes.
