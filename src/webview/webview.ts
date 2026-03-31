import { Viewer } from './viewer';
import { Customizer } from './customizer';
import { MessageHandler } from './messages';
import { Toolbar } from './toolbar';

// fflate (bundled inside ThreeMFLoader) calls performance.mark/clearMarks.
// In VS Code's Electron webview, performance may exist but lack these methods.
if (typeof performance !== 'undefined') {
    if (typeof performance.mark !== 'function') { (performance as any).mark = () => {}; }
    if (typeof performance.clearMarks !== 'function') { (performance as any).clearMarks = () => {}; }
}

const vscode = acquireVsCodeApi();

const viewer = new Viewer();

let handler: MessageHandler;
const customizer = new Customizer((name, value, instant) => {
    handler!.sendParameterChanged(name, value, instant);
});
handler = new MessageHandler(vscode, viewer, customizer);

const toolbar = new Toolbar(
    (mode) => { viewer.setRenderMode(mode); handler.sendRenderModeChanged(mode); },
    (proj) => { viewer.setCameraProjection(proj); handler.sendCameraProjectionChanged(proj); },
    (shadows) => { viewer.setShadows(shadows); },
    () => { handler.sendExport(); }
);
