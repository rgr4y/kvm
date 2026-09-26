# edid-gen — KVM EDID preset generator

Vendored EDID assembly core from [RobertoNegro/edid-generator](https://github.com/RobertoNegro/edid-generator)
(MIT, see `LICENSE`). Only the non-interactive builder library is vendored; the
`@clack`-based wizard is not. `gen-presets.mjs` drives `buildEdidBinary()`
headlessly for the fixed KVM mode set.

The generated `.bin` blobs are committed under `../../edid_blobs/` and embedded
into `kvm_app` (`edid_presets.go`). Regenerate them only when the mode set or
parameters change.

## Regenerate

```sh
node tools/edid-gen/gen-presets.mjs edid_blobs
```

No npm install needed — the builder core has no runtime dependencies.

## Modes

Six modes, each in plain and `-audio` (LPCM stereo) variants:

| id             | mode            | base DTD source        |
|----------------|-----------------|------------------------|
| `720p60`       | 1280x720@60     | CTA-861 VIC 4          |
| `1080p60`      | 1920x1080@60    | CTA-861 VIC 16         |
| `1080p30`      | 1920x1080@30    | CTA-861 VIC 34         |
| `1920x1200-60` | 1920x1200@59.95 | VESA CVT-RB v1         |
| `1440p60`      | 2560x1440@59.95 | VESA CVT-RB v1         |
| `2160p30`      | 3840x2160@30    | CTA-861 VIC 95         |

VIC-mode base DTDs use the canonical CTA standard timing (the builder substitutes
`VIC_STANDARD_TIMINGS` for the base descriptor); the two non-VIC modes use CVT
reduced-blanking. All timings verified against VESA DMT / CTA-861 tables. All
blobs are HDMI (EDID 1.3 + CEA-861 extension), 256 bytes, checksum-valid.

The monitor-name descriptor is rewritten to `KVM <mode>` at apply time by
`setEDIDMonitorName`, so the captured host reports e.g. `KVM 1080p60`.
