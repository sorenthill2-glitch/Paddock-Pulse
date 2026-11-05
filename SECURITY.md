# Security

## What Paddock Pulse handles
- **Your F1 login** (the `login-session` token). It is saved as plain text in `f1-token.txt` in your user data folder
  (`%APPDATA%\paddock-pulse\` for the installed app, the project folder when run from source). The folder is private to your
  Windows user. The token is only ever sent to F1's own servers (`livetiming.formula1.com`, `f1tv.formula1.com`); it is never
  sent to the page, written to logs, or served over HTTP.
- **A local web server** on `127.0.0.1` (port 8765 in the desktop app, 8080 for `node server.js`). It is not reachable from other
  computers. It refuses requests whose `Host` is not `127.0.0.1`/`localhost`, refuses cross-site requests to its control
  endpoints (`/replay/*`, `/f1token`, `/f1audio/*`), and serves only an allow-list of files (the page, the layout script, the logo and the bundled fonts).
- **No telemetry.** The app does not phone home. Fonts are bundled, so there are no third-party requests besides F1's own
  servers (and OpenF1 only if you configure it).

## Reporting a problem
Please report security issues privately rather than in a public issue: on the repository's **Security** tab, choose
**Report a vulnerability**. Include what you did and what you saw; never paste your real F1 token.

## If you shared your token by accident
Sign out of F1 TV in your browser and sign in again: that issues a new login and invalidates the old one.
