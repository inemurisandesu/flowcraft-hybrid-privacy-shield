/**
 * Official Firebase AI Logic Hybrid Inference wrapper.
 * Supports InferenceMode.ONLY_ON_DEVICE, PREFER_ON_DEVICE, and ONLY_IN_CLOUD
 * when Firebase Web Config is provided, with deterministic offline/demo fallback.
 */

export async function callFirebaseHybridCloud(sanitizedPrompt, taskType, inferenceMode = "ONLY_IN_CLOUD") {
  const cfgRaw = window.__FIREBASE_CONFIG__ || localStorage.getItem("flowcraft_firebase_config");
  if (!cfgRaw) {
    const simulated =
      taskType === "structured-json"
        ? JSON.stringify(
            {
              title: "Duplicate Billing & Token Exposure Incident",
              severity: "high",
              inferenceMode,
              piiFreeVerified: true,
              summary: "Customer reported duplicate invoice and exposed credentials in ticket text. All PII/tokens were stripped on-device before cloud synthesis.",
              actionItems: [
                "Verify duplicate invoice ID and issue refund within 5 business days",
                "Rotate any credentials referenced in the redacted ticket",
                "Send sanitized status update back to customer support queue",
              ],
            },
            null,
            2
          )
        : [
            "## Shareable Incident Report (Sanitized Cloud Synthesis)",
            `- **Firebase AI Logic Mode**: \`${inferenceMode}\``,
            "- **Privacy Guarantee**: Raw PII/secrets never left the browser.",
            "- **Summary**: Customer escalated a duplicate billing issue with embedded sensitive data. Local shield masked all identifiers prior to cloud formatting.",
            "- **Next Actions**: Confirm refund timeline, rotate affected tokens, and close ticket.",
          ].join("\n");
    return { live: false, mode: inferenceMode, text: simulated };
  }

  const firebaseConfig = typeof cfgRaw === "string" ? JSON.parse(cfgRaw) : cfgRaw;
  const { initializeApp, getApps } = await import("https://www.gstatic.com/firebasejs/11.6.0/firebase-app.js");
  const { getAI, getGenerativeModel, GoogleAIBackend, InferenceMode } = await import(
    "https://www.gstatic.com/firebasejs/11.6.0/firebase-ai.js"
  );

  const modeMap = {
    ONLY_ON_DEVICE: InferenceMode?.ONLY_ON_DEVICE ?? "only_on_device",
    PREFER_ON_DEVICE: InferenceMode?.PREFER_ON_DEVICE ?? "prefer_on_device",
    ONLY_IN_CLOUD: InferenceMode?.ONLY_IN_CLOUD ?? "only_in_cloud",
  };

  const app = getApps().length ? getApps()[0] : initializeApp(firebaseConfig);
  const ai = getAI(app, { backend: new GoogleAIBackend() });
  const model = getGenerativeModel(ai, {
    model: "gemini-2.5-flash",
    mode: modeMap[inferenceMode] ?? modeMap.ONLY_IN_CLOUD,
  });

  const instruction =
    taskType === "structured-json"
      ? "Convert this sanitized customer support log into strict JSON with keys: title, severity, summary, actionItems (string array)."
      : "Convert this sanitized customer support log into a clean shareable Markdown incident report with Summary, Impact, and Action Items.";

  const response = await model.generateContent(`${instruction}\n\nSanitized Log:\n${sanitizedPrompt}`);
  return { live: true, mode: inferenceMode, text: response.response.text() };
}
