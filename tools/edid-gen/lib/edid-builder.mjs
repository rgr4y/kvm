import { SRGB_CHROMATICITY, BT2020_CHROMATICITY, COLOR_DEPTH_BITS, INTERFACE_BITS,
         FRL_LEVELS, VIC_TABLE, VIC_STANDARD_TIMINGS, findMatchingVics } from './constants.mjs';
import {
  encodeMfgId, encodeDetailedTiming, buildStandardTimings,
  computeEstablishedTimings, encodeRangeLimits, encodeDisplayName,
  encodeSerialDescriptor, computeChecksum, computeDisplaySizeMm,
} from './timing.mjs';
import { computeTiming } from './cvt.mjs';
import { buildCeaExtensionBlock, computeDataBlockSize } from './cea-extension.mjs';
import { buildDisplayIdExtensionBlock } from './displayid.mjs';

// Maximum pixel clock representable by a DTD (uint16 in 10 kHz units)
const MAX_DTD_CLOCK_KHZ = 655350;

// VIC 1 timing parameters (640x480p@59.94Hz) for range limits calculation
const VIC1_TIMING = {
  pixelClockKhz: 25175,
  hActive: 640,
  hBlanking: 160,
  vActive: 480,
  vBlanking: 45,
  refreshRate: 60,
};

/**
 * Classify all selected timings into categories:
 * - vicModes: have a VIC match → declared via SVD only
 * - dtdModes: no VIC, clock ≤ 655 MHz → declared via DTD
 * - displayIdModes: no VIC, clock > 655 MHz → declared via DisplayID Type VII
 *
 * Also computes FRL requirements for HDMI 2.1.
 */
export function classifyModes(allTimings, colorDepth) {
  const vicModes = [];
  const dtdModes = [];
  const displayIdModes = [];
  const allVicsSet = new Set([1]);  // VIC 1 always included

  for (const timing of allTimings) {
    const vics = findMatchingVics(timing.hActive, timing.vActive, timing.refreshRate);
    if (vics.length > 0) {
      vicModes.push({ timing, vics });
      for (const v of vics) allVicsSet.add(v);
    } else if (timing.pixelClockKhz <= MAX_DTD_CLOCK_KHZ) {
      dtdModes.push(timing);
    } else {
      displayIdModes.push(timing);
    }
  }

  // Find preferred VIC: the VIC of the user's preferred (first) timing
  let preferredVic = null;
  if (vicModes.length > 0 && vicModes[0].timing === allTimings[0]) {
    preferredVic = vicModes[0].vics[0];
  }

  // Lead VIC for SVD ordering: preferredVic if available, otherwise the first
  // user-specified VIC (not auto-added VIC 1) to avoid "ascending order" warnings
  let leadVic = preferredVic;
  if (!leadVic) {
    for (const vm of vicModes) {
      const nonOneVic = vm.vics.find(v => v !== 1);
      if (nonOneVic) { leadVic = nonOneVic; break; }
    }
  }

  // Order: lead VIC first, then rest sorted ascending
  const allVics = leadVic
    ? [leadVic, ...[...allVicsSet].filter(v => v !== leadVic).sort((a, b) => a - b)]
    : [...allVicsSet].sort((a, b) => a - b);

  // Compute max VIC standard pixel clock (VIC timings have defined clocks per CTA-861)
  let maxVicClockKhz = 0;
  for (const vic of allVics) {
    const info = VIC_TABLE.get(vic);
    if (info && info.clockKhz > maxVicClockKhz) {
      maxVicClockKhz = info.clockKhz;
    }
  }

  // FRL calculation: consider both CVT-computed and VIC standard clocks
  const maxCvtClockKhz = Math.max(...allTimings.map(t => t.pixelClockKhz));
  const maxClockKhz = Math.max(maxCvtClockKhz, maxVicClockKhz);
  const maxPixelClockMhz = maxClockKhz / 1000;
  const bpc = colorDepth || 8;
  const requiredGbps = maxPixelClockMhz * bpc * 3 / 1000;
  const tmdsBandwidthMhz = maxPixelClockMhz * (bpc / 8);
  const needsFrl = tmdsBandwidthMhz > 600;

  let frlLevel = 0;
  if (needsFrl) {
    for (const fl of FRL_LEVELS) {
      if (fl.bandwidthGbps >= requiredGbps) {
        frlLevel = fl.level;
        break;
      }
    }
    // If no level is sufficient, use max
    if (frlLevel === 0 && requiredGbps > 0) {
      frlLevel = 6;
    }
  }

  const needsDisplayId = displayIdModes.length > 0;

  // Fallback DTD: when preferred timing exceeds DTD limit, generate a lower-rate
  // CVT timing for the same resolution that fits within the DTD range
  let fallbackDtd = null;
  const preferred = allTimings[0];
  if (preferred && preferred.pixelClockKhz > MAX_DTD_CLOCK_KHZ) {
    // Try decreasing refresh rates until one fits
    const fallbackRates = [60, 50, 48, 30, 24];
    for (const rate of fallbackRates) {
      const fb = computeTiming(preferred.hActive, preferred.vActive, rate);
      if (fb.pixelClockKhz <= MAX_DTD_CLOCK_KHZ) {
        fb.width = preferred.hActive;
        fb.height = preferred.vActive;
        fallbackDtd = fb;
        break;
      }
    }
  }

  return {
    vicModes,
    dtdModes,
    displayIdModes,
    allVics,
    preferredVic,
    maxVicClockKhz,
    needsFrl,
    frlLevel,
    needsDisplayId,
    fallbackDtd,
  };
}

