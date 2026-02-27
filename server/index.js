/**
 * Slide Controller Server
 *
 * Express backend that controls LibreOffice Impress presentations over
 * the local network. Sends keystrokes via ydotool (Wayland-compatible)
 * and detects LibreOffice by checking running processes.
 *
 * Fully plug-and-play: on startup it automatically ensures ydotoold is
 * running, the firewall port is open, and any stale process on the
 * server port is killed.
 */

const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { execSync, exec } = require('child_process');
const rateLimit = require('express-rate-limit');
const qrcode = require('qrcode-terminal');

/* ------------------------------------------------------------------ */
/*  CONSTANTS                                                         */
/* ------------------------------------------------------------------ */

/** Port the Express server listens on */
const SERVER_PORT = 3001;

/** Host to bind — 0.0.0.0 makes the server reachable from the LAN */
const SERVER_HOST = '0.0.0.0';

/** Maximum requests per second per IP for slide-control endpoints */
const RATE_LIMIT_MAX = 10;

/** Rate-limit window in milliseconds (1 second) */
const RATE_LIMIT_WINDOW_MS = 1000;

/** Path to the built React client (production) */
const CLIENT_DIST_PATH = path.join(__dirname, '..', 'client', 'dist');

/** ydotoold socket path — must match what the daemon uses */
const YDOTOOL_SOCKET = '/run/user/' + String(process.getuid()) + '/.ydotool_socket';

/**
 * Linux kernel keycodes used by ydotool.
 * @see https://github.com/torvalds/linux/blob/master/include/uapi/linux/input-event-codes.h
 * @type {Record<string, number>}
 */
const KEYCODES = {
  Right: 106,
  Left: 105,
};

/* ------------------------------------------------------------------ */
/*  PREFLIGHT UTILITIES                                               */
/* ------------------------------------------------------------------ */

/**
 * Run a shell command silently, returning true if it succeeded.
 *
 * @param {string} cmd - Shell command to execute.
 * @returns {boolean} True if exit code was 0.
 */
function runQuiet(cmd) {
  try {
    execSync(cmd, { stdio: 'ignore', timeout: 10000 });
    return true;
  } catch {
    return false;
  }
}

/**
 * Get the trimmed stdout of a shell command, or empty string on failure.
 *
 * @param {string} cmd - Shell command to execute.
 * @returns {string} Trimmed stdout output.
 */
function runCapture(cmd) {
  try {
    return execSync(cmd, { timeout: 5000 }).toString().trim();
  } catch {
    return '';
  }
}

/**
 * Ensure ydotoold (the ydotool daemon) is running.
 * Tries systemd first, then falls back to manual start.
 *
 * @returns {boolean} True if ydotoold is confirmed running.
 */
function ensureYdotoold() {
  if (runCapture('pgrep -x ydotoold')) {
    console.log('  ✔ ydotoold is running');
    return true;
  }

  console.log('  ⟳ ydotoold not running — starting it…');

  /* Try systemd first */
  if (runQuiet('sudo systemctl start ydotool.service 2>/dev/null')) {
    execSync('sleep 1', { stdio: 'ignore' });
    if (runCapture('pgrep -x ydotoold')) {
      console.log('  ✔ ydotoold started via systemd');
      return true;
    }
  }

  /* Fallback: start manually in background */
  exec('sudo ydotoold --socket-path="' + YDOTOOL_SOCKET + '" --socket-perm=0666', { stdio: 'ignore' });
  execSync('sleep 2', { stdio: 'ignore' });

  if (runCapture('pgrep -x ydotoold')) {
    console.log('  ✔ ydotoold started manually');
    return true;
  }

  console.log('  ✘ FAILED to start ydotoold — slide control will not work');
  console.log('    Run manually: sudo ydotoold &');
  return false;
}

/**
 * Ensure the nftables firewall allows incoming TCP on the server port.
 *
 * @returns {void}
 */
function ensureFirewallOpen() {
  const ruleset = runCapture('sudo nft list ruleset 2>/dev/null');
  if (!ruleset) {
    console.log('  ✔ No nftables firewall detected');
    return;
  }

  if (ruleset.includes('tcp dport ' + SERVER_PORT + ' accept')) {
    console.log('  ✔ Firewall port ' + SERVER_PORT + ' is open');
    return;
  }

  if (ruleset.includes('policy drop')) {
    console.log('  ⟳ Opening firewall port ' + SERVER_PORT + '…');
    if (runQuiet('sudo nft add rule inet filter input tcp dport ' + SERVER_PORT + ' accept')) {
      console.log('  ✔ Firewall port ' + SERVER_PORT + ' opened');
      runQuiet('sudo sh -c "nft list ruleset > /etc/nftables.conf"');
    } else {
      console.log('  ✘ Could not open firewall — phones may not connect');
    }
  } else {
    console.log('  ✔ Firewall policy is ACCEPT — no rule needed');
  }
}

/**
 * Kill any stale process occupying the server port.
 *
 * @returns {void}
 */
function freePort() {
  const pid = runCapture('fuser ' + SERVER_PORT + '/tcp 2>/dev/null');
  if (pid) {
    console.log('  ⟳ Killing stale process on port ' + SERVER_PORT + ' (PID ' + pid.trim() + ')…');
    runQuiet('fuser -k ' + SERVER_PORT + '/tcp 2>/dev/null');
    execSync('sleep 1', { stdio: 'ignore' });
    console.log('  ✔ Port freed');
  } else {
    console.log('  ✔ Port ' + SERVER_PORT + ' is available');
  }
}

