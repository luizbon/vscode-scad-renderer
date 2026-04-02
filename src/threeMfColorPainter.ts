import AdmZip from 'adm-zip';

const SLIC3RPE_NS = 'http://schemas.slic3r.org/3mf/2017/06';

/**
 * Encode a 1-based extruder number to an OrcaSlicer/Bambu mmu_segmentation string.
 *
 * The format is a packed nibble bitstream (LSB-first within each nibble),
 * written to a hex string where the first nibble becomes the rightmost character.
 *
 * Leaf node (unsplit triangle):
 *   bits 0-1: split_sides = 0
 *   bits 2-3: state (for state < 3) OR 0b11 extended marker (for state >= 3)
 *   bits 4-7: (state - 3) in 4 bits, only when extended
 *
 * State equals extruder number (1-based).
 * State 0 (NONE) = no annotation → attribute omitted from triangle.
 */
function encodeExtruder(extruder: number): string {
    const state = extruder;
    const bits: boolean[] = [false, false]; // split_sides = 0 (bits 0, 1)

    if (state >= 3) {
        bits.push(true, true); // extended marker (bits 2, 3)
        const n = state - 3;
        for (let i = 0; i < 4; i++) {
            bits.push(Boolean((n >> i) & 1)); // bits 4-7, LSB first
        }
    } else {
        bits.push(Boolean(state & 1)); // bit 2: state LSB
        bits.push(Boolean(state & 2)); // bit 3: state MSB
    }

    // Pad to nibble boundary
    while (bits.length % 4 !== 0) { bits.push(false); }

    // Convert to hex string — each nibble is prepended so first nibble → rightmost char
    let result = '';
    for (let offset = 0; offset < bits.length; offset += 4) {
        let nibble = 0;
        for (let i = 3; i >= 0; i--) {
            nibble = (nibble << 1) | (bits[offset + i] ? 1 : 0);
        }
        const ch = nibble < 10
            ? String.fromCharCode(nibble + 0x30)
            : String.fromCharCode(nibble - 10 + 0x41);
        result = ch + result;
    }
    return result;
}

/**
 * Post-process a 3MF file exported by OpenSCAD to inject OrcaSlicer/Bambu-compatible
 * per-face colour painting data (slic3rpe:mmu_segmentation attributes).
 *
 * OpenSCAD already writes m:colorgroup + per-triangle p1 indices.
 * This function reads those and adds the slic3rpe namespace attribute so that
 * OrcaSlicer, Bambu Studio, and compatible slicers (AnycubicSlicerNext) display
 * and use the colour assignments for multi-material printing.
 *
 * Colour index mapping: colorgroup index N → extruder N+1.
 * Triangles assigned to extruder 1 (state=NONE) get no attribute (slicer default).
 *
 * Modifies the file in-place. Silently no-ops if the file has no colorgroup data.
 */
export function injectOrcaSlicerColors(filePath: string): void {
    let zip: AdmZip;
    try {
        zip = new AdmZip(filePath);
    } catch {
        return; // not a valid zip/3mf
    }

    const modelEntry = zip.getEntry('3D/3dmodel.model');
    if (!modelEntry) { return; }

    let xml = zip.readAsText(modelEntry);

    // Only proceed if the file has m:colorgroup data from OpenSCAD
    if (!xml.includes('<m:colorgroup')) { return; }

    // Parse the default pindex from the object element (e.g. pindex="0")
    const objMatch = xml.match(/\bpindex="(\d+)"/);
    const defaultPindex = objMatch ? parseInt(objMatch[1], 10) : 0;

    // Add slic3rpe namespace to <model> element if not already present
    if (!xml.includes('xmlns:slic3rpe=')) {
        xml = xml.replace(/<model\b/, `<model xmlns:slic3rpe="${SLIC3RPE_NS}"`);
    }

    // Process each <triangle .../> element:
    // - extract p1 attribute (colour index); fall back to defaultPindex
    // - map colour index to extruder number (index+1)
    // - inject slic3rpe:mmu_segmentation for extruder >= 2; skip for extruder 1 (NONE)
    xml = xml.replace(/<triangle([^/]*)(\/\s*>)/g, (match, attrs: string, close: string) => {
        const p1Match = attrs.match(/\bp1="(\d+)"/);
        const colorIndex = p1Match ? parseInt(p1Match[1], 10) : defaultPindex;
        const extruder = colorIndex + 1;

        if (extruder <= 1) { return match; } // extruder 1 = NONE, no annotation needed

        const encoded = encodeExtruder(extruder);
        return `<triangle${attrs} slic3rpe:mmu_segmentation="${encoded}"${close}`;
    });

    zip.updateFile(modelEntry, Buffer.from(xml, 'utf8'));
    zip.writeZip(filePath);
}
