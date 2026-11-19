import { resendClient, sender } from "../lib/resend.js";
import { ENV } from "../lib/env.js";
import { createWelcomeEmailTemplate } from "./emailTemplates.js";

export const sendWelcomeEmail = async (email, name, clientURL) => {
  // Email is optional infrastructure: with no key configured (tests, or a
  // fresh clone) there is nothing to send and nothing to log as a failure.
  if (!ENV.RESEND_API_KEY) return;
  const { data, error } = await resendClient.emails.send({
    from: `${sender.name} <${sender.email}>`,
    to: email,
    subject: "Welcome to ConvoSphere!",
    html: createWelcomeEmailTemplate(name, clientURL),
  });

  if (error) {
    console.error("Error sending welcome email:", error.message ?? error);
    throw new Error("Failed to send welcome email");
  }

  console.log("Welcome email sent:", data?.id ?? "ok");
};
