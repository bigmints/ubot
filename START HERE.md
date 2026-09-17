# Start Youbot

Youbot helps you build a personal concierge for the people who message you. Give it a job, share useful information, and manage visitor conversations in one inbox.

Version 1 runs on your computer. Youbot itself is free. You choose your AI service and pay that provider for any usage, or run a local AI model. Youbot works while your computer is awake and the launcher stays open.

## On a Mac

1. Download the release folder and extract it. Keep it somewhere you can find again, such as your home folder.
2. Open **Start Youbot.command**.
3. Your browser will open a short setup guide. Choose a username and a password you will remember.
4. Wait for setup to finish. The first start downloads the tools Youbot needs, so it can take several minutes.
5. Select **Open Youbot**, sign in, and follow the guide to connect your AI.

If macOS says the file cannot be opened, confirm you downloaded the intended Youbot release. These launchers are not signed native installers. If your device policy blocks them, ask the device administrator for help. Do not turn off Gatekeeper or other security protections.

## On Windows

1. Download the release folder, right-click the ZIP, and choose **Extract All**.
2. In the extracted folder, open **Start Youbot.cmd**. Do not run it from inside the ZIP.
3. Follow the same browser setup guide: choose your login, wait for setup, then open Youbot.

Windows must be 64-bit. If your device policy blocks downloaded scripts, ask the device administrator for help. You do not need to change the computer’s execution policy or security settings. The launcher uses a process-only PowerShell setting for its own setup script.

## What you need

- An internet connection for first setup, and enough free space for dependencies and build files.
- A current 64-bit Mac or Windows computer. Node.js 22 or later is used if installed; otherwise the launcher downloads a private copy from nodejs.org and checks its download checksum.
- An AI account and API key for online AI. An ordinary chat subscription may not include API credits. Each provider has its own eligibility, regional availability and charges.
- For local AI, install Ollama and a model that supports tools first. Local AI needs more memory and may be slower.

Youbot has native dependencies. Some computers may require developer/build tools if prebuilt dependencies are unavailable. This path is not yet a substitute for signed, tested native installers.

## Open it next time

Open **Start Youbot.command** or **Start Youbot.cmd** again and select **Start Youbot**. Your login, settings and conversations are kept. Keep the launcher window open while using Youbot.

To stop, return to the setup browser tab and select **Stop Youbot**, or close the launcher window. Scheduled work pauses when Youbot is stopped or your computer sleeps. Closing only the Youbot browser tab does not stop the concierge.

## If something goes wrong

- **Setup could not finish:** check your internet connection and free disk space, then select **Try setup again**. For native dependency failures, share the relevant error with someone who can help install the required build tools.
- **Another Youbot is already running:** stop that installation first. The launcher will not stop an unrelated process to free a port.
- **No AI reply:** open **AI settings** and check your model, key and available AI credit. A saved key is not proof the provider accepted it.
- **The reply disappeared after refreshing:** reopen Chat. Youbot checks the pending request instead of sending it again.
- **Forgotten local login:** the desktop launcher's configuration is at `.youbot-desktop/config.json` inside your home folder. It contains private information. Get trusted help recovering it and never post this file publicly.

Desktop data is stored in `.youbot-desktop` inside your home folder, separate from the downloaded project. Setup diagnostics are in `setup.log` there. Keep this folder when updating or moving the project, and back it up securely. Do not share full logs or configuration without checking for private information.

## Release status

The release bundle includes the built concierge and interface. The source checkout can also build them automatically. Clean Mac and Windows installation and signed native installer packages require separate release validation. Paid managed hosting is phase two and is not part of version 1.
