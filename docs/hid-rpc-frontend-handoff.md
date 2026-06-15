# HID RPC Frontend Port — Implementation Handoff

## Context

This is a Luckfox PicoKVM project (fork of JetKVM). The HID RPC **backend** has been ported and is live on the device. The browser UI still sends all keyboard/mouse events via JSON-RPC over a WebRTC data channel. This causes queue lag under fast input — every mouse move is a JSON-serialized RPC call with no backpressure.

The backend now accepts a dedicated binary WebRTC data channel (`hidrpc` / `hidrpc-unreliable-*`) for HID events. The frontend needs to be updated to use it.

## What Exists (Backend — Already Done)

- `internal/hidrpc/hidrpc.go` — Binary HID RPC protocol handler
- `internal/hidrpc/message.go` — Message marshal/unmarshal (binary format)
- `hidrpc.go` — Top-level bridge: dispatches HID messages to USB gadget
- `webrtc.go` — Accepts `hidrpc` and `hidrpc-unreliable-*` data channels, routes messages through priority queues
- `internal/usbgadget/hid_keyboard.go` — Upgraded with modifier tracking, serialized state mutations, improved auto-release

## What Needs To Be Built (Frontend)

Port these from JetKVM commit stack (`bcc307b` through `99203a0` on `jetkvm/dev` remote):

### New Files

1. **`ui/src/hooks/hidRpc.ts`** — Binary protocol encoder/decoder matching `internal/hidrpc/message.go`
   - Message types: keyboard report, mouse absolute, mouse relative, wheel, keepalive
   - Binary serialization (ArrayBuffer/DataView)
   - Get source: `git show bcc307b:ui/src/hooks/hidRpc.ts` (then apply changes from `72e3013`, `afb146d`)

2. **`ui/src/hooks/useHidRpc.ts`** — React hook managing the HID RPC data channel lifecycle
   - Creates/negotiates the `hidrpc` WebRTC data channel
   - Handles handshake, version negotiation
   - Provides `sendKeyboard()`, `sendMouse()`, `sendWheel()` functions
   - Falls back to JSON-RPC if HID RPC channel unavailable
   - Get source: `git show bcc307b:ui/src/hooks/useHidRpc.ts` (then `76e748a` adds fallback logic)

3. **`ui/src/hooks/useMouse.ts`** — Mouse event handler using HID RPC
   - Replaces mouse portion of current `useMouseEvents.ts` JSON-RPC sends
   - Uses binary channel for mouse reports
   - Get source: `git show bcc307b:ui/src/hooks/useMouse.ts`

### Modified Files

4. **`ui/src/hooks/useKeyboard.ts`** — Switch keyboard sends from JSON-RPC to HID RPC binary channel
   - Currently calls `send("keyboardReport", ...)` — change to use `useHidRpc` hook's `sendKeyboard()`
   - Keep JSON-RPC as fallback
   - Compare: `git diff bcc307b^..bcc307b -- ui/src/hooks/useKeyboard.ts`

5. **`ui/src/components/WebRTCVideo.tsx`** — Wire up HID RPC channel in WebRTC session setup
   - Add data channel creation for `hidrpc`
   - Compare: `git diff bcc307b^..bcc307b -- ui/src/components/WebRTCVideo.tsx`

6. **`ui/src/hooks/stores.ts`** — Add HID RPC state to stores
   - `hidRpcConnected`, `hidRpcVersion`, etc.
   - Compare: `git diff bcc307b^..bcc307b -- ui/src/hooks/stores.ts`

7. **`ui/src/routes/devices.$id.tsx`** — Wire useHidRpc hook into device route
   - Compare: `git diff bcc307b^..bcc307b -- ui/src/routes/devices.$id.tsx`

8. **`ui/vite.config.ts`** — May need WebRTC data channel proxy config for dev mode
   - Compare: `git diff bcc307b^..bcc307b -- ui/vite.config.ts`

## Key Differences from JetKVM Source

- Import paths: JetKVM uses `@/hooks/...` — same in our codebase, no change needed
- `useMouseEvents.ts` — Luckfox has extra touch/zoom/mobile code not in JetKVM. Don't overwrite — integrate HID RPC sends alongside existing logic
- `WebRTCVideo.tsx` — Luckfox version differs significantly from JetKVM. Patch carefully.
- JSON-RPC handlers (`absMouseReport`, `relMouseReport`, `keyboardReport`, `wheelReport`) must continue working as fallback
- `ui/src/hooks/stores.ts` — Luckfox has extra store fields (vpn, audio, npu, etc). Only add HID RPC fields, don't restructure.

## How to Get JetKVM Source

The `jetkvm` remote is already configured:
```bash
git show bcc307b:ui/src/hooks/hidRpc.ts      # Binary protocol
git show bcc307b:ui/src/hooks/useHidRpc.ts    # React hook
git show bcc307b:ui/src/hooks/useMouse.ts     # Mouse handler
git diff bcc307b^..99203a0 -- ui/src/         # Full frontend diff across all 8 commits
```

## Commit Stack (in order)
```
bcc307b  feat: hid rpc channel (#755)              — foundation
72e3013  feat: send all paste keystrokes to backend — paste via binary channel
afb146d  feat: release keyPress automatically       — auto-release in frontend
711158a  fix: modifier key auto-release and reset   — modifier handling
2167272  fix: serialise keyboard state mutations     — race fix
87eac39  fix: prevent modifier auto-release typing   — typing fix
df5dbea  fix: keep modifiers out of auto-release     — modifier refinement
99203a0  fix: remove goroutine from HID handler      — backend only (already ported)
```

## Testing

1. Build: `cd ui && npx tsc --noEmit` — must pass
2. `make build_release && make deploy_only` — deploy to device
3. Open browser, verify:
   - Keyboard input works (type in target machine)
   - Mouse movement is responsive (no queue lag)
   - Check browser console for `hidrpc` data channel connection
   - Modifier keys (Shift, Ctrl, Alt) work correctly
   - Paste via Ctrl+V works
   - Falls back gracefully if HID RPC channel fails

## Device Access

```bash
make deploy              # build + deploy
make deploy_only         # deploy without rebuild  
make build_release       # full build (frontend + backend)
ssh root@picokvm         # SSH (also tries 10.0.1.8, 192.168.4.8)
```

## Current State

- Branch: `luckfox` on `origin` (rgr4y/kvm)
- Version: 0.2.0
- All backend HID RPC code is committed and deployed
- Device is running and accessible
- 30 commits ahead of upstream/luckfox
