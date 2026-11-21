/**
 * Optional Firebase AI Logic (Gemini Developer API) integration module.
 * Works seamlessly when Firebase web config is supplied via localStorage or window.__FIREBASE_CONFIG__,
 * and safely falls back to sanitized preview mode when unconfigured.
 */

export async function callFirebaseHybridCloud(sanitizedPrompt, taskType) {
  const cfgRaw = window.__FIREBASE_CONFIG__ || localStorage.getItem("flowcraft_firebase_config");
  if (!cfgRaw) {
    return {
      live: false,
      text: JSON.stringify(
        {
          mode: "DEMO_SIMULATED_CLOUD (Connect Firebase Web Config for Live Gemini Call)",
          taskType,
          guaranteedPiiFree: true,
          sanitizedPayloadReceivedByCloud: sanitizedPrompt,
          extractedSummary:
            "Billing duplicate invoice detected; refund requested within 5 business days; all PII stripped locally prior to cloud transmission.",
        },
        null,
        2
      ),
    };
  }

  const firebaseConfig = typeof cfgRaw === "string" ? JSON.parse(cfgRaw) : cfgRaw;
  const { initializeApp, getApps } = await import("https://www.gstatic.com/firebasejs/11.6.0/firebase-app.js");
  const { getAI, getGenerativeModel, GoogleAIBackend } = await import(
    "https://www.gstatic.com/firebasejs/11.6.0/firebase-ai.js"
  );

  const app = getApps().length ? getApps()[0] : initializeApp(firebaseConfig);
  const ai = getAI(app, { backend: new GoogleAIBackend() });
  const model = getGenerativeModel(ai, { model: "gemini-2.5-flash" });

  const instruction =
    taskType === "structured-json"
      ? "Return ONLY valid JSON with keys: title, category, urgency, actionItems (array of strings)."
      : "Provide a concise, actionable executive risk analysis in 4 bullet points.";

  const response = await model.generateContent(`${instruction}\n\nSanitized Input:\n${sanitizedPrompt}`);
  return { live: true, text: response.response.text() };
}
