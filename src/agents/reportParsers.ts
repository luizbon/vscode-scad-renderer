/**
 * Pure parsing utilities for agent structured reports.
 *
 * These functions have no VS Code dependency and can be tested directly with mocha/ts-node.
 */

// ─────────────────────────────────────────────────────────────────────────────
// Sentinel block stripping
// ─────────────────────────────────────────────────────────────────────────────

const SENTINEL_PAIRS = [
    ['ORCHESTRATOR_DECISION_START', 'ORCHESTRATOR_DECISION_END'],
    ['DIAGNOSTIC_REPORT_START',     'DIAGNOSTIC_REPORT_END'],
    ['REVIEW_REPORT_START',         'REVIEW_REPORT_END'],
    ['QA_REPORT_START',             'QA_REPORT_END'],
    ['DESIGN_BRIEF_START',          'DESIGN_BRIEF_END'],
] as const;

/**
 * Removes all machine-readable sentinel blocks from agent output,
 * leaving only the natural-language portions readable by the user.
 */
export function stripSentinelBlocks(text: string): string {
    let result = text;
    for (const [start, end] of SENTINEL_PAIRS) {
        const startIdx = result.indexOf(start);
        const endIdx   = result.indexOf(end);
        if (startIdx !== -1 && endIdx !== -1) {
            result = result.substring(0, startIdx) + result.substring(endIdx + end.length);
        }
    }
    // Also strip standalone action tokens like ACTION:GENERATE_CODE
    result = result.replace(/\bACTION:[A-Z_]+\b/g, '');
    return result.trim();
}

// ─────────────────────────────────────────────────────────────────────────────
// Diagnostic Report (Debugger Agent)
// ─────────────────────────────────────────────────────────────────────────────

export const DIAGNOSTIC_REPORT_START = 'DIAGNOSTIC_REPORT_START';
export const DIAGNOSTIC_REPORT_END   = 'DIAGNOSTIC_REPORT_END';

/** Extracted, machine-readable diagnostic report from the debugger LLM. */
export interface DiagnosticReport {
    raw: string;
    errorType?: string;
    location?: string;
    rootCause?: string;
    evidence?: string;
    fixGuidance?: string;
}

/** Parses the structured report block from the LLM's raw output. */
export function parseDiagnosticReport(text: string): DiagnosticReport {
    const start = text.indexOf(DIAGNOSTIC_REPORT_START);
    const end   = text.indexOf(DIAGNOSTIC_REPORT_END);

    if (start === -1 || end === -1) {
        return { raw: text };
    }

    const block = text.substring(start + DIAGNOSTIC_REPORT_START.length, end).trim();

    const extract = (label: string): string | undefined => {
        const regex = new RegExp(`^${label}:\\s*(.+)`, 'm');
        const match = block.match(regex);
        return match ? match[1].trim() : undefined;
    };

    return {
        raw:          block,
        errorType:    extract('Error Type'),
        location:     extract('Location'),
        rootCause:    extract('Root Cause'),
        evidence:     extract('Evidence'),
        fixGuidance:  extract('Fix Guidance'),
    };
}

// ─────────────────────────────────────────────────────────────────────────────
// Review Report (Reviewer Agent)
// ─────────────────────────────────────────────────────────────────────────────

export const REVIEW_REPORT_START = 'REVIEW_REPORT_START';
export const REVIEW_REPORT_END   = 'REVIEW_REPORT_END';

/** Structured review result returned by the reviewer agent. */
export interface ReviewReport {
    raw: string;
    status: 'Approved' | 'Changes Required' | 'Unknown';
    fdmRisks?: string;
    geometricIntegrity?: string;
    briefFidelity?: string;
    changeRequest?: string;
}

/** Parses the structured report block from the LLM's raw output. */
export function parseReviewReport(text: string): ReviewReport {
    const start = text.indexOf(REVIEW_REPORT_START);
    const end   = text.indexOf(REVIEW_REPORT_END);

    if (start === -1 || end === -1) {
        return { raw: text, status: 'Unknown' };
    }

    const block = text.substring(start + REVIEW_REPORT_START.length, end).trim();

    const extract = (label: string): string | undefined => {
        const regex = new RegExp(`^${label}:\\s*(.+)`, 'm');
        const match = block.match(regex);
        return match ? match[1].trim() : undefined;
    };

    const rawStatus = extract('Status') ?? '';
    const status: ReviewReport['status'] =
        rawStatus.includes('Approved')          ? 'Approved'          :
        rawStatus.includes('Changes Required')  ? 'Changes Required'  :
        'Unknown';

    return {
        raw:                block,
        status,
        fdmRisks:           extract('FDM Risks'),
        geometricIntegrity: extract('Geometric Integrity'),
        briefFidelity:      extract('Brief Fidelity'),
        changeRequest:      extract('Change Request'),
    };
}

