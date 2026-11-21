# Devpost Submission Draft — `#BuildHybridAI 2026`

## Project Name
**FlowCraft Privacy Shield — Deterministic PII & Hybrid AI Router**

## Tagline
Zero-leakage Hybrid AI routing: sensitive documents stay 100% on-device with Chrome Gemini Nano, while complex reasoning routes only PII-redacted payloads to Firebase AI Logic.

## Inspiration
Enterprises and solo developers hesitate to adopt cloud LLMs for real business documents because invoices, support tickets, and incident logs contain emails, phone numbers, IP addresses, and leaked API keys. Yet pure on-device small models struggle with strict schema extraction and deep multi-step analysis. Hybrid AI solves this tension directly.

## What It Does
1. **Layer 1 — Deterministic On-Device PII & Secret Shield**: Scans every input locally in sub-millisecond time for emails, phone numbers, IPv4 addresses, card-like numbers, and API tokens (`sk-`, `ghp_`, `AKIA`, `AIza`).
2. **Layer 2 — Chrome Built-in AI (Gemini Nano) Local Inference**: When on-device inference is available for quick summaries, triage, or offline work, executes **100% on-device with 0 bytes sent to cloud**.
3. **Layer 3 — Firebase AI Logic Hybrid Cloud Inference + Deterministic JSON Repair**: For complex structured JSON extraction or deep analysis, strips every detected PII/secret locally first, routes only the sanitized text to Firebase AI Logic (`google/gemini-2.5-flash`), and runs a deterministic local JSON repairer if the output contains Markdown fences or trailing commas.

## Built With
- Chrome Built-in AI (`LanguageModel` / Gemini Nano)
- Firebase AI Logic (`firebase/ai`, `GoogleAIBackend`)
- Firebase Hosting
- Vanilla ES Modules (zero external npm supply-chain dependencies)
- Node.js native test runner (`node:assert/strict`)

## Repository
`https://github.com/inemurisandesu/flowcraft-hybrid-privacy-shield`
