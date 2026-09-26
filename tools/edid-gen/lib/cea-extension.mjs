import { FRL_LEVELS, VIC_TABLE } from './constants.mjs';
import { encodeDetailedTiming, computeChecksum } from './timing.mjs';

function needsVfpdbNvrdb(classification) {
  if (!classification || !classification.preferredVic) return false;
  const info = VIC_TABLE.get(classification.preferredVic);
  return info != null && (info.width >= 4096 || info.height >= 4096);
}

/**
 * Write SVD (Short Video Descriptor) block with dynamic VIC list.
 * Tag 2 (Video), one byte per VIC.
 * VIC 1 is always included as first entry (CTA-861 requirement).
 */
function writeSvdBlock(buf, offset, vicList) {
  const len = vicList.length;
  buf[offset] = (2 << 5) | len;  // Tag 2 (Video), length = number of VICs
  for (let i = 0; i < len; i++) {
    buf[offset + 1 + i] = vicList[i] & 0xff;
  }
  return 1 + len;
}

/**
 * Write HDMI Vendor Specific Data Block (8 bytes).
 * IEEE OUI 0x000C03 (HDMI Licensing), CEC phys addr 1.0.0.0.
 */
function writeHdmiVsdb(buf, offset, state, hdmiParams) {
  buf[offset]     = 0x67;  // Tag 3 (VSDB), length 7
  buf[offset + 1] = 0x03;  // IEEE OUI LSB
  buf[offset + 2] = 0x0C;
  buf[offset + 3] = 0x00;  // IEEE OUI MSB
  buf[offset + 4] = 0x10;  // CEC phys addr 1.0.0.0
  buf[offset + 5] = 0x00;

  // Deep color flags
  let dcFlags = 0;
  if (state.colorDepth >= 10) dcFlags |= 0x10;  // DC_30bit
  if (state.colorDepth >= 12) dcFlags |= 0x20;  // DC_36bit
  if (dcFlags) dcFlags |= 0x08;                  // DC_Y444
  buf[offset + 6] = dcFlags;

  // Max TMDS clock / 5, capped at 340 MHz (value 68)
  buf[offset + 7] = Math.min(Math.floor(hdmiParams.maxTmdsMhz / 5), 68);
  return 8;
}

/**
 * Write HDMI Forum Vendor Specific Data Block.
 * IEEE OUI 0xC45DD8 (HDMI Forum).
 *
 * Without FRL: 8 bytes (payload 7)
 * With FRL: 12 bytes (payload 11) — adds FRL rate, ALLM, VRR placeholders, DSC flag
 *
 * Byte layout (x[n] = nth byte after OUI, i.e. raw byte n+4):
 *   x[0]: Version
 *   x[1]: Max_TMDS_Character_Rate / 5
 *   x[2]: [7]SCDC_Present [6]RR_Capable ...
 *   x[3]: [7:4]Max_FRL_Rate [3]UHD_VIC [2]DC_48bit_420 [1]DC_36bit_420 [0]DC_30bit_420
 *   x[4]: [1]ALLM ...gaming flags
 *   x[5]: [7:6]VRR_max_upper [5:0]VRR_min
 *   x[6]: VRR_max_lower
 *   x[7]: [7]DSC_1p2 [1]DSC_12bpc [0]DSC_10bpc
 */
