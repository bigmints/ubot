import { readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(new URL('../web-ui/package.json', import.meta.url));
const sharp = require('sharp');
const mark = JSON.parse(readFileSync(new URL('./mark.json', import.meta.url), 'utf8'));
const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${mark.viewBox}" fill="currentColor"><path d="${mark.path}"/></svg>`;
// Opaque white keeps the monochrome favicon readable in either browser theme.
const icon = size => `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 80 80"><rect width="80" height="80" rx="16" fill="white"/><svg x="10" y="10" width="60" height="60" viewBox="${mark.viewBox}" fill="black"><path d="${mark.path}"/></svg></svg>`;
const write = (file, content) => writeFileSync(new URL(file, import.meta.url), content);
write('./youbot.svg', svg);
write('../web-ui/app/icon.svg', icon(64));
write('../webchat-relay/website/assets/icon.svg', icon(64));
for (const size of [192, 512]) write(`../webchat-relay/public/icon-${size}.svg`, icon(size));
await sharp(Buffer.from(icon(180))).png().toFile(new URL('../web-ui/app/apple-icon.png', import.meta.url).pathname);
// ICO directory containing PNG images at the three usual browser sizes.
const sizes = [16, 32, 48];
const images = await Promise.all(sizes.map(size => sharp(Buffer.from(icon(size))).png().toBuffer()));
const header = Buffer.alloc(6 + 16 * sizes.length);
header.writeUInt16LE(1, 2);
header.writeUInt16LE(sizes.length, 4);
let offset = header.length;
images.forEach((image, i) => {
  const entry = 6 + 16 * i;
  header[entry] = header[entry + 1] = sizes[i];
  header.writeUInt16LE(1, entry + 4);
  header.writeUInt16LE(32, entry + 6);
  header.writeUInt32LE(image.length, entry + 8);
  header.writeUInt32LE(offset, entry + 12);
  offset += image.length;
});
write('../web-ui/app/favicon.ico', Buffer.concat([header, ...images]));
console.log('Generated Youbot SVG, browser, Apple and relay icons from branding/mark.json.');
