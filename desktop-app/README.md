# ANFAC Media System Desktop

This folder contains the Electron desktop app, its web UI, and Windows icon.

## Run locally

```powershell
npm ci
npm start
```

## Build the Windows installer

```powershell
npm ci
npm run build:win
```

The client portal and messages currently use this app installation's local
storage. Cross-device messaging requires a deployed shared chat API and is not
enabled by this desktop package.