/**
 * Build the 128-byte EDID 1.4 base block.
 *
 * state: { displayName, mfgId, iface, colorDepth, dpi }
 * allTimings: array of timing objects (preferred first)
 * extensionCount: number of extension blocks
 * allOriginalTimings: all original timings including high-clock ones (for range limits)
 * classification: { maxVicClockKhz, allVics, ... } for VIC clock consideration in range limits
 */
export function buildBaseBlock(state, allTimings, extensionCount, allOriginalTimings, classification, maxDisplayIdClockKhz = 0) {
  const buf = Buffer.alloc(128);

  // Fixed header (bytes 0-7)
  Buffer.from([0x00, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0x00]).copy(buf, 0);

  // Manufacturer ID (bytes 8-9)
  const mfg = state.mfgId.toUpperCase();
  const [mfgHi, mfgLo] = encodeMfgId(mfg[0], mfg[1], mfg[2]);
  buf[8] = mfgHi;
  buf[9] = mfgLo;

  // Product code (bytes 10-11) - 0x0000
  buf[10] = 0; buf[11] = 0;

  // Serial number (bytes 12-15) - 0x00000000
  buf[12] = 0; buf[13] = 0; buf[14] = 0; buf[15] = 0;

  // Week and year of manufacture (bytes 16-17)
  const now = new Date();
  const startOfYear = new Date(now.getFullYear(), 0, 1);
  const weekNum = Math.ceil(((now - startOfYear) / 86400000 + startOfYear.getDay() + 1) / 7);
  buf[16] = Math.min(weekNum, 54);
  buf[17] = now.getFullYear() - 1990;

  // EDID version: 1.3 for HDMI (required by HDMI spec), 1.4 for DP
  const isHdmiIface = state.iface === 'HDMI';
  const edidMinorVersion = isHdmiIface ? 3 : 4;
  buf[18] = 1;
  buf[19] = edidMinorVersion;

  // Video input definition (byte 20) - digital
  if (edidMinorVersion >= 4) {
    // EDID 1.4: encode color depth and interface type
    const depthBits = COLOR_DEPTH_BITS[state.colorDepth] || 0b010;
    const ifaceBits = INTERFACE_BITS[state.iface] || 0;
    buf[20] = 0x80 | (depthBits << 4) | ifaceBits;
  } else {
    // EDID 1.3: just digital flag (depth/interface communicated via CTA extension)
    buf[20] = 0x80;
  }

  // Physical size in cm (bytes 21-22) - from preferred (largest) resolution
  const preferred = allTimings[0];
  const displaySizeMm = computeDisplaySizeMm(preferred, state.dpi);
  buf[21] = Math.round(displaySizeMm.hMm / 10);
  buf[22] = Math.round(displaySizeMm.vMm / 10);

  // Gamma (byte 23) - 2.20 = 120 encoded
  buf[23] = 120;

  // Feature support (byte 24)
  buf[24] = 0xea;

  // Chromaticity (bytes 25-34)
  const chromaticity = state.hdr ? BT2020_CHROMATICITY : SRGB_CHROMATICITY;
  chromaticity.copy(buf, 25);

  // Use all original timings for established/standard timings and range limits
  const rangeTimings = allOriginalTimings || allTimings;

  // Established timings (bytes 35-37)
  const estTimings = computeEstablishedTimings(rangeTimings);
  buf[35] = estTimings[0];
  buf[36] = estTimings[1];
  buf[37] = estTimings[2];

  // Standard timings (bytes 38-53)
  buildStandardTimings(rangeTimings).copy(buf, 38);

  // Range limits need to include VIC 1 if CEA extension is present
  // Max VIC pixel clock is passed separately to avoid a synthetic timing
  // with bogus blanking that would distort H-freq range
  let rangeLimitTimings = rangeTimings;
  let maxClockOverrideKhz = 0;
  if (extensionCount > 0) {
    rangeLimitTimings = [...rangeTimings, VIC1_TIMING];
    const vicClock = classification ? classification.maxVicClockKhz : 0;
    maxClockOverrideKhz = Math.max(vicClock, maxDisplayIdClockKhz);
  }

  // EDID 1.4: DTDs must come before display descriptors.
  if (allTimings.length >= 2 && extensionCount === 0) {
    // 2 timings, no extension: DTD1, DTD2, range limits, display name
    encodeDetailedTiming(preferred, displaySizeMm).copy(buf, 54);
    encodeDetailedTiming(allTimings[1], displaySizeMm).copy(buf, 72);
    encodeRangeLimits(rangeLimitTimings, edidMinorVersion, maxClockOverrideKhz).copy(buf, 90);
    encodeDisplayName(state.displayName).copy(buf, 108);
  } else {
    // 1 timing or >2 (with CEA extension): DTD1, range limits, display name, serial
    encodeDetailedTiming(preferred, displaySizeMm).copy(buf, 54);
    encodeRangeLimits(rangeLimitTimings, edidMinorVersion, maxClockOverrideKhz).copy(buf, 72);
    encodeDisplayName(state.displayName).copy(buf, 90);
    encodeSerialDescriptor('Linux #0').copy(buf, 108);
  }

  // Extension count (byte 126)
  buf[126] = extensionCount;

  // Checksum (byte 127)
  buf[127] = computeChecksum(buf);

  return buf;
}

