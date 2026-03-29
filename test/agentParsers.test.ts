import { expect } from 'chai';
import { parseDiagnosticReport, parseReviewReport, parseQaReport, parseOrchestratorDecision } from '../src/agents/reportParsers';

// ─────────────────────────────────────────────────────────────────────────────
// parseDiagnosticReport
// ─────────────────────────────────────────────────────────────────────────────

describe('parseDiagnosticReport', () => {
    it('returns raw text when delimiters are absent', () => {
        const result = parseDiagnosticReport('Some analysis with no delimiters.');
        expect(result.raw).to.equal('Some analysis with no delimiters.');
        expect(result.errorType).to.be.undefined;
        expect(result.fixGuidance).to.be.undefined;
    });

    it('extracts all fields from a well-formed report', () => {
        const text = `
Some preamble text.

DIAGNOSTIC_REPORT_START
Error Type: Logical
Location: my_model.scad / Line 42 / module wall
Root Cause: The difference() subtrahend is larger than the base cylinder.
Evidence: Render produces an empty geometry (0 triangles in STL output).
Fix Guidance: Reduce the subtrahend radius to be smaller than base_r.
DIAGNOSTIC_REPORT_END

Some closing remarks.
        `;
        const result = parseDiagnosticReport(text);
        expect(result.errorType).to.equal('Logical');
        expect(result.location).to.equal('my_model.scad / Line 42 / module wall');
        expect(result.rootCause).to.equal('The difference() subtrahend is larger than the base cylinder.');
        expect(result.evidence).to.equal('Render produces an empty geometry (0 triangles in STL output).');
        expect(result.fixGuidance).to.equal('Reduce the subtrahend radius to be smaller than base_r.');
    });

    it('handles missing optional fields gracefully', () => {
        const text = `
DIAGNOSTIC_REPORT_START
Error Type: Syntax
DIAGNOSTIC_REPORT_END
        `;
        const result = parseDiagnosticReport(text);
        expect(result.errorType).to.equal('Syntax');
        expect(result.location).to.be.undefined;
        expect(result.fixGuidance).to.be.undefined;
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// parseReviewReport
// ─────────────────────────────────────────────────────────────────────────────

describe('parseReviewReport', () => {
    it('returns Unknown status when delimiters are absent', () => {
        const result = parseReviewReport('No structured block here.');
        expect(result.status).to.equal('Unknown');
    });

    it('parses an Approved status correctly', () => {
        const text = `
REVIEW_REPORT_START
Status: Approved
FDM Risks: None
Geometric Integrity: OK
Brief Fidelity: All requirements met.
Change Request: N/A
REVIEW_REPORT_END
        `;
        const result = parseReviewReport(text);
        expect(result.status).to.equal('Approved');
        expect(result.fdmRisks).to.equal('None');
        expect(result.geometricIntegrity).to.equal('OK');
        expect(result.briefFidelity).to.equal('All requirements met.');
        expect(result.changeRequest).to.equal('N/A');
    });

    it('parses a Changes Required status correctly', () => {
        const text = `
REVIEW_REPORT_START
Status: Changes Required
FDM Risks: Overhang at 60° on the top lip.
Geometric Integrity: OK
Brief Fidelity: Missing the hook mounting hole.
Change Request: Add a 4 mm mounting hole centred on the back plate at Z=20.
REVIEW_REPORT_END
        `;
        const result = parseReviewReport(text);
        expect(result.status).to.equal('Changes Required');
        expect(result.changeRequest).to.equal('Add a 4 mm mounting hole centred on the back plate at Z=20.');
    });

    it('handles Unknown status when the Status field is unrecognised', () => {
        const text = `
REVIEW_REPORT_START
Status: Conditional
FDM Risks: Minor
REVIEW_REPORT_END
        `;
        const result = parseReviewReport(text);
        expect(result.status).to.equal('Unknown');
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// parseQaReport
// ─────────────────────────────────────────────────────────────────────────────

describe('parseQaReport', () => {
    it('returns Unknown result when delimiters are absent', () => {
        const result = parseQaReport('No QA block found.');
        expect(result.result).to.equal('Unknown');
    });

    it('parses a Pass result correctly', () => {
        const text = `
QA_REPORT_START
Result: Pass
Visual Evidence: A clean cube sitting flat on the build plate with no artefacts.
Requirement Matching: Yes — matches the design brief exactly.
Printability Status: Pass
Change Request: N/A
QA_REPORT_END
        `;
        const result = parseQaReport(text);
        expect(result.result).to.equal('Pass');
        expect(result.visualEvidence).to.include('clean cube');
        expect(result.changeRequest).to.equal('N/A');
    });

    it('parses a Fail result with change request', () => {
        const text = `
QA_REPORT_START
Result: Fail
Visual Evidence: The model appears hollow with missing top face.
Requirement Matching: No — the lid is absent from the generated model.
Printability Status: Fail — non-manifold geometry detected.
Change Request: Add a top_thickness parameter and close the top face with a translate+cube.
QA_REPORT_END
        `;
        const result = parseQaReport(text);
        expect(result.result).to.equal('Fail');
        expect(result.printabilityStatus).to.include('non-manifold');
        expect(result.changeRequest).to.include('top_thickness');
    });

    it('handles Unknown result when the Result field is unrecognised', () => {
        const text = `
QA_REPORT_START
Result: Review
Visual Evidence: Something odd.
QA_REPORT_END
        `;
        const result = parseQaReport(text);
        expect(result.result).to.equal('Unknown');
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// parseOrchestratorDecision
// ─────────────────────────────────────────────────────────────────────────────

describe('parseOrchestratorDecision', () => {
    it('returns UNKNOWN when no decision block is found', () => {
        const result = parseOrchestratorDecision('No decision here.');
        expect(result.action).to.equal('UNKNOWN');
    });

    it('extracts CALL_CODER with a brief', () => {
        const text = `
ORCHESTRATOR_DECISION_START
Action: CALL_CODER
Brief: Add a hole at the back.
ORCHESTRATOR_DECISION_END
        `;
        const result = parseOrchestratorDecision(text);
        expect(result.action).to.equal('CALL_CODER');
        expect(result.brief).to.equal('Add a hole at the back.');
    });

    it('extracts CALL_REVIEWER without a brief', () => {
        const text = `
ORCHESTRATOR_DECISION_START
Action: CALL_REVIEWER
ORCHESTRATOR_DECISION_END
        `;
        const result = parseOrchestratorDecision(text);
        expect(result.action).to.equal('CALL_REVIEWER');
        expect(result.brief).to.be.undefined;
    });

    it('extracts DONE correctly', () => {
        const text = `
ORCHESTRATOR_DECISION_START
Action: DONE
ORCHESTRATOR_DECISION_END
        `;
        const result = parseOrchestratorDecision(text);
        expect(result.action).to.equal('DONE');
    });

    it('handles UNKNOWN action gracefully', () => {
        const text = `
ORCHESTRATOR_DECISION_START
Action: SURRENDER
ORCHESTRATOR_DECISION_END
        `;
        const result = parseOrchestratorDecision(text);
        expect(result.action).to.equal('UNKNOWN');
    });
});
