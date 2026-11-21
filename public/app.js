import { decideRoute, repairJsonResponse } from "./router.js";
import { callFirebaseHybridCloud } from "./firebase-hybrid.js";

let simulatedOffline = false;
let onDeviceAvailable = false;
let pendingDecision = null;

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
    : "Network: Offline (ONLY_ON_DEVICE Active)";
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
      engine: "ONLY_ON_DEVICE_DETERMINISTIC_SHIELD",
      taskType,
      headline: lines[0] || "Incident Log",
      lineCount: lines.length,
      piiShielded: scan.counts,
      cloudBytesSent: 0,
      sanitizedSummaryText: scan.redactedText,
    },
    null,
    2
  );
}

function runStep1LocalScan() {
  const t0 = performance.now();
  const text = document.getElementById("doc-input").value;
  const taskType = document.getElementById("task-type").value;
  const privacyMode = document.getElementById("privacy-mode").value;
  const isOnline = navigator.onLine && !simulatedOffline;

  pendingDecision = decideRoute({ text, taskType, privacyMode, onDeviceAvailable, isOnline });
  pendingDecision.taskType = taskType;

  document.getElementById("m-route").textContent = `PREVIEW (${pendingDecision.target.replaceAll("_", " ")})`;
  document.getElementById("m-pii").textContent = String(pendingDecision.scan.totalFindings);
  document.getElementById("m-bytes").textContent = "0 B (Awaiting Consent)";
  document.getElementById("m-lat").textContent = `${Math.round(performance.now() - t0)} ms (local)`;
  document.getElementById("route-reason").textContent = pendingDecision.reason;

  const isCloud = pendingDecision.target === "FIREBASE_CLOUD_GEMINI";
  document.getElementById("preview-box").textContent = isCloud
    ? `[EXACT PAYLOAD TO BE SENT TO CLOUD — ${pendingDecision.cloudBytesSent} bytes]\n\n${pendingDecision.payloadToModel}`
    : `[0 BYTES WILL LEAVE THIS DEVICE — LOCAL EXECUTION ONLY]\n\n${pendingDecision.scan.redactedText}`;

  const approveBtn = document.getElementById("btn-approve");
  approveBtn.disabled = false;
  approveBtn.textContent = isCloud
    ? `Step 2: Approve & Send Sanitized Payload (${pendingDecision.cloudBytesSent} B)`
    : "Step 2: Generate Report 100% On-Device (0 B Sent)";
  document.getElementById("output").textContent = "Review the preview above, then click Step 2.";
}

async function runStep2ApprovedExecution() {
  if (!pendingDecision) return;
  const t0 = performance.now();
  const d = pendingDecision;

  document.getElementById("m-route").textContent = d.target.replaceAll("_", " ");
  document.getElementById("m-bytes").textContent = `${d.cloudBytesSent} B`;

  let resultText = "";
  try {
    if (d.target === "ON_DEVICE_NANO") {
      resultText = await runOnDeviceNano(
        `Create a concise shareable incident summary without exposing raw PII:\n\n${d.scan.redactedText}`
      );
    } else if (d.target === "FIREBASE_CLOUD_GEMINI") {
      const cloudRes = await callFirebaseHybridCloud(d.payloadToModel, d.taskType, "ONLY_IN_CLOUD");
      resultText =
        d.taskType === "structured-json"
          ? JSON.stringify(repairJsonResponse(cloudRes.text), null, 2)
          : cloudRes.text;
    } else {
      resultText = deterministicLocalSummary(d.payloadToModel, d.taskType, d.scan);
    }
  } catch (err) {
    resultText = `Safe Local Fallback (${err.message}):\n\n` + deterministicLocalSummary(d.payloadToModel, d.taskType, d.scan);
  }

  document.getElementById("m-lat").textContent = `${Math.round(performance.now() - t0)} ms`;
  document.getElementById("output").textContent = resultText;
  document.getElementById("btn-copy").disabled = false;
}

document.getElementById("btn-scan").addEventListener("click", runStep1LocalScan);
document.getElementById("btn-approve").addEventListener("click", runStep2ApprovedExecution);
document.getElementById("btn-copy").addEventListener("click", async () => {
  const txt = document.getElementById("output").textContent;
  try {
    await navigator.clipboard.writeText(txt);
    document.getElementById("btn-copy").textContent = "Copied!";
    setTimeout(() => (document.getElementById("btn-copy").textContent = "Copy Final Report"), 1500);
  } catch {}
});
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
    runStep1LocalScan();
  });
});
window.addEventListener("online", refreshNetworkPill);
window.addEventListener("offline", refreshNetworkPill);

detectChromeOnDeviceAi();
refreshNetworkPill();
