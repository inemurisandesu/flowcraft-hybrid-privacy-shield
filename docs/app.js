import { decideRoute, repairJsonResponse } from "./router.js";
import { callFirebaseHybridCloud } from "./firebase-hybrid.js";

let simulatedOffline = false;
let onDeviceAvailable = false;

const PRESETS = {
  pii_local: {
    taskType: "summarize",
    privacyMode: "hybrid-auto",
    text:
      "# Q4 Billing Escalation\n" +
      "Customer: alice.tanaka@example.com (Tel: 090-1234-5678, IP: 192.168.10.42)\n" +
      "Temporary webhook token: ghp_1234567890abcdefghij123456\n\n" +
      "Issue: Duplicate invoice #INV-2026-1122 for $450. Requesting refund within 5 business days.",
  },
  hybrid_json: {
    taskType: "structured-json",
    privacyMode: "hybrid-auto",
    text:
      "Vendor Incident Report — Prepared by ops-lead@corp-example.jp (03-5555-0199)\n" +
      "Affected server: 10.24.8.15 | Key leaked: sk-proj1234567890abcdef123456\n" +
      "Action required: Rotate credentials immediately, audit access logs from 2026-11-20, notify security team.",
  },
  offline_shield: {
    taskType: "deep-analysis",
    privacyMode: "strict-local",
    text:
      "CONFIDENTIAL BOARD MEMO\n" +
      "Contact CFO at cfo@private-holdings.co.jp / 080-9999-8888.\n" +
      "Proposed Q1 budget reallocation: $120,000 toward automated security auditing and on-device inference.",
  },
};

async function detectChromeOnDeviceAi() {
  const pill = document.getElementById("pill-nano");
  try {
    if (typeof LanguageModel !== "undefined" && typeof LanguageModel.availability === "function") {
      const avail = await LanguageModel.availability();
      onDeviceAvailable = avail === "available" || avail === "readily";
      pill.textContent = `Chrome Gemini Nano: ${avail}`;
      return;
    }
    if (window.ai?.languageModel?.capabilities) {
      const cap = await window.ai.languageModel.capabilities();
      onDeviceAvailable = cap.available === "readily";
      pill.textContent = `Chrome Gemini Nano: ${cap.available}`;
      return;
    }
    onDeviceAvailable = false;
    pill.textContent = "Chrome Gemini Nano: Fallback Ready";
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
  throw new Error("On-device Gemini Nano API unavailable in this browser");
}

function deterministicLocalSummary(text, taskType, scan) {
  const lines = text.split("\n").map((l) => l.trim()).filter(Boolean);
  return JSON.stringify(
    {
      engine: "LOCAL_DETERMINISTIC_SHIELD",
      taskType,
      headline: lines[0] || "Document",
      lineCount: lines.length,
      piiShielded: scan.counts,
      cloudBytesSent: 0,
      note: "100% local execution with zero cloud egress.",
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

  const decision = decideRoute({ text, taskType, privacyMode, onDeviceAvailable, isOnline });

  document.getElementById("m-route").textContent = decision.target.replaceAll("_", " ");
  document.getElementById("m-pii").textContent = String(decision.scan.totalFindings);
  document.getElementById("m-bytes").textContent = `${decision.cloudBytesSent} B`;
  document.getElementById("route-reason").textContent = decision.reason;

  let resultText = "";
  try {
    if (decision.target === "ON_DEVICE_NANO") {
      resultText = await runOnDeviceNano(`Task: ${taskType}. Be concise.\n\n${decision.payloadToModel}`);
    } else if (decision.target === "FIREBASE_CLOUD_GEMINI") {
      const cloudRes = await callFirebaseHybridCloud(decision.payloadToModel, taskType);
      resultText =
        taskType === "structured-json"
          ? JSON.stringify(repairJsonResponse(cloudRes.text), null, 2)
          : cloudRes.text;
    } else {
      resultText = deterministicLocalSummary(decision.payloadToModel, taskType, decision.scan);
    }
  } catch (err) {
    resultText = `Safe Local Fallback (${err.message}):\n\n` + deterministicLocalSummary(decision.payloadToModel, taskType, decision.scan);
  }

  document.getElementById("m-lat").textContent = `${Math.round(performance.now() - t0)} ms`;
  document.getElementById("output").textContent = resultText;
}

document.getElementById("btn-run").addEventListener("click", executeHybridRouter);
document.getElementById("btn-offline-sim").addEventListener("click", () => {
  simulatedOffline = !simulatedOffline;
  refreshNetworkPill();
});
document.querySelectorAll("[data-preset]").forEach((btn) => {
  btn.addEventListener("click", () => {
    const p = PRESETS[btn.getAttribute("data-preset")];
    if (!p) return;
    document.getElementById("doc-input").value = p.text;
    document.getElementById("task-type").value = p.taskType;
    document.getElementById("privacy-mode").value = p.privacyMode;
    executeHybridRouter();
  });
});
window.addEventListener("online", refreshNetworkPill);
window.addEventListener("offline", refreshNetworkPill);

detectChromeOnDeviceAi();
refreshNetworkPill();
