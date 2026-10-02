// Groups a test case's data-entry fields by the screen they live on (e.g.
// "Applicant Details" / "Supervisor Details" / "Role") and proposes a
// deterministic starting value for common field patterns (name/email/
// username/etc.), so Analyze can ask the user one question per section
// ("provide specific details for X?") instead of the flow generator having
// to guess every value from scratch. Deterministic — no AI provider needed,
// same "always works" philosophy as test-case-analysis.util.ts.

const INPUT_TYPE_PATTERN = /input|textarea|select/i;

const FIRST_NAMES = ['Priya', 'Alex', 'Wei', 'Maria', 'John', 'Fatima', 'Liam', 'Noor'];
const LAST_NAMES = ['Sharma', 'Smith', 'Chen', 'Garcia', 'Khan', 'Muller', 'Silva', 'Kim'];

// A stable hash of the field's own identity (not Math.random()) — the same
// field must always get the same suggestion on repeated fetches. The
// frontend renders these into an uncontrolled input's defaultValue; a value
// that changed on every refetch (e.g. a background refetch on window focus)
// made React re-render an already-initialized field with a different
// default, which is exactly what triggers Base UI's "changing the default
// value state of an uncontrolled FieldControl after being initialized"
// warning.
function stableIndex(seed: string, modulo: number): number {
  let hash = 0;
  for (let i = 0; i < seed.length; i++) {
    hash = (hash * 31 + seed.charCodeAt(i)) | 0;
  }
  return Math.abs(hash) % modulo;
}

function pick(seed: string, list: string[]): string {
  return list[stableIndex(seed, list.length)];
}

function stableDigits(seed: string, count: number): string {
  let out = '';
  for (let i = 0; i < count; i++) {
    out += stableIndex(`${seed}:${i}`, 10);
  }
  return out;
}

// Placeholder tokens ({{randomEmail}}, {{today}}, …) are resolved fresh at
// run time by the generated script (see playwright-compiler.ts's
// resolvePlaceholders) — using them here means a saved value stays valid
// indefinitely instead of going stale.
const FIELD_VALUE_RULES: { pattern: RegExp; generate: (seed: string) => string; sensitive?: boolean }[] = [
  { pattern: /first\s*name/i, generate: (seed) => pick(seed, FIRST_NAMES) },
  { pattern: /last\s*name|surname/i, generate: (seed) => pick(seed, LAST_NAMES) },
  { pattern: /user\s*(name|id)|login\s*id/i, generate: () => '{{randomUser}}' },
  { pattern: /e-?mail/i, generate: () => '{{randomEmail}}' },
  { pattern: /phone|mobile|contact\s*number/i, generate: (seed) => `555${stableDigits(seed, 7)}` },
  { pattern: /pass(word)?/i, generate: (seed) => `Pw${stableDigits(seed, 6)}!`, sensitive: true },
  { pattern: /\bdate\b/i, generate: () => '{{today}}' },
];

// `seed` should uniquely identify the field (its objectId) so two different
// fields matching the same rule (e.g. "First Name" on two screens) still get
// distinct values, while the same field stays stable across calls.
export function suggestFieldValue(label: string, seed: string): { value: string | null; sensitive: boolean } {
  for (const rule of FIELD_VALUE_RULES) {
    if (rule.pattern.test(label)) return { value: rule.generate(seed), sensitive: !!rule.sensitive };
  }
  // App-specific fields (role name, department, project code, …) have no
  // safe generic guess — leave blank so the user supplies (or explicitly
  // skips) it rather than seed the flow with a plausible-looking value that
  // doesn't actually exist in the app under test.
  return { value: null, sensitive: false };
}

export interface DataRequirementField {
  objectId: string;
  objectName: string;
  screenName: string | null;
  fieldLabel: string;
  suggestedValue: string | null;
  sensitive: boolean;
}

export interface DataRequirementGroup {
  screenName: string;
  fields: DataRequirementField[];
}

interface DataRequirementObjectInput {
  id: string;
  objectName: string;
  displayLabel: string | null;
  screenName: string | null;
  objectType: string;
}

/**
 * Same "does the step text mention this screen" heuristic as
 * generateFromTestCase's own screen-narrowing (word overlap, not full-string
 * containment — test case steps rarely repeat a screen name verbatim, e.g.
 * "Enter Details of applicant" vs. a screen named "Applicant Details").
 */
export function buildDataRequirementGroups(
  stepsText: string,
  objects: DataRequirementObjectInput[],
): DataRequirementGroup[] {
  const lowerSteps = stepsText.toLowerCase();
  const screenNames = [...new Set(objects.map((o) => o.screenName).filter((s): s is string => !!s))];
  const mentionedScreens = screenNames.filter((screen) =>
    screen
      .toLowerCase()
      .split(/\s+/)
      .filter((w) => w.length > 2)
      .some((w) => lowerSteps.includes(w)),
  );
  const relevantScreens = mentionedScreens.length > 0 ? mentionedScreens : screenNames;

  const groups: DataRequirementGroup[] = [];
  for (const screen of relevantScreens) {
    const fields = objects
      .filter((o) => o.screenName === screen && INPUT_TYPE_PATTERN.test(o.objectType))
      .map((o) => {
        const fieldLabel = o.displayLabel || o.objectName;
        // Pattern-match against the field's own name, not the display label
        // — displayLabel is often screen-qualified for disambiguation (e.g.
        // "System dropdown (New Password)"), and matching that let a plain
        // "System" field on this app's "New Password" screen get flagged as
        // a password field purely because the SCREEN's name contains
        // "password". objectName reflects the field's own identity only.
        const { value, sensitive } = suggestFieldValue(o.objectName, o.id);
        return { objectId: o.id, objectName: o.objectName, screenName: o.screenName, fieldLabel, suggestedValue: value, sensitive };
      });
    if (fields.length > 0) groups.push({ screenName: screen, fields });
  }
  return groups;
}

// Mirrors the exact key format generateFromTestCase uses to look up/reuse a
// TestDataItem for a step's bound object — matching it here is what lets a
// value saved from Analyze get picked up automatically the next time a flow
// is generated, with zero AI guessing needed for that field.
export function dataItemKeyFor(objectName: string, screenName: string | null): string {
  return (screenName ? `${objectName} - ${screenName}` : objectName).slice(0, 60);
}
