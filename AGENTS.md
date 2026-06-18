# Agents Guide — Luckfox PicoKVM Fork

## What This Is

Maintained fork of [Luckfox PicoKVM](https://github.com/LuckfoxTECH/luckfox-pico-kvm) (itself based on [JetKVM](https://jetkvm.com/)). Targets the Luckfox Pico KVM hardware (RV1106G3 SoC, eMMC, A/B slot boot).

## Repos

| Repo | Branch | Purpose |
|------|--------|---------|
| [rgr4y/kvm](https://github.com/rgr4y/kvm) | `luckfox` | App (Go backend + React frontend) |
| [rgr4y/luckfox-pico](https://github.com/rgr4y/luckfox-pico) | `picokvm-board` | SDK board config, overlays, rootfs build |
| [rgr4y/kvm_display](https://github.com/rgr4y/kvm_display) | `swap-network-monitor` | LVGL touchscreen UI |

## Architecture

- **Go backend** (`*.go` in root) — WebRTC, USB HID gadget, OTA updates, VPN (Tailscale)
- **React frontend** (`ui/`) — Vite + TypeScript + Tailwind
- **Build output** — `bin/kvm_app` → deploy to `/userdata/picokvm/bin/kvm_app` on device
- **Rootfs** — custom buildroot rootfs with stock kernel/uboot, built via Luckfox SDK on x86 Docker

## OTA / Custom Update Source

The OTA system (`ota.go`) supports two update source formats:

1. **GitHub repo URL** (preferred): Set custom base URL to `https://github.com/owner/repo`. The updater auto-detects GitHub URLs, hits the Releases API (`/repos/{owner}/{repo}/releases/latest`), and finds `update.bin` + `system.img` assets from the latest release. Tag becomes the version.

2. **Flat URL**: Any URL serving `version.txt` (contains version string) alongside `update.bin` and/or `system.img` files.

## Key Files

| File | What |
|------|------|
| `ota.go` | OTA update logic, GitHub Releases API integration |
| `vpn.go` | Tailscale VPN (non-blocking init, 30s timeout) |
| `web.go` | HTTP/WebSocket server |
| `video.go` | HDMI capture (TC358743) |
| `usb.go` | USB HID gadget (keyboard/mouse emulation) |
| `ui/src/layout/components_setting/version/VersionContent.tsx` | Update source UI |

## Device Info

- SoC: Rockchip RV1106G3
- RAM: 256MB (66MB CMA, ~167MB OS)
- Boot: eMMC with A/B slot switching
- Stock kernel + custom rootfs (system partition only)
- Persistent storage: `/userdata` (survives OTA)
- SSH on port 22, web UI on port 80

## Build

```bash
make frontend     # frontend only
make build_dev    # backend only
make build_release # full build
```

Cross-compile rootfs on x86 Linux (Docker on unraid). See `rgr4y/luckfox-pico` repo for SDK build instructions.
