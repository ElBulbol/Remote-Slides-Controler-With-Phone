# Slide Controller

Control **LibreOffice Impress** slides from your phone over a local network. Node.js + Express backend, React + Vite frontend.

## Run

```bash
./start.sh
```

Then scan the QR code from your phone.

## How It Works

- The Express server sends `xdotool` keystrokes (`Right` / `Left`) to control LibreOffice Impress.
- It checks connectivity to the LibreOffice UNO bridge on TCP port 2002 to report connection status.
- The React frontend is a full-screen touch interface: tap or swipe left/right to navigate slides.
- On startup the server prints a QR code so you can quickly open the controller on your phone.

---

## Architecture

```
Phone (browser)  ──HTTP──▶  Express :3001  ──xdotool──▶  LibreOffice Impress
                              │
                              └── TCP :2002 ──▶  UNO bridge (status check)
```
