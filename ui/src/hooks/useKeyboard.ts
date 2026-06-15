import { useCallback, useEffect, useRef } from "react";

import notifications from "@/notifications";
import { hidKeyBufferSize, useHidStore, useRTCStore, useSettingsStore } from "@/hooks/stores";
import { useJsonRpc } from "@/hooks/useJsonRpc";
import { useHidRpc } from "@/hooks/useHidRpc";
import {
  KeyboardLedStateMessage,
  KeyboardMacroStateMessage,
  KeyboardMacroStep,
  KeysDownStateMessage,
} from "@/hooks/hidRpc";
import { keys, modifiers } from "@/keyboardMappings";

const MACRO_RESET_KEYBOARD_STATE: KeyboardMacroStep = {
  keys: new Array(hidKeyBufferSize).fill(0),
  modifier: 0,
  delay: 0,
};

export default function useKeyboard() {
  const [send] = useJsonRpc();

  const rpcDataChannel = useRTCStore(state => state.rpcDataChannel);
  const forceHttp = useSettingsStore(state => state.forceHttp);
  const updateActiveKeysAndModifiers = useHidStore(
    state => state.updateActiveKeysAndModifiers,
  );
  const isReinitializingGadget = useHidStore(state => state.isReinitializingGadget);
  const usbState = useHidStore(state => state.usbState);
  const setKeysDownState = useHidStore(state => state.setKeysDownState);
  const setKeyboardLedState = useHidStore(state => state.setKeyboardLedState);
  const setPasteModeEnabled = useHidStore(state => state.setPasteModeEnabled);

  // HID RPC binary channel — handles incoming state messages from device
  const {
    reportKeyboardEvent: sendKeyboardEventHidRpc,
    reportKeyboardMacroEvent: sendKeyboardMacroEventHidRpc,
    rpcHidReady,
  } = useHidRpc(message => {
    switch (message.constructor) {
      case KeysDownStateMessage:
        setKeysDownState((message as KeysDownStateMessage).keysDownState);
        break;
      case KeyboardLedStateMessage:
        setKeyboardLedState((message as KeyboardLedStateMessage).keyboardLedState);
        break;
      case KeyboardMacroStateMessage:
        if (!(message as KeyboardMacroStateMessage).isPaste) break;
        setPasteModeEnabled((message as KeyboardMacroStateMessage).state);
        break;
      default:
        break;
    }
  });

  // Track held keys for keepalive
  const heldKeysRef = useRef<Set<number>>(new Set());
  const keepaliveIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const sendKeyboardEvent = useCallback(
    (keyArray: number[], modifierArray: number[]) => {
      // Don't send keyboard events while reinitializing gadget
      if (isReinitializingGadget) return;
      if (usbState !== "configured") return;

      const accModifier = modifierArray.reduce((acc, val) => acc + val, 0);

      if (rpcHidReady) {
        // Binary channel — send keyboard report directly
        sendKeyboardEventHidRpc(keyArray, accModifier);
      } else {
        // JSON-RPC fallback
        if (!forceHttp && rpcDataChannel?.readyState !== "open") return;
        send("keyboardReport", { keys: keyArray, modifier: accModifier }, resp => {
          if ("error" in resp) {
            const msg = (resp.error.data as string) || resp.error.message || "";
            if (msg.includes("cannot send after transport endpoint shutdown") && usbState === "configured") {
              notifications.error("Please check if the cable and connection are stable.", { duration: 5000 });
            }
          }
        });
      }

      // Update the info bar display of currently pressed keys
      updateActiveKeysAndModifiers({ keys: keyArray, modifiers: modifierArray });
    },
    [forceHttp, rpcDataChannel?.readyState, send, updateActiveKeysAndModifiers, isReinitializingGadget, usbState, rpcHidReady, sendKeyboardEventHidRpc],
  );

  const resetKeyboardState = useCallback(() => {
    sendKeyboardEvent([], []);
    heldKeysRef.current.clear();
    if (keepaliveIntervalRef.current) {
      clearInterval(keepaliveIntervalRef.current);
      keepaliveIntervalRef.current = null;
    }
  }, [sendKeyboardEvent]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      resetKeyboardState();
    };
  }, [resetKeyboardState]);

  const executeMacro = useCallback(
    async (steps: { keys: string[] | null; modifiers: string[] | null; delay: number }[]) => {
      if (rpcHidReady) {
        // Build macro steps and send via HID RPC in one shot
        const macroSteps: KeyboardMacroStep[] = [];

        for (const step of steps) {
          const keyValues = (step.keys || []).map(key => keys[key]).filter(Boolean);
          const modifierMask: number = (step.modifiers || [])
            .map(mod => modifiers[mod])
            .reduce((acc, val) => acc + val, 0);

          if (keyValues.length > 0 || modifierMask > 0) {
            macroSteps.push({ keys: keyValues, modifier: modifierMask, delay: 20 });
            macroSteps.push({ ...MACRO_RESET_KEYBOARD_STATE, delay: step.delay || 100 });
          }
        }

        sendKeyboardMacroEventHidRpc(macroSteps);
      } else {
        // Legacy: execute step by step via JSON-RPC
        for (const [index, step] of steps.entries()) {
          const keyValues = step.keys?.map(key => keys[key]).filter(Boolean) || [];
          const modifierValues = step.modifiers?.map(mod => modifiers[mod]).filter(Boolean) || [];

          if (keyValues.length > 0 || modifierValues.length > 0) {
            sendKeyboardEvent(keyValues, modifierValues);
            await new Promise(resolve => setTimeout(resolve, step.delay || 50));
            resetKeyboardState();
          } else {
            await new Promise(resolve => setTimeout(resolve, step.delay || 50));
          }

          if (index < steps.length - 1) {
            await new Promise(resolve => setTimeout(resolve, 10));
          }
        }
      }
    },
    [rpcHidReady, sendKeyboardMacroEventHidRpc, sendKeyboardEvent, resetKeyboardState],
  );

  return { sendKeyboardEvent, resetKeyboardState, executeMacro };
}