/**
 * Compute the maximum TMDS clock in MHz across all timings at a given color depth.
 * Also considers VIC standard pixel clocks which may differ from CVT-computed values.
 */
function computeMaxTmdsMhz(allTimings, colorDepth, classification) {
  const maxCvtClockKhz = Math.max(...allTimings.map(t => t.pixelClockKhz));
  const maxVicClockKhz = classification ? classification.maxVicClockKhz : 0;
  const maxPixelClockKhz = Math.max(maxCvtClockKhz, maxVicClockKhz);
  const maxClockMhz = (Math.ceil(maxPixelClockKhz / 10000) + 1) * 10;
  return maxClockMhz * (colorDepth / 8);
}

/**
 * Compute how many DTDs fit in the first CEA extension block.
 */
function computeFirstBlockDtdCapacity(state, hdmiParams, classification) {
  const dataBlockSize = computeDataBlockSize(state, hdmiParams, classification);
  return Math.floor((127 - (4 + dataBlockSize)) / 18);
}

/**
 * Build the complete EDID binary (base block + extension blocks).
 *
 * state: { displayName, mfgId, iface, colorDepth, dpi, hdr, audio }
 * allTimings: array of timing objects (preferred first)
 */
export function buildEdidBinary(state, allTimings) {
  const isHdmi = state.iface === 'HDMI';

  // Classify modes
  const classification = classifyModes(allTimings, state.colorDepth);
  const { dtdModes, displayIdModes, fallbackDtd, needsDisplayId } = classification;

  // Determine the base block DTD (preferred timing)
  // If the preferred timing exceeds DTD limit, use fallback
  const preferredTiming = allTimings[0];
  const preferredFitsDtd = preferredTiming.pixelClockKhz <= MAX_DTD_CLOCK_KHZ;
  let baseBlockDtd = preferredFitsDtd ? preferredTiming : fallbackDtd;

  // Find which VIC matches the base block DTD's resolution/rate
  // and use its standard timing for exact match (avoids edid-decode warning)
  let dtdMatchingVic = null;
  if (baseBlockDtd) {
    const dtdVics = findMatchingVics(baseBlockDtd.hActive, baseBlockDtd.vActive, baseBlockDtd.refreshRate);
    for (const v of dtdVics) {
      const vicTiming = VIC_STANDARD_TIMINGS.get(v);
      if (vicTiming && vicTiming.pixelClockKhz <= MAX_DTD_CLOCK_KHZ) {
        baseBlockDtd = vicTiming;
        dtdMatchingVic = v;
        break;
      }
    }
  }

  // Reorder SVDs so the VIC matching the first DTD leads the list
  // This avoids "VIC X and the first DTD are not identical" warning
  if (dtdMatchingVic && classification.allVics[0] !== dtdMatchingVic) {
    const reordered = [dtdMatchingVic, ...classification.allVics.filter(v => v !== dtdMatchingVic)];
    classification.allVics = reordered;
  }

  if (!baseBlockDtd) {
    throw new Error(
      `Cannot generate EDID: preferred timing ${preferredTiming.hActive}x${preferredTiming.vActive}@${preferredTiming.refreshRate}Hz ` +
      `exceeds DTD limit and no fallback could be computed`
    );
  }

  // Build hdmiParams for CEA blocks
  const hdmiParams = isHdmi ? {
    maxTmdsMhz: computeMaxTmdsMhz(allTimings, state.colorDepth, classification),
    audioConfig: state.audio || null,
  } : null;

  // CEA extension DTDs: only dtdModes (not vicModes, not displayIdModes)
  // The base block DTD is separate, so exclude it from CEA DTDs
  const ceaDtdTimings = dtdModes.filter(t => t !== preferredTiming);
  // If we used a fallback, the preferred is NOT in dtdModes, so ceaDtdTimings = dtdModes
  // If preferred fits DTD and is a dtdMode, it's already filtered out above

  // HDMI: all non-preferred DTD timings go to CEA extensions
  // DP: only when >2 DTD timings (2nd can fit in base block descriptor 2)
  let extraTimings;
  if (isHdmi) {
    extraTimings = ceaDtdTimings;
  } else {
    // For DP: if preferred fits DTD and there's a 2nd DTD timing, it goes in base block slot 2
    // So we only need CEA for 3rd+ DTD timings, or always if there are VICs
    if (classification.allVics.length > 1 || ceaDtdTimings.length > 1) {
      extraTimings = ceaDtdTimings.length > 1 ? ceaDtdTimings.slice(1) : [];
    } else {
      extraTimings = ceaDtdTimings.length > 1 ? ceaDtdTimings.slice(1) : [];
    }
  }

  // Base block timings: for DP without extensions, can include 2 DTDs
  let baseBlockTimings;
  if (isHdmi) {
    baseBlockTimings = [baseBlockDtd];
  } else {
    if (ceaDtdTimings.length >= 1 && classification.allVics.length <= 1 && !needsDisplayId) {
      baseBlockTimings = [baseBlockDtd, ...ceaDtdTimings.slice(0, 1)];
      extraTimings = ceaDtdTimings.slice(1);
    } else {
      baseBlockTimings = [baseBlockDtd];
    }
  }

  // Need a CEA extension if: HDMI (always for VSDB), or there are extra DTD timings, or VICs > just VIC 1
  const needsCeaExtension = isHdmi || extraTimings.length > 0 || classification.allVics.length > 1;

  // Compute CEA extension count
  let ceaExtensionCount = 0;
  if (needsCeaExtension) {
    const firstCap = computeFirstBlockDtdCapacity(state, hdmiParams, classification);
    ceaExtensionCount = extraTimings.length <= firstCap
      ? 1
      : 1 + Math.ceil((extraTimings.length - firstCap) / 6);
  }

  // DisplayID extension blocks: first block holds 3 (Display Parameters uses 32 bytes),
  // subsequent blocks hold 5
  const DISPLAYID_FIRST_BLOCK_CAP = 3;
  const DISPLAYID_NEXT_BLOCK_CAP = 5;
  const displayIdBlockCount = needsDisplayId
    ? 1 + Math.ceil(Math.max(0, displayIdModes.length - DISPLAYID_FIRST_BLOCK_CAP) / DISPLAYID_NEXT_BLOCK_CAP)
    : 0;

  const dataExtensions = ceaExtensionCount + displayIdBlockCount;

  // EDID 1.3 requires a Block Map Extension in block 1 when there are 2+ data extensions
  const needsBlockMap = isHdmi && dataExtensions >= 2;
  const totalExtensions = dataExtensions + (needsBlockMap ? 1 : 0);

  // Compute display physical size once from the highest-res timing
  const displaySizeMm = computeDisplaySizeMm(preferredTiming, state.dpi);

  // Include ALL timings in range limits so edid-decode doesn't warn about
  // timings being out of range. EDID 1.3 caps at 255 Hz/255 kHz,
  // EDID 1.4 caps at 510 Hz/510 kHz — values beyond are clamped by encodeRangeLimits.
  const baseBlock = buildBaseBlock(state, baseBlockTimings, totalExtensions, allTimings, classification, 0);

  if (totalExtensions === 0) {
    return baseBlock;
  }

  const blocks = [baseBlock];

  // Build Block Map Extension for EDID 1.3 when needed
  const extensionBlocks = [];

  // Build CEA extension blocks
  if (ceaExtensionCount > 0) {
    const firstCap = computeFirstBlockDtdCapacity(state, hdmiParams, classification);
    let timingIdx = 0;
    for (let i = 0; i < ceaExtensionCount; i++) {
      const cap = (i === 0) ? firstCap : 6;
      const blockTimings = extraTimings.slice(timingIdx, timingIdx + cap);
      timingIdx += cap;
      extensionBlocks.push(buildCeaExtensionBlock(blockTimings, displaySizeMm, i === 0, state, hdmiParams, classification));
    }
  }

  // Build DisplayID extension blocks
  if (displayIdBlockCount > 0) {
    let didTimingIdx = 0;
    for (let i = 0; i < displayIdBlockCount; i++) {
      const cap = (i === 0) ? DISPLAYID_FIRST_BLOCK_CAP : DISPLAYID_NEXT_BLOCK_CAP;
      const blockTimings = displayIdModes.slice(didTimingIdx, didTimingIdx + cap);
      didTimingIdx += cap;
      const didExtCount = (i === 0) ? displayIdBlockCount - 1 : 0;
      extensionBlocks.push(buildDisplayIdExtensionBlock(blockTimings, preferredTiming, displaySizeMm, i === 0, didExtCount));
    }
  }

  if (needsBlockMap) {
    // Block Map: byte 0 = 0xF0, bytes 1-126 = extension tags, byte 127 = checksum
    const blockMap = Buffer.alloc(128);
    blockMap[0] = 0xf0;
    for (let i = 0; i < extensionBlocks.length; i++) {
      blockMap[1 + i] = extensionBlocks[i][0];  // Extension tag (0x02=CTA, 0x70=DisplayID)
    }
    blockMap[127] = computeChecksum(blockMap);
    blocks.push(blockMap);
  }

  blocks.push(...extensionBlocks);

  return Buffer.concat(blocks);
}
