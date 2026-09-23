import * as vscode from "vscode";
import {
  GITHUB_REPO_URL,
  markAsked,
  markNeverAsk,
  normalizeRatingState,
  ratingStoreFor,
  recordActivation,
  shouldAskForRating,
  type RatingState,
} from "./rating-core";
import { appName, isKnownSetUp } from "./state";
import { hadOnboardingToastThisSession } from "./session";
import { log } from "./log";

/**
 * Rating prompt — the VS Code glue around rating-core.ts (which holds the
 * persisted-state policy and its tests).
 *
 * Session rules layered on top of the policy:
 *   - at most one ask per session;
 *   - never in a session that already showed a welcome / connect / setup toast
 *     (hadOnboardingToastThisSession) — one request per window is plenty;
 *   - ~3 minutes after activation, so it never competes with startup work and
 *     only reaches someone who kept the editor open. The timer is a disposable
 *     in context.subscriptions, so it never fires after deactivation.
 */

/** globalState key; synced across machines so "Don't ask again" holds everywhere. */
export const RATING_STATE_KEY = "mnemoverse.rating";

/** Delay between activation and the (possible) ask. */
export const RATING_DELAY_MS = 3 * 60 * 1000;

let askedThisSession = false;

function readState(context: vscode.ExtensionContext): RatingState {
  return normalizeRatingState(context.globalState.get(RATING_STATE_KEY));
}

async function writeState(context: vscode.ExtensionContext, state: RatingState): Promise<void> {
  await context.globalState.update(RATING_STATE_KEY, state);
}

/** Count this activation (first-seen date, distinct active days). */
export async function recordRatingActivation(context: vscode.ExtensionContext, now = Date.now()): Promise<void> {
  context.globalState.setKeysForSync([RATING_STATE_KEY]);
  await writeState(context, recordActivation(readState(context), now));
}

/** Arm the delayed check. Returns the disposable that cancels it. */
export function scheduleRatingPrompt(context: vscode.ExtensionContext): vscode.Disposable {
  const timer = setTimeout(() => {
    void maybeAskForRating(context).catch((err) => log.error("Rating prompt failed", err));
  }, RATING_DELAY_MS);
  return new vscode.Disposable(() => clearTimeout(timer));
}

/**
 * Show the prompt if every rule allows it. Returns whether it was shown.
 * The ask is counted BEFORE the toast appears, so closing the window on the
 * toast still counts as an ask.
 */
export async function maybeAskForRating(context: vscode.ExtensionContext, now = Date.now()): Promise<boolean> {
  if (askedThisSession || hadOnboardingToastThisSession()) {
    return false;
  }
  const state = readState(context);
  // isKnownSetUp, not isConnected: a Cursor registration nobody signed in to
  // counts as "connected" for the agent, but memory may never have worked for
  // this user, and they are the last person to ask for a rating.
  if (!shouldAskForRating(state, { connected: isKnownSetUp(), now })) {
    return false;
  }
  askedThisSession = true;
  await writeState(context, markAsked(state, now));

  const store = ratingStoreFor(appName());
  const choice = await vscode.window.showInformationMessage(
    `Is Mnemoverse memory useful to you? A rating on ${store.name} helps other developers find it.`,
    "Rate",
    "Later",
    "Don't ask again",
  );
  if (choice === "Rate") {
    await writeState(context, markNeverAsk(readState(context)));
    await vscode.env.openExternal(vscode.Uri.parse(store.url));
  } else if (choice === "Don't ask again") {
    await writeState(context, markNeverAsk(readState(context)));
  }
  // "Later" or dismissed: the ask was already counted; the policy allows one
  // more, 30+ days from now.
  return true;
}

/**
 * `mnemoverse.rate`: open the review page of the store this editor uses. A user
 * who rates on their own is not asked again.
 */
export async function openRatingPage(context: vscode.ExtensionContext): Promise<void> {
  await writeState(context, markNeverAsk(readState(context)));
  await vscode.env.openExternal(vscode.Uri.parse(ratingStoreFor(appName()).url));
}

/** `mnemoverse.starOnGitHub`. */
export async function openGitHubRepo(): Promise<void> {
  await vscode.env.openExternal(vscode.Uri.parse(GITHUB_REPO_URL));
}
