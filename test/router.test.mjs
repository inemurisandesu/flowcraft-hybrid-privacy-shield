import assert from "node:assert/strict";
import {
  buildExactPrompt,
  buildRuleFallbackReport,
  decideRoute,
  isApprovalStillValid,
  repairJsonResponse,
  utf8ByteLength,
  validateIncidentSchema,
} from "../public/router.js";

// 1. Sensitive simple task with on-device available -> ONLY_ON_DEVICE, no cloud call
const r1 = decideRoute({
  text: "Contact alice@example.com token sk-1234567890abcdef1234",
  taskType: "summarize",
  privacyMode: "hybrid-auto",
  onDeviceAvailable: true,
  isOnline: true,
});
assert.equal(r1.target, "ON_DEVICE_NANO");
assert.equal(r1.inferenceMode, "ONLY_ON_DEVICE");
assert.equal(r1.willContactCloud, false);
assert.equal(r1.scan.totalFindings, 2);

// 2. Complex task with sensitive data -> ONLY_IN_CLOUD after redaction + exact prompt consistency
const r2 = decideRoute({
  text: "User 090-1234-5678 from 10.0.0.5 needs structured JSON extraction",
  taskType: "structured-json",
  privacyMode: "hybrid-auto",
  onDeviceAvailable: true,
  isOnline: true,
});
assert.equal(r2.target, "FIREBASE_CLOUD_GEMINI");
assert.equal(r2.inferenceMode, "ONLY_IN_CLOUD");
assert.equal(r2.willContactCloud, true);
assert.ok(!r2.exactPrompt.includes("090-1234-5678"));
assert.ok(!r2.exactPrompt.includes("10.0.0.5"));
assert.ok(r2.exactPrompt.includes("[REDACTED_PHONE]"));
assert.ok(r2.exactPrompt.includes("[REDACTED_IP]"));
assert.equal(r2.exactPrompt, buildExactPrompt(r2.sanitizedBody, "structured-json"));
assert.equal(r2.promptBytes, utf8ByteLength(r2.exactPrompt));

// 3. Critical Security Gate: Stale cloud approval MUST be rejected after switching to strict-local or offline!
assert.equal(
  isApprovalStillValid(r2, {
    text: "User 090-1234-5678 from 10.0.0.5 needs structured JSON extraction",
    taskType: "structured-json",
    privacyMode: "hybrid-auto",
    isOnline: true,
  }),
  true
);
assert.equal(
  isApprovalStillValid(r2, {
    text: "User 090-1234-5678 from 10.0.0.5 needs structured JSON extraction",
    taskType: "structured-json",
    privacyMode: "strict-local",
    isOnline: true,
  }),
  false
);
assert.equal(
  isApprovalStillValid(r2, {
    text: "User 090-1234-5678 from 10.0.0.5 needs structured JSON extraction",
    taskType: "structured-json",
    privacyMode: "hybrid-auto",
    isOnline: false,
  }),
  false
);
assert.equal(
  isApprovalStillValid(r2, {
    text: "Edited secret text",
    taskType: "structured-json",
    privacyMode: "hybrid-auto",
    isOnline: true,
  }),
  false
);

// 4. Local rule fallback MUST NOT leak raw unredacted PII in headline or body
const r3 = decideRoute({
  text: "Escalation from secret@corp.jp tel 080-9999-8888\nSecond line",
  taskType: "deep-analysis",
  privacyMode: "strict-local",
  onDeviceAvailable: false,
  isOnline: false,
});
assert.equal(r3.target, "LOCAL_RULE_FALLBACK");
const fb = buildRuleFallbackReport(r3.sanitizedBody, "deep-analysis", r3.scan);
assert.equal(fb.cloudRequestMade, false);
assert.ok(!fb.headline.includes("secret@corp.jp"));
assert.ok(!fb.headline.includes("080-9999-8888"));
assert.ok(fb.headline.includes("[REDACTED_EMAIL]"));

// 5. Strict JSON repair + schema validation
const repaired = repairJsonResponse('```json\n{"title":"Duplicate Charge","severity":"high","summary":"Refund needed","actionItems":["Issue refund",],}\n```');
assert.equal(validateIncidentSchema(repaired).valid, true);
assert.equal(validateIncidentSchema({ title: "Only title" }).valid, false);
assert.equal(validateIncidentSchema({ title: "T", severity: "urgent", summary: "S", actionItems: ["A"] }).valid, false);

console.log("All 5 FlowCraft Privacy Shield security, routing, fallback & schema tests passed!");
