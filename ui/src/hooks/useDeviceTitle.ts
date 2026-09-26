import { useEffect } from "react";

import { NetworkSettings } from "@/hooks/stores";
import { useJsonRpc } from "@/hooks/useJsonRpc";

const FALLBACK_TITLE = "KVM";

/**
 * Sets the browser tab/window title to the device's configured hostname
 * (falling back to "KVM"), so multiple KVMs are distinguishable at a glance.
 *
 * Fetches once on mount via getNetworkSettings — the same source BottomBar
 * uses. A hostname change made in Network settings is reflected after reload.
 */
export function useDeviceTitle() {
  const [send] = useJsonRpc();

  useEffect(() => {
    send("getNetworkSettings", {}, resp => {
      if ("error" in resp) return;
      const hostname = (resp.result as NetworkSettings).hostname?.trim();
      document.title = hostname || FALLBACK_TITLE;
    });
  }, [send]);
}
