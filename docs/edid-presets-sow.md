# SoW: Capability-labeled EDID presets ("pick a mode")

## Problem
The EDID picker lists presets by scavenged monitor name ("Acer B246WL", "DELL
D2721H"). In a KVM the EDID is presented to the *captured target host*, which
reads it to decide output resolution / refresh / audio / HDR. Users don't care
what monitor the EDID came from — they care what the target will output. Labels
should describe the mode/capabilities, not the donor monitor.

The bridge (tc358743 / rk628) tops out ~1080p60. An EDID advertising more (4K,
HDR) makes the target output something the bridge can't ingest -> garbled / no
capture. So presets exist mainly to cap and force a known-good mode, and to fix
targets that pick 640x480 safe-mode with a missing/garbage EDID (BIOS/UEFI).

## Model
```
EDIDCaps   { maxRes string; refresh int; hdr bool; audio bool }
EDIDPreset { id string; label string; caps EDIDCaps; edidHex string;
             disabled bool; note string }
```
`caps` are PARSED from `edidHex` at runtime (correct-by-construction), not
hand-declared, so a label can never silently disagree with the blob. `disabled`
presets carry no blob yet (see "EDID blobs").

## Backend (Go, package kvm)
New `edid_presets.go`:
- `edidPresets []EDIDPreset` table (blobs below).
- `parseEDIDCaps(hex)` — decode base-block detailed timing #1 for resolution +
  refresh (pixclk / (htotal*vtotal)); scan the CEA-861 extension (if byte 126 > 0)
  data block collection for an Audio Data Block (tag 1 -> audio) and HDR static
  metadata (extended tag 6 -> hdr).
- `validateEDID(hex)` — length %128==0, header 00ffffffffffff00, each 128-byte
  block sums to 0 mod 256. Used by tests to reject bad blobs before ship.
- `rpcGetEDIDPresets()` -> presets with parsed caps.
- `rpcSetEDIDPreset(id)` -> looks up preset, refuses disabled/empty, applies via
  the existing `rpcSetEDID` (-> CallCtrlAction set_edid) path so persistence
  (config.EdidString) and the native apply are unchanged.
Registry: add `getEDIDPresets`, `setEDIDPreset`. `setEDID` (raw hex) stays for
Custom. `edid_presets_test.go` validates every non-disabled blob (checksum +
header) and that parsed resolution matches the label claim.

## UI (ui/src/layout/components_side/Video/SettingsVideoSide.tsx)
- On mount `send("getEDIDPresets")`; build the Select options from the result:
  `label` + a caps summary suffix (e.g. "1920x1080 · 60Hz · audio"). `disabled`
  presets render greyed (Antd option `disabled`).
- Keep matching the received EDID (getEDID) to a preset by hex to preselect.
- onChange: "custom" -> show textarea (raw setEDID, unchanged); otherwise
  `send("setEDIDPreset", { id })`.
- Remove the hard-coded `edids` array (now backend-owned; no drift).

## EDID blobs
Real, checksum-valid blobs already in the repo are reused, relabeled by capability:
- 1080p60, no audio  <- current default (128B, no CEA extension) [VERIFIED]
- 1080p60, audio     <- DELL D2721H dump (256B, CEA) [VERIFIED]
- 1920x1200          <- Acer B246WL dump (256B) [VERIFIED]
- 1920x1200 (alt)    <- ASUS PA248QV dump (256B) [VERIFIED]
Passthrough = paste a real monitor dump into Custom (documented in UI note).
Modes with NO verified blob ship **disabled** with a TODO rather than a
hand-rolled (likely malformed) EDID:
- 720p60  (TODO)
- 1080p30 (TODO)
To produce them: use the kernel built-in EDID firmware sources
(drivers/gpu/drm/edid/1280x720.* etc.) or AW EDID Editor / `edid-decode`, verify
with `edid-decode`, drop the hex in the table and clear `disabled`.

## Testing
- Go: `edid_presets_test.go` (checksum / header / resolution). `make build_dev`.
- Manual: UI dropdown lists capability labels; selecting one calls setEDIDPreset;
  target output changes; disabled entries not selectable; Custom still works.

## Open questions
- Auto-generate 720p60 / 1080p30 blobs in-tree (CVT/GTF) vs. vendor kernel
  firmware blobs? (Correctness / verification tradeoff.)
- Should `setEDID` reject blobs failing `validateEDID`, or stay permissive for
  Custom power users? (Currently permissive.)
