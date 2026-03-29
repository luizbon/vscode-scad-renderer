# Implementation Plan: Debug Orchestration Pipeline

The `/debug` command currently sends a raw system prompt and streams a text response back — the AI "thinks" and talks, but takes no action. The fix is to wire `/debug` into a proper **two-agent pipeline**, mirroring the `/create` flow.

## Architecture

Every pipeline is orchestrator-driven. The orchestrator loops the **Coder ↔ Reviewer** and **Coder ↔ QA** stages indefinitely until each agent explicitly approves. There is **no iteration cap** — the goal is a production-ready output:

```
╔══ /create ══════════════════════════════════════════════════════╗
║  Designer (interview)                                           ║
║  ↓                                                              ║
║  ┌── Coder → Reviewer ──────────────────────────┐              ║
║  │   ↑            │ Changes Required                     │              ║
║  │   └────────────┘ (loops until Approved)               │              ║
║  └──── Approved ──────────────────────────────► ─┤              ║
║                                                   ↓              ║
║  ┌── Coder → QA ────────────────────────────────┐              ║
║  │   ↑       │ Fail                                  │              ║
║  │   └───────┘ (loops until Pass)                    │              ║
║  └──── Pass ───────────────────────────► Final save button       ║
╚═════════════════════════════════════════════════════════════════╝

╔══ /debug ════════════════════════════════════════════════════════╗
║  Debugger (root-cause report)                                    ║
║  ↓                                                               ║
║  ┌── Coder → Reviewer ──────────────────────────┐               ║
║  │   ↑            │ Changes Required                      │               ║
║  │   └────────────┘ (loops until Approved)                │               ║
║  └──── Approved ──────────────────────────────► ─┤               ║
║                                                   ↓               ║
║  ┌── Coder → QA ────────────────────────────────┐               ║
║  │   ↑       │ Fail                                   │               ║
║  │   └───────┘ (loops until Pass)                     │               ║
║  └──── Pass ─────────────────────────► Final summary            ║
╚══════════════════════════════════════════════════════════════════╝
```

The **orchestrator** owns the loop state and is the sole decision-maker for when to advance or repeat. Neither the Reviewer nor QA ever directly re-trigger the Coder — they report to the orchestrator, which does.

## Proposed Changes

---

### [NEW] `src/agents/debuggerAgent.ts`
A dedicated agent that:
1. Loads the `scad-debugger.skill.md` prompt.
2. Sends the SCAD code + render logs to the LLM.
3. Returns a **structured `DiagnosticReport`** — only root cause analysis, no code.
4. Streams its analysis to the chat so the user can see what it found.

---

### [NEW] `src/agents/reviewerAgent.ts`
A shared `runReviewerTurn()` function:
1. Loads `scad-reviewer.skill.md`.
2. Sends the current SCAD code + original design brief.
3. Returns a structured `ReviewReport` (parsed from `REVIEW_REPORT_START…END` delimiters) with a `status: 'Approved' | 'Changes Required'` field.
4. Streams its critique to the chat.

---

### [NEW] `src/agents/qaAgent.ts`
A shared `runQaTurn()` function:
1. Loads `scad-qa.skill.md`.
2. Uses the `scad_renderer_capture_preview` tool for visual inspection.
3. Returns a structured `QaReport` with a `result: 'Pass' | 'Fail'` field and specific `changeRequest` text when failing.
4. Streams its verdict to the chat.

---

### [MODIFY] `src/agents/coderAgent.ts`
- `runCoderTurn` already accepts a `designBrief`. Add an optional `fixBrief: string` parameter used in fix mode.
- When `fixBrief` is set, the coder's input message becomes: `"Fix the following diagnosed root cause in the existing SCAD file:\n\n{DiagnosticReport}\n\nExisting code:\n{scadCode}"`.

---

### [NEW] `src/debugAgent.ts`
Orchestrator for the debug flow — parallel to `createAgent.ts`.

**`handleDebugRequest()`** full flow:
1. Collect SCAD source + render logs from context.
2. Open the file and ensure a preview panel is open.
3. Run `runDebuggerTurn` → extract `DiagnosticReport`.
4. **Reviewer-Coder loop** (orchestrator-driven, no cap):
   - Run `runCoderTurn(…, fixBrief)` with current brief.
   - Run `runReviewerTurn` → if `status === 'Changes Required'`, orchestrator sets new `fixBrief = changeRequest` and loops.
   - Exit loop only when Reviewer returns `status === 'Approved'`.
5. **QA-Coder loop** (orchestrator-driven, no cap):
   - Run `runQaTurn` → if `result === 'Fail'`, orchestrator sets new `fixBrief = changeRequest` and loops.
   - Exit loop only when QA returns `result === 'Pass'`.
6. Stream a final summary to the user.

> **Orchestrator responsibility:** All loop decisions live in the orchestrator. The Reviewer and QA agents only return their structured reports. They never invoke the Coder directly.

---

### [MODIFY] `src/createAgent.ts`
After code generation, add an orchestrator-driven post-generation loop:
5. **Reviewer-Coder loop** (orchestrator-driven, no cap):
   - Run `runReviewerTurn` → if `status === 'Changes Required'`, orchestrator feeds `changeRequest` back to `runCoderTurn` and repeats.
6. **QA-Coder loop** (orchestrator-driven, no cap):
   - Run `runQaTurn` → if `result === 'Fail'`, orchestrator feeds `changeRequest` back to `runCoderTurn` and repeats.
7. Show final save button only when both loops exit with approval.

---

### [MODIFY] `src/aiAssistant.ts`
- Route `command === 'debug'` to `handleDebugRequest`.
- Remove the old `debug:` entry from `COMMAND_PROMPTS`.

---

### [MODIFY] `.agents/skills/scad-debugger.skill.md`
Add structured delimiters `DIAGNOSTIC_REPORT_START / DIAGNOSTIC_REPORT_END` for machine-parseable output.

### [MODIFY] `.agents/skills/scad-reviewer.skill.md`
Add `REVIEW_REPORT_START / REVIEW_REPORT_END` delimiters and expand the Review Pillars section.

### [MODIFY] `.agents/skills/scad-qa.skill.md`
Add `QA_REPORT_START / QA_REPORT_END` delimiters.

---

## Verification Plan

### Automated Tests
- `npm run test`: Full pass required before and after.

### Manual Verification
1. **`/debug` flow**: Open a `.scad` file with a known error → Run `@scad /debug` → Confirm: Debugger analysis streams → Coder fix applies → Reviewer feedback streams → QA captures preview → Final summary shown.
2. **`/create` flow**: Start a `/create` session → Complete the interview → Confirm the full coder → reviewer → QA pipeline runs after code generation.
3. **Reviewer rejection loop**: Manually introduce a printability issue and confirm the reviewer flags it and the coder corrects it before QA.
