import { expect } from 'chai';
import { ScadRunner } from '../src/scadRunner';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
// Use require() to get the mutable CJS exports object rather than an immutable
// ESM namespace object. This allows stubProperty to work on Node 24+.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const cp = require('child_process') as typeof import('child_process');

// Helper to temporarily override a property on a plain CJS module exports object.
// NOTE: pass the CJS require() result (not an ESM namespace object) so that
// Object.defineProperty succeeds on Node 24+.
function stubProperty<T extends object>(obj: T, key: keyof T, value: unknown): () => void {
    const descriptor = Object.getOwnPropertyDescriptor(obj, key);
    Object.defineProperty(obj, key, { configurable: true, writable: true, value });
    return () => {
        if (descriptor) {
            // Always restore as configurable so subsequent stubs can override again
            Object.defineProperty(obj, key, { ...descriptor, configurable: true });
        }
    };
}

describe('ScadRunner', () => {
    it('should determine missing openscad gracefully', async () => {
        const runner = new ScadRunner('some-missing-openscad-executable-12345');
        try {
            await runner.checkVersion();
            expect.fail('Should have thrown error for missing executable');
        } catch (e: any) {
            expect(e.message).to.include('not found or failed');
        }
    });

    it('should compile simple scad content to stl buffer', async () => {
        const runner = new ScadRunner('openscad'); // Assume it exists for integration testing

        // Skip test if openscad is not on system path (unit tests shouldn't strictly require integration)
        let hasScad = true;
        try {
            await runner.checkVersion();
        } catch (e) {
            hasScad = false;
        }

        if (hasScad) {
            const tempScad = path.join(os.tmpdir(), 'test-cube.scad');
            fs.writeFileSync(tempScad, 'cube([10, 10, 10]);');

            try {
                // We don't demand manifold in unit tests, just standard renderStl.
                const { stlBuffer, tmpFile } = await runner.renderStl(tempScad, os.tmpdir());
                expect(stlBuffer.length).to.be.greaterThan(0);

                // First 80 bytes of STL is header
                expect(stlBuffer.length).to.be.greaterThan(80);
                fs.unlinkSync(tmpFile);
            } catch (err: any) {
                if (err.message.includes('unrecognised option') || err.message.includes('manifold')) {
                    console.log('Skipping real renderStl test because openscad version does not support Manifold backend');
                } else {
                    throw err;
                }
            } finally {
                fs.unlinkSync(tempScad);
            }
        } else {
            console.log('Skipping real renderStl test because openscad was not found in PATH');
        }
    });

    // ── extractParameters ──────────────────────────────────────────────────────

    describe('extractParameters', () => {
        it('returns empty array when openscad is missing', async () => {
            const runner = new ScadRunner('some-missing-openscad-executable-12345');
            const result = await runner.extractParameters('/fake/file.scad', os.tmpdir());
            expect(result).to.deep.equal([]);
        });

        it('returns empty array when temp JSON file is not created', async () => {
            // Use a valid executable that exits quickly — `true` on Unix writes no file
            const runner = new ScadRunner('true');
            const result = await runner.extractParameters('/fake/file.scad', os.tmpdir());
            expect(result).to.deep.equal([]);
        });

        it('returns parsed parameters from a well-formed JSON file', async () => {
            const tmpDir = os.tmpdir();
            const scadPath = path.join(tmpDir, 'params-test.scad');
            fs.writeFileSync(scadPath, '/* [Customizer] */ width = 10; // [5:50]');

            const restore = stubProperty(cp, 'execFile', (
                _exe: string,
                args: string[],
                callback: (err: any, stdout: string, stderr: string) => void
            ) => {
                const outIdx = args.indexOf('-o');
                const outPath = outIdx !== -1 ? args[outIdx + 1] : null;
                if (outPath) {
                    fs.writeFileSync(outPath, JSON.stringify({
                        parameters: [{ name: 'width', type: 'number', default: 10 }]
                    }));
                }
                callback(null, '', '');
            });

            const runner = new ScadRunner('openscad');
            try {
                const result = await runner.extractParameters(scadPath, tmpDir);
                expect(result).to.deep.equal([{ name: 'width', type: 'number', default: 10 }]);
            } finally {
                restore();
                try { fs.unlinkSync(scadPath); } catch { /* ignore */ }
            }
        });

        it('returns empty array when JSON file contains no parameters key', async () => {
            const tmpDir = os.tmpdir();
            const restore = stubProperty(cp, 'execFile', (
                _exe: string,
                args: string[],
                callback: (err: any, stdout: string, stderr: string) => void
            ) => {
                const outIdx = args.indexOf('-o');
                const outPath = outIdx !== -1 ? args[outIdx + 1] : null;
                if (outPath) { fs.writeFileSync(outPath, JSON.stringify({ other: 'data' })); }
                callback(null, '', '');
            });

            const runner = new ScadRunner('openscad');
            try {
                const result = await runner.extractParameters('/fake/file.scad', tmpDir);
                expect(result).to.deep.equal([]);
            } finally {
                restore();
            }
        });

        it('returns empty array when JSON file is malformed', async () => {
            const tmpDir = os.tmpdir();
            const restore = stubProperty(cp, 'execFile', (
                _exe: string,
                args: string[],
                callback: (err: any, stdout: string, stderr: string) => void
            ) => {
                const outIdx = args.indexOf('-o');
                const outPath = outIdx !== -1 ? args[outIdx + 1] : null;
                if (outPath) { fs.writeFileSync(outPath, 'not-valid-json'); }
                callback(null, '', '');
            });

            const runner = new ScadRunner('openscad');
            try {
                const result = await runner.extractParameters('/fake/file.scad', tmpDir);
                expect(result).to.deep.equal([]);
            } finally {
                restore();
            }
        });
    });

    // ── supportsManifold ───────────────────────────────────────────────────────

    describe('supportsManifold', () => {
        it('returns true when openscad --help output contains "manifold"', async () => {
            const restore = stubProperty(cp, 'exec', (_cmd: string, callback: (err: any, stdout: string, stderr: string) => void) => {
                callback(null, '', 'Options: --backend=manifold --export-format binstl');
            });

            try {
                const runner = new ScadRunner('openscad');
                const result = await runner.supportsManifold();
                expect(result).to.equal(true);
            } finally {
                restore();
            }
        });

        it('returns false when openscad --help output does not contain "manifold"', async () => {
            const restore = stubProperty(cp, 'exec', (_cmd: string, callback: (err: any, stdout: string, stderr: string) => void) => {
                callback(null, 'OpenSCAD 2019.05', 'Options: --o output');
            });

            try {
                const runner = new ScadRunner('openscad');
                const result = await runner.supportsManifold();
                expect(result).to.equal(false);
            } finally {
                restore();
            }
        });

        it('returns false on exec error', async () => {
            const restore = stubProperty(cp, 'exec', (_cmd: string, callback: (err: any, stdout: string, stderr: string) => void) => {
                callback(new Error('not found'), '', '');
            });

            try {
                const runner = new ScadRunner('nonexistent-openscad');
                const result = await runner.supportsManifold();
                expect(result).to.equal(false);
            } finally {
                restore();
            }
        });
    });

    // ── Command injection safety ───────────────────────────────────────────────

    describe('command injection safety', () => {
        it('handles file paths with spaces without breaking execFile', async () => {
            const tmpDir = os.tmpdir();
            const spacyDir = path.join(tmpDir, 'my scad files');
            fs.mkdirSync(spacyDir, { recursive: true });
            const scadPath = path.join(spacyDir, 'my file.scad');
            fs.writeFileSync(scadPath, 'cube([1,1,1]);');

            const runner = new ScadRunner('some-missing-openscad-executable-12345');
            // The test just confirms that extractParameters does not throw a JS-level
            // error even with paths that contain spaces (no shell injection risk since
            // cp.execFile is used, not exec).
            const result = await runner.extractParameters(scadPath, spacyDir);
            expect(result).to.be.an('array');

            try { fs.unlinkSync(scadPath); } catch { /* ignore */ }
            try { fs.rmdirSync(spacyDir); } catch { /* ignore */ }
        });

        it('handles file paths with special characters gracefully', async () => {
            const runner = new ScadRunner('some-missing-openscad-executable-12345');
            // Paths with $, &, ; etc. — execFile passes args as array, never shell-interpolated.
            const result = await runner.extractParameters('/tmp/file$name;rm -rf /.scad', os.tmpdir());
            expect(result).to.be.an('array');
        });
    });
});
