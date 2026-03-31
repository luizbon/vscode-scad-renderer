import * as cp from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

export class ScadRunner {
    constructor(private executablePath: string) { }

    public async checkVersion(): Promise<string> {
        return new Promise((resolve, reject) => {
            cp.exec(`"${this.executablePath}" -v`, (err, stdout, stderr) => {
                const combined = stdout + stderr;
                if (err && !combined.includes('OpenSCAD')) {
                    reject(new Error(`OpenSCAD not found or failed: ${err.message}`));
                } else {
                    resolve(combined);
                }
            });
        });
    }

    public async supportsManifold(): Promise<boolean> {
        return new Promise((resolve) => {
            cp.exec(`"${this.executablePath}" --help`, (err, stdout, stderr) => {
                const combined = stdout + stderr;
                resolve(combined.toLowerCase().includes('manifold'));
            });
        });
    }

    public async extractParameters(inputScadPath: string, outputTplDir: string): Promise<any[]> {
        const tmpFile = path.join(outputTplDir, `vscode-scad-params-${Date.now()}.json`);
        return new Promise((resolve) => {
            cp.execFile(this.executablePath, [
                '-o', tmpFile,
                '--export-format', 'param',
                inputScadPath,
            ], () => {
                if (!fs.existsSync(tmpFile)) {
                    resolve([]);
                    return;
                }

                fs.readFile(tmpFile, 'utf8', (err, data) => {
                    fs.unlink(tmpFile, () => { });

                    if (err) { resolve([]); return; }
                    try {
                        const parsed = JSON.parse(data);
                        resolve(parsed.parameters || []);
                    } catch {
                        resolve([]);
                    }
                });
            });
        });
    }

    public async renderStl(
        inputScadPath: string,
        outputTplDir: string,
        overrides?: Record<string, string | number | boolean>
    ): Promise<{ stlBuffer: Buffer, tmpFile: string, stdout: string, stderr: string }> {
        const tmpFile = path.join(outputTplDir, `vscode-scad-tmp-${Date.now()}.3mf`);

        // 3MF preserves color() calls from OpenSCAD code.
        // Use manifold backend when available for faster, more reliable geometry.
        const hasManifold = await this.supportsManifold();
        const args = ['-o', tmpFile, '--export-format', '3mf'];

        if (hasManifold) {
            args.push('--backend=manifold');
        }

        if (overrides) {
            for (const [key, value] of Object.entries(overrides)) {
                // Strings must be explicitly quoted inside the -D argument for OpenSCAD
                const argValue = typeof value === 'string' ? `"${value}"` : value.toString();
                args.push('-D', `${key}=${argValue}`);
            }
        }

        args.push(inputScadPath);

        return new Promise((resolve, reject) => {
            cp.execFile(this.executablePath, args, (error, stdout, stderr) => {
                if (error) {
                    // Extract the clean error log from stderr instead of dumping the raw CLI command text
                    const cleanMessage = stderr ? stderr.trim() : error.message;
                    reject(new Error(`OpenSCAD Error:\\n${cleanMessage}`));
                    return;
                }
                fs.readFile(tmpFile, (err, data) => {
                    if (err) {
                        reject(new Error(`Failed to read compiled STL: ${err.message}`));
                        return;
                    }
                    resolve({ stlBuffer: data, tmpFile, stdout, stderr });
                });
            });
        });
    }

    public async exportTo3mf(
        inputScadPath: string,
        outputPath: string,
        overrides?: Record<string, string | number | boolean>
    ): Promise<void> {
        const hasManifold = await this.supportsManifold();
        // material-type=color → m:colorgroup extension (Materials & Properties spec),
        // which slicers (PrusaSlicer, Bambu Studio, Cura) read for display colours.
        // color-mode=model ensures per-face colour assignments are included (not just the default).
        const args = [
            '-o', outputPath,
            '--export-format', '3mf',
            '-O', 'export-3mf/material-type=color',
            '-O', 'export-3mf/color-mode=model',
        ];

        if (hasManifold) { args.push('--backend=manifold'); }

        if (overrides) {
            for (const [key, value] of Object.entries(overrides)) {
                const argValue = typeof value === 'string' ? `"${value}"` : value.toString();
                args.push('-D', `${key}=${argValue}`);
            }
        }

        args.push(inputScadPath);

        return new Promise((resolve, reject) => {
            cp.execFile(this.executablePath, args, (error, _stdout, stderr) => {
                if (error) {
                    reject(new Error(stderr ? stderr.trim() : error.message));
                } else {
                    resolve();
                }
            });
        });
    }

    public async render(
        inputScadPath: string,
        overrides?: Record<string, string | number | boolean>
    ): Promise<{ modelBuffer: Buffer; parameters: any[]; stdout: string; stderr: string }> {
        const tmpDir = os.tmpdir();
        const [modelResult, parameters] = await Promise.all([
            this.renderStl(inputScadPath, tmpDir, overrides),
            this.extractParameters(inputScadPath, tmpDir)
        ]);

        fs.unlink(modelResult.tmpFile, () => { });

        return {
            modelBuffer: modelResult.stlBuffer,
            parameters,
            stdout: modelResult.stdout,
            stderr: modelResult.stderr
        };
    }
}
