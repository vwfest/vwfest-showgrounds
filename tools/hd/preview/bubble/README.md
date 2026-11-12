# Bubble photoreal test (step 1)

Offline NFT stills and in-game shots of the model-0 test car, displayed as
**Bubble**. Not merged, not deployed.

- `renders/common.png`, `rare.png`, `epic.png` — Blender 4.5 Cycles, 1024×1024, 64 samples + OIDN, rarity tag.
- `ingame/` — High (1440×900) and phone (844×390, Low tier) real-time shots.

Reproduce:

```
PREVIEW is not required; `node build.cjs` already bundles src/preview-bubble.js
python3 tools/hd/…  (see tools/hd/render_bubble_nft.py and shot-bubble.cjs)
```

Asset licenses: `tools/hd/CREDITS-photoreal-bubble.md`.