/**
 * Verify ydotool can actually send a keystroke.
 *
 * @returns {boolean} True if a test keystroke succeeded.
 */
function testYdotool() {
  return runQuiet('ydotool key 0:1 0:0');
}

/**
 * Run all preflight checks and auto-fix issues before starting.
 *
 * @returns {void}
 */
function preflight() {
  console.log('');
  console.log('┌──────────────────────────────────────────────┐');
  console.log('│            PREFLIGHT CHECKS                  │');
  console.log('└──────────────────────────────────────────────┘');

  freePort();
  ensureYdotoold();

  if (testYdotool()) {
    console.log('  ✔ ydotool keystroke test passed');
  } else {
    console.log('  ✘ ydotool keystroke test FAILED');
  }

  ensureFirewallOpen();

  if (isLibreOfficeRunning()) {
    console.log('  ✔ LibreOffice is running');
  } else {
    console.log('  ⚠ LibreOffice is not running — start it and open a presentation');
  }

  if (fs.existsSync(path.join(CLIENT_DIST_PATH, 'index.html'))) {
    console.log('  ✔ Client build found');
  } else {
    console.log('  ✘ Client build not found — run: cd client && npm run build');
  }

  console.log('');
}

/* ------------------------------------------------------------------ */
/*  HELPERS                                                           */
/* ------------------------------------------------------------------ */

/**
 * Detect the first non-internal IPv4 address of this machine.
 *
 * @returns {string} The local IPv4 address, or '127.0.0.1' as fallback.
 */
function getLocalIp() {
  const interfaces = os.networkInterfaces();
  for (const name of Object.keys(interfaces)) {
    for (const iface of interfaces[name]) {
      if (iface.family === 'IPv4' && !iface.internal) {
        return iface.address;
      }
    }
  }
  return '127.0.0.1';
}

/**
 * Check if LibreOffice (soffice) is currently running.
 *
 * @returns {boolean} True if at least one soffice process exists.
 */
function isLibreOfficeRunning() {
  return !!runCapture('pgrep -f soffice 2>/dev/null');
}

/**
 * Execute a keystroke via ydotool to control LibreOffice Impress.
 *
 * @param {'Right' | 'Left'} key - The logical key name to send.
 * @throws {Error} If ydotool fails or ydotoold is not running.
 */
function sendKeystroke(key) {
  const code = KEYCODES[key];
  if (!code) {
    throw new Error('Unknown key: ' + key);
  }
  execSync('ydotool key ' + code + ':1 ' + code + ':0', { timeout: 5000 });
}

/* ------------------------------------------------------------------ */
/*  EXPRESS APP                                                       */
/* ------------------------------------------------------------------ */

const app = express();

app.use(cors());
app.use(express.json());

/** Rate limiter applied only to slide-control endpoints */
const slideLimiter = rateLimit({
  windowMs: RATE_LIMIT_WINDOW_MS,
  max: RATE_LIMIT_MAX,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests — slow down' },
});

app.use(express.static(CLIENT_DIST_PATH));

/* --- API Routes --------------------------------------------------- */

/**
 * POST /api/next — advance to the next slide.
 */
app.post('/api/next', slideLimiter, async (_req, res) => {
  try {
    sendKeystroke('Right');
    return res.json({ success: true });
  } catch (err) {
    return res.status(500).json({ error: 'ydotool failed: ' + err.message });
  }
});

/**
 * POST /api/prev — go back to the previous slide.
 */
app.post('/api/prev', slideLimiter, async (_req, res) => {
  try {
    sendKeystroke('Left');
    return res.json({ success: true });
  } catch (err) {
    return res.status(500).json({ error: 'ydotool failed: ' + err.message });
  }
});

/**
 * GET /api/status — check if LibreOffice is running (process-based).
 */
app.get('/api/status', async (_req, res) => {
  try {
    const connected = isLibreOfficeRunning();
    return res.json({ slide: null, total: null, connected });
  } catch {
    return res.json({ slide: null, total: null, connected: false });
  }
});

/**
 * Catch-all: serve the React SPA for any non-API route.
 */
app.get('*', (_req, res) => {
  const indexPath = path.join(CLIENT_DIST_PATH, 'index.html');
  res.sendFile(indexPath, (err) => {
    if (err) {
      res.status(404).send('Client build not found. Run: cd client && npm run build');
    }
  });
});

/* ------------------------------------------------------------------ */
/*  STARTUP                                                           */
/* ------------------------------------------------------------------ */

preflight();

app.listen(SERVER_PORT, SERVER_HOST, () => {
  const localIp = getLocalIp();
  const url = 'http://' + localIp + ':' + SERVER_PORT;

  console.log('┌──────────────────────────────────────────────┐');
  console.log('│        SLIDE CONTROLLER — SERVER READY       │');
  console.log('├──────────────────────────────────────────────┤');
  console.log('│  Local:   http://localhost:' + SERVER_PORT + '             │');
  console.log('│  Network: ' + url.padEnd(34) + '│');
  console.log('└──────────────────────────────────────────────┘');
  console.log('');
  console.log('Scan this QR code with your phone:');
  console.log('');
  qrcode.generate(url, { small: true });
  console.log('');
  console.log('Ready — open LibreOffice Impress, press F5, and control from your phone.');
  console.log('');
});
