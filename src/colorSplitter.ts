/**
 * Multi-colour 3MF export using the ColorSCAD technique:
 *
 *  1. .scad → .csg  (normalises all colour representations to [r,g,b,a] vectors)
 *  2. Override color() to echo every colour used in the model
 *  3. For each colour: re-render with color() overridden to pass ONLY that colour's
 *     geometry ($colored special-variable guards against nested color() calls)
 *  4. Merge all per-colour meshes into one 3MF with separate objects + m:colorgroup
 *     + Metadata/model_settings.config for Bambu Studio / OrcaSlicer / AnycubicSlicerNext
 *
 * Credit: technique from https://github.com/jschobben/colorscad
 */

import * as cp from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import AdmZip from 'adm-zip';

// ─── Colour helpers ──────────────────────────────────────────────────────────

/** Convert a linear-light channel (OpenSCAD) to sRGB (3MF / slicers). */
function linearToSRGB(c: number): number {
    const v = Math.min(1, Math.max(0, c));
    return v <= 0.0031308 ? 12.92 * v : 1.055 * Math.pow(v, 1.0 / 2.4) - 0.055;
}

function vecToHex(r: number, g: number, b: number): string {
    const h = (v: number) => Math.round(linearToSRGB(v) * 255).toString(16).padStart(2, '0');
    return `#${h(r)}${h(g)}${h(b)}`;
}

// ─── OpenSCAD runner ─────────────────────────────────────────────────────────

function run(exe: string, args: string[]): Promise<{ stdout: string; stderr: string }> {
    return new Promise(resolve => {
        cp.execFile(exe, args, { maxBuffer: 200 * 1024 * 1024 }, (_err, stdout, stderr) => {
            resolve({ stdout, stderr });
        });
    });
}

// ─── 3MF mesh extraction ─────────────────────────────────────────────────────

function extractMeshContent(threeMfPath: string): string | null {
    try {
        const zip = new AdmZip(threeMfPath);
        const xml = zip.readAsText('3D/3dmodel.model');
        const m = xml.match(/<mesh>([\s\S]*?)<\/mesh>/);
        return m ? m[1] : null;
    } catch {
        return null;
    }
}

function isEmptyMesh(meshXml: string): boolean {
    return (meshXml.match(/<vertex\b/g) ?? []).length === 0;
}

// ─── 3MF writer ──────────────────────────────────────────────────────────────

function writeMerged3mf(
    meshes: Array<{ hex: string; name: string; meshXml: string }>,
    outputPath: string
): void {
    // 3D/3dmodel.model — one <object> per colour (ids 2..N+1), shared <m:colorgroup>,
    // plus one assembly <object> (id N+2) that references all colour objects via
    // <components>. Only the assembly is placed in <build> so slicers treat the
    // whole model as a single multi-part object (avoids "positioned at multiple
    // heights" warning in Bambu Studio / OrcaSlicer / AnycubicSlicerNext).
    const colorGroupXml = meshes.map(m => `\t\t\t<m:color color="${m.hex}"/>`).join('\n');
    const objectsXml = meshes.map((m, i) => {
        const id = i + 2;
        return (
            `\t\t<object id="${id}" type="model" pid="1" pindex="${i}">\n` +
            `\t\t\t<mesh>${m.meshXml}\t\t\t</mesh>\n` +
            `\t\t</object>`
        );
    }).join('\n');

    const assemblyId = meshes.length + 2;
    const componentsXml = meshes.map((_, i) => `\t\t\t<component objectid="${i + 2}"/>`).join('\n');
    const assemblyXml =
        `\t\t<object id="${assemblyId}" type="model">\n` +
        `\t\t\t<components>\n` +
        componentsXml + '\n' +
        `\t\t\t</components>\n` +
        `\t\t</object>`;

    const modelXml = [
        `<?xml version="1.0" encoding="utf-8"?>`,
        `<model xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02"`,
        `       xmlns:m="http://schemas.microsoft.com/3dmanufacturing/material/2015/02"`,
        `       unit="millimeter" xml:lang="en-US">`,
        `\t<resources>`,
        `\t\t<m:colorgroup id="1">`,
        colorGroupXml,
        `\t\t</m:colorgroup>`,
        objectsXml,
        assemblyXml,
        `\t</resources>`,
        `\t<build>`,
        `\t\t<item objectid="${assemblyId}"/>`,
        `\t</build>`,
        `</model>`,
    ].join('\n');

    // Metadata/model_settings.config — one parent object (the assembly) with each
    // colour mesh as a child part assigned to its own extruder.
    const partsXml = meshes.map((m, i) => {
        const partId = i + 2;
        const ext = i + 1;
        return [
            `    <part id="${partId}" subtype="normal_part">`,
            `      <metadata key="name" value="${m.name}"/>`,
            `      <metadata key="extruder" value="${ext}"/>`,
            `    </part>`,
        ].join('\n');
    }).join('\n');
    const objectConfigsXml =
        `  <object id="${assemblyId}">\n` +
        `    <metadata key="name" value="model"/>\n` +
        partsXml + '\n' +
        `  </object>`;
    const modelSettingsXml = `<?xml version="1.0" encoding="UTF-8"?>\n<config>\n${objectConfigsXml}\n</config>`;

    const contentTypesXml = [
        `<?xml version="1.0" encoding="UTF-8"?>`,
        `<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">`,
        `  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>`,
        `  <Default Extension="model" ContentType="application/vnd.ms-package.3dmanufacturing-3dmodel+xml"/>`,
        `  <Default Extension="config" ContentType="text/xml"/>`,
        `</Types>`,
    ].join('\n');

    const relsXml = [
        `<?xml version="1.0" encoding="UTF-8"?>`,
        `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">`,
        `  <Relationship Type="http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel" Target="/3D/3dmodel.model" Id="rel0"/>`,
        `</Relationships>`,
    ].join('\n');

    const zip = new AdmZip();
    zip.addFile('[Content_Types].xml', Buffer.from(contentTypesXml, 'utf8'));
    zip.addFile('_rels/.rels', Buffer.from(relsXml, 'utf8'));
    zip.addFile('3D/3dmodel.model', Buffer.from(modelXml, 'utf8'));
    zip.addFile('Metadata/model_settings.config', Buffer.from(modelSettingsXml, 'utf8'));
    zip.writeZip(outputPath);
}

