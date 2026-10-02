export type FailureCategory =
  | 'locator_not_found'
  | 'timeout'
  | 'assertion_failed'
  | 'navigation_failed'
  | 'unknown'
  | 'application_bug'
  | 'test_data_issue'
  | 'environment_issue'
  | 'requirement_mismatch'
  | 'automation_script_issue';

// Categories the deterministic string-matchers below can already tell apart
// confidently from the raw error message. `assertion_failed` and `unknown`
// are the two genuinely ambiguous ones — an assertion failing could mean a
// real app bug, a stale requirement, or a bad script, which needs semantic
// judgment the AI provides in execution.service.ts, not more string matching.
export const CONFIDENT_DETERMINISTIC_CATEGORIES: FailureCategory[] = [
  'locator_not_found',
  'timeout',
  'navigation_failed',
];

export interface DeterministicFailureAnalysis {
  category: FailureCategory;
  failureMessage: string;
  likelyRootCause: string;
  suggestedFix: string;
  autoHealPossible: boolean;
}

/**
 * Classifies a real Playwright error message. Ported in spirit from the
 * legacy app's deterministic_failure_analysis, but keyed on Playwright's own
 * error vocabulary (timeouts, strict-mode violations, assertion failures)
 * instead of the legacy's SAP-GUI-flavored phrases ("control could not be
 * found") — this app targets web/Playwright first, not SAP GUI.
 */
export function analyzePlaywrightFailure(errorMessage: string | undefined): DeterministicFailureAnalysis {
  const msg = errorMessage ?? 'Unknown failure';
  const lower = msg.toLowerCase();

  if (lower.includes('strict mode violation')) {
    return {
      category: 'locator_not_found',
      failureMessage: msg,
      likelyRootCause: 'The locator matched more than one element — it is no longer unique on the page.',
      suggestedFix: 'Refine the locator (e.g. add a more specific attribute) in the Object Library.',
      autoHealPossible: true,
    };
  }
  // Checked before the generic locator-timeout pattern below: Playwright's
  // own retry call-log includes "waiting for locator(...)" for the ENTIRE
  // time an assertion is retrying, even when the locator resolved to a
  // real element on every attempt and only the content/value/visibility
  // check kept failing — so "timeout" + "waiting for locator" alone can't
  // tell "the element was never found" apart from "found every time, wrong
  // content". Confirmed in practice: a toContainText() failure whose own
  // call log showed "locator resolved to <input .../>" 33 times was still
  // mis-labeled locator_not_found, sending the suggested fix toward
  // re-scanning a locator that was never actually the problem.
  if (
    lower.includes('tobevisible') ||
    lower.includes('tocontaintext') ||
    lower.includes('tohavetext') ||
    lower.includes('tohavevalue') ||
    lower.includes('expect(')
  ) {
    return {
      category: 'assertion_failed',
      failureMessage: msg,
      likelyRootCause: 'The assertion did not hold — the expected content or visibility was not present when checked.',
      suggestedFix: 'Confirm the expected value is still correct, and that a prior step actually reached this state.',
      autoHealPossible: false,
    };
  }
  if (lower.includes('timeout') && (lower.includes('waiting for locator') || lower.includes('waiting for selector'))) {
    return {
      category: 'locator_not_found',
      failureMessage: msg,
      likelyRootCause:
        "The locator did not resolve to any element within the timeout — the object's selector may be stale, or a prior step failed to reach the expected screen.",
      suggestedFix: "Re-scan the page and re-verify the object's locator in the Object Library.",
      autoHealPossible: true,
    };
  }
  if (lower.includes('net::') || lower.includes('page.goto') || lower.includes('navigation')) {
    return {
      category: 'navigation_failed',
      failureMessage: msg,
      likelyRootCause: 'The page failed to load — the URL may be unreachable or the network blocked the request.',
      suggestedFix: 'Verify the application URL is reachable from this environment.',
      autoHealPossible: false,
    };
  }
  if (lower.includes('timeout')) {
    return {
      category: 'timeout',
      failureMessage: msg,
      likelyRootCause: 'An action did not complete within the configured timeout.',
      suggestedFix: 'Consider adding a Wait step, or check whether the application is slower than expected.',
      autoHealPossible: false,
    };
  }
  return {
    category: 'unknown',
    failureMessage: msg,
    likelyRootCause: 'Unrecognized failure pattern.',
    suggestedFix: 'Review the full error message and logs.',
    autoHealPossible: false,
  };
}

/**
 * Same taxonomy as analyzePlaywrightFailure, keyed on Selenium's own
 * exception vocabulary instead — the two frameworks don't share error
 * wording (Selenium says "no such element", Playwright says "waiting for
 * locator"), so reusing the Playwright matcher would silently classify
 * everything as 'unknown'.
 */
