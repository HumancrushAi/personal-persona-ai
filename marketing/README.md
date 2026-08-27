# Off-platform promo set

Creative for mainstream networks — Facebook, Instagram, TikTok — where the site's
own art direction cannot go. **Everything here is deliberately tame:** fully
clothed models, no lingerie, no suggestive posing, no explicit copy. Meta rejects
sexualised creative on sight, and repeated rejections put the whole ad account at
risk, so the hook has to come from the line and the warmth of the shot.

Nothing in this folder ships with the app. It exists to be downloaded and posted.

## Banners

| File | Size | Where it goes |
| --- | --- | --- |
| `*-reel-1080x1920.jpg` | 1080×1920 | Reels / Stories covers, TikTok |
| `*-square-1080x1080.jpg` | 1080×1080 | Feed posts |
| `*-feed-1200x630.jpg` | 1200×630 | Link previews, page banners |

Three concepts, each in all three sizes:

- **build-her** — "Make your own AI companion"
- **texts-first** — "She texts you first."
- **your-rules** — "Your companion. Your rules."

The vertical layouts keep every word between the top 250px and bottom 420px,
which is roughly what the Reels and Stories chrome covers.

## Reels videos

`reels/*-reel-8s.mp4` — 8 seconds, 1080×1920, H.264 + AAC, ~1.5MB each.

Each one is her photo animated into real motion, her line spoken aloud, a
caption for the first 5.4 seconds and a CTA end card after it. They are built to
work muted, which is how most of the feed watches them.

**The voice is not lip-synced.** She animates as if speaking and the audio runs
over the top. Close enough at 8 seconds on a phone, but it is not a talking head.
Real lip-sync needs a dedicated model (fal.ai `sync-lipsync`, HeyGen, D-ID) —
none is wired up in this repo.

## Rebuilding

```bash
# photos + all nine banners  (Replicate FLUX; photos are reused unless --force)
npx vite-node scripts/generate-social-banners.ts

# the three videos  (RunPod i2v + OpenAI TTS + ffmpeg; ~7 min each)
npx vite-node scripts/generate-social-reels.ts -- --only=build-her
```

Copy lives at the top of each script — edit `CONCEPTS` / `REELS` and re-run. Text
is auto-fitted to the frame, so a longer headline shrinks instead of running off
the edge.

`source/` holds the raw photography (9:16 and 16:9 per concept) and is reused by
both scripts. `reels/work/` holds video intermediates and is gitignored — delete
it freely, but note that re-rendering motion costs another RunPod job.
