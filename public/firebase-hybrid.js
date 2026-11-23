/**
 * Official Firebase AI Logic Hybrid Inference Wrapper (Firebase Web SDK 12.6.0).
 *
 * Uses official InferenceMode (`ONLY_ON_DEVICE` / `ONLY_IN_CLOUD`), explicit
 * `responseSchema` for structured JSON, `initializeDeviceModel()` on user gesture,
 * and returns real `response.inferenceSource`.
 *
 * Honesty policy: NEVER fabricates fake cloud responses when Firebase Web Config
 * is missing or a call fails.
 */

const FIREBASE_SDK_VERSION = "12.6.0";

async function loadFirebaseModules() {
  const [{ initializeApp, getApps }, aiMod] = await Promise.all([
    import(`https://www.gstatic.com/firebasejs/${FIREBASE_SDK_VERSION}/firebase-app.js`),
    import(`https://www.gstatic.com/firebasejs/${FIREBASE_SDK_VERSION}/firebase-ai.js`),
  ]);
  return { initializeApp, getApps, ...aiMod };
}

export function getSavedFirebaseConfig() {
  if (window.__FIREBASE_CONFIG__ && typeof window.__FIREBASE_CONFIG__ === "object") {
    return window.__FIREBASE_CONFIG__;
  }
  const raw = localStorage.getItem("flowcraft_firebase_config");
  if (!raw || !raw.trim()) return null;
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" && parsed.apiKey && parsed.projectId ? parsed : null;
  } catch {
    return null;
  }
}

export async function prepareOnDeviceModel(onProgress) {
  // 1. Prefer Chrome Built-in AI Prompt API user-gesture initialization
  if (typeof LanguageModel !== "undefined" && typeof LanguageModel.create === "function") {
    const session = await LanguageModel.create({
      monitor(m) {
        m.addEventListener("downloadprogress", (e) => {
          if (typeof onProgress === "function") {
            onProgress(Math.round((e.loaded || 0) * 100));
          }
        });
      },
    });
    session.destroy?.();
    return { ready: true, method: "Chrome LanguageModel.create()" };
  }

  // 2. Fallback to Firebase AI Logic on-device initializer if configured
  const cfg = getSavedFirebaseConfig();
  if (cfg) {
    const { initializeApp, getApps, getAI, getGenerativeModel, GoogleAIBackend, InferenceMode } =
      await loadFirebaseModules();
    const app = getApps().length ? getApps()[0] : initializeApp(cfg);
    const ai = getAI(app, { backend: new GoogleAIBackend() });
    const model = getGenerativeModel(ai, {
      model: "gemini-2.5-flash",
      mode: InferenceMode.ONLY_ON_DEVICE,
    });
    if (typeof model.initializeDeviceModel === "function") {
      await model.initializeDeviceModel();
      return { ready: true, method: "Firebase AI Logic initializeDeviceModel()" };
    }
  }

  return {
    ready: false,
    method: "On-device Gemini Nano API not available in this browser (use Chrome with Built-in AI enabled).",
  };
}

/**
 * Executes live Hybrid AI inference via Firebase AI Logic SDK 12.6.0.
 * Sends the EXACT user-approved prompt string verbatim (`exactPrompt`).
 */
export async function callFirebaseHybridInference({
  exactPrompt,
  taskType,
  inferenceMode = "ONLY_IN_CLOUD",
}) {
  const firebaseConfig = getSavedFirebaseConfig();
  if (!firebaseConfig) {
    return {
      live: false,
      inferenceSource: "NOT_CONFIGURED",
      error:
        "Firebase Web Config is not set. Open 'Firebase Web Config' below to paste your Firebase project config JSON, or switch to ONLY_ON_DEVICE.",
    };
  }

  const { initializeApp, getApps, getAI, getGenerativeModel, GoogleAIBackend, InferenceMode, Schema } =
    await loadFirebaseModules();

  const modeMap = {
    ONLY_ON_DEVICE: InferenceMode.ONLY_ON_DEVICE,
    PREFER_ON_DEVICE: InferenceMode.PREFER_ON_DEVICE,
    ONLY_IN_CLOUD: InferenceMode.ONLY_IN_CLOUD,
  };

  const generationConfig =
    taskType === "structured-json" && Schema
      ? {
          responseMimeType: "application/json",
          responseSchema: Schema.object({
            properties: {
              title: Schema.string(),
              severity: Schema.enumString({ enum: ["low", "medium", "high", "critical"] }),
              summary: Schema.string(),
              actionItems: Schema.array({ items: Schema.string() }),
            },
            required: ["title", "severity", "summary", "actionItems"],
          }),
        }
      : undefined;

  const app = getApps().length ? getApps()[0] : initializeApp(firebaseConfig);
  const ai = getAI(app, { backend: new GoogleAIBackend() });
  const model = getGenerativeModel(ai, {
    model: "gemini-2.5-flash",
    mode: modeMap[inferenceMode] ?? InferenceMode.ONLY_IN_CLOUD,
    ...(generationConfig ? { generationConfig } : {}),
  });

  const result = await model.generateContent(exactPrompt);
  const text = result.response.text();
  const inferenceSource = result.response.inferenceSource || inferenceMode;
  return {
    live: true,
    inferenceSource,
    text,
  };
}
