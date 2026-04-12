'use strict';
/**
 * Test bootstrap: intercepts require('vscode') and returns a minimal stub
 * so tests can run outside the VS Code host.
 *
 * Loaded via `--require test/setup.js` before any test files.
 */

const Module = require('module');
const path = require('path');

// ── Minimal vscode mock ────────────────────────────────────────────────────────

class LanguageModelTextPart {
    constructor(value) { this.value = value; }
}

class LanguageModelToolCallPart {
    constructor(callId, name, input) {
        this.callId = callId;
        this.name = name;
        this.input = input;
    }
}

class LanguageModelImagePart {
    constructor(data, mimeType) {
        this.data = data;
        this.mimeType = mimeType;
    }
}

class LanguageModelDataPart {
    static image(data, mimeType) {
        return new LanguageModelDataPart(data, mimeType);
    }
    constructor(data, mimeType) {
        this.data = data;
        this.mimeType = mimeType;
    }
}

class LanguageModelToolResultPart {
    constructor(callId, content) {
        this.callId = callId;
        this.content = content;
    }
}

class LanguageModelChatMessage {
    static User(content) { return new LanguageModelChatMessage('user', content); }
    static Assistant(content) { return new LanguageModelChatMessage('assistant', content); }
    constructor(role, content) {
        this.role = role;
        this.content = content;
    }
}

class LanguageModelToolResult {
    constructor(content) { this.content = content; }
}

const vscodeMockExports = {
    LanguageModelTextPart,
    LanguageModelImagePart,
    LanguageModelDataPart,
    LanguageModelToolCallPart,
    LanguageModelToolResultPart,
    LanguageModelChatMessage,
    LanguageModelToolResult,
    Uri: {
        file: (p) => ({ fsPath: p, scheme: 'file', toString: () => 'file://' + p }),
        joinPath: (base, ...segs) => {
            const nodePath = require('path');
            const joined = nodePath.join(base.fsPath, ...segs);
            return { fsPath: joined, scheme: 'file', toString: () => 'file://' + joined };
        },
    },
    ViewColumn: { One: 1, Two: 2, Three: 3 },
    workspace: {
        workspaceFolders: null,
        fs: {
            createDirectory: async () => {},
            writeFile: async () => {},
            readFile: async () => Buffer.alloc(0),
        },
        openTextDocument: async (uri) => ({ uri, getText: () => '' }),
        activeTextEditor: undefined,
    },
    window: {
        activeTextEditor: undefined,
        showTextDocument: async () => {},
        createOutputChannel: (_name) => ({
            appendLine: () => {},
            append: () => {},
            show: () => {},
            hide: () => {},
            clear: () => {},
            dispose: () => {},
        }),
    },
    commands: {
        executeCommand: async () => {},
    },
    lm: {
        tools: [],
        invokeTool: async (_name, _opts, _token) => ({ content: [] }),
        registerTool: (_name, _handler) => ({ dispose: () => {} }),
    },
};

// ── Intercept Module._resolveFilename for 'vscode' ────────────────────────────

// Use a stable synthetic path as the cache key for the mock module.
const MOCK_PATH = path.resolve(__dirname, '__vscode_mock__.js');

// Register the mock in the require cache under the synthetic path.
const mod = new Module(MOCK_PATH);
mod.exports = vscodeMockExports;
mod.filename = MOCK_PATH;
mod.loaded = true;
require.cache[MOCK_PATH] = mod;

// Patch _resolveFilename so that require('vscode') returns MOCK_PATH,
// which Node then finds in the cache without hitting the file system.
const _origResolve = Module._resolveFilename;
Module._resolveFilename = function (request, parent, isMain, options) {
    if (request === 'vscode') {
        return MOCK_PATH;
    }
    return _origResolve.call(this, request, parent, isMain, options);
};
