# Credits — photoreal Bubble test car (step 1)

All tools and textures used for this test are free. Nothing was purchased. No
free-tier AI 3D generators (and no NonCommercial licenses) were used. The car
body, wheels, plates and extras are original code-built geometry already in
this repository (`tools/hd/src/rides/`, baked to `docs/hd/rides/m0.bin`).

## Tools

- **Blender 4.5.16 LTS** (GPL-2.0-or-later) — offline Cycles CPU renders.
  https://www.blender.org/download/lts/4-5/
  https://download.blender.org/release/Blender4.5/blender-4.5.16-linux-x64.tar.xz
- **Three.js** r170 (MIT) — in-game real-time PBR (`MeshPhysicalMaterial`).
  Already a project dependency.
- **Playwright** / Chromium (Apache-2.0 / BSD) — in-game screenshots.
- **meshopt / existing bake toolchain** — already in the repo; this step did
  not rebake `m0.bin`.

## Textures / lighting

- **kloppenheim_06_puresky_1k.hdr** — CC0, Poly Haven.
  Author: Greg Zaal (sky edits: Jarod Guest).
  https://polyhaven.com/a/kloppenheim_06_puresky
  Used for in-game IBL (existing) and as the reflection-only world in the
  Cycles studio (camera rays see a built-in studio cyclorama, not the sky).
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

The plate reads **VWFEST** (the project's own brand). There is no
manufacturer logo and no exact Volkswagen model name on the test car, the
renders, or the rarity tags. The display name used here is **Bubble**.

## Fonts (plate textures and rarity tags only)

- **DejaVu Sans Bold** — used only to rasterize the VWFEST plate texture and
  the rarity-tag overlay. Bitstream Vera license / public-domain changes.
  https://dejavu-fonts.github.io/