function writeHfVsdb(buf, offset, state, hdmiParams, classification) {
  const needsFrl = classification && classification.needsFrl;
  const payloadLen = needsFrl ? 12 : 7;

  buf[offset]     = (3 << 5) | payloadLen;  // Tag 3 (VSDB), length
  buf[offset + 1] = 0xD8;  // IEEE OUI LSB
  buf[offset + 2] = 0x5D;
  buf[offset + 3] = 0xC4;  // IEEE OUI MSB
  buf[offset + 4] = 0x01;  // Version 1

  // x[1]: Max TMDS char rate / 5 (0 if ≤340 MHz, capped at 600 MHz = value 120)
  const above340 = hdmiParams.maxTmdsMhz > 340;
  buf[offset + 5] = above340 ? Math.min(Math.floor(hdmiParams.maxTmdsMhz / 5), 120) : 0;

  // x[2]: SCDC_Present + RR_Capable when >340 MHz
  buf[offset + 6] = above340 ? 0xC0 : 0x00;

  // Deep color 4:2:0 flags
  let dc420 = 0;
  if (state.colorDepth >= 10) dc420 |= 0x01;  // DC_30bit_420
  if (state.colorDepth >= 12) dc420 |= 0x02;  // DC_36bit_420

  if (needsFrl) {
    const frlLevel = classification.frlLevel;
    // x[3]: bits[7:4] = Max_FRL_Rate, bits[2:0] = dc420
    buf[offset + 7] = ((frlLevel & 0x0f) << 4) | (dc420 & 0x07);

    // x[4]: bit1 = ALLM
    buf[offset + 8] = 0x02;  // ALLM only

    // x[5]: VRR_min[5:0] + VRR_max_upper[7:6] — 0 = no VRR
    buf[offset + 9] = 0x00;

    // x[6]: VRR_max_lower — 0 = no VRR
    buf[offset + 10] = 0x00;

    // x[7]: DSC capabilities — auto-enable DSC 1.2 when FRL active
    let dscFlags = 0x80;  // DSC_1p2
    if (state.colorDepth >= 10) dscFlags |= 0x01;  // DSC_10bpc
    if (state.colorDepth >= 12) dscFlags |= 0x02;  // DSC_12bpc
    buf[offset + 11] = dscFlags;

    // x[8]: DSC_Max_FRL_Rate[7:4] + DSC_Max_Slices[3:0] — 0 = default
    buf[offset + 12] = 0x00;
  } else {
    // x[3]: no FRL, just dc420
    buf[offset + 7] = dc420;
  }

  return 1 + payloadLen;
}

/**
 * Write Short Audio Descriptor data block (4 bytes).
 * Format: LPCM, sample rates 32+44.1+48 kHz, bit depths 16+20+24.
 */
function writeAudioBlock(buf, offset, audioConfig) {
  buf[offset]     = 0x23;             // Tag 1 (Audio), length 3
  buf[offset + 1] = audioConfig.sadByte1;  // LPCM + channel count
  buf[offset + 2] = 0x07;             // 32 + 44.1 + 48 kHz
  buf[offset + 3] = 0x07;             // 16 + 20 + 24 bit
  return 4;
}

/**
 * Write Speaker Allocation Data Block (4 bytes).
 */
function writeSpeakerAlloc(buf, offset, audioConfig) {
  buf[offset]     = 0x83;  // Tag 4 (Speaker), length 3
  buf[offset + 1] = audioConfig.speakerAlloc;
  buf[offset + 2] = audioConfig.speakerAlloc2 || 0x00;
  buf[offset + 3] = 0x00;
  return 4;
}

/**
 * Compute the total data block size for the first CEA block.
 * Used externally by edid-builder to calculate DTD capacity.
 *
 * classification: { allVics, needsFrl, ... } from classifyModes
 */
export function computeDataBlockSize(state, hdmiParams, classification) {
  let size = 0;

  // SVD: 1 byte header + 1 byte per VIC
  const vicCount = classification ? classification.allVics.length : 1;
  size += 1 + vicCount;

  if (hdmiParams) {
    size += 8;  // HDMI VSDB (always 8 bytes)
    // HF-VSDB: 8 without FRL, 13 with FRL (payload 12 + tag)
    size += (classification && classification.needsFrl) ? 13 : 8;
    if (hdmiParams.audioConfig) {
      size += 4;  // Audio
      size += 4;  // Speaker Allocation
    }
  }
  size += 3;  // VCDB (always)
  size += 4;  // Colorimetry (always — sRGB required for interop)
  if (state && state.hdr) {
    size += 5;  // HDR Static Metadata
  }
  if (needsVfpdbNvrdb(classification)) {
    size += 3;  // VFPDB
    size += 3;  // NVRDB
  }
  return size;
}

/**
 * Build a CEA-861 extension block (128 bytes).
 *
 * timings: array of timing objects (up to 6 per block)
 * displaySizeMm: { hMm, vMm } - display physical size
 * isFirst: if true, include data blocks and set native DTD count
 * state: { hdr, colorDepth, ... } - generator state
 * hdmiParams: { maxTmdsMhz, audioConfig } or null
 * classification: { allVics, needsFrl, frlLevel, ... } from classifyModes
 */
