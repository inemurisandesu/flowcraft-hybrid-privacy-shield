/**
 * FlowCraft Privacy Shield — Hybrid AI Routing Engine (Pure ES Module + Node compatible).
 * Decides deterministically whether a task runs 100% on-device (Chrome Gemini Nano)
 * or routes PII-redacted content to Cloud AI (Firebase AI Logic / Gemini).
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

/**
 * Core Hybrid AI Routing Policy:
 * - "strict-local" mode OR offline -> ALWAYS on-device (never send a single byte to cloud).
 * - Sensitive data present & simple task & on-device model ready -> ON_DEVICE_LOCAL (0 bytes sent).
 * - Complex synthesis/structured JSON task OR on-device unavailable -> REDACTED_CLOUD (only PII-redacted text sent).
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

  if (!isOnline || privacyMode === "strict-local") {
    return {
      target: onDeviceAvailable ? "ON_DEVICE_NANO" : "LOCAL_DETERMINISTIC_FALLBACK",
      payloadToModel: text,
      cloudBytesSent: 0,
      reason: !isOnline
        ? "Offline detected: executing 100% locally."
        : "Strict Local Privacy mode: zero cloud egress enforced.",
      scan,
    };
  }

  if (privacyMode === "hybrid-auto" && onDeviceAvailable && !isComplexTask) {
    return {
      target: "ON_DEVICE_NANO",
      payloadToModel: text,
      cloudBytesSent: 0,
      reason: scan.containsSensitiveData
        ? `Detected ${scan.totalFindings} PII/secret item(s): handled 100% on-device via Chrome Gemini Nano (0 bytes sent to cloud).`
        : "Low-latency local task: handled on-device via Chrome Gemini Nano (zero cloud cost).",
      scan,
    };
  }

  // Cloud route (Firebase AI Logic) — ALWAYS strip PII before egress!
  const safePayload = scan.redactedText;
  return {
    target: "FIREBASE_CLOUD_GEMINI",
    payloadToModel: safePayload,
    cloudBytesSent: new TextEncoder().encode(safePayload).length,
    reason: scan.containsSensitiveData
      ? `Complex task (${taskType}): stripped ${scan.totalFindings} PII/secret item(s) locally before routing sanitized payload to Firebase AI Logic.`
      : `Complex task (${taskType}): routed to Firebase AI Logic cloud inference.`,
    scan,
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
