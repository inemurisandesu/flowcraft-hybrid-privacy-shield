/**
 * FlowCraft Privacy Shield — Hybrid AI Routing, Redaction, Prompt & Schema Engine
 * Pure ES Module (Browser + Node.js compatible, zero external dependencies).
 *
 * Scope transparency:
 * - Deterministically detects 5 structured PII/secret categories (email, API tokens,
 *   payment card numbers, phone numbers, IPv4 addresses).
 * - Unstructured secrets (names, street addresses, free-text confidentiality) are
 *   addressed via the mandatory editable Step 2 human review before any cloud egress.
 */

const PII_RULES = [
  { name: "email", regex: /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g, token: "[REDACTED_EMAIL]" },
  { name: "api_token", regex: /\b(?:sk-[A-Za-z0-9_-]{16,}|gh[pousr]_[A-Za-z0-9]{20,}|AKIA[0-9A-Z]{16}|AIza[0-9A-Za-z_-]{30,})\b/g, token: "[REDACTED_TOKEN]" },
  { name: "card", regex: /(?<!\d)(?:\d{4}[-\s]?){3}\d{4}(?!\d)/g, token: "[REDACTED_CARD]" },
  { name: "phone", regex: /(?<!\d)(?:\+?\d{1,3}[-\s]?)?(?:\(0?\d{1,4}\)|0\d{1,4})[-\s]?\d{1,4}[-\s]?\d{3,4}(?!\d)/g, token: "[REDACTED_PHONE]" },
  { name: "ipv4", regex: /\b(?:(?:25[0-5]|2[0-4]\d|1?\d?\d)\.){3}(?:25[0-5]|2[0-4]\d|1?\d?\d)\b/g, token: "[REDACTED_IP]" },
];

export function scanAndRedact(text) {
  let redacted = String(text || "");
  const counts = {};
  let totalFindings = 0;

  for (const rule of PII_RULES) {
    const matches = redacted.match(rule.regex);
    if (matches && matches.length > 0) {
      counts[rule.name] = matches.length;
      totalFindings += matches.length;
      redacted = redacted.replace(rule.regex, rule.token);
    }
  }

  return {
    originalLength: String(text || "").length,
    redactedText: redacted,
    counts,
    totalFindings,
    containsSensitiveData: totalFindings > 0,
  };
}

export function utf8ByteLength(str) {
  return new TextEncoder().encode(String(str || "")).length;
}

/**
 * Builds the EXACT prompt string (instruction + sanitized body) displayed in Step 2 preview
 * and transmitted verbatim when approved — zero hidden instructions appended later.
 */
export function buildExactPrompt(sanitizedBody, taskType) {
  const body = String(sanitizedBody || "").trim();
  if (taskType === "structured-json") {
    return (
      "Convert the following sanitized customer support ticket into strict JSON with exact keys: " +
      "title (string), severity (one of: low, medium, high, critical), summary (string), " +
      "actionItems (array of non-empty strings). Do not invent unredacted personal identifiers.\n\n" +
      `Sanitized Ticket:\n${body}`
    );
  }
  if (taskType === "deep-analysis") {
    return (
      "Convert the following sanitized customer support ticket into a concise, shareable Markdown " +
      "incident report with sections: ## Summary, ## Impact, and ## Next Actions. Keep all redaction tokens intact.\n\n" +
      `Sanitized Ticket:\n${body}`
    );
  }
  return (
    "Summarize the following sanitized customer support ticket in 3 concise bullet points without " +
    "reconstructing any redacted identifiers:\n\n" +
    `Sanitized Ticket:\n${body}`
  );
}

/**
 * Core Hybrid AI Routing Policy:
 * - Offline OR "strict-local" -> ALWAYS on-device (`ONLY_ON_DEVICE`), 0 cloud egress.
 * - "hybrid-auto" + simple task + on-device ready -> `ONLY_ON_DEVICE` (Gemini Nano).
 * - Complex synthesis/JSON OR "cloud-redacted" (when online) -> `ONLY_IN_CLOUD` after
 *   deterministic redaction + mandatory Step 2 human approval.
 */