export function buildCeaExtensionBlock(timings, displaySizeMm, isFirst, state, hdmiParams, classification) {
  const buf = Buffer.alloc(128);

  // Tag (byte 0): CEA extension
  buf[0] = 0x02;

  // Revision (byte 1): CEA-861-D
  buf[1] = 0x03;

  let dataBlockEnd = 4;  // Start of data block collection

  if (isFirst) {
    let offset = 4;

    // 1. SVD with all VICs
    const vicList = classification ? classification.allVics : [1];
    offset += writeSvdBlock(buf, offset, vicList);

    // 2. HDMI VSDB - when HDMI
    if (hdmiParams) {
      offset += writeHdmiVsdb(buf, offset, state, hdmiParams);
    }

    // 3. HF-VSDB - when HDMI
    if (hdmiParams) {
      offset += writeHfVsdb(buf, offset, state, hdmiParams, classification);
    }

    // 4. Audio Data Block - when HDMI + audio
    if (hdmiParams && hdmiParams.audioConfig) {
      offset += writeAudioBlock(buf, offset, hdmiParams.audioConfig);
    }

    // 5. Speaker Allocation - when HDMI + audio
    if (hdmiParams && hdmiParams.audioConfig) {
      offset += writeSpeakerAlloc(buf, offset, hdmiParams.audioConfig);
    }

    // 6. VCDB (Video Capability Data Block) - always
    buf[offset] = (7 << 5) | 2;  // 0xE2: extended tag, length 2
    buf[offset + 1] = 0x00;       // Extended tag code 0 = VCDB
    buf[offset + 2] = 0x4a;       // QS=1, S_IT=underscan, S_CE=underscan
    offset += 3;

    // 7. Colorimetry Data Block - always (sRGB required for interop, BT.2020 added for HDR)
    buf[offset] = (7 << 5) | 3;   // 0xE3: extended tag, length 3
    buf[offset + 1] = 0x05;        // Extended tag code 5 = Colorimetry
    buf[offset + 2] = (state && state.hdr) ? 0x80 : 0x00;  // BT.2020 RGB when HDR
    buf[offset + 3] = 0x20;        // sRGB
    offset += 4;

    // 8. HDR Static Metadata - when HDR
    if (state && state.hdr) {
      buf[offset] = (7 << 5) | 4;   // 0xE4: extended tag, length 4
      buf[offset + 1] = 0x06;        // Extended tag code 6 = HDR Static Metadata
      buf[offset + 2] = 0x05;        // SDR + PQ/ST2084 EOTFs
      buf[offset + 3] = 0x01;        // Static Metadata Descriptor Type 1
      buf[offset + 4] = 0x00;        // Desired Content Max Luminance (unspecified)
      offset += 5;
    }

    // 9. VFPDB — when preferred VIC has width/height >= 4096
    if (needsVfpdbNvrdb(classification)) {
      const svr = classification.preferredVic;
      buf[offset]     = (7 << 5) | 2;  // extended tag, payload length 2
      buf[offset + 1] = 0x0D;          // VFPDB
      buf[offset + 2] = svr;
      offset += 3;
    }

    // 10. NVRDB — when preferred VIC has width/height >= 4096
    if (needsVfpdbNvrdb(classification)) {
      const svr = classification.preferredVic;
      buf[offset]     = (7 << 5) | 2;  // extended tag, payload length 2
      buf[offset + 1] = 0x08;          // NVRDB
      buf[offset + 2] = svr;
      offset += 3;
    }

    dataBlockEnd = offset;
  }

  // DTD offset (byte 2)
  buf[2] = dataBlockEnd;

  // Byte 3: underscan supported + basic audio flag + native DTD count
  // Native DTD count must be the same across ALL CTA blocks (CTA-861 requirement)
  const nativeDtds = (classification && classification.preferredVic) ? 1 : 0;
  buf[3] = (hdmiParams?.audioConfig ? 0xC0 : 0x80) | nativeDtds;

  // DTDs
  let offset = dataBlockEnd;
  for (const timing of timings) {
    if (offset + 18 > 127) break;  // Leave room for checksum
    encodeDetailedTiming(timing, displaySizeMm).copy(buf, offset);
    offset += 18;
  }

  // Remaining bytes are already zero-padded (Buffer.alloc)

  // Checksum (byte 127)
  buf[127] = computeChecksum(buf);

  return buf;
}
