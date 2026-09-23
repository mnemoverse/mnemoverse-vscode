/**
 * Rating prompt policy — pure, VS Code-free (unit-tested in node).
 *
 * Both stores rank partly on reviews, and the listing has none yet, so the
 * extension asks for a rating — but only from someone who has had time to
 * judge it and for whom it actually works. Every rule below exists to keep the
 * ask rare and well-timed:
 *
 *   - connected            — never ask someone for whom memory is not known to
 *                            be set up (state.ts `isKnownSetUp`: a working
 *                            local key, the hosted connection chosen on
 *                            purpose, or an entry in the user's own MCP config
 *                            — not a server merely offered to an editor whose
 *                            sign-in the extension cannot see).
 *   - >= 7 days installed  — a first-week user has not seen memory pay off yet.
 *   - >= 4 active days     — distinct calendar days the extension activated;
 *                            filters out "installed once, opened once".
 *   - !neverAsk            — "Don't ask again" and "Rate" are final.
 *   - at most twice ever   — a second ask only after "Later", 30+ days on.
 *
 * The session-level rules (at most once per session, never alongside a
 * welcome/connect toast, ~3 minutes after activation) live in the VS Code glue
 * (rating.ts), because they depend on what else happened in this window.
 */

export const DAY_MS = 24 * 60 * 60 * 1000;
export const MIN_DAYS_INSTALLED = 7;
export const MIN_ACTIVE_DAYS = 4;
export const DAYS_BEFORE_SECOND_ASK = 30;

/** Persisted (globalState) rating state. All timestamps are epoch milliseconds. */
export interface RatingState {
  /** First activation we ever recorded. */
  firstSeen?: number;
  /** Number of distinct local calendar days with at least one activation. */
  activeDays: number;
  /** The last day counted in `activeDays`, as YYYY-MM-DD (local time). */
  lastActiveDay?: string;
  /** How many times the prompt has been shown. */
  askCount: number;
  /** When the prompt was last shown. */
  lastAskedAt?: number;
  /** The user chose "Rate" or "Don't ask again". */
  neverAsk: boolean;
}

export const EMPTY_RATING_STATE: RatingState = { activeDays: 0, askCount: 0, neverAsk: false };

/**
 * Coerce whatever globalState returned into a valid state. globalState is
 * plain JSON a user (or a Settings Sync conflict) can mangle; a bad value must
 * degrade to "fresh install", never throw during activation.
 */
export function normalizeRatingState(raw: unknown): RatingState {
  if (!raw || typeof raw !== "object") {
    return { ...EMPTY_RATING_STATE };
  }
  const r = raw as Record<string, unknown>;
  const num = (v: unknown): number | undefined =>
    typeof v === "number" && Number.isFinite(v) && v >= 0 ? v : undefined;
  return {
    firstSeen: num(r.firstSeen),
    activeDays: Math.floor(num(r.activeDays) ?? 0),
    lastActiveDay: typeof r.lastActiveDay === "string" ? r.lastActiveDay : undefined,
    askCount: Math.floor(num(r.askCount) ?? 0),
    lastAskedAt: num(r.lastAskedAt),
    neverAsk: r.neverAsk === true,
  };
}

/** Local calendar day as YYYY-MM-DD. Local, because "a day of use" is the user's day. */
export function localDay(now: number): string {
  const d = new Date(now);
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${mm}-${dd}`;
}

/**
 * Record one activation at `now`: set `firstSeen` once, and count the day if it
 * differs from the last counted day. Several windows or restarts on the same
 * day count once. Returns a new object.
 */
export function recordActivation(state: RatingState, now: number): RatingState {
  const day = localDay(now);
  return {
    ...state,
    firstSeen: state.firstSeen ?? now,
    activeDays: state.lastActiveDay === day ? state.activeDays : state.activeDays + 1,
    lastActiveDay: day,
  };
}

/** Whether the rating prompt is due, from persisted state alone. */
export function shouldAskForRating(state: RatingState, opts: { connected: boolean; now: number }): boolean {
  if (!opts.connected || state.neverAsk || state.firstSeen === undefined) {
    return false;
  }
  if (opts.now - state.firstSeen < MIN_DAYS_INSTALLED * DAY_MS) {
    return false;
  }
  if (state.activeDays < MIN_ACTIVE_DAYS) {
    return false;
  }
  if (state.askCount === 0) {
    return true;
  }
  return (
    state.askCount === 1 &&
    state.lastAskedAt !== undefined &&
    opts.now - state.lastAskedAt >= DAYS_BEFORE_SECOND_ASK * DAY_MS
  );
}

/** State after the prompt was shown (counted at show time, so a crash can't re-ask). */
export function markAsked(state: RatingState, now: number): RatingState {
  return { ...state, askCount: state.askCount + 1, lastAskedAt: now };
}

/** State after "Rate" or "Don't ask again". */
export function markNeverAsk(state: RatingState): RatingState {
  return { ...state, neverAsk: true };
}

export const MARKETPLACE_REVIEW_URL =
  "https://marketplace.visualstudio.com/items?itemName=Mnemoverse.mnemoverse-vscode&ssr=false#review-details";
export const OPEN_VSX_REVIEW_URL = "https://open-vsx.org/extension/mnemoverse/mnemoverse-vscode/reviews";
export const GITHUB_REPO_URL = "https://github.com/mnemoverse/mnemoverse-vscode";

/**
 * Where this user installed from, judged by the editor: Microsoft's builds
 * ("Visual Studio Code", "… - Insiders") use the Marketplace; every fork uses
 * Open VSX or a mirror of it. A review on the store the user actually uses is
 * the one other users of that editor will see.
 */
export function ratingStoreFor(appName: string): { name: string; url: string } {
  return /visual studio code/i.test(appName ?? "")
    ? { name: "the VS Code Marketplace", url: MARKETPLACE_REVIEW_URL }
    : { name: "Open VSX", url: OPEN_VSX_REVIEW_URL };
}
