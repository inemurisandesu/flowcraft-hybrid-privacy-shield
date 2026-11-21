import assert from "node:assert/strict";
import { decideRoute, repairJsonResponse, scanAndRedact } from "../public/router.js";

// 1. Sensitive simple task with on-device available -> 0 bytes sent to cloud
const r1 = decideRoute({
  text: "Contact alice@example.com token sk-1234567890abcdef1234",
  taskType: "summarize",
  privacyMode: "hybrid-auto",
  onDeviceAvailable: true,
  isOnline: true,
});
assert.equal(r1.target, "ON_DEVICE_NANO");
assert.equal(r1.cloudBytesSent, 0);
assert.equal(r1.scan.totalFindings, 2);

// 2. Complex task with sensitive data -> routed to Firebase Cloud ONLY after PII redaction
const r2 = decideRoute({
  text: "User 090-1234-5678 from 10.0.0.5 needs structured JSON extraction",
  taskType: "structured-json",
  privacyMode: "hybrid-auto",
  onDeviceAvailable: true,
  isOnline: true,
});
assert.equal(r2.target, "FIREBASE_CLOUD_GEMINI");
assert.ok(r2.cloudBytesSent > 0);
assert.ok(!r2.payloadToModel.includes("090-1234-5678"));
assert.ok(!r2.payloadToModel.includes("10.0.0.5"));
assert.ok(r2.payloadToModel.includes("[REDACTED_PHONE]"));
assert.ok(r2.payloadToModel.includes("[REDACTED_IP]"));

// 3. Offline mode -> never sends cloud bytes
const r3 = decideRoute({
  text: "Offline urgent report",
  taskType: "deep-analysis",
  privacyMode: "hybrid-auto",
  onDeviceAvailable: false,
  isOnline: false,
});
assert.equal(r3.target, "LOCAL_DETERMINISTIC_FALLBACK");
assert.equal(r3.cloudBytesSent, 0);

// 4. Deterministic JSON repair
const repaired = repairJsonResponse('```json\n{"status": "ok", "items": [1, 2,],}\n```');
assert.deepEqual(repaired, { status: "ok", items: [1, 2] });

console.log("All FlowCraft Privacy Shield hybrid router tests passed!");