// ─────────────────────────────────────────────────────────────────────────────
// QA Report (QA Agent)
// ─────────────────────────────────────────────────────────────────────────────

export const QA_REPORT_START = 'QA_REPORT_START';
export const QA_REPORT_END   = 'QA_REPORT_END';

/** Structured QA result returned by the QA agent. */
export interface QaReport {
    raw: string;
    result: 'Pass' | 'Fail' | 'Unknown';
    visualEvidence?: string;
    requirementMatching?: string;
    printabilityStatus?: string;
    changeRequest?: string;
}

/** Parses the structured report block from the LLM's raw output. */
export function parseQaReport(text: string): QaReport {
    const start = text.indexOf(QA_REPORT_START);
    const end   = text.indexOf(QA_REPORT_END);

    if (start === -1 || end === -1) {
        return { raw: text, result: 'Unknown' };
    }

    const block = text.substring(start + QA_REPORT_START.length, end).trim();

    const extract = (label: string): string | undefined => {
        const regex = new RegExp(`^${label}:\\s*(.+)`, 'm');
        const match = block.match(regex);
        return match ? match[1].trim() : undefined;
    };

    const rawResult = extract('Result') ?? '';
    const result: QaReport['result'] =
        rawResult.includes('Pass') ? 'Pass' :
        rawResult.includes('Fail') ? 'Fail' :
        'Unknown';

    return {
        raw:                 block,
        result,
        visualEvidence:      extract('Visual Evidence'),
        requirementMatching: extract('Requirement Matching'),
        printabilityStatus:  extract('Printability Status'),
        changeRequest:       extract('Change Request'),
    };
}

// ─────────────────────────────────────────────────────────────────────────────
// Orchestrator Decision
// ─────────────────────────────────────────────────────────────────────────────

export const ORCHESTRATOR_DECISION_START = 'ORCHESTRATOR_DECISION_START';
export const ORCHESTRATOR_DECISION_END   = 'ORCHESTRATOR_DECISION_END';

export type OrchestratorAction =
    | 'CALL_CODER'
    | 'CALL_REVIEWER'
    | 'CALL_QA'
    | 'CALL_DEBUGGER'
    | 'CALL_DESIGNER'
    | 'DONE'
    | 'UNKNOWN';

/** A single entry in the session change log. */
export interface ChangeLogEntry {
    step: number;
    agent: string;
    summary: string;
    outcome: 'success' | 'failure' | 'pending';
}

/** Context provided to the orchestrator LLM to make the next-action decision. */
export interface OrchestratorContext {
    fileDescription: string;
    designBrief: string;
    trigger: string;
    agentReports: string[];
    currentCode?: string;
    /** Ordered log of changes made this session — prevents regressions across loop iterations. */
    changeLog: ChangeLogEntry[];
}

/** The orchestrator's next-step decision, parsed from its structured output. */
export interface OrchestratorDecision {
    raw: string;
    action: OrchestratorAction;
    reason?: string;
    /** The brief/instruction to pass to the next subagent. */
    brief?: string;
}

/** Parses the orchestrator's decision block from its raw output. */
export function parseOrchestratorDecision(text: string): OrchestratorDecision {
    const start = text.indexOf(ORCHESTRATOR_DECISION_START);
    const end   = text.indexOf(ORCHESTRATOR_DECISION_END);

    if (start === -1 || end === -1) {
        return { raw: text, action: 'UNKNOWN' };
    }

    const block = text.substring(start + ORCHESTRATOR_DECISION_START.length, end).trim();

    const extract = (label: string): string | undefined => {
        const regex = new RegExp(`^${label}:\\s*(.+)`, 'm');
        const match = block.match(regex);
        return match ? match[1].trim() : undefined;
    };

    const rawAction = extract('Action') ?? '';
    const action: OrchestratorAction =
        rawAction.includes('CALL_CODER')     ? 'CALL_CODER'     :
        rawAction.includes('CALL_REVIEWER')  ? 'CALL_REVIEWER'  :
        rawAction.includes('CALL_QA')        ? 'CALL_QA'        :
        rawAction.includes('CALL_DEBUGGER')  ? 'CALL_DEBUGGER'  :
        rawAction.includes('CALL_DESIGNER')  ? 'CALL_DESIGNER'  :
        rawAction.includes('DONE')           ? 'DONE'           :
        'UNKNOWN';

    return {
        raw:    block,
        action,
        reason: extract('Reason'),
        brief:  extract('Brief'),
    };
}

