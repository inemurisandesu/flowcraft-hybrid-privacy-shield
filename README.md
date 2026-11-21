# FlowCraft Privacy Shield — Hybrid AI Document & PII Router

Built for **Google `#BuildHybridAI 2026`** (Best Web/Chrome App & Hybrid AI Routing).

## Problem
Sending raw business documents directly to cloud LLMs leaks customer emails, phone numbers, IPs, and API keys—while running everything on-device struggles with complex multi-step reasoning and strict schema extraction.

## Hybrid AI Solution
FlowCraft Privacy Shield implements a **3-layer privacy-first hybrid router**:
1. **Deterministic Local PII & Secret Shield (`router.js`)**: Scans and masks emails, phone numbers, IPv4 addresses, cards, and API tokens (`sk-`, `ghp_`, `AKIA`, `AIza`) inside the browser before any network egress.
2. **On-Device Neural Inference (Chrome Built-in AI / Gemini Nano)**: Handles sensitive summaries, ticket triage, and offline requests **100% locally (0 bytes sent to cloud)**.
3. **Sanitized Cloud Hybrid Inference (Firebase AI Logic)**: Routes complex structured JSON extraction and deep analysis to Cloud Gemini using **only PII-redacted payloads**, paired with a deterministic local JSON repair fallback.

## Run Tests Locally
```bash
node test/router.test.mjs
```

## Preview Locally
```bash
python3 -m http.server 8080 --directory public
```
