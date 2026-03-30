import { Viewer } from './viewer';
import { Customizer } from './customizer';
import { MessageHandler } from './messages';

const vscode = acquireVsCodeApi();

const viewer = new Viewer();

let handler: MessageHandler;
const customizer = new Customizer((name, value, instant) => {
    handler!.sendParameterChanged(name, value, instant);
});
handler = new MessageHandler(vscode, viewer, customizer);
