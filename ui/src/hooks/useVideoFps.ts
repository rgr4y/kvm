import { useMemo, useState } from "react";
import { useInterval } from "usehooks-ts";

import { useRTCStore, useSettingsStore } from "@/hooks/stores";

/**
 * Polls the WebRTC inbound-rtp stats for the live video frame rate and returns
 * both the raw value and a display label ("30fps" / "N/A fps"). Extracted so the
 * fps readout can live in whichever bar hosts the monitor button.
 */
export function useVideoFps() {
  const forceHttp = useSettingsStore(state => state.forceHttp);
  const peerConnection = useRTCStore(state => state.peerConnection);
  const mediaStream = useRTCStore(state => state.mediaStream);
  const [fps, setFps] = useState(0);

  useInterval(function collectWebRTCStats() {
    (async () => {
      if (forceHttp) return;
      if (!mediaStream) return;
      const videoTrack = mediaStream.getVideoTracks()[0];
      if (!videoTrack) return;
      const stats = await peerConnection?.getStats();
      stats?.forEach(report => {
        if (report.type === "inbound-rtp") {
          setFps(report.framesPerSecond ?? 0);
        }
      });
    })();
  }, 500);

  const label = useMemo(
    () => (forceHttp ? "N/A fps" : `${Math.round(fps || 0)}fps`),
    [forceHttp, fps],
  );

  return { fps, label };
}
