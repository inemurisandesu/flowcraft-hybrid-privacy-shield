# FlowCraft Privacy Shield — Hybrid AI Support Incident Router

Built for **Google `#BuildHybridAI 2026`** (Firebase AI Logic + Chrome Built-in AI / Gemini Nano).

- **Live Demo (GitHub Pages)**: https://inemurisandesu.github.io/flowcraft-hybrid-privacy-shield/
- **License**: MIT (`LICENSE`)

## Problem
Support and ops teams want AI-structured incident reports, yet pasting raw tickets into cloud LLMs exposes customer emails, phone numbers, IP addresses, and leaked API tokens. Running everything on-device preserves privacy but can struggle with strict schema extraction.

## Hybrid AI Architecture (Honest Scope & Explicit Consent)
1. **Step 1 — Local Structured PII Redaction (`public/router.js`)**:
   - Deterministically masks 5 structured categories locally in the browser: **emails, API tokens (`sk-`, `ghp_`, `AKIA`, `AIza`), payment card numbers, phone numbers, and IPv4 addresses**.
   - **Transparent Scope**: Unstructured secrets (names, street addresses, confidential prose) cannot be guaranteed by regex alone, so Step 2 provides an **editable sanitized ticket box** and displays the **exact verbatim prompt (instruction + ticket) and UTF-8 byte size** before any inference runs.
2. **Step 2 — Explicit Consent & Stale-Approval Guard (`public/app.js`)**:
   - Any change to input text, output format, inference policy, or network connectivity **immediately invalidates** prior Step 1 approval.
   - Approval is re-validated and atomically consumed before the first `await` so switching to `ONLY_ON_DEVICE` (Strict Local) or going offline can never trigger a stale cloud call.
3. **Hybrid Execution (`public/firebase-hybrid.js`, Firebase Web SDK `12.6.0`)**:
   - **On-Device (`InferenceMode.ONLY_ON_DEVICE` / Chrome Prompt API)**: Handles local summaries and offline/strict-local workflows with zero cloud requests. Includes a user-gesture **Prepare On-Device Model** button (`LanguageModel.create()` / `initializeDeviceModel()`).
   - **Cloud (`InferenceMode.ONLY_IN_CLOUD` + `responseSchema`)**: Sends ONLY the user-reviewed verbatim prompt to `gemini-2.5-flash` with strict JSON `responseSchema`, validates required keys/types, and displays the real `response.inferenceSource`.
   - **Honest Fallback**: Never fabricates fake cloud output when Firebase Web Config is unset—clearly displays `CLOUD NOT CONFIGURED` and offers a rule-based local fallback built strictly from redacted text.

## Judge Reproduction Guide
1. **Run Unit Tests**:
   ```bash
   node test/router.test.mjs
   ```
2. **Preview Locally**:
   ```bash
   python3 -m http.server 8080 --directory public
   ```
3. **Test All 3 Hybrid Paths**:
   - **On-Device Offline Path**: Click **Prepare On-Device Model** (Chrome with Built-in AI), toggle offline, select Preset 1, run Step 1 → Step 2 (verify 0 network requests in DevTools Network tab).
   - **Live Cloud Schema Path**: Open **Firebase Web Config**, paste your Firebase Web App JSON (`apiKey`, `projectId`, `appId`), select Preset 2 (same refund ticket), review/edit Step 2 exact prompt, click Step 2 → inspect live `response.inferenceSource` and validated JSON.
   - **Security Guard Check**: Run Step 1 on Cloud mode, switch Inference Policy to `ONLY_ON_DEVICE (No Cloud Requests)` → verify approval is immediately invalidated and Step 2 button disables.
