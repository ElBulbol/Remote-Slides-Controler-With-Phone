/**
 * @fileoverview Slide Controller — single-component React application.
 *
 * Provides a full-screen touch interface to control LibreOffice Impress
 * presentations over the local network. The left half of the screen
 * triggers "previous slide" and the right half triggers "next slide",
 * via both taps and swipe gestures.
 */

import { useState, useEffect, useRef, useCallback } from 'react';

/* ------------------------------------------------------------------ */
/*  CONSTANTS                                                         */
/* ------------------------------------------------------------------ */

/** Polling interval for /api/status in milliseconds */
const STATUS_POLL_INTERVAL_MS = 2000;

/** Minimum horizontal distance (px) to register a swipe */
const SWIPE_MIN_DISTANCE_PX = 50;

/** Maximum movement (px) that still counts as a tap */
const TAP_MAX_DISTANCE_PX = 10;

/** Duration (ms) of the visual flash feedback */
const FLASH_DURATION_MS = 300;

/** Height of the header bar in pixels */
const HEADER_HEIGHT_PX = 60;

/** Diameter of the connection-status indicator dot */
const STATUS_DOT_SIZE_PX = 12;

/* ------------------------------------------------------------------ */
/*  INLINE STYLE OBJECTS                                              */
/* ------------------------------------------------------------------ */

/**
 * Root container — fills the viewport.
 *
 * @type {React.CSSProperties}
 */
const rootStyle = {
  display: 'flex',
  flexDirection: 'column',
  height: '100%',
  width: '100%',
  background: '#0d0d0d',
  fontFamily: "'Courier New', Courier, monospace",
};

/**
 * Header bar — holds the slide counter and connection dot.
 *
 * @type {React.CSSProperties}
 */
const headerStyle = {
  height: `${HEADER_HEIGHT_PX}px`,
  minHeight: `${HEADER_HEIGHT_PX}px`,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  position: 'relative',
  borderBottom: '1px solid rgba(255, 255, 255, 0.1)',
  borderRadius: 0,
};

/**
 * Slide counter text in the header.
 *
 * @type {React.CSSProperties}
 */
const counterStyle = {
  fontSize: '20px',
  letterSpacing: '2px',
  color: '#ffffff',
  fontFamily: "'Courier New', Courier, monospace",
};

/**
 * Touch zone — fills all remaining space below the header.
 *
 * @type {React.CSSProperties}
 */
const touchZoneStyle = {
  flex: 1,
  display: 'flex',
  position: 'relative',
  borderRadius: 0,
};

/**
 * Build the style for a single touch-half (left or right).
 *
 * @param {'left' | 'right'} side - Which half of the screen.
 * @returns {React.CSSProperties}
 */
function halfStyle(side) {
  return {
    flex: 1,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    position: 'relative',
    borderRight: side === 'left' ? '1px solid rgba(255, 255, 255, 0.1)' : 'none',
    borderRadius: 0,
  };
}

/**
 * Arrow hint characters shown at low opacity in each half.
 *
 * @type {React.CSSProperties}
 */
const arrowHintStyle = {
  fontSize: '96px',
  opacity: 0.08,
  color: '#ffffff',
  pointerEvents: 'none',
  fontFamily: "'Courier New', Courier, monospace",
};

/**
 * Build the style for the flash overlay on a given side.
 *
 * @param {boolean} active - Whether this side is currently flashing.
 * @returns {React.CSSProperties}
 */
function flashOverlayStyle(active) {
  return {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    background: 'rgba(255, 255, 255, 0.08)',
    pointerEvents: 'none',
    borderRadius: 0,
    animation: active ? `flash-fade ${FLASH_DURATION_MS}ms ease-out forwards` : 'none',
    opacity: active ? undefined : 0,
  };
}

/**
 * Build the connection-status dot style.
 *
 * @param {boolean} connected - Whether the UNO bridge is reachable.
 * @returns {React.CSSProperties}
 */
function dotStyle(connected) {
  return {
    width: `${STATUS_DOT_SIZE_PX}px`,
    height: `${STATUS_DOT_SIZE_PX}px`,
    borderRadius: '50%',
    background: connected ? '#ffffff' : '#444444',
    position: 'absolute',
    right: '16px',
    top: '50%',
    transform: 'translateY(-50%)',
  };
}

/* ------------------------------------------------------------------ */
/*  COMPONENT                                                         */
/* ------------------------------------------------------------------ */

/**
 * App — full-screen slide controller UI.
 *
 * Polls the backend for connection status, sends next/prev commands,
 * and provides visual + gestural feedback for touch interactions.
 *
 * @returns {JSX.Element}
 */
