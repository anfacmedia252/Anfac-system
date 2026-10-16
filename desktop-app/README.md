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

## Client project progress

As an administrator, open **Projects & Events**, create a project or edit an
existing one, and set the **Client Name** to exactly match the client's profile.
Update the status, client-visible progress percentage, and progress note, then
save. The client sees the matching project and updates under **My Projects &
Messages**. The progress slider and percentage field stay synchronized.

The client portal also includes an animated ANFAC Media service-poster slider.
The portal and chat use this app installation's local storage; cross-device
updates and messaging require a deployed shared backend.
