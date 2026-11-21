import { decideRoute, repairJsonResponse } from "./router.js";

let simulatedOffline = false;
let onDeviceAvailable = false;

async function detectChromeOnDeviceAi() {
  const pill = document.getElementById("pill-nano");
  try {
    if (typeof LanguageModel !== "undefined" && typeof LanguageModel.availability === "function") {
      const avail = await LanguageModel.availability();
      onDeviceAvailable = avail === "available" || avail === "readily";
      pill.textContent = `Chrome Gemini Nano: ${avail}`;
      return;
    }
    if (window.ai && window.ai.languageModel && typeof window.ai.languageModel.capabilities === "function") {
      const cap = await window.ai.languageModel.capabilities();
      onDeviceAvailable = cap.available === "readily";
      pill.textContent = `Chrome Gemini Nano: ${cap.available}`;
      return;
    }
    onDeviceAvailable = false;
    pill.textContent = "Chrome Gemini Nano: Fallback Mode";
  } catch {
    onDeviceAvailable = false;
    pill.textContent = "Chrome Gemini Nano: Unavailable";
  }
}

function refreshNetworkPill() {
  const online = navigator.onLine && !simulatedOffline;
  document.getElementById("pill-net").textContent = online
    ? "Network: Online"
    : "Network: Offline (Local Shield Active)";
}

async function runOnDeviceNano(promptText) {
  if (typeof LanguageModel !== "undefined" && typeof LanguageModel.create === "function") {
    const session = await LanguageModel.create();
    try {
      return await session.prompt(promptText);
    } finally {
      session.destroy?.();
    }
  }
  if (window.ai?.languageModel?.create) {
    const session = await window.ai.languageModel.create();
    try {
      return await session.prompt(promptText);
    } finally {
      session.destroy?.();
    }
  }
  throw new Error("On-device model API not available in this browser");
}

function deterministicLocalSummary(text, taskType, scan) {
  const lines = text.split("\n").map((l) => l.trim()).filter(Boolean);
  const headline = lines[0] || "Document";
  return JSON.stringify(
    {
      engine: "LOCAL_DETERMINISTIC_SHIELD",
      taskType,
      headline,
      lineCount: lines.length,
      piiShielded: scan.counts,
      note: "Executed 100% locally with 0 bytes sent to cloud. Enable Chrome Built-in AI (Gemini Nano) for full on-device neural inference, or connect Firebase AI Logic config for sanitized cloud hybrid routing.",
    },
    null,
    2
  );
}

async function executeHybridRouter() {
  const t0 = performance.now();
  const text = document.getElementById("doc-input").value;
  const taskType = document.getElementById("task-type").value;
  const privacyMode = document.getElementById("privacy-mode").value;
  const isOnline = navigator.onLine && !simulatedOffline;

  const decision = decideRoute({
    text,
    taskType,
    privacyMode,
    onDeviceAvailable,
    isOnline,
  });

  document.getElementById("m-route").textContent = decision.target.replaceAll("_", " ");
  document.getElementById("m-pii").textContent = String(decision.scan.totalFindings);
  document.getElementById("m-bytes").textContent = `${decision.cloudBytesSent} B`;
  document.getElementById("route-reason").textContent = decision.reason;

  let resultText = "";
  try {
    if (decision.target === "ON_DEVICE_NANO") {
      const prompt = `Task: ${taskType}. Respond concisely.\n\n${decision.payloadToModel}`;
      resultText = await runOnDeviceNano(prompt);
    } else if (decision.target === "FIREBASE_CLOUD_GEMINI") {
      // Cloud integration hook: when Firebase AI Logic is configured in firebase-config.js,
      // call Firebase getAI() / getGenerativeModel() with ONLY decision.payloadToModel (PII already stripped).
      const mockCloudStructured = JSON.stringify(
        {
          route: "FIREBASE_CLOUD_GEMINI (Sanitized Payload Ready)",
          taskType,
          piiStrippedBeforeEgress: decision.scan.counts,
          sanitizedPayloadSentToCloud: decision.payloadToModel,
        },
        null,
        2
      );
      resultText = taskType === "structured-json"
        ? JSON.stringify(repairJsonResponse(mockCloudStructured), null, 2)
        : mockCloudStructured;
    } else {
      resultText = deterministicLocalSummary(decision.payloadToModel, taskType, decision.scan);
    }
  } catch (err) {
    resultText = `Fallback triggered (${err.message}):\n\n` + deterministicLocalSummary(decision.payloadToModel, taskType, decision.scan);
  }

  const dt = Math.round(performance.now() - t0);
  document.getElementById("m-lat").textContent = `${dt} ms`;
  document.getElementById("output").textContent = resultText;
}

document.getElementById("btn-run").addEventListener("click", executeHybridRouter);
document.getElementById("btn-offline-sim").addEventListener("click", () => {
  simulatedOffline = !simulatedOffline;
  refreshNetworkPill();
});
window.addEventListener("online", refreshNetworkPill);
window.addEventListener("offline", refreshNetworkPill);

detectChromeOnDeviceAi();
refreshNetworkPill();