export function decideRoute({
  text,
  taskType = "summarize",
  privacyMode = "hybrid-auto",
  onDeviceAvailable = false,
  isOnline = true,
}) {
  const scan = scanAndRedact(text);
  const isComplexTask = taskType === "deep-analysis" || taskType === "structured-json" || scan.originalLength > 4000;
  const exactPrompt = buildExactPrompt(scan.redactedText, taskType);
  const promptBytes = utf8ByteLength(exactPrompt);

  if (!isOnline || privacyMode === "strict-local") {
    return {
      target: onDeviceAvailable ? "ON_DEVICE_NANO" : "LOCAL_RULE_FALLBACK",
      inferenceMode: "ONLY_ON_DEVICE",
      sanitizedBody: scan.redactedText,
      exactPrompt,
      promptBytes,
      willContactCloud: false,
      reason: !isOnline
        ? "Offline detected: cloud egress disabled (ONLY_ON_DEVICE)."
        : "Strict Local policy active: cloud egress disabled (ONLY_ON_DEVICE).",
      scan,
      snapshot: { text: String(text || ""), taskType, privacyMode, isOnline },
    };
  }

  if (privacyMode === "hybrid-auto" && onDeviceAvailable && !isComplexTask) {
    return {
      target: "ON_DEVICE_NANO",
      inferenceMode: "ONLY_ON_DEVICE",
      sanitizedBody: scan.redactedText,
      exactPrompt,
      promptBytes,
      willContactCloud: false,
      reason: scan.containsSensitiveData
        ? `Masked ${scan.totalFindings} structured PII/secret match(es); simple task stays on-device via Gemini Nano (ONLY_ON_DEVICE).`
        : "Simple local task routed on-device via Gemini Nano (ONLY_ON_DEVICE).",
      scan,
      snapshot: { text: String(text || ""), taskType, privacyMode, isOnline },
    };
  }

  return {
    target: "FIREBASE_CLOUD_GEMINI",
    inferenceMode: "ONLY_IN_CLOUD",
    sanitizedBody: scan.redactedText,
    exactPrompt,
    promptBytes,
    willContactCloud: true,
    reason: scan.containsSensitiveData
      ? `Masked ${scan.totalFindings} structured PII/secret match(es). Inspect & edit the exact prompt below before approving ONLY_IN_CLOUD inference.`
      : "No regex PII matched; inspect & edit the exact prompt below before approving ONLY_IN_CLOUD inference.",
    scan,
    snapshot: { text: String(text || ""), taskType, privacyMode, isOnline },
  };
}

/**
 * Verifies that a Step 1 approval snapshot still matches live UI state before execution.
 * Prevents stale cloud approval from executing after switching to strict-local or offline.
 */
export function isApprovalStillValid(decision, currentState) {
  if (!decision || !decision.snapshot || !currentState) return false;
  const s = decision.snapshot;
  if (s.privacyMode !== currentState.privacyMode) return false;
  if (s.taskType !== currentState.taskType) return false;
  if (s.isOnline !== currentState.isOnline) return false;
  if (s.text !== String(currentState.text || "")) return false;
  if (decision.willContactCloud && (!currentState.isOnline || currentState.privacyMode === "strict-local")) {
    return false;
  }
  return true;
}

/**
 * Safe deterministic rule-based fallback summary — NEVER reads raw unredacted text.
 */
export function buildRuleFallbackReport(sanitizedBody, taskType, scan) {
  const safeText = scanAndRedact(sanitizedBody).redactedText;
  const lines = safeText.split("\n").map((l) => l.trim()).filter(Boolean);
  return {
    engine: "RULE_BASED_LOCAL_FALLBACK",
    inferenceSource: "LOCAL_RULE_FALLBACK",
    taskType,
    headline: lines[0] || "Sanitized Incident Log",
    lineCount: lines.length,
    structuredPiiMasked: scan.counts,
    promptUtf8Bytes: utf8ByteLength(safeText),
    cloudRequestMade: false,
    sanitizedBody: safeText,
  };
}

export function repairJsonResponse(raw) {
  let s = String(raw || "").trim();
  const fence = s.match(/```(?:json|JSON)?\s*\n([\s\S]*?)```/);
  if (fence) s = fence[1].trim();
  const starts = [s.indexOf("{"), s.indexOf("[")].filter((i) => i !== -1);
  if (starts.length) {
    s = s.slice(Math.min(...starts));
    const closer = s[0] === "{" ? "}" : "]";
    const last = s.lastIndexOf(closer);
    if (last !== -1) s = s.slice(0, last + 1);
  }
  s = s.replace(/,\s*([}\]])/g, "$1");
  return JSON.parse(s);
}

const VALID_SEVERITIES = new Set(["low", "medium", "high", "critical"]);

export function validateIncidentSchema(obj) {
  const errors = [];
  if (!obj || typeof obj !== "object" || Array.isArray(obj)) {
    return { valid: false, errors: ["Output must be a JSON object"] };
  }
  if (typeof obj.title !== "string" || !obj.title.trim()) errors.push("title must be a non-empty string");
  if (typeof obj.severity !== "string" || !VALID_SEVERITIES.has(obj.severity.toLowerCase())) {
    errors.push("severity must be one of: low, medium, high, critical");
  }
  if (typeof obj.summary !== "string" || !obj.summary.trim()) errors.push("summary must be a non-empty string");
  if (!Array.isArray(obj.actionItems) || obj.actionItems.length === 0 || !obj.actionItems.every((x) => typeof x === "string" && x.trim())) {
    errors.push("actionItems must be a non-empty array of strings");
  }
  return { valid: errors.length === 0, errors };
}
