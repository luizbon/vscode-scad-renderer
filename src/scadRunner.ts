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
            // Use --info parameters for modern versions, but fallback for older ones
            // 2021.01 doesn't support --info=parameters, but it's okay to try
            cp.execFile(this.executablePath, [
                inputScadPath,
                '-o', tmpFile,
                '--info', 'parameters'
            ], (error, stdout, stderr) => {
                if (!fs.existsSync(tmpFile)) {
                    // Fail silently for extraction, it's not critical for 3D preview
                    resolve([]);
                    return;
                }

                fs.readFile(tmpFile, 'utf8', (err, data) => {
                    // Try to clean up anyway
                    fs.unlink(tmpFile, () => { });

                    if (err) {
                        resolve([]);
                        return;
                    }
                    try {
                        const parsed = JSON.parse(data);
                        resolve(parsed.parameters || []);
                    } catch (e) {
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
        const tmpFile = path.join(outputTplDir, `vscode-scad-tmp-${Date.now()}.stl`);

        // Check capabilities to avoid using unsupported flags
        const hasManifold = await this.supportsManifold();
        const args = ['-o', tmpFile];

        if (hasManifold) {
            args.push('--backend=manifold');
            args.push('--export-format', 'binstl');
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

    public async render(
        inputScadPath: string,
        overrides?: Record<string, string | number | boolean>
    ): Promise<{ stlBuffer: Buffer; parameters: any[]; stdout: string; stderr: string }> {
        const tmpDir = os.tmpdir();
        const [stlResult, parameters] = await Promise.all([
            this.renderStl(inputScadPath, tmpDir, overrides),
            this.extractParameters(inputScadPath, tmpDir)
        ]);

        // Clean up the temp STL file
        fs.unlink(stlResult.tmpFile, () => { });

        return {
            stlBuffer: stlResult.stlBuffer,
            parameters: parameters,
            stdout: stlResult.stdout,
            stderr: stlResult.stderr
        };
    }
}
