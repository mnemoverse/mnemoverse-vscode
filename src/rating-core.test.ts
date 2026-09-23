import { describe, it, expect } from "vitest";
import {
  DAY_MS,
  EMPTY_RATING_STATE,
  MARKETPLACE_REVIEW_URL,
  OPEN_VSX_REVIEW_URL,
  markAsked,
  markNeverAsk,
  normalizeRatingState,
  ratingStoreFor,
  recordActivation,
  shouldAskForRating,
  type RatingState,
} from "./rating-core";

const T0 = new Date(2026, 8, 1, 10, 0, 0).getTime(); // 1 Sep 2026, 10:00 local

/** A user who installed at T0 and used the extension on `days` distinct days. */
function veteran(days = 4, overrides: Partial<RatingState> = {}): RatingState {
  return { ...EMPTY_RATING_STATE, firstSeen: T0, activeDays: days, lastActiveDay: "2026-09-05", ...overrides };
}

const at = (days: number) => T0 + days * DAY_MS;

describe("recordActivation", () => {
  it("sets firstSeen once and counts each distinct day once", () => {
    let s = recordActivation(EMPTY_RATING_STATE, T0);
    expect(s.firstSeen).toBe(T0);
    expect(s.activeDays).toBe(1);
    s = recordActivation(s, T0 + 60 * 60 * 1000); // same day, later
    expect(s.activeDays).toBe(1);
    s = recordActivation(s, at(1));
    s = recordActivation(s, at(1) + 1000);
    s = recordActivation(s, at(3));
    expect(s.activeDays).toBe(3);
    expect(s.firstSeen).toBe(T0);
  });
});

describe("shouldAskForRating", () => {
  it("asks a connected user after 7 days and 4 active days", () => {
    expect(shouldAskForRating(veteran(), { connected: true, now: at(7) })).toBe(true);
  });

  it("never asks a user who is not connected", () => {
    expect(shouldAskForRating(veteran(), { connected: false, now: at(30) })).toBe(false);
  });

  it("waits for 7 days since first seen", () => {
    expect(shouldAskForRating(veteran(), { connected: true, now: at(6.9) })).toBe(false);
  });

  it("waits for 4 distinct active days", () => {
    expect(shouldAskForRating(veteran(3), { connected: true, now: at(20) })).toBe(false);
  });

  it("never asks without a firstSeen (fresh state)", () => {
    expect(shouldAskForRating(EMPTY_RATING_STATE, { connected: true, now: at(100) })).toBe(false);
  });

  it("respects Don't ask again / Rate", () => {
    expect(shouldAskForRating(markNeverAsk(veteran()), { connected: true, now: at(100) })).toBe(false);
  });

  it("asks a second time only 30+ days after a Later, and never a third time", () => {
    const once = markAsked(veteran(), at(8));
    expect(once.askCount).toBe(1);
    expect(shouldAskForRating(once, { connected: true, now: at(8 + 29) })).toBe(false);
    expect(shouldAskForRating(once, { connected: true, now: at(8 + 30) })).toBe(true);
    const twice = markAsked(once, at(40));
    expect(shouldAskForRating(twice, { connected: true, now: at(400) })).toBe(false);
  });
});

describe("normalizeRatingState", () => {
  it("degrades garbage to a fresh state instead of throwing", () => {
    expect(normalizeRatingState(undefined)).toEqual(EMPTY_RATING_STATE);
    expect(normalizeRatingState("x")).toEqual(EMPTY_RATING_STATE);
    expect(normalizeRatingState({ activeDays: -3, askCount: "2", firstSeen: NaN, neverAsk: "yes" })).toEqual({
      ...EMPTY_RATING_STATE,
      firstSeen: undefined,
      lastActiveDay: undefined,
      lastAskedAt: undefined,
    });
  });

  it("keeps a valid state", () => {
    const s = veteran(5, { askCount: 1, lastAskedAt: at(9), neverAsk: false });
    expect(normalizeRatingState(JSON.parse(JSON.stringify(s)))).toEqual(s);
  });
});

describe("ratingStoreFor", () => {
  it("sends Microsoft builds to the Marketplace review tab", () => {
    expect(ratingStoreFor("Visual Studio Code")).toEqual({ name: "the VS Code Marketplace", url: MARKETPLACE_REVIEW_URL });
    expect(ratingStoreFor("Visual Studio Code - Insiders").url).toBe(MARKETPLACE_REVIEW_URL);
  });

  it("sends every fork to Open VSX", () => {
    for (const app of ["Cursor", "VSCodium", "Kiro", "Windsurf", "Positron", ""]) {
      expect(ratingStoreFor(app)).toEqual({ name: "Open VSX", url: OPEN_VSX_REVIEW_URL });
    }
  });

  it("uses the review URLs the owner asked for", () => {
    expect(MARKETPLACE_REVIEW_URL).toBe(
      "https://marketplace.visualstudio.com/items?itemName=Mnemoverse.mnemoverse-vscode&ssr=false#review-details",
    );
    expect(OPEN_VSX_REVIEW_URL).toBe("https://open-vsx.org/extension/mnemoverse/mnemoverse-vscode/reviews");
  });
});