// ─── Main export ─────────────────────────────────────────────────────────────

/**
 * Export a .scad file as a multi-colour 3MF.
 * Throws if the model has no color() calls or all colour renders produce empty geometry —
 * callers should fall back to a plain single-colour export.
 */
export async function exportMultiColorTo3mf(
    executablePath: string,
    inputScadPath: string,
    outputPath: string,
    overrides?: Record<string, string | number | boolean>
): Promise<void> {
    const tmpDir = os.tmpdir();
    // CSG file MUST live beside the source .scad so relative import() paths resolve
    const csgPath = path.join(path.dirname(inputScadPath), `._csc-${Date.now()}.csg`);
    const tmpFiles: string[] = [csgPath];

    try {
        // ── 1. SCAD → CSG ────────────────────────────────────────────────────
        const csgArgs = ['-o', csgPath];
        if (overrides) {
            for (const [k, v] of Object.entries(overrides)) {
                csgArgs.push('-D', `${k}=${typeof v === 'string' ? `"${v}"` : v}`);
            }
        }
        csgArgs.push(inputScadPath);
        await run(executablePath, csgArgs);
        if (!fs.existsSync(csgPath)) { throw new Error('CSG generation failed'); }

        // ── 2. Enumerate colours ─────────────────────────────────────────────
        // Replace color() with an echo-only version; no geometry is rendered.
        const enumStl = path.join(tmpDir, `._csc-enum-${Date.now()}.stl`);
        tmpFiles.push(enumStl);
        const { stderr: echoOut } = await run(executablePath, [
            '-o', enumStl,
            '-D', 'module color(c, alpha=1) { echo(colorid_TAG=str(c)); }',
            csgPath,
        ]);

        type ColorEntry = { str: string; r: number; g: number; b: number; a: number };
        const colorList: ColorEntry[] = [];
        const seen = new Set<string>();
        for (const line of echoOut.split('\n')) {
            // ECHO: colorid_TAG = "[r, g, b, a]"
            const m = line.match(/ECHO: colorid_TAG = "(\[[^\]]+\])"/);
            if (!m) { continue; }
            const colorStr = m[1]; // e.g. "[0, 0, 0, 1]"
            if (seen.has(colorStr)) { continue; }
            seen.add(colorStr);
            const parts = colorStr.replace(/[\[\]\s]/g, '').split(',').map(Number);
            if (parts.length >= 3 && !parts.some(isNaN)) {
                colorList.push({ str: colorStr, r: parts[0], g: parts[1], b: parts[2], a: parts[3] ?? 1 });
            }
        }
        if (colorList.length === 0) { throw new Error('No color() calls found in model'); }

        // ── 3. Render each colour in parallel ────────────────────────────────
        // The color() override uses $colored (OpenSCAD dynamic-scoped special variable)
        // so that the outermost color() wins in nested calls.
        const renderResults = await Promise.all(colorList.map(async (color) => {
            const outPath = path.join(tmpDir, `._csc-${Date.now()}-${Math.random().toString(36).slice(2)}.3mf`);
            tmpFiles.push(outPath);
            const override =
                `$colored = false; ` +
                `module color(c, alpha=1) { ` +
                `  if ($colored) { children(); } ` +
                `  else { $colored = true; if (str(c) == "${color.str}") children(); } ` +
                `}`;
            await run(executablePath, ['-o', outPath, '-D', override, csgPath]);
            return { color, outPath };
        }));

        // ── 4. Merge ─────────────────────────────────────────────────────────
        const meshes: Array<{ hex: string; name: string; meshXml: string }> = [];
        for (const { color, outPath } of renderResults) {
            if (!fs.existsSync(outPath)) { continue; }
            const meshXml = extractMeshContent(outPath);
            if (!meshXml || isEmptyMesh(meshXml)) { continue; }
            meshes.push({ hex: vecToHex(color.r, color.g, color.b), name: color.str, meshXml });
        }
        if (meshes.length === 0) { throw new Error('All colour renders produced empty geometry'); }

        writeMerged3mf(meshes, outputPath);

    } finally {
        for (const f of tmpFiles) {
            try { if (fs.existsSync(f)) { fs.unlinkSync(f); } } catch {}
        }
    }
}
