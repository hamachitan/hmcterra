import { spawn } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';

export async function runRpmspec(specContent: string, queryFormat: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const tempDir = os.tmpdir();
    let tempFile;
    do {
      tempFile = path.join(tempDir, `spec-${Date.now()}-${Math.random()}.spec`);
    } while (fs.existsSync(tempFile));
    fs.writeFileSync(tempFile, specContent);

    const child = spawn('rpmspec', ['-q', tempFile, '--undefine=dist', '--queryformat', queryFormat], { stdio: 'pipe' });
    let stdout = '';
    let stderr = '';

    child.stdout.on('data', (data) => stdout += data.toString());
    child.stderr.on('data', (data) => stderr += data.toString());

    child.on('close', (code) => {
      try {
        fs.unlinkSync(tempFile);
      } catch (err) {
        // ignore
      }
      if (code === 0) resolve(stdout.trim());
      else reject(new Error(`rpmspec failed: ${stderr}`));
    });
  });
}