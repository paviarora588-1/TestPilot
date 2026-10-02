export interface DeterministicAnalysis {
  requiredObjects: string[];
  missingObjectMappings: string[];
  requiredTestDataHints: string[];
}

const DATA_KEYWORDS = ['username', 'password', 'email', 'phone', 'date', 'amount', 'id', 'name'];

/**
 * Matches step text against the application's actual Object Library so
 * "required objects" / "missing object mappings" are grounded in what's
 * really scanned, not just an AI guess — this is what lets the acceptance
 * check ("zero missing objects against Phase 1's library") be verified
 * deterministically even when no local AI model is configured/running.
 */
export function analyzeStepsAgainstObjects(stepsText: string, objectNames: string[]): DeterministicAnalysis {
  const lowerSteps = stepsText.toLowerCase();
  const requiredObjects = objectNames.filter((name) => {
    const words = name
      .toLowerCase()
      .split(/\s+/)
      .filter((w) => w.length > 2);
    return words.some((w) => lowerSteps.includes(w));
  });

  const requiredTestDataHints: string[] = [];
  for (const line of stepsText.split(/\r?\n/)) {
    const lower = line.toLowerCase();
    if (!/\b(enter|type|input|select)\b/.test(lower)) continue;
    for (const keyword of DATA_KEYWORDS) {
      if (lower.includes(keyword) && !requiredTestDataHints.includes(keyword)) {
        requiredTestDataHints.push(keyword);
      }
    }
  }

  return {
    requiredObjects,
    missingObjectMappings:
      requiredObjects.length === 0
        ? ["No Object Library entries match this test case's steps yet — scan and promote the relevant objects first."]
        : [],
    requiredTestDataHints,
  };
}
