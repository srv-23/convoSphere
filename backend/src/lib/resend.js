import { Resend } from "resend";
import { ENV } from "./env.js";

const apiKey = ENV.RESEND_API_KEY;

/**
 * `new Resend(undefined)` throws at import time, which would crash the app
 * (and the test suite) before a single request is handled. Email is a
 * non-critical side effect, so degrade to a no-op when unconfigured.
 */
export const resendClient = apiKey
  ? new Resend(apiKey)
  : {
      emails: {
        send: async () => ({
          data: null,
          error: { message: "RESEND_API_KEY is not configured" },
        }),
      },
    };

export const sender = {
  email: ENV.EMAIL_FROM ?? "no-reply@localhost",
  name: ENV.EMAIL_FROM_NAME ?? "ConvoSphere",
};
