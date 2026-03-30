import * as vscode from 'vscode';

let logger: vscode.TelemetryLogger | undefined;

export function initTelemetry(context: vscode.ExtensionContext): void {
    const sender: vscode.TelemetrySender = {
        sendEventData(_eventName: string, _data?: Record<string, unknown>) {
            // VS Code handles routing through its own telemetry pipeline.
            // Replace this body with your own backend (Application Insights, etc.) if needed.
        },
        sendErrorData(_error: Error, _data?: Record<string, unknown>) {
            // Same as above.
        }
    };

    logger = vscode.env.createTelemetryLogger(sender, {
        ignoreBuiltInCommonProperties: false,
        additionalCommonProperties: {
            extensionVersion: context.extension.packageJSON.version as string
        }
    });

    context.subscriptions.push(logger);
}

export function sendEvent(
    eventName: string,
    properties?: Record<string, string | number | boolean>
): void {
    logger?.logUsage(eventName, properties);
}

export function sendError(error: Error, properties?: Record<string, string>): void {
    logger?.logError(error, properties);
}
