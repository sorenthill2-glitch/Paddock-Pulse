# Contributing

Thanks for helping. Paddock Pulse is a small project with no build step for the app itself: plain Node.js on the server side and a
single `index.html` for the interface.

## Set up
```
npm install            # downloads the castLabs Electron fork (needed for F1 TV video: it includes Widevine)
npm start              # desktop app
node server.js         # browser version at http://localhost:8080 (no F1 TV boxes)
```
Put your own F1 login in `f1-token.txt` (see the README) to get car positions, telemetry and replays. Never commit it
(it is in `.gitignore`).

## Run the tests
```
npm test               # fast checks that need no login: layout, F1 TV matcher, feed parser
node test-server.js    # needs your F1 login: the server, replays of real sessions, abuse and memory checks (a few minutes)
node test-circuits.js 2025   # needs your login: traces every circuit of a season
npx electron test-login.js   # automatic login pickup from the F1 TV box
```
Please add or update a test with your change. `test-f1tv.js` holds real F1 TV label lists: when F1 TV changes how it names
things, add the new labels there first and make them pass.

## Building the installer
`Build installer.bat` builds the app, signs it for Widevine, then packages it with NSIS. Signing needs a free castLabs EVS
account (see https://github.com/castlabs/electron-releases/wiki/EVS), because F1 TV video will not play in an unsigned build.

## Style
- Match the surrounding code: terse, comments explain *why*. No new dependencies unless there is no alternative.
- Do not redraw or recolour the logo (see `assets/LOGO.md`).
- Anything that reads F1's feeds must cope with missing, late or malformed data: never let a bad message take the app down
  (`test-feedcore.js` fuzzes this).

## What is out of scope
Anything that gets around F1 TV's protection or its subscription (downloading, recording or restreaming video; sharing logins).
The app plays video only inside the official F1 TV player, signed in with your own account.
