import aj from "../lib/arcjet.js";
import { isSpoofedBot } from "@arcjet/inspect";
import { isTest } from "../lib/env.js";

export const arcjetProtection = async (req, res, next) => {
  // Never call a hosted service from the test suite.
  if (isTest) return next();

  try {
    const decision = await aj.protect(req);

    if (decision.isDenied()) {
      if (decision.reason.isRateLimit()) {
        return res.status(429).json({ message: "Rate limit exceeded. Please try again later." });
      }
      if (decision.reason.isBot()) {
        return res.status(403).json({ message: "Bot access denied." });
      }
      return res.status(403).json({ message: "Access denied by security policy." });
    }

    if (decision.results.some(isSpoofedBot)) {
      return res.status(403).json({ message: "Malicious bot activity detected." });
    }

    return next();
  } catch (error) {
    // Deliberate availability trade-off: if Arcjet is unreachable we serve
    // the request rather than taking the whole API down. Logged loudly
    // because a silent fail-open hides outages.
    console.error("Arcjet protection error (failing open):", error?.message ?? error);
    return next();
  }
};
