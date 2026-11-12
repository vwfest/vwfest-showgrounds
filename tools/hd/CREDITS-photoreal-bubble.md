# Credits — photoreal Bubble test car (step 1, redo)

All tools and textures used for this test are free. Nothing was purchased. No
free-tier AI 3D generators (and no NonCommercial licenses) were used.

The Bubble body, interior, glass, lamps, bumpers, wheels, plate and emblem are
**100% original geometry**, authored in `tools/hd/bubble_build.py` as a scripted
subdivision cage plus primitives. No third-party car mesh (CC0 or otherwise)
was imported or referenced. There are no mesh credits.

## Tools

- **Blender 4.5.16 LTS** (GPL-2.0-or-later) — original body modeling (bpy) and
  offline Cycles CPU renders with OpenImageDenoise.
  https://www.blender.org/download/lts/4-5/
- **Three.js** r170 (MIT) — in-game real-time PBR (`MeshPhysicalMaterial`).
  Already a project dependency.
- **Playwright** / Chromium (Apache-2.0 / BSD) — in-game screenshots.

## Textures / lighting

- **kloppenheim_06_puresky_1k.hdr** — CC0, Poly Haven.
  Author: Greg Zaal (sky edits: Jarod Guest).
  https://polyhaven.com/a/kloppenheim_06_puresky
  Used for in-game IBL (existing). NFT stills use a built-in dark studio
  (area softboxes + glossy floor), not this HDRI.
- **belfast_sunset_puresky_1k.hdr** — CC0, Poly Haven.
  Authors: Greg Zaal, Dimitrios Savva (photography), Jarod Guest (sky edits).
  https://polyhaven.com/a/belfast_sunset_puresky
  Already in the game for sunset IBL; not required for the stills.
- **asphalt_02** and **grass_path_2** 1k PBR sets — CC0, Poly Haven, by Rob Tuytel.
  https://polyhaven.com/a/asphalt_02
  https://polyhaven.com/a/grass_path_2
  Already in the game; they appear under the car in in-game screenshots when
  the High tier loads terrain textures.

CC0 requires no attribution; credit is given as thanks. No other third-party
meshes, logos, or paint kits were used.

## Brand marks

The plate and hood badge read **VWFEST** (the project's own brand). There is no
manufacturer logo and no exact Volkswagen model name on the test car, the
renders, or the rarity badges. The display name used here is **Bubble**.

## Fonts (plate letters and rarity badge only)

- **DejaVu Sans Bold** / **DejaVu Serif Bold** — used only to extrude the
  VWFEST plate letters and to rasterize the gold rarity badge. Bitstream Vera
  license / public-domain changes.
  https://dejavu-fonts.github.io/
