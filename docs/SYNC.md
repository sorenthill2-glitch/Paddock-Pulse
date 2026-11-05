# How video and data are kept in sync, and how well

## Why it is hard
A replay has two clocks: F1's data recording (with real UTC times) and the F1 TV video (which plays from 0). F1 TV's player (a
Bitmovin player) does not tell the page the video's original clock, there are no stream timestamps to read, and the `<video>`
element's `currentTime` is not the position (it keeps counting and ignores seeks beyond the buffer). So the app:
- reads the position from the player's own time label,
- seeks by clicking the player's seek bar (which lands up to ~15 s from the target in a small box, finer in a big one),
- plays and pauses with the player's own button (the element's `play()`/`pause()` are ignored),
- links the two with one offset: *video time = offset + seconds into the recording*.

## The starting point
Every replay starts from a guess of that offset: the video time of lights-out, remembered per year and session type from
your earlier syncs, or for 2024-and-later races a typical value of ~506 s. The recording's own start varies by ~20 s between
races, so the guess is anchored at lights-out (the recording's `Started` status), not at the start of the data.

## Measured accuracy
Method: read the broadcast's lap counter at the video times the data predicts around the lap-10 and lap-25 flips
(expected laps 9, 10, 24, 25).

| | Result |
|---|---|
| 2024 and later, typical start | within ~25 s on 9 of 11 races: 2025 Mexico City, Sao Paulo, Abu Dhabi, Monaco; 2024 British, Spanish, Austrian; 2026 Australian, Mexico City |
| minutes off | 2026 Canadian (~5 laps), 2025 Australian (wet start, 7-10 laps) |
| older years | 2021 Abu Dhabi ~110 s off; 2023 Italian ~20 minutes off; so no typical value is used before 2024 |

Things that did not work, so you do not repeat them: the post-race tail of the video is not constant (so the start cannot be
derived from the video's length), and the broadcast's lap box appears at very different moments in different races (so it cannot
mark lights-out).

## Correcting it
Compare the broadcast lap counter with the **Lap** number above the map. If they differ, type the lap the broadcast shows and
press **Sync at lap** (moves data and video to the start of that lap), or press **Flip!** at the exact moment the counter flips
(exact), then nudge with **Data -30s … +30s**. Qualifying and practice have no lap counter: use **Sync at lights out** or **Sync
video**.

## F1 TV matching (which video opens)
The archive is walked like a person would: Archive, season page, race weekend, session. Race weekends are matched by the race
date (each card shows its weekend dates), so races that share a country or sponsor words are not confused. Labels differ by
era ("F1 Race", "F1 Race Replay", "2019 British GP - F1 FP1", "2021 ... F1 Sprint"); `test-f1tv.js` holds real label lists.
All 804 sessions F1 lists (2018-2026, 2022 has none) were checked: about 770 resolve to the right video; the rest are pre-season
testing days (F1 TV splits each day into two sessions), most 2018 practice (highlights only), and a few that are not on F1 TV.
