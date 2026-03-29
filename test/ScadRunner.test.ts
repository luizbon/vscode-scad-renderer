import { expect } from 'chai';
import { ScadRunner } from '../src/scadRunner';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

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
});
