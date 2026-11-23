import {
  buildExactPrompt,
  buildRuleFallbackReport,
  decideRoute,
  isApprovalStillValid,
  repairJsonResponse,
  utf8ByteLength,
  validateIncidentSchema,
} from "./router.js";
import {
  callFirebaseHybridInference,
  getSavedFirebaseConfig,
  prepareOnDeviceModel,
} from "./firebase-hybrid.js";

let simulatedOffline = false;
let onDeviceAvailable = false;
let pendingDecision = null;
let executionInFlight = false;
let activeRunEpoch = 0;

const PRESETS = {
  pii_local: {
    taskType: "summarize",
    privacyMode: "hybrid-auto",
    text:
      "# Q4 Refund Escalation Ticket #INV-2026-1122\n" +
      "Customer: alice.tanaka@example.com (Tel: 090-1234-5678, IP: 192.168.10.42)\n" +
      "Temporary webhook token: ghp_1234567890abcdefghij123456\n\n" +
      "Issue: Duplicate charge of $450 on invoice #INV-2026-1122. Customer requests refund within 5 business days and webhook credential rotation confirmation.",
  },
  hybrid_json: {
    taskType: "structured-json",
    privacyMode: "hybrid-auto",
    text:
      "# Q4 Refund Escalation Ticket #INV-2026-1122\n" +
      "Customer: alice.tanaka@example.com (Tel: 090-1234-5678, IP: 192.168.10.42)\n" +
      "Temporary webhook token: ghp_1234567890abcdefghij123456\n\n" +
      "Issue: Duplicate charge of $450 on invoice #INV-2026-1122. Customer requests refund within 5 business days and webhook credential rotation confirmation.",
  },
  offline_shield: {
    taskType: "deep-analysis",
    privacyMode: "strict-local",
    text:
      "CONFIDENTIAL SECURITY TICKET\n" +
      "Reporter: ops-lead@corp-example.jp / Tel: 03-5555-0199 / Host: 10.24.8.15\n" +
      "Leaked key: sk-proj1234567890abcdef123456\n" +
      "Action required: Rotate credentials immediately and audit logs from 2026-11-20.",
  },
};

function currentUiState() {
  return {
    text: document.getElementById("doc-input").value,
    taskType: document.getElementById("task-type").value,
    privacyMode: document.getElementById("privacy-mode").value,
    isOnline: navigator.onLine && !simulatedOffline,
  };
}

function invalidateApproval(reason) {
  activeRunEpoch += 1;
  if (!pendingDecision) return;
  pendingDecision = null;
  const approveBtn = document.getElementById("btn-approve");
  approveBtn.disabled = true;
  approveBtn.textContent = "Step 2: Re-run Step 1 to Approve";
  document.getElementById("m-route").textContent = "APPROVAL CLEARED";
  document.getElementById("route-reason").textContent =
    reason || "Inputs or policy changed. Previous approval was invalidated — re-run Step 1.";
}

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
    pill.textContent = "Chrome Gemini Nano: Not Detected (Rule Fallback Ready)";
  } catch {
    onDeviceAvailable = false;
    pill.textContent = "Chrome Gemini Nano: Unavailable";
  }
}

function refreshNetworkPill() {
  const online = navigator.onLine && !simulatedOffline;
  document.getElementById("pill-net").textContent = online
    ? "Network: Online"
    : "Network: Offline (ONLY_ON_DEVICE Enforced)";
}

function refreshFirebasePill() {
  const cfg = getSavedFirebaseConfig();
  document.getElementById("pill-fb").textContent = cfg
    ? `Firebase AI Logic: Configured (${cfg.projectId})`
    : "Firebase AI Logic: Not Configured";
}

