import { Viewer } from './viewer';
import { Customizer } from './customizer';
import { MessageHandler } from './messages';

const vscode = acquireVsCodeApi();

const viewer = new Viewer();

const customizer = new Customizer((name, value, instant) => {
    handler.sendParameterChanged(name, value, instant);
});

const handler = new MessageHandler(vscode, viewer, customizer);
