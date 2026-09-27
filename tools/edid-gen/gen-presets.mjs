// Non-interactive KVM preset generator.
// Drives buildEdidBinary() headlessly for the fixed KVM mode set.
// Usage: node gen-presets.mjs <outDir>
import { writeFileSync, mkdirSync } from 'node:fs';
import { buildEdidBinary } from './lib/edid-builder.mjs';
import { computeTiming } from './lib/cvt.mjs';
import { AUDIO_CONFIGS } from './lib/constants.mjs';

const outDir = process.argv[2] || './out';
mkdirSync(outDir, { recursive: true });

// displayName max 13 chars. mfgId 3 uppercase letters.
const MODES = [
  { id: '720p60',       name: 'KVM 720p60',    w: 1280, h: 720,  rate: 60 },
  { id: '1080p60',      name: 'KVM 1080p60',   w: 1920, h: 1080, rate: 60 },
  { id: '1080p30',      name: 'KVM 1080p30',   w: 1920, h: 1080, rate: 30 },
  { id: '1920x1200-60', name: 'KVM 1920x1200', w: 1920, h: 1200, rate: 60 },
  { id: '1440p60',      name: 'KVM 1440p60',   w: 2560, h: 1440, rate: 60 },
  { id: '2160p30',      name: 'KVM 2160p30',   w: 3840, h: 2160, rate: 30 },
];

function mkTiming(w, h, rate) {
  const t = computeTiming(w, h, rate);
  t.width = w;
  t.height = h;
  return t;
}

let count = 0;
for (const m of MODES) {
  for (const audio of [null, 'stereo']) {
    const state = {
      displayName: m.name,
      mfgId: 'KVM',
      iface: 'HDMI',
      colorDepth: 8,
      dpi: 96,
      hdr: false,
      audio: audio ? AUDIO_CONFIGS[audio] : null,
    };
    const bin = buildEdidBinary(state, [mkTiming(m.w, m.h, m.rate)]);
    const fname = `${m.id}${audio ? '-audio' : ''}.bin`;
    writeFileSync(`${outDir}/${fname}`, bin);
    console.log(`${fname.padEnd(22)} ${bin.length} bytes  ${m.name}${audio ? ' +audio' : ''}`);
    count++;
  }
}
console.log(`\nWrote ${count} blobs to ${outDir}`);
