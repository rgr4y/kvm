import { useEffect, useMemo, useState } from "react";

import { useVideoStore, useSettingsStore} from "@/hooks/stores";

import { useVideoStream } from "./useVideoStream";
import { usePointerLock } from "./usePointerLock";

const LOADING_TIMEOUT_MS = 15_000;

export const useVideoOverlays = (
  videoStream: ReturnType<typeof useVideoStream>,
  pointerLock: ReturnType<typeof usePointerLock>,
  videoEffects: any
) => {
  const hdmiState = useVideoStore(state => state.hdmiState);
  const videoWidth = useVideoStore(state => state.width);
  const videoHeight = useVideoStore(state => state.height);

  const forceHttp = useSettingsStore(state => state.forceHttp);
  const hdmiError = ["no_lock", "no_signal", "out_of_range"].includes(hdmiState);
  const isVideoLoading = !videoStream.isPlaying;

  // Loading timeout — after 15s with no video, escalate to HDMI error overlay
  const [loadingTimedOut, setLoadingTimedOut] = useState(false);
  const rawShowLoading = isVideoLoading && !hdmiError;

  useEffect(() => {
    if (!rawShowLoading) {
      setLoadingTimedOut(false);
      return;
    }
    const timer = setTimeout(() => setLoadingTimedOut(true), LOADING_TIMEOUT_MS);
    return () => clearTimeout(timer);
  }, [rawShowLoading]);

  const showPointerLockBar = useMemo(() => {
    if (videoEffects.settings.mouseMode !== "relative") return false;
    if (!pointerLock.isPointerLockPossible) return false;
    if (pointerLock.isPointerLockActive) return false;
    if (isVideoLoading) return false;
    if (!videoStream.isPlaying) return false;
    if (videoHeight === 0 || videoWidth === 0) return false;
    return true;
  }, [
    videoStream.isPlaying,
    pointerLock.isPointerLockActive,
    pointerLock.isPointerLockPossible,
    isVideoLoading,
    videoEffects.settings.mouseMode,
    videoHeight,
    videoWidth,
  ]);

  const showNoAutoplayOverlay = useMemo(() => {
    if (videoStream.peerConnectionState !== "connected" || !forceHttp ) return false;
    if (videoStream.isPlaying) return false;
    if (hdmiError) return false;
    if (videoHeight === 0 || videoWidth === 0) return false;
    return true;
  }, [hdmiError, videoStream.isPlaying, videoStream.peerConnectionState, videoHeight, videoWidth]);

  const shouldHideVideo = isVideoLoading || hdmiError || (videoStream.peerConnectionState !== "connected" && !forceHttp);
  const showConnectionOverlays = videoStream.peerConnectionState === "connected" || forceHttp;
  const showLoadingOverlay = rawShowLoading && !loadingTimedOut;
  const showHDMIError = hdmiError || loadingTimedOut;

  // When loading timed out with no real HDMI error, show as no_signal
  const effectiveHdmiState = loadingTimedOut && !hdmiError ? "no_signal" : hdmiState;

  return {
    forceHttp,
    showPointerLockBar,
    showNoAutoplayOverlay,
    showConnectionOverlays,
    showLoadingOverlay,
    showHDMIError,
    shouldHideVideo,
    hdmiState: effectiveHdmiState,
    framesReceived: videoStream.framesReceived,
  };
};