> **🔧 Maintained Fork** — This is an actively maintained fork of [Luckfox PicoKVM](https://github.com/LuckfoxTECH/luckfox-pico-kvm), with custom firmware builds, bug fixes, and quality-of-life improvements. Custom firmware releases are published at [rgr4y/luckfox-pico](https://github.com/rgr4y/luckfox-pico/releases).

![luckfox](https://github.com/LuckfoxTECH/luckfox-pico/assets/144299491/cec5c4a5-22b9-4a9a-abb1-704b11651e88)

# Luckfox PicoKVM

Luckfox PicoKVM is a lightweight IP KVM tool for remote access to a target device’s display with HID input emulation over the network. Based on [JetKVM](https://jetkvm.com/), targeting the Luckfox Pico KVM hardware (Rockchip RV1106G3).

## Contributing

This fork is maintained by a small team and we’d love help. Whether it’s bug fixes, feature ideas, documentation, or testing — contributions are welcome. If you’re using a PicoKVM and want to help improve the firmware and software, open an issue or PR. No contribution is too small.

See [AGENTS.md](AGENTS.md) for architecture and repo layout.

## What’s Different From Upstream

- **Custom firmware releases** with Entware, SSH, swap, and persistence baked in
- **GitHub Releases OTA** — set your update source to a GitHub repo URL and the updater auto-detects releases via the API
- **Non-blocking VPN init** — web server no longer hangs if Tailscale isn’t configured
- **Reordered display screens** — network/Tailscale info on second swipe
- **Various bug fixes** — typos, error handling, HDMI state detection

## Custom Update Source

Point your PicoKVM’s custom update URL at a GitHub repo to get OTA updates from releases:

```
https://github.com/rgr4y/luckfox-pico
```

The updater auto-detects GitHub URLs, queries the Releases API for the latest release, and finds `update.bin` / `system.img` assets automatically. Alternatively, use any URL serving a `version.txt` file alongside the update assets.

## Features

* **Micro SD card support** — boot settings or storage expansion
* **USB multifunction** — USB sound card, MTP device, HTTP file upload/download
* **Serial port control** — connect to controlled device’s serial port
* **1.54-inch touchscreen** — IP address, connection status, system info
* **Remote access** — WebRTC, Tailscale VPN, FRP reverse proxy

## Build

```bash
make frontend       # frontend only
make build_dev      # backend only
make build_release  # full build
```

Output: `bin/kvm_app` → deploy to `/userdata/picokvm/bin/kvm_app` on device via SSH or MTP.

## Related Repos

| Repo | Purpose |
|------|---------|
| [rgr4y/luckfox-pico](https://github.com/rgr4y/luckfox-pico) | SDK board config, overlays, firmware releases |
| [rgr4y/kvm_display](https://github.com/rgr4y/kvm_display) | LVGL touchscreen UI |

## Documentation

- [Luckfox PicoKVM Wiki](https://wiki.luckfox.com/Luckfox-PicoKVM/)
- [JetKVM](https://jetkvm.com/) (upstream project)
