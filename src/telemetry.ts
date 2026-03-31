import * as vscode from 'vscode';
import TelemetryReporter from '@vscode/extension-telemetry';

const CONNECTION_STRING: string = process.env.TELEMETRY_CONNECTION_STRING || '';

let reporter: TelemetryReporter | undefined;

export function initTelemetry(context: vscode.ExtensionContext): void {
    if (CONNECTION_STRING) {
        reporter = new TelemetryReporter(CONNECTION_STRING);
        context.subscriptions.push(reporter);
    }
}

export function sendEvent(
    eventName: string,
    properties?: Record<string, string>
): void {
    reporter?.sendTelemetryEvent(eventName, properties);
}

export function sendError(error: Error, properties?: Record<string, string>): void {
    reporter?.sendTelemetryErrorEvent(error.name, { ...properties, message: error.message });
}