async function runOnDeviceNano(exactPrompt) {
  // Always try Chrome Built-in AI locally FIRST (100% independent of CDN/network!)
  if (typeof LanguageModel !== "undefined" && typeof LanguageModel.create === "function") {
    const session = await LanguageModel.create();
    try {
      const text = await session.prompt(exactPrompt);
      return { live: true, cloudRequestMade: false, inferenceSource: "ON_DEVICE_CHROME_NANO", text };
    } finally {
      session.destroy?.();
    }
  }
  if (window.ai?.languageModel?.create) {
    const session = await window.ai.languageModel.create();
    try {
      const text = await session.prompt(exactPrompt);
      return { live: true, cloudRequestMade: false, inferenceSource: "ON_DEVICE_CHROME_NANO", text };
    } finally {
      session.destroy?.();
    }
  }
  throw new Error("On-device Gemini Nano API unavailable in this browser");
}

function refreshPreviewPrompt() {
  if (!pendingDecision) return;
  const editedSanitized = document.getElementById("preview-sanitized").value;
  const exactPrompt = buildExactPrompt(editedSanitized, pendingDecision.snapshot.taskType);
  const bytes = utf8ByteLength(exactPrompt);
  pendingDecision.sanitizedBody = editedSanitized;
  pendingDecision.exactPrompt = exactPrompt;
  pendingDecision.promptBytes = bytes;

  document.getElementById("exact-prompt-box").textContent = exactPrompt;
  document.getElementById("m-bytes").textContent = `${bytes} B (UTF-8)`;

  const approveBtn = document.getElementById("btn-approve");
  if (!approveBtn.disabled) {
    approveBtn.textContent = pendingDecision.willContactCloud
      ? `Step 2: Approve & Send Exact Prompt (${bytes} B, ONLY_IN_CLOUD)`
      : `Step 2: Run Locally (${bytes} B, ONLY_ON_DEVICE)`;
  }
}

function runStep1LocalScan() {
  const t0 = performance.now();
  const ui = currentUiState();
  pendingDecision = decideRoute({
    text: ui.text,
    taskType: ui.taskType,
    privacyMode: ui.privacyMode,
    onDeviceAvailable,
    isOnline: ui.isOnline,
  });

  document.getElementById("m-route").textContent = `PREVIEW (${pendingDecision.inferenceMode})`;
  document.getElementById("m-pii").textContent = String(pendingDecision.scan.totalFindings);
  document.getElementById("m-bytes").textContent = `${pendingDecision.promptBytes} B (UTF-8)`;
  document.getElementById("m-result").textContent = "AWAITING STEP 2";
  document.getElementById("route-reason").textContent = pendingDecision.reason;

  const sanInput = document.getElementById("preview-sanitized");
  sanInput.value = pendingDecision.sanitizedBody;
  sanInput.disabled = false;
  document.getElementById("exact-prompt-box").textContent = pendingDecision.exactPrompt;

  const approveBtn = document.getElementById("btn-approve");
  approveBtn.disabled = false;
  approveBtn.textContent = pendingDecision.willContactCloud
    ? `Step 2: Approve & Send Exact Prompt (${pendingDecision.promptBytes} B, ONLY_IN_CLOUD)`
    : `Step 2: Run Locally (${pendingDecision.promptBytes} B, ONLY_ON_DEVICE)`;
  document.getElementById("output").textContent =
    `Step 1 local scan finished in ${Math.round(performance.now() - t0)} ms (0 cloud requests). ` +
    "Review or edit the sanitized text above to mask any unstructured names/addresses, then click Step 2.";
}

