import arcjet, { shield, detectBot, slidingWindow } from "@arcjet/node";
import { ENV, isTest } from "./env.js";

const hasKey = Boolean(ENV.ARCJET_KEY);

/**
 * Arcjet is a hosted service: it needs a key and a network round trip.
 * When the key is absent (tests, or a fresh clone before .env is filled in)
 * we fall back to a pass-through decision so the app still boots.
 */
const passthrough = {
  protect: async () => ({
    isDenied: () => false,
    results: [],
  }),
};

function createClient() {
  if (isTest || !hasKey) {
    if (!hasKey && !isTest) {
      console.warn("ARCJET_KEY is not set - rate limiting is disabled.");
    }
    return passthrough;
  }

  return arcjet({
    key: ENV.ARCJET_KEY,
    rules: [
      // Shield protects against common attacks e.g. SQL/NoSQL injection
      shield({ mode: "LIVE" }),
      detectBot({
        mode: "LIVE",
        // Block all bots except the following
        allow: ["CATEGORY:SEARCH_ENGINE"],
      }),
      // Sliding-window rate limit keyed by client IP
      slidingWindow({
        mode: "LIVE",
        max: 100,
        interval: 60,
      }),
    ],
  });
}

const aj = createClient();

export default aj;
