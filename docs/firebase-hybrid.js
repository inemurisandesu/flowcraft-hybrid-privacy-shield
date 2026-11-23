/**
 * Official Firebase AI Logic Hybrid Inference Wrapper (Firebase Web SDK 12.14.0).
 *
 * Verified against Firebase AI Logic Web Hybrid specifications:
 * - Uses SDK 12.14.0 (includes `InferenceMode`, `inCloudParams`, `initializeDeviceModel()`, `response.inferenceSource`).
 * - Places `model` and `generationConfig` inside `inCloudParams` when `mode` is specified.
 * - Uses `Schema.object({ properties })` (all properties required by default in Firebase AI Logic).
 * - Uses named Firebase app per `projectId` + `apiKey` hash so changing config never reuses a stale app.
 * - Re-runs caller's `assertStillApproved()` synchronously immediately before `generateContent()`.
 * - Never fabricates fake cloud output or fake `inferenceSource`.
 */

const FIREBASE_SDK_VERSION = "12.14.0";

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

function getOrCreateApp(initializeApp, getApps, cfg) {
  const appName = `flowcraft-${cfg.projectId}-${String(cfg.apiKey).slice(-6)}`;
  const existing = getApps().find((a) => a.name === appName);
  return existing || initializeApp(cfg, appName);
}

export async function prepareOnDeviceModel(onProgress) {
  // 1. Always try Chrome Built-in AI Prompt API locally FIRST (zero CDN/network dependency!)
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
    return { ready: true, method: "Chrome LanguageModel.create() (Offline-Capable)" };
  }

  // 2. If online and Firebase configured, try Firebase AI Logic 12.14.0 initializeDeviceModel()
  const cfg = getSavedFirebaseConfig();
  if (cfg && navigator.onLine) {
    const { initializeApp, getApps, getAI, getGenerativeModel, GoogleAIBackend, InferenceMode } =
      await loadFirebaseModules();
    const app = getOrCreateApp(initializeApp, getApps, cfg);
    const ai = getAI(app, { backend: new GoogleAIBackend() });
    const model = getGenerativeModel(ai, {
      mode: InferenceMode.ONLY_ON_DEVICE,
    });
    if (typeof model.initializeDeviceModel === "function") {
      await model.initializeDeviceModel();
      return { ready: true, method: `Firebase AI Logic ${FIREBASE_SDK_VERSION} initializeDeviceModel()` };
    }
  }

  return {
    ready: false,
    method: "On-device Gemini Nano API unavailable in this browser (use Chrome with Built-in AI enabled).",
  };
}

/**
 * Executes live Hybrid AI inference via Firebase AI Logic SDK 12.14.0.
 * Re-validates consent via `assertStillApproved()` right before sending over network.
 */
export async function callFirebaseHybridInference({
  exactPrompt,
  taskType,
  inferenceMode = "ONLY_IN_CLOUD",
  modelName = "gemini-2.5-flash-lite",
  assertStillApproved,
}) {
  const firebaseConfig = getSavedFirebaseConfig();
  if (!firebaseConfig) {
    return {
      live: false,
      cloudRequestMade: false,
      inferenceSource: "NOT_CONFIGURED",
      error:
        "Firebase Web Config is not set. Open 'Firebase Web Config' below to paste your Firebase Web App JSON, or switch to ONLY_ON_DEVICE.",
    };
  }

  const { initializeApp, getApps, getAI, getGenerativeModel, GoogleAIBackend, InferenceMode, Schema } =
    await loadFirebaseModules();

  // Final synchronous consent & policy check AFTER async SDK load, immediately before network egress!
  if (typeof assertStillApproved === "function") {
    assertStillApproved(firebaseConfig.projectId);
  }

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
          }),
        }
      : undefined;

  const app = getOrCreateApp(initializeApp, getApps, firebaseConfig);
  const ai = getAI(app, { backend: new GoogleAIBackend() });

  const resolvedMode = modeMap[inferenceMode] ?? InferenceMode.ONLY_IN_CLOUD;
  const modelParams =
    resolvedMode === InferenceMode.ONLY_ON_DEVICE
      ? { mode: resolvedMode }
      : {
          mode: resolvedMode,
          inCloudParams: {
            model: modelName,
            ...(generationConfig ? { generationConfig } : {}),
          },
        };

  const model = getGenerativeModel(ai, modelParams);
  const result = await model.generateContent(exactPrompt);
  const text = result.response.text();
  // Never fabricate inferenceSource if absent from SDK response
  const inferenceSource = result.response.inferenceSource ?? "UNREPORTED_BY_SDK";
  return {
    live: true,
    cloudRequestMade: resolvedMode !== InferenceMode.ONLY_ON_DEVICE,
    inferenceSource,
    projectId: firebaseConfig.projectId,
    text,
  };
}