export default function App() {
  /* --- State ------------------------------------------------------ */

  /** @type {[number|null, Function]} Current slide index (1-based) */
  const [slide, setSlide] = useState(null);

  /** @type {[number|null, Function]} Total number of slides */
  const [total, setTotal] = useState(null);

  /** @type {[boolean, Function]} Whether the UNO bridge is reachable */
  const [connected, setConnected] = useState(false);

  /** @type {[null|'left'|'right', Function]} Flash feedback side */
  const [flash, setFlash] = useState(null);

  /* --- Refs for touch tracking ------------------------------------ */

  /** @type {React.MutableRefObject<number>} Touch start X coordinate */
  const touchStartX = useRef(0);

  /** @type {React.MutableRefObject<number>} Touch start Y coordinate */
  const touchStartY = useRef(0);

  /* --- Status polling --------------------------------------------- */

  useEffect(() => {
    /**
     * Fetch current slide status from the backend.
     *
     * @returns {Promise<void>}
     */
    async function pollStatus() {
      try {
        const res = await fetch('/api/status');
        const data = await res.json();
        setSlide(data.slide);
        setTotal(data.total);
        setConnected(data.connected);
      } catch {
        setSlide(null);
        setTotal(null);
        setConnected(false);
      }
    }

    pollStatus();
    const id = setInterval(pollStatus, STATUS_POLL_INTERVAL_MS);
    return () => clearInterval(id);
  }, []);

  /* --- Commands --------------------------------------------------- */

  /**
   * Send a slide-control command to the backend and trigger flash feedback.
   *
   * @param {'/api/next' | '/api/prev'} endpoint - API route to call.
   * @param {'left' | 'right'} side - Which half flashed.
   * @returns {Promise<void>}
   */
  const sendCommand = useCallback(async (endpoint, side) => {
    setFlash(side);
    setTimeout(() => setFlash(null), FLASH_DURATION_MS);

    try {
      await fetch(endpoint, { method: 'POST' });
    } catch {
      /* Swallow network errors — the user sees the flash regardless */
    }
  }, []);

  /* --- Touch handlers --------------------------------------------- */

  /**
   * Record the starting coordinates of a touch.
   *
   * @param {React.TouchEvent} e
   */
  const handleTouchStart = useCallback((e) => {
    const touch = e.touches[0];
    touchStartX.current = touch.clientX;
    touchStartY.current = touch.clientY;
  }, []);

  /**
   * Prevent default on touchmove to disable browser scroll/bounce/zoom.
   *
   * @param {React.TouchEvent} e
   */
  const handleTouchMove = useCallback((e) => {
    e.preventDefault();
  }, []);

  /**
   * Determine whether the gesture was a swipe or a tap and fire the
   * corresponding command.
   *
   * @param {React.TouchEvent} e
   */
  const handleTouchEnd = useCallback(
    (e) => {
      const touch = e.changedTouches[0];
      const deltaX = touch.clientX - touchStartX.current;
      const deltaY = touch.clientY - touchStartY.current;
      const absDeltaX = Math.abs(deltaX);
      const absDeltaY = Math.abs(deltaY);

      /* --- Swipe detection --------------------------------------- */
      if (absDeltaX >= SWIPE_MIN_DISTANCE_PX && absDeltaX > absDeltaY) {
        if (deltaX > 0) {
          sendCommand('/api/next', 'right');
        } else {
          sendCommand('/api/prev', 'left');
        }
        return;
      }

      /* --- Tap detection ----------------------------------------- */
      if (absDeltaX < TAP_MAX_DISTANCE_PX && absDeltaY < TAP_MAX_DISTANCE_PX) {
        const screenMidpoint = window.innerWidth / 2;
        if (touch.clientX < screenMidpoint) {
          sendCommand('/api/prev', 'left');
        } else {
          sendCommand('/api/next', 'right');
        }
      }
    },
    [sendCommand],
  );

  /* --- Formatting helpers ---------------------------------------- */

  /**
   * Zero-pad a number to two digits, or return '--' for null values.
   *
   * @param {number|null} n
   * @returns {string}
   */
  function pad(n) {
    if (n === null || n === undefined) return '--';
    return String(n).padStart(2, '0');
  }

  /* --- Render ----------------------------------------------------- */

  return (
    <div style={rootStyle}>
      {/* Header */}
      <div style={headerStyle}>
        <span style={counterStyle}>
          {pad(slide)} / {pad(total)}
        </span>
        <div style={dotStyle(connected)} />
      </div>

      {/* Touch zone */}
      <div
        style={touchZoneStyle}
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
      >
        {/* Left half — previous */}
        <div style={halfStyle('left')}>
          <span style={arrowHintStyle}>&#x2039;</span>
          <div style={flashOverlayStyle(flash === 'left')} />
        </div>

        {/* Right half — next */}
        <div style={halfStyle('right')}>
          <span style={arrowHintStyle}>&#x203A;</span>
          <div style={flashOverlayStyle(flash === 'right')} />
        </div>
      </div>
    </div>
  );
}