async function runStep2ApprovedExecution() {
  if (executionInFlight || !pendingDecision) return;

  // Re-validate live state synchronously BEFORE the first await!
  const ui = currentUiState();
  if (!isApprovalStillValid(pendingDecision, ui)) {
    invalidateApproval("Blocked: policy, input, or network state changed after Step 1 preview.");
    return;
  }

  const d = pendingDecision;
  const approvedProjectId = getSavedFirebaseConfig()?.projectId || null;
  const myEpoch = ++activeRunEpoch;
  pendingDecision = null;
  executionInFlight = true;

  const approveBtn = document.getElementById("btn-approve");
  approveBtn.disabled = true;
  approveBtn.textContent = "Executing...";
  document.getElementById("preview-sanitized").disabled = true;

  const t0 = performance.now();
  let outputText = "";
  let execResult = "UNKNOWN";
  let cloudRequestAttempted = false;

  try {
    if (!d.willContactCloud) {
      if (d.target === "ON_DEVICE_NANO") {
        try {
          const nanoRes = await runOnDeviceNano(d.exactPrompt);
          outputText = nanoRes.text;
          execResult = `${nanoRes.inferenceSource} (0 B cloud)`;
        } catch (err) {
          const fb = buildRuleFallbackReport(d.sanitizedBody, d.snapshot.taskType, d.scan);
          outputText = JSON.stringify({ note: `On-device Nano unavailable: ${err.message}`, ...fb }, null, 2);
          execResult = "RULE_FALLBACK (0 B cloud)";
        }
      } else {
        const fb = buildRuleFallbackReport(d.sanitizedBody, d.snapshot.taskType, d.scan);
        outputText = JSON.stringify(fb, null, 2);
        execResult = "RULE_FALLBACK (0 B cloud)";
      }
    } else {
      // ONLY_IN_CLOUD path — re-validates consent right before network egress AFTER async SDK load!
      const cloudRes = await callFirebaseHybridInference({
        exactPrompt: d.exactPrompt,
        taskType: d.snapshot.taskType,
        inferenceMode: "ONLY_IN_CLOUD",
        assertStillApproved: (liveProjectId) => {
          const liveUi = currentUiState();
          if (myEpoch !== activeRunEpoch || !isApprovalStillValid(d, liveUi)) {
            throw new Error("CONSENT_REVOKED: policy, input, or network state changed before network egress.");
          }
          if (approvedProjectId && liveProjectId !== approvedProjectId) {
            throw new Error("CONSENT_REVOKED: Firebase target project changed after Step 1 preview.");
          }
          cloudRequestAttempted = true;
        },
      });

      if (!cloudRes.live) {
        execResult = "CLOUD NOT CONFIGURED";
        outputText =
          `[NO CLOUD CALL EXECUTED — ${cloudRes.inferenceSource}]\n` +
          `${cloudRes.error}\n\n` +
          "Deterministic Rule-Based Local Preview (cloudRequestMade: false):\n" +
          JSON.stringify(buildRuleFallbackReport(d.sanitizedBody, d.snapshot.taskType, d.scan), null, 2);
      } else if (d.snapshot.taskType === "structured-json") {
        cloudRequestAttempted = true;
        const parsed = repairJsonResponse(cloudRes.text);
        const check = validateIncidentSchema(parsed);
        execResult = check.valid
          ? `${cloudRes.inferenceSource} (SCHEMA OK)`
          : `${cloudRes.inferenceSource} (SCHEMA WARN)`;
        outputText = JSON.stringify(
          {
            cloudRequestMade: true,
            projectId: cloudRes.projectId,
            inferenceSource: cloudRes.inferenceSource,
            schemaValid: check.valid,
            schemaErrors: check.errors,
            data: parsed,
          },
          null,
          2
        );
      } else {
        cloudRequestAttempted = true;
        execResult = `${cloudRes.inferenceSource} (LIVE)`;
        outputText = `[cloudRequestMade: true | projectId: ${cloudRes.projectId} | inferenceSource: ${cloudRes.inferenceSource}]\n\n${cloudRes.text}`;
      }
    }
  } catch (err) {
    execResult = cloudRequestAttempted ? "CLOUD ERROR (REQUEST SENT)" : "ABORTED / SAFE FALLBACK";
    const fb = buildRuleFallbackReport(d.sanitizedBody, d.snapshot.taskType, d.scan);
    fb.cloudRequestMade = cloudRequestAttempted;
    outputText = `[Execution note: ${err.message}]\n\n` + JSON.stringify(fb, null, 2);
  } finally {
    executionInFlight = false;
    approveBtn.textContent = "Step 2: Run Step 1 Again for New Request";
  }

  // Do not overwrite UI if user started a newer Step 1 scan while this run was in flight
  if (myEpoch !== activeRunEpoch) return;

  document.getElementById("m-route").textContent = d.inferenceMode;
  document.getElementById("m-result").textContent = `${execResult} · ${Math.round(performance.now() - t0)} ms`;
  document.getElementById("output").textContent = outputText;
  document.getElementById("btn-copy").disabled = false;
}

