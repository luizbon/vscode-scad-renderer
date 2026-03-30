import { Viewer } from './viewer';
import { Customizer } from './customizer';
import { MessageHandler } from './messages';
import { Toolbar } from './toolbar';

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
    (shadows) => { viewer.setShadows(shadows); }
);