export function analyzeSeleniumFailure(errorMessage: string | undefined): DeterministicFailureAnalysis {
  const msg = errorMessage ?? 'Unknown failure';
  const lower = msg.toLowerCase();

  if (lower.includes('no such element') || lower.includes('unable to locate element')) {
    return {
      category: 'locator_not_found',
      failureMessage: msg,
      likelyRootCause:
        "The locator did not resolve to any element — the object's selector may be stale, or a prior step failed to reach the expected screen.",
      suggestedFix: "Re-scan the page and re-verify the object's locator in the Object Library.",
      autoHealPossible: true,
    };
  }
  if (lower.includes('element not interactable') || lower.includes('stale element reference')) {
    return {
      category: 'locator_not_found',
      failureMessage: msg,
      likelyRootCause: 'The element exists but is not currently interactable (hidden, disabled, or the DOM changed under it).',
      suggestedFix: 'Confirm a prior step reached the right state, or add a Wait step before this one.',
      autoHealPossible: true,
    };
  }
  if (lower.includes('assert') || lower.includes('expected')) {
    return {
      category: 'assertion_failed',
      failureMessage: msg,
      likelyRootCause: 'The assertion did not hold — the expected content or visibility was not present when checked.',
      suggestedFix: 'Confirm the expected value is still correct, and that a prior step actually reached this state.',
      autoHealPossible: false,
    };
  }
  if (lower.includes('net::') || lower.includes('unreachable') || lower.includes('refused')) {
    return {
      category: 'navigation_failed',
      failureMessage: msg,
      likelyRootCause: 'The page failed to load — the URL may be unreachable or the network blocked the request.',
      suggestedFix: 'Verify the application URL is reachable from this environment.',
      autoHealPossible: false,
    };
  }
  if (lower.includes('timeout') || lower.includes('timed out')) {
    return {
      category: 'timeout',
      failureMessage: msg,
      likelyRootCause: 'An action did not complete within the configured timeout.',
      suggestedFix: 'Consider adding a Wait step, or check whether the application is slower than expected.',
      autoHealPossible: false,
    };
  }
  return {
    category: 'unknown',
    failureMessage: msg,
    likelyRootCause: 'Unrecognized failure pattern.',
    suggestedFix: 'Review the full error message and logs.',
    autoHealPossible: false,
  };
}

/**
 * Same taxonomy again, keyed on SAP GUI Scripting's own error vocabulary.
 * The "not found"/"visible"/"Expected text" phrasings below are the exact
 * messages sap-gui-compiler.ts's generated scripts throw (not guessed SAP
 * COM wording) — the underlying attach-time messages (no session, scripting
 * disabled) come from sap-gui-walker.ps1's own Write-ErrorJson text and are
 * matched the same way. Never verified against a live SAP GUI session in
 * this environment (see scanner/sap/sap-gui-walker.ps1's prerequisites) —
 * unmatched messages fall through to 'unknown', where the AI enrichment
 * pass in execution.service.ts can still make a semantic judgment call.
 */
export function analyzeSapGuiFailure(errorMessage: string | undefined): DeterministicFailureAnalysis {
  const msg = errorMessage ?? 'Unknown failure';
  const lower = msg.toLowerCase();

  if (lower.includes('could not attach') || lower.includes('scripting') || lower.includes('no sap connections')) {
    return {
      category: 'environment_issue',
      failureMessage: msg,
      likelyRootCause: 'No active, scripting-enabled SAP GUI session was available to attach to on the execution machine.',
      suggestedFix: 'Confirm SAP Logon has a live logged-in session and that GUI scripting is enabled (client-side and server-side).',
      autoHealPossible: false,
    };
  }
  if (lower.includes('not found') || lower.includes('could not be found')) {
    return {
      category: 'locator_not_found',
      failureMessage: msg,
      likelyRootCause:
        "The SAP GUI element id did not resolve — a prior step may have failed to reach the expected screen, or the transaction's layout changed.",
      suggestedFix: "Re-scan the transaction and re-verify the object's technical path in the Object Library.",
      // Unlike web objects, SAP GUI objects don't carry backup locators (the
      // scanner captures one stable SAP-assigned id, not several heuristic
      // guesses) — auto-heal has nothing to fall back to yet, so this stays
      // false rather than implying a suggestion will appear.
      autoHealPossible: false,
    };
  }
  if (lower.includes('not visible') || lower.includes('expected text containing')) {
    return {
      category: 'assertion_failed',
      failureMessage: msg,
      likelyRootCause: 'The assertion did not hold — the expected content or visibility was not present when checked.',
      suggestedFix: 'Confirm the expected value is still correct, and that a prior step actually reached this state.',
      autoHealPossible: false,
    };
  }
  if (lower.includes('timeout') || lower.includes('timed out')) {
    return {
      category: 'timeout',
      failureMessage: msg,
      likelyRootCause: 'An action did not complete within the configured timeout.',
      suggestedFix: 'Consider adding a Wait step, or check whether the SAP system is slower than expected.',
      autoHealPossible: false,
    };
  }
  return {
    category: 'unknown',
    failureMessage: msg,
    likelyRootCause: 'Unrecognized failure pattern.',
    suggestedFix: 'Review the full error message and logs.',
    autoHealPossible: false,
  };
}
