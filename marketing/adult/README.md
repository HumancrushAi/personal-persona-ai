# Adult network ad set

Creative for PornHub/TrafficJunky, xHamster, ExoClick and similar. **Do not post
any of this to Facebook, Instagram or TikTok** — use `../` for those, which is a
deliberately separate, fully clothed set. Mixing them is how an ad account gets
banned.

## Banners

Three concepts × five ad units, in `*.jpg`:

| Unit | Where it runs |
| --- | --- |
| `315x300` | PornHub mobile — highest volume unit on the network |
| `300x250` | MPU, universal across every adult network |
| `900x250` | Desktop wide / above-player |
| `728x90` | Leaderboard |
| `300x100` | Mobile strip |

Concepts:

- **sends-anything** — "She'll send you anything."
- **your-rules** — "Your AI girl. Your rules."
- **texts-back** — "She always texts back."

Portrait and square units put the copy over a bottom scrim; the wide units put
her on the right with the copy on a dark panel, because a 90px-tall banner has
nowhere to put a scrim. Headline sizes are measured against the space actually
left over next to the button, not guessed — the first pass ran the headline
straight underneath the CTA on every wide unit.

## Reels

`reels/*-reel-8s.mp4` — 8 seconds, 1080×1920, H.264 + AAC.

Her photo animated into real motion, her line spoken aloud, a caption for the
first 5.4 seconds then a CTA end card. Built to work muted. The voice is not
lip-synced — she animates as if speaking and the audio runs over it.

## Why it is lingerie and not explicit

Every one of these networks holds the *ad unit* to a stricter standard than the
content around it: exposed genitals are rejected outright and most reject bare
nipples in banner creative. Lingerie is what actually passes review, and it
crops far better at 300×100 where there is room for a face and little else.

## Rebuilding

```bash
# photos + all fifteen banners (photos are reused unless --force)
npx vite-node scripts/generate-adult-banners.ts

# the videos — note the --set flag, it selects the adult copy AND this folder
npx vite-node scripts/generate-social-reels.ts -- --set=adult
```

Copy lives at the top of each script. `source/` holds the raw photography and is
shared by both. `reels/work/` holds video intermediates and is gitignored —
re-rendering motion costs another RunPod job.
