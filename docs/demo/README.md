# Demo video

[`faultline-demo-video.mp4`](faultline-demo-video.mp4): Break, Understand, Fix, Prove. 2 min 35 s, 1440×900, H.264, captions and voiceover, 11.7 MB. The WebM it is encoded from sits beside it ([`faultline-demo-video.webm`](faultline-demo-video.webm), 25.1 MB).

Recorded on 2026-10-25 at 05:33 IST from the running FAULTLINE web app on `:3000` and its stored records; `pnpm demo:preflight` passed 10 of 10 before recording. Every product scene is a real page. Nothing is scanned, approved or merged on camera. The two title cards are [`card.html`](card.html).

| Time | Beat | What is on screen | Source of truth |
|---|---|---|---|
| 0:00 | Title | "Break it. Understand it. Fix it. Prove it." | `card.html` |
| 0:08 | BREAK | Blast Radius of the Northwind Supply analysis: 5 of 8 experiments break the "Buy a backpack" journey; `GET /api/inventory` tile, then its finding sheet with affected steps | `/scans/780cac26-dc0d-46be-84cf-0032f04646f6/blast-radius` (runbook tab B) |
| 0:32 | BREAK | Blast Radius of the Daluxe Official scan-only analysis: visitors' browsers call `http://localhost:8081` | `/scans/83758bb7-4a37-41cf-afdd-b2b73c3f020c/blast-radius` (tab C) |
| 0:44 | UNDERSTAND | Inventory experiment: BROKEN, reproduced; Reality Split seam dragged across the normal and fault screenshots; causal timeline; generated Playwright test source | `/scans/780cac26-…/experiments/5f64dd02-32d0-485e-8e94-5ffcbac309b2` (tab D) |
| 1:18 | FIX | Repair record: approval row (`phase3-demo`, 2026-10-25 00:59:36 IST), Devin session `60a680e3`, PR #1 on the reference shop | `/repairs/268eeabb-af9e-4b86-828b-fbcf065f2a88` (tab E) |
| 1:37 | PROVE | Verification on Devin's exact commit: original fails 2 of 2, Devin's commit passes 2 of 2, VERIFIED FIXED; before and after screenshots; the agent-stated limitation; cross-check on journey v2: STILL FAILING | same repair page (tab E) |
| 2:25 | Close | "AI can write the fix. FAULTLINE proves whether it works." | `card.html` |

## Shown from stored records

- The Devin session and GitHub pull request appear through FAULTLINE's repair page, not their own sites: `Invinciblx777/faultline-reference-shop` is private until release and the Devin session page needs a sign-in. The caption says "repo private until release".
- The approval dialog is not shown. This repair was approved in the UI on 2026-10-25 at 00:59:36 IST; the video shows the stored "Approved by" row.
- Scans, verifications and the cross-check are the stored runs from that night. The video re-renders them; it does not re-run them.

## Re-recording

```bash
node scripts/record-demo.mjs
```

Needs the web app on `:3000` and the database the runbook points at. It reads tabs B to E from [DEMO_RUNBOOK.md](../../DEMO_RUNBOOK.md), signs in off camera as the local `visual-snapshots` operator (random password per run) and writes `faultline-demo-video.webm`. Encode the MP4 with ffmpeg:

```bash
ffmpeg -i faultline-demo-video.webm -c:v libx264 -crf 23 -pix_fmt yuv420p -movflags +faststart faultline-demo-video.mp4
```

or, where only GStreamer is installed (as for this recording):

```bash
gst-launch-1.0 -q filesrc location=faultline-demo-video.webm ! matroskademux ! decodebin ! videoconvert ! video/x-raw,format=I420 ! openh264enc bitrate=1200000 complexity=high ! h264parse ! mp4mux faststart=true ! filesink location=faultline-demo-video.mp4
```

## Voice track

The narration reads each caption and card line, timed to when that caption appears on screen. It is synthesized locally with [Piper](https://github.com/rhasspy/piper) 1.8.0 and the `en_US-ryan-high` voice (rhasspy/piper-voices v1.0.0); no external service is called. [`narration.json`](narration.json) holds each line as `[start s, slot end s, text]`; each clip starts 0.15 s after its start and ends before its slot ends. The clips are mixed into one mono track at 85% gain, encoded as AAC 96 kb/s at 48 kHz, and muxed beside the unchanged H.264 stream:

```bash
gst-launch-1.0 -q mp4mux name=m faststart=true ! filesink location=faultline-demo-video.mp4 \
  filesrc location=silent.mp4 ! qtdemux ! h264parse ! queue ! m.video_0 \
  filesrc location=mix.wav ! wavparse ! audioconvert ! audioresample ! audio/x-raw,rate=48000,channels=1 ! fdkaacenc bitrate=96000 ! aacparse ! queue ! m.audio_0
```

The WebM stays silent; it is the source for both.

The earlier walkthrough, [`faultline-walkthrough.webm`](faultline-walkthrough.webm) (2 min 39 s, 1366×768), stays as a backup.
