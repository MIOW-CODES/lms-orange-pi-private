// Server-side seeding for IAE 106: Fundamentals of Electronics Technology
// Course Code: IAE 106
// Level: College 2nd Year BTLED
// Meetings:
//   - Friday 3:00-5:00 PM Lecture
//   - Monday 3:00-6:00 PM Lab 1
//   - Wednesday 3:00-6:00 PM Lab 2
// Quizzes:
//   - Quiz 1: Resistor Reading
//   - Quiz 2: Resistor connected in series, parallel and series parallel
//   - Quiz 3: Multi tester reading

import { db } from "@/integrations/db/client.server";

export interface SeedIae106Result {
  courseId: string;
  courseTitle: string;
  courseCode: string;
  meetingsCreated: number;
  quizzesCreated: number;
  questionsCreated: number;
  enrollmentsAdded: number;
}

export function isIae106Cohort(profile: { grade_level: number | null; section: string | null }) {
  const section = (profile.section ?? "").trim().toUpperCase();
  return profile.grade_level === 14 || section.startsWith("BTLED") || section === "B8";
}

export async function seedIae106CourseAndQuizzes(): Promise<SeedIae106Result> {
  // 1. Locate or select teacher (Dr. Alan L. Vergara or any teacher/admin)
  const { data: teacherData } = await db
    .from("profiles")
    .select("id")
    .in("role", ["teacher", "admin"])
    .order("role", { ascending: false })
    .limit(1);

  const teacherRows = (teacherData as Array<{ id: string }> | null) ?? [];
  const teacherId =
    teacherRows.length > 0 ? teacherRows[0]!.id : "b0000000-0000-4000-8000-000000000003";

  // 2. Check if course IAE 106 already exists
  const { data: existingCourseData } = await db
    .from("courses")
    .select("id, title, code")
    .in("code", ["IAE 106", "IAE106"])
    .maybeSingle();

  let courseId = existingCourseData ? (existingCourseData as { id: string }).id : null;

  const coursePayload = {
    title: "Fundamentals of Electronics Technology",
    code: "IAE 106",
    grade_level: 14, // College 2nd Year
    education_level: "college",
    college_year: 2,
    program: "BTLED",
    color: "amber",
    grading_system: "college_semestral",
    teacher_id: teacherId,
    days_of_week: ["fri"],
    start_time: "15:00:00",
    end_time: "17:00:00",
  };

  if (!courseId) {
    const { data: insertedCourse, error: insertCourseErr } = await db
      .from("courses")
      .insert(coursePayload)
      .select("id")
      .single();

    if (insertCourseErr || !insertedCourse) {
      throw new Error(`Failed to insert course IAE 106: ${insertCourseErr?.message}`);
    }
    courseId = (insertedCourse as { id: string }).id;
  } else {
    // Update existing course metadata to ensure proper values
    await db.from("courses").update(coursePayload).eq("id", courseId);
  }

  // 3. Upsert Course Meetings
  // Friday 3:00-5:00 Lecture, Monday 3-6 pm Lab1, Wednesday 3-6 pm Lab2
  const meetingsToUpsert = [
    {
      course_id: courseId,
      kind: "lecture",
      label: "Lecture",
      days_of_week: ["fri"],
      start_time: "15:00:00",
      end_time: "17:00:00",
      sort_order: 0,
    },
    {
      course_id: courseId,
      kind: "lab",
      label: "Lab 1",
      days_of_week: ["mon"],
      start_time: "15:00:00",
      end_time: "18:00:00",
      sort_order: 1,
    },
    {
      course_id: courseId,
      kind: "lab",
      label: "Lab 2",
      days_of_week: ["wed"],
      start_time: "15:00:00",
      end_time: "18:00:00",
      sort_order: 2,
    },
  ];

  let meetingsCreated = 0;
  for (const m of meetingsToUpsert) {
    const { data: existingM } = await db
      .from("course_meetings")
      .select("id")
      .eq("course_id", courseId)
      .eq("label", m.label)
      .maybeSingle();

    if (!existingM) {
      await db.from("course_meetings").insert(m);
      meetingsCreated++;
    } else {
      await db
        .from("course_meetings")
        .update({
          kind: m.kind,
          days_of_week: m.days_of_week,
          start_time: m.start_time,
          end_time: m.end_time,
          sort_order: m.sort_order,
        })
        .eq("id", (existingM as { id: string }).id);
      meetingsCreated++;
    }
  }

  // 4. Quizzes definitions
  const quizzesData = [
    {
      title: "Quiz 1: Resistor Reading",
      duration_minutes: 25,
      questions: [
        {
          question: "What does the color code system on axial lead resistors primarily indicate?",
          options: [
            "Resistance value and tolerance",
            "Maximum voltage limit",
            "Temperature coefficient only",
            "Inductance rating",
          ],
          correct_answer: "Resistance value and tolerance",
        },
        {
          question:
            "In the standard resistor color code chart, what numerical value corresponds to Black?",
          options: ["0", "1", "2", "5"],
          correct_answer: "0",
        },
        {
          question:
            "What numerical value does the color Brown represent in the resistor color code?",
          options: ["1", "0", "2", "3"],
          correct_answer: "1",
        },
        {
          question: "Which color represents the number 2 in the resistor color code?",
          options: ["Red", "Orange", "Brown", "Yellow"],
          correct_answer: "Red",
        },
        {
          question: "Which color represents the number 4 in the resistor color code?",
          options: ["Yellow", "Orange", "Green", "Violet"],
          correct_answer: "Yellow",
        },
        {
          question: "Which color represents the number 7 in the resistor color code?",
          options: ["Violet", "Blue", "Gray", "White"],
          correct_answer: "Violet",
        },
        {
          question: "On a standard 4-band resistor, which band represents the decimal multiplier?",
          options: ["Third band", "First band", "Second band", "Fourth band"],
          correct_answer: "Third band",
        },
        {
          question: "On a standard 4-band resistor, what does the fourth band indicate?",
          options: [
            "Tolerance rating (± percentage)",
            "Power rating in Watts",
            "Third significant digit",
            "Voltage drop",
          ],
          correct_answer: "Tolerance rating (± percentage)",
        },
        {
          question: "What tolerance percentage is indicated by a Gold band in the 4th position?",
          options: ["±5%", "±10%", "±1%", "±20%"],
          correct_answer: "±5%",
        },
        {
          question: "What tolerance percentage is indicated by a Silver band in the 4th position?",
          options: ["±10%", "±5%", "±2%", "±20%"],
          correct_answer: "±10%",
        },
        {
          question:
            "A 4-band resistor has color bands Brown, Black, Red, Gold. What is its nominal resistance?",
          options: ["1,000 Ω (1 kΩ)", "100 Ω", "10,000 Ω (10 kΩ)", "120 Ω"],
          correct_answer: "1,000 Ω (1 kΩ)",
        },
        {
          question:
            "A 4-band resistor has color bands Yellow, Violet, Orange, Gold. What is its nominal resistance?",
          options: [
            "47,000 Ω (47 kΩ)",
            "4,700 Ω (4.7 kΩ)",
            "470,000 Ω (470 kΩ)",
            "37,000 Ω (37 kΩ)",
          ],
          correct_answer: "47,000 Ω (47 kΩ)",
        },
        {
          question:
            "A 4-band resistor has color bands Red, Red, Brown, Gold. What is its resistance value?",
          options: ["220 Ω", "2.2 kΩ", "22 Ω", "220 kΩ"],
          correct_answer: "220 Ω",
        },
        {
          question:
            "A 4-band resistor has color bands Brown, Black, Orange, Silver. What is its value and tolerance?",
          options: ["10 kΩ ± 10%", "1 kΩ ± 5%", "100 kΩ ± 10%", "10 kΩ ± 5%"],
          correct_answer: "10 kΩ ± 10%",
        },
        {
          question:
            "A 4-band resistor has color bands Orange, White, Green, Gold. What is its nominal resistance?",
          options: ["3.9 MΩ (3,900,000 Ω)", "390 kΩ", "39 kΩ", "3.9 kΩ"],
          correct_answer: "3.9 MΩ (3,900,000 Ω)",
        },
        {
          question:
            "What color bands represent a 330 Ω resistor with ±5% tolerance on a 4-band resistor?",
          options: [
            "Orange, Orange, Brown, Gold",
            "Orange, Orange, Red, Gold",
            "Brown, Black, Brown, Gold",
            "Yellow, Violet, Brown, Gold",
          ],
          correct_answer: "Orange, Orange, Brown, Gold",
        },
        {
          question: "In a 5-band precision resistor, what do the first three bands represent?",
          options: [
            "The first three significant digits",
            "Two significant digits and a multiplier",
            "Tolerance and two digits",
            "Power rating and two digits",
          ],
          correct_answer: "The first three significant digits",
        },
        {
          question:
            "A 5-band resistor has bands: Brown, Black, Black, Brown, Brown. What is its resistance and tolerance?",
          options: ["1,000 Ω (1 kΩ) ± 1%", "100 Ω ± 5%", "10 kΩ ± 1%", "100 Ω ± 2%"],
          correct_answer: "1,000 Ω (1 kΩ) ± 1%",
        },
        {
          question:
            "If a 1 kΩ resistor has a ±5% tolerance (Gold), what is the acceptable measured resistance range?",
          options: ["950 Ω to 1,050 Ω", "900 Ω to 1,100 Ω", "980 Ω to 1,020 Ω", "990 Ω to 1,010 Ω"],
          correct_answer: "950 Ω to 1,050 Ω",
        },
        {
          question:
            "When Gold is used as the 3rd band (multiplier) on a 4-band resistor, what multiplier factor does it represent?",
          options: ["0.1", "0.01", "10", "100"],
          correct_answer: "0.1",
        },
      ],
    },
    {
      title: "Quiz 2: Resistor connected in series, parallel and series parallel",
      duration_minutes: 30,
      questions: [
        {
          question: "How is the total equivalent resistance (RT) calculated in a series circuit?",
          options: [
            "RT = R1 + R2 + ... + Rn",
            "1/RT = 1/R1 + 1/R2 + ...",
            "RT = (R1 * R2) / (R1 + R2)",
            "RT = R1 * R2 * ... * Rn",
          ],
          correct_answer: "RT = R1 + R2 + ... + Rn",
        },
        {
          question:
            "What electrical quantity remains constant and identical through all components in a series circuit?",
          options: ["Current (I)", "Voltage (V)", "Power (P)", "Resistance (R)"],
          correct_answer: "Current (I)",
        },
        {
          question:
            "Three resistors of values 100 Ω, 220 Ω, and 470 Ω are connected in series. What is the total equivalent resistance?",
          options: ["790 Ω", "690 Ω", "590 Ω", "890 Ω"],
          correct_answer: "790 Ω",
        },
        {
          question:
            "If two 1 kΩ resistors are connected in series across a 10 V DC supply, what is the total current flowing in the circuit?",
          options: ["5 mA", "10 mA", "20 mA", "2.5 mA"],
          correct_answer: "5 mA",
        },
        {
          question:
            "According to Kirchhoff's Voltage Law (KVL), what is the sum of all voltage drops in a closed series loop?",
          options: [
            "Equal to the total source voltage applied",
            "Always zero including the source",
            "Greater than the source voltage",
            "Equal to the smallest resistor voltage drop",
          ],
          correct_answer: "Equal to the total source voltage applied",
        },
        {
          question:
            "What is the formula for the total equivalent resistance (RT) of two parallel resistors R1 and R2?",
          options: [
            "RT = (R1 * R2) / (R1 + R2)",
            "RT = R1 + R2",
            "RT = (R1 + R2) / (R1 * R2)",
            "RT = R1 * R2",
          ],
          correct_answer: "RT = (R1 * R2) / (R1 + R2)",
        },
        {
          question:
            "What electrical quantity is identical across every branch of a parallel circuit?",
          options: ["Voltage (V)", "Current (I)", "Power (P)", "Conductance (G)"],
          correct_answer: "Voltage (V)",
        },
        {
          question:
            "Two 100 Ω resistors are connected in parallel. What is their equivalent resistance?",
          options: ["50 Ω", "200 Ω", "25 Ω", "100 Ω"],
          correct_answer: "50 Ω",
        },
        {
          question:
            "In any parallel resistive circuit, the total equivalent resistance (RT) is always:",
          options: [
            "Less than the smallest individual branch resistance",
            "Greater than the largest branch resistance",
            "Equal to the sum of all branch resistances",
            "Equal to the average of branch resistances",
          ],
          correct_answer: "Less than the smallest individual branch resistance",
        },
        {
          question:
            "Three identical 300 Ω resistors are connected in parallel. What is the total equivalent resistance?",
          options: ["100 Ω", "900 Ω", "150 Ω", "300 Ω"],
          correct_answer: "100 Ω",
        },
        {
          question:
            "A 12 V source is connected across two parallel resistors: R1 = 6 Ω and R2 = 12 Ω. What is the current through R1?",
          options: ["2 A", "1 A", "3 A", "0.5 A"],
          correct_answer: "2 A",
        },
        {
          question:
            "For a parallel circuit with 12 V across R1 = 6 Ω and R2 = 12 Ω, what is the total current (IT) supplied by the source?",
          options: ["3 A", "1 A", "2 A", "4 A"],
          correct_answer: "3 A",
        },
        {
          question:
            "If one resistor in a parallel branch burns out into an open circuit, what happens to the remaining branches?",
          options: [
            "They continue to operate with the same voltage applied",
            "Current stops flowing through all other branches",
            "Voltage across the other branches drops to zero",
            "Total circuit resistance drops to zero",
          ],
          correct_answer: "They continue to operate with the same voltage applied",
        },
        {
          question:
            "If one resistor in a series circuit becomes an open circuit, what happens to the current in the circuit?",
          options: [
            "Current drops to zero throughout the entire circuit (I = 0)",
            "Current doubles in the remaining components",
            "Voltage across all other resistors increases",
            "The remaining resistors continue to operate normally",
          ],
          correct_answer: "Current drops to zero throughout the entire circuit (I = 0)",
        },
        {
          question:
            "In a voltage divider circuit with series resistors R1 and R2 across Vin, what is the voltage across R2?",
          options: [
            "V2 = Vin * [R2 / (R1 + R2)]",
            "V2 = Vin * [R1 / (R1 + R2)]",
            "V2 = Vin * [(R1 + R2) / R2]",
            "V2 = Vin / (R1 + R2)",
          ],
          correct_answer: "V2 = Vin * [R2 / (R1 + R2)]",
        },
        {
          question:
            "How should you begin analyzing a series-parallel combination circuit to find equivalent resistance?",
          options: [
            "Simplify purely series or parallel sub-groups first, working back toward the source",
            "Add all resistors together as a single series string",
            "Divide the supply voltage by the total number of components",
            "Calculate power dissipation before finding resistance",
          ],
          correct_answer:
            "Simplify purely series or parallel sub-groups first, working back toward the source",
        },
        {
          question:
            "A circuit has R1 = 100 Ω in series with a parallel pair R2 = 200 Ω and R3 = 200 Ω. What is the total equivalent resistance?",
          options: ["200 Ω", "300 Ω", "500 Ω", "100 Ω"],
          correct_answer: "200 Ω",
        },
        {
          question:
            "In the circuit (R1 = 100 Ω in series with 200 Ω || 200 Ω, RT = 200 Ω), with a 20 V supply, what is the total source current?",
          options: ["100 mA (0.1 A)", "200 mA (0.2 A)", "50 mA (0.05 A)", "10 mA (0.01 A)"],
          correct_answer: "100 mA (0.1 A)",
        },
        {
          question:
            "Two parallel resistors of 30 Ω and 60 Ω are connected in series with a 10 Ω resistor. What is the total equivalent resistance?",
          options: ["30 Ω", "100 Ω", "20 Ω", "40 Ω"],
          correct_answer: "30 Ω",
        },
        {
          question: "In a parallel circuit, which branch carries the greater amount of current?",
          options: [
            "The branch with the lower resistance value",
            "The branch with the higher resistance value",
            "Both branches carry identical current regardless of resistance",
            "Current only flows in the branch closest to the positive terminal",
          ],
          correct_answer: "The branch with the lower resistance value",
        },
      ],
    },
    {
      title: "Quiz 3: Multi tester reading",
      duration_minutes: 25,
      questions: [
        {
          question: "What does the acronym VOM stand for in electrical and electronics testing?",
          options: [
            "Volt-Ohm-Milliammeter",
            "Voltage Output Monitor",
            "Variable Oscillator Meter",
            "Vector Ohmic Multiplier",
          ],
          correct_answer: "Volt-Ohm-Milliammeter",
        },
        {
          question:
            "Why is the resistance (Ohms, Ω) scale on an analog multimeter unique compared to voltage and current scales?",
          options: [
            "It is non-linear and reads from right (0) to left (∞)",
            "It is linear and reads left (0) to right (max)",
            "It reads from center zero outward",
            "It displays values in decibels only",
          ],
          correct_answer: "It is non-linear and reads from right (0) to left (∞)",
        },
        {
          question:
            "What critical calibration procedure must be performed whenever switching resistance ranges on an analog multimeter?",
          options: [
            "Zero Ohm Adjustment (shorting the test probes together and adjusting to 0 Ω)",
            "Frequency tuning of the meter coil",
            "AC line phase balance calibration",
            "Swapping the probe polarities",
          ],
          correct_answer:
            "Zero Ohm Adjustment (shorting the test probes together and adjusting to 0 Ω)",
        },
        {
          question:
            "What safety precaution is mandatory before measuring the resistance of an in-circuit component?",
          options: [
            "Disconnect power from the circuit and discharge all capacitors",
            "Turn on circuit power so the meter can sense current",
            "Set the range to the highest AC voltage range",
            "Ground both meter test probes together to earth",
          ],
          correct_answer: "Disconnect power from the circuit and discharge all capacitors",
        },
        {
          question:
            "If the selector switch is set to the R x 10 range and the pointer indicates 15 on the ohm scale, what is the measured resistance?",
          options: ["150 Ω", "15 Ω", "1,500 Ω", "1.5 Ω"],
          correct_answer: "150 Ω",
        },
        {
          question:
            "If the selector switch is set to the R x 1k range and the pointer indicates 4.7, what is the measured resistance?",
          options: ["4.7 kΩ (4,700 Ω)", "470 Ω", "47 kΩ", "0.47 kΩ"],
          correct_answer: "4.7 kΩ (4,700 Ω)",
        },
        {
          question:
            "If the analog meter pointer does not deflect from the far left (rests on ∞) during a resistance measurement, what does it indicate?",
          options: [
            "An open circuit (infinite resistance / broken path)",
            "A short circuit (0 Ω)",
            "A normal low-resistance wire",
            "A fully charged battery",
          ],
          correct_answer: "An open circuit (infinite resistance / broken path)",
        },
        {
          question:
            "If the meter pointer deflects completely to the far right (resting on 0 Ω) during a continuity check, what does it signify?",
          options: [
            "Continuity exists / closed circuit with negligible resistance",
            "The circuit is completely open",
            "The component has blown open",
            "The meter fuse has blown",
          ],
          correct_answer: "Continuity exists / closed circuit with negligible resistance",
        },
        {
          question:
            "When measuring an unknown DC voltage with a multimeter, what range should the selector switch initially be set to?",
          options: [
            "The highest voltage range to prevent meter needle damage/overload",
            "The lowest voltage range for maximum sensitivity",
            "The resistance R x 1 range",
            "The highest current range",
          ],
          correct_answer: "The highest voltage range to prevent meter needle damage/overload",
        },
        {
          question:
            "Which test lead is connected to the COM (common / reference / ground) terminal on a multimeter?",
          options: ["Black lead", "Red lead", "Yellow lead", "Green lead"],
          correct_answer: "Black lead",
        },
        {
          question:
            "When measuring DC voltage with an analog multitester, what happens if test probe polarities are accidentally reversed?",
          options: [
            "The pointer deflects backward (to the left of zero), risking needle damage",
            "The meter displays a minus sign on the scale",
            "The internal fuse blows immediately",
            "The reading remains accurate and positive",
          ],
          correct_answer:
            "The pointer deflects backward (to the left of zero), risking needle damage",
        },
        {
          question:
            "How must a multitester be connected to measure electric current flowing in a circuit?",
          options: [
            "In series with the load by opening the circuit line",
            "In parallel directly across the power supply terminals",
            "Across the load resistor without breaking the circuit",
            "Between circuit ground and the chassis",
          ],
          correct_answer: "In series with the load by opening the circuit line",
        },
        {
          question:
            "How must a multitester be connected to measure voltage across an active component?",
          options: [
            "In parallel across the component",
            "In series by cutting the circuit trace",
            "In series with the power supply negative terminal",
            "Between the component and an isolated ground",
          ],
          correct_answer: "In parallel across the component",
        },
        {
          question:
            "What happens if a multitester set to current (ammeter) mode is mistakenly connected in parallel across a voltage source?",
          options: [
            "A heavy short-circuit current flows through the meter, blowing its fuse or damaging it",
            "It accurately reads the circuit voltage",
            "The pointer remains at zero safely",
            "The voltage source automatically shuts down without issue",
          ],
          correct_answer:
            "A heavy short-circuit current flows through the meter, blowing its fuse or damaging it",
        },
        {
          question:
            "If the selector switch is on the DCV 50 V range and the pointer rests on 30 on the 0–50 scale, what is the measured voltage?",
          options: ["30 V", "3 V", "300 V", "15 V"],
          correct_answer: "30 V",
        },
        {
          question:
            "If the selector switch is on the DCV 10 V range and the pointer indicates 15 on a 0–50 scale, what is the measured voltage?",
          options: ["3 V", "15 V", "1.5 V", "0.3 V"],
          correct_answer: "3 V",
        },
        {
          question:
            "What provides the electrical power needed to measure resistance with an analog multimeter?",
          options: [
            "The meter's internal battery (e.g. 1.5 V / 9 V)",
            "The circuit under test must be powered",
            "An external wall outlet adapter",
            "Electromagnetic induction from test leads",
          ],
          correct_answer: "The meter's internal battery (e.g. 1.5 V / 9 V)",
        },
        {
          question:
            "When an analog multimeter cannot be zeroed on the R x 1 range (pointer cannot reach 0 Ω), what is the most probable cause?",
          options: [
            "The internal battery is weak or depleted",
            "The test leads are excessively long",
            "The meter movement coil is burned out",
            "The zero adjust knob is set to reverse polarity",
          ],
          correct_answer: "The internal battery is weak or depleted",
        },
        {
          question:
            "What setting should the multimeter selector switch be placed in when finished and storing the device?",
          options: [
            "OFF or highest AC Voltage range (e.g. ACV 1000V)",
            "Resistance R x 1 range",
            "Current DCA 250 mA range",
            "Lowest DC Voltage range",
          ],
          correct_answer: "OFF or highest AC Voltage range (e.g. ACV 1000V)",
        },
        {
          question:
            "What is parallax error when reading an analog meter scale, and how is it eliminated?",
          options: [
            "An apparent shift in needle position when viewed at an angle; eliminated by lining up the needle with its mirror image",
            "A calibration drift caused by ambient temperature changes; eliminated by cooling the meter",
            "A friction error in the jeweled meter bearings; eliminated by tapping the meter case",
            "A reading error caused by depleted batteries; eliminated by replacing batteries",
          ],
          correct_answer:
            "An apparent shift in needle position when viewed at an angle; eliminated by lining up the needle with its mirror image",
        },
      ],
    },
  ];

  let quizzesCreated = 0;
  let questionsCreated = 0;

  for (const qDef of quizzesData) {
    const { data: existingQ } = await db
      .from("quizzes")
      .select("id")
      .eq("course_id", courseId)
      .eq("title", qDef.title)
      .is("deleted_at", null)
      .maybeSingle();

    let quizId: string;

    if (!existingQ) {
      const { data: createdQ, error: createQErr } = await db
        .from("quizzes")
        .insert({
          course_id: courseId,
          title: qDef.title,
          duration_minutes: qDef.duration_minutes,
          allow_retake: false,
          max_attempts: 1,
          retake_score_policy: "highest_score",
          question_count: qDef.questions.length,
          opens_at: null,
          closes_at: new Date(Date.now() + 30 * 24 * 3600 * 1000).toISOString(),
        })
        .select("id")
        .single();

      if (createQErr || !createdQ) {
        throw new Error(`Failed to create quiz '${qDef.title}': ${createQErr?.message}`);
      }
      quizId = (createdQ as { id: string }).id;
      quizzesCreated++;
    } else {
      quizId = (existingQ as { id: string }).id;
      await db
        .from("quizzes")
        .update({
          duration_minutes: qDef.duration_minutes,
          allow_retake: false,
          max_attempts: 1,
          retake_score_policy: "highest_score",
          question_count: qDef.questions.length,
          closes_at: new Date(Date.now() + 30 * 24 * 3600 * 1000).toISOString(),
        })
        .eq("id", quizId);
      quizzesCreated++;
    }

    // Insert questions if not already present
    const { data: existingQuestions } = await db
      .from("quiz_questions")
      .select("id")
      .eq("quiz_id", quizId);

    const qRows = (existingQuestions as Array<{ id: string }> | null) ?? [];

    if (qRows.length === 0) {
      const qInserts = qDef.questions.map((q, idx) => ({
        quiz_id: quizId,
        question: q.question,
        options: q.options,
        correct_answer: q.correct_answer,
        position: idx + 1,
      }));

      const { error: insQuestionsErr } = await db.from("quiz_questions").insert(qInserts);
      if (insQuestionsErr) {
        throw new Error(
          `Failed to insert questions for '${qDef.title}': ${insQuestionsErr.message}`,
        );
      }
      questionsCreated += qInserts.length;
    } else {
      questionsCreated += qRows.length;
    }
  }

  // 5. Enroll Students
  // Target only the course's actual grade/section cohort. Do not add demo/test
  // accounts as exceptions; the previous broad query enrolled the whole school.
  const { data: eligibleStudents } = await db
    .from("profiles")
    .select("id, grade_level, section")
    .eq("role", "student")
    .is("deleted_at", null);

  type CohortProfile = {
    id: string;
    grade_level: number | null;
    section: string | null;
  };
  const studentRows = ((eligibleStudents as CohortProfile[] | null) ?? []).filter(isIae106Cohort);
  let enrollmentsAdded = 0;
  if (studentRows.length > 0) {
    for (const s of studentRows) {
      const { error: enrErr } = await db
        .from("enrollments")
        .upsert(
          { student_id: s.id, course_id: courseId },
          { onConflict: "student_id,course_id", ignoreDuplicates: true },
        );
      if (!enrErr) enrollmentsAdded++;
    }
  }

  return {
    courseId,
    courseTitle: coursePayload.title,
    courseCode: coursePayload.code,
    meetingsCreated,
    quizzesCreated,
    questionsCreated,
    enrollmentsAdded,
  };
}