// Event bindings — ANY change to inputs, task, policy, or connectivity invalidates stale approval immediately!
document.getElementById("doc-input").addEventListener("input", () =>
  invalidateApproval("Raw input edited — previous Step 1 approval cleared.")
);
document.getElementById("task-type").addEventListener("change", () =>
  invalidateApproval("Output format changed — previous Step 1 approval cleared.")
);
document.getElementById("privacy-mode").addEventListener("change", () =>
  invalidateApproval("Inference policy changed — previous Step 1 approval cleared.")
);
document.getElementById("preview-sanitized").addEventListener("input", refreshPreviewPrompt);

document.getElementById("btn-scan").addEventListener("click", runStep1LocalScan);
document.getElementById("btn-approve").addEventListener("click", runStep2ApprovedExecution);

document.getElementById("btn-prepare-nano").addEventListener("click", async () => {
  const btn = document.getElementById("btn-prepare-nano");
  btn.disabled = true;
  btn.textContent = "Initializing On-Device Model...";
  try {
    const res = await prepareOnDeviceModel((pct) => {
      btn.textContent = `Downloading Nano: ${pct}%`;
    });
    document.getElementById("route-reason").textContent = res.ready
      ? `On-device model ready via ${res.method}.`
      : res.method;
    await detectChromeOnDeviceAi();
  } catch (err) {
    document.getElementById("route-reason").textContent = `On-device init failed: ${err.message}`;
  } finally {
    btn.disabled = false;
    btn.textContent = "Prepare On-Device Model";
  }
});

document.getElementById("btn-copy").addEventListener("click", async () => {
  try {
    await navigator.clipboard.writeText(document.getElementById("output").textContent);
    document.getElementById("btn-copy").textContent = "Copied!";
    setTimeout(() => (document.getElementById("btn-copy").textContent = "Copy Final Report"), 1500);
  } catch {}
});

document.getElementById("btn-offline-sim").addEventListener("click", () => {
  simulatedOffline = !simulatedOffline;
  refreshNetworkPill();
  invalidateApproval("Network connectivity toggled — previous Step 1 approval cleared.");
});

document.getElementById("btn-save-fb").addEventListener("click", () => {
  const raw = document.getElementById("fb-config-input").value.trim();
  if (!raw) {
    localStorage.removeItem("flowcraft_firebase_config");
    refreshFirebasePill();
    document.getElementById("fb-status").textContent = "Cleared saved Firebase Web Config.";
    return;
  }
  try {
    const parsed = JSON.parse(raw);
    if (!parsed.apiKey || !parsed.projectId) throw new Error("JSON must include apiKey and projectId");
    localStorage.setItem("flowcraft_firebase_config", JSON.stringify(parsed));
    refreshFirebasePill();
    document.getElementById("fb-status").textContent = `Saved config for project: ${parsed.projectId}`;
  } catch (err) {
    document.getElementById("fb-status").textContent = `Invalid JSON: ${err.message}`;
  }
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

window.addEventListener("online", () => {
  refreshNetworkPill();
  invalidateApproval("Browser came online — previous approval cleared.");
});
window.addEventListener("offline", () => {
  refreshNetworkPill();
  invalidateApproval("Browser went offline — cloud approval invalidated.");
});

detectChromeOnDeviceAi();
refreshNetworkPill();
refreshFirebasePill();
