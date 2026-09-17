import { existsSync, symlinkSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
const addon = fileURLToPath(new URL('../node_modules/@kutalia/whisper-node-addon/dist/', import.meta.url));
if (process.platform === 'darwin') {
  for (const arch of ['arm64', 'x64']) {
    const source = path.join(addon, `mac-${arch}`);
    const target = path.join(addon, `darwin-${arch}`);
    if (existsSync(source) && !existsSync(target)) symlinkSync(source, target, 'dir');
  }
}
