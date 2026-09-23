/**
 * Per-activation UI state — VS Code-free so it unit-tests in node.
 *
 * The "connect" toast (keyless Sign In) has two entry points that can fire near-
 * simultaneously: the first-run welcome (extension.ts) and the agent-touch path
 * (provider.ts, when a memory tool is invoked without a key). `claimConnectPrompt`
 * is the single arbiter so the user sees AT MOST ONE connect toast per session,
 * regardless of which fires first or how their awaits interleave. State resets
 * naturally on the next extension-host session.
 */
let connectPromptShownThisSession = false;

/**
 * Whether ANY onboarding toast (welcome, connect, Cursor intro, guidance, Node
 * missing) was shown this session. The rating prompt reads it: asking for a
 * review in the same window that just asked the user to set something up reads
 * as nagging, so the rating waits for a quieter session.
 */
let onboardingToastThisSession = false;

/** Whether a connect toast has already been shown (or claimed) this session. */
export function wasConnectPromptShown(): boolean {
  return connectPromptShownThisSession;
}

/**
 * Claim the single connect-toast slot for this session. Returns `true` and marks
 * it claimed if the caller should show the toast; returns `false` if one already
 * fired. Synchronous and idempotent — two callers in the same tick cannot both
 * claim, which is what makes the welcome/agent-touch race safe without any
 * cross-module flag plumbing.
 */
export function claimConnectPrompt(): boolean {
  if (connectPromptShownThisSession) {
    return false;
  }
  connectPromptShownThisSession = true;
  onboardingToastThisSession = true;
  return true;
}

/** Record that an onboarding toast (of any kind) was shown this session. */
export function noteOnboardingToast(): void {
  onboardingToastThisSession = true;
}

/** Whether an onboarding toast was shown this session (see `noteOnboardingToast`). */
export function hadOnboardingToastThisSession(): boolean {
  return onboardingToastThisSession;
}

/**
 * Re-arm the connect toast. Called on a deliberate sign-out so a reconnect in the
 * same session still gets the one-click affordance (otherwise the session guard
 * would suppress it for the rest of the window).
 */
export function resetConnectPrompt(): void {
  connectPromptShownThisSession = false;
}
