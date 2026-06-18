import { useCallback, useEffect, useRef } from "react";
import { useNavigate, useOutletContext } from "react-router-dom";
import { isMobile } from "react-device-detect";

import { GridCard } from "@components/Card";
import { Button } from "@components/Button";
import LogoLuckfox from "@/assets/logo-luckfox.png";
import { useSettingsStore, useUiStore } from "@/hooks/stores";
import { useJsonRpc } from "@/hooks/useJsonRpc";

interface ContextType {
  setupPeerConnection: () => Promise<void>;
}
/* TODO: Migrate to using URLs instead of the global state. To simplify the refactoring, we'll keep the global state for now. */

// Track page-level load time for animation skipping
const PAGE_LOAD_TIME = Date.now();

export default function OtherSessionRoute() {
  const outletContext = useOutletContext<ContextType>();
  const navigate = useNavigate();
  const setOtherSession = useUiStore(state => state.setOtherSession);
  const setSkipModalCloseAnimation = useUiStore(state => state.setSkipModalCloseAnimation);
  const forceHttp = useSettingsStore(state => state.forceHttp);
  const [send] = useJsonRpc();
  const dismissingRef = useRef(false);
  const mountTimeRef = useRef(Date.now());

  // Function to handle closing the modal
  const handleClose = useCallback(() => {
    if (dismissingRef.current) return;
    dismissingRef.current = true;

    if (forceHttp) {
      send("confirmOtherSession", {}, () => undefined);
    }

    // Skip modal close animation if page is fresh (<10s) or component was briefly shown
    const pageAge = Date.now() - PAGE_LOAD_TIME;
    const mountAge = Date.now() - mountTimeRef.current;
    if (pageAge < 10_000 || mountAge < 2_000) {
      setSkipModalCloseAnimation(true);
    }

    if (isMobile) {
      setOtherSession(false);
    } else {
      // Fire-and-forget: start peer connection setup immediately
      // so the video stream loads behind the closing modal
      outletContext?.setupPeerConnection().catch(() => {});
      navigate("..");
    }
  }, [forceHttp, send, setOtherSession, setSkipModalCloseAnimation, outletContext, navigate]);

  // Poll /api/session/active every 1s while tab is visible.
  // Auto-dismiss when no other session is active.
  useEffect(() => {
    let timer: ReturnType<typeof setInterval> | null = null;

    const getSessionId = () => {
      try {
        return window.sessionStorage.getItem("httpSessionId") || "";
      } catch {
        return "";
      }
    };

    const checkSession = async () => {
      if (document.visibilityState !== "visible") return;
      if (dismissingRef.current) return;

      try {
        const res = await fetch("/api/session/active", {
          headers: { "X-Session-ID": getSessionId() },
        });
        if (!res.ok) return;
        const data = await res.json();
        if (data.active === false) {
          handleClose();
        }
      } catch {
        // Network error — skip this tick
      }
    };

    // Check immediately on mount (handles page refresh on /other-session)
    checkSession();
    timer = setInterval(checkSession, 1000);

    return () => {
      if (timer) clearInterval(timer);
    };
  }, [handleClose]);

  return (
    <GridCard cardClassName="relative mx-auto max-w-md text-left pointer-events-auto z-[10000] !pointer-events-auto">
      <div className="p-10">
        <div className="flex min-h-[140px] flex-col items-start justify-start space-y-4 text-left">
          <div className="h-[24px]">
            <img src={LogoLuckfox} alt="" className="h-full dark:hidden" />
            <img src={LogoLuckfox} alt="" className="hidden h-full dark:block" />
          </div>

          <div className="text-left">
            <p className="text-base font-semibold dark:text-white">
              Another Active Session Detected
            </p>
            <p className="mb-4 text-sm text-slate-600 dark:text-[#ffffff]">
              Only one active session is supported at a time. Would you like to take over
              this session?
            </p>
            <div className="flex items-center justify-start space-x-4">
              <Button size="SM" theme="primary" text="Use Here" onClick={handleClose} />
            </div>
          </div>
        </div>
      </div>
    </GridCard>
  );
}
