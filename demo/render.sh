#!/usr/bin/env bash
# Build the renderer image (cached) and render the demo to ./out/demo.mp4
# and ./out/still-*.png for CWS screenshots. Then build the README GIF.
#
# Usage:
#   ./render.sh                  — full pipeline: render everything, then publish
#   ./render.sh video            — full video to out/demo.mp4
#   ./render.sh stills           — one captioned PNG per scene to out/still-*.png (overlay on)
#   ./render.sh still <frame>    — single PNG (overlay off) to out/still-<frame>.png
#   ./render.sh tiles            — CWS promo tiles to out/promo-{small,marquee}.png
#   ./render.sh thumbnail        — 1280×720 YouTube thumbnail to out/youtube-thumbnail.png
#   ./render.sh youtube          — 1920×1080 pillarboxed master from out/demo.mp4
#   ./render.sh gif [width]      — convert out/demo.mp4 → ../docs/demo.gif
#                                  (default 960px wide, palette-optimised)
#   ./render.sh publish          — copy out/* into their committed homes
#
# Committed homes (publish copies out/ → these; `gif` writes docs/demo.gif itself):
#   docs/demo.gif                README hero
#   docs/store/screenshot-1..5.png       CWS store listing — 5 scene stills (1280×800)
#   docs/store/{marquee,promo-tile}.png  CWS promo tiles (1400×560, 440×280)
#   docs/youtube-master.mp4      YouTube upload master (1080p) — NOT deployed to Pages
#   docs/youtube-thumbnail.png   YouTube thumbnail (1280×720)
#   marketing/demo.mp4           landing-page <video> loop (1280×800)
#   marketing/demo-poster.png    landing-page <video> poster (opening frame)

set -euo pipefail

IMAGE=catm-demo-renderer
FFMPEG_IMAGE=linuxserver/ffmpeg
cd "$(dirname "$0")"
mkdir -p out

build_image() {
  docker build -t "$IMAGE" .
}

run_remotion() {
  # Bind-mount the repo root so the demo can resolve `@app/*` → ../src.
  # The container's /work/demo/node_modules wins via an anonymous volume.
  docker run --rm \
    -v "$(cd .. && pwd)":/work \
    -v /work/demo/node_modules \
    -w /work/demo \
    "$IMAGE" \
    "$@"
}

# Captioned stills, one per scene at its zoom/copy apex (overlay ON so the
# marketing line is burned in). Frames must be kept in sync with the SCENES
# timing in src/theme.ts and each scene's zoom keyframes.
render_stills() {
  build_image
  for pair in "70:onboarding" "288:sidepanel" "600:voices" "870:fulltab" "1140:privacy"; do
    frame="${pair%%:*}"
    name="${pair##*:}"
    echo "── still: $name (frame $frame) ──"
    run_remotion npx remotion still Demo \
      --frame="$frame" \
      --props='{"overlay":true}' \
      "out/still-${name}.png"
  done
}

render_tiles() {
  build_image
  echo "── tile: promo-small (440×280) ──"
  run_remotion npx remotion still PromoSmall --frame=0 out/promo-small.png
  echo "── tile: promo-marquee (1400×560) ──"
  run_remotion npx remotion still PromoMarquee --frame=0 out/promo-marquee.png
}

render_thumbnail() {
  build_image
  echo "── thumbnail: youtube-thumbnail (1280×720) ──"
  run_remotion npx remotion still YouTubeThumbnail --frame=0 out/youtube-thumbnail.png
}

# Pad the 1280×800 (8:5) render into a 1920×1080 (16:9) frame so the YouTube
# upload reads as designed instead of relying on YouTube's auto-pillarbox.
# Bars are filled with the brand background (--bg-0) rather than black.
render_youtube() {
  test -f out/demo.mp4 || { echo "out/demo.mp4 missing — run ./render.sh video first"; exit 1; }
  repo_root="$(cd .. && pwd)"
  echo "── youtube: 1920×1080 pillarbox master ──"
  docker run --rm -v "$repo_root":/work -w /work "$FFMPEG_IMAGE" \
    -i demo/out/demo.mp4 \
    -vf "scale=-2:1080,pad=1920:1080:(ow-iw)/2:(oh-ih)/2:color=0xFAFBFC" \
    -c:v libx264 -pix_fmt yuv420p -crf 20 -preset medium -movflags +faststart -an \
    -y demo/out/youtube-master.mp4
}

# Copy rendered artefacts from out/ (gitignored) into their committed homes.
# Keeps the README, CWS listing, marketing site, and YouTube bundle in sync
# from a single render so nothing goes stale by hand.
publish() {
  local docs="../docs" mkt="../marketing"
  mkdir -p "$docs/store"
  # scene stills → numbered CWS screenshots (order = demo scene order)
  local i=1
  for n in onboarding sidepanel voices fulltab privacy; do
    cp "out/still-${n}.png" "$docs/store/screenshot-${i}.png"
    i=$((i + 1))
  done
  cp out/promo-small.png "$docs/store/promo-tile.png"
  cp out/promo-marquee.png "$docs/store/marquee.png"
  cp out/demo.mp4 "$mkt/demo.mp4"
  cp out/still-onboarding.png "$mkt/demo-poster.png"
  cp out/youtube-master.mp4 "$docs/youtube-master.mp4"
  cp out/youtube-thumbnail.png "$docs/youtube-thumbnail.png"
  echo "Published: docs/store/{screenshot-1..5,marquee,promo-tile}.png, docs/{youtube-master.mp4,youtube-thumbnail.png}, marketing/{demo.mp4,demo-poster.png}"
}

case "${1:-all}" in
  video)
    build_image
    run_remotion npx remotion render Demo out/demo.mp4
    ;;
  still)
    build_image
    frame="${2:-330}"
    run_remotion npx remotion still Demo \
      --frame="$frame" \
      --props='{"overlay":false}' \
      "out/still-${frame}.png"
    ;;
  stills)
    render_stills
    ;;
  tiles)
    render_tiles
    ;;
  thumbnail)
    render_thumbnail
    ;;
  youtube)
    render_youtube
    ;;
  publish)
    publish
    ;;
  gif)
    width="${2:-960}"
    test -f out/demo.mp4 || { echo "out/demo.mp4 missing — run ./render.sh video first"; exit 1; }
    mkdir -p ../docs
    repo_root="$(cd .. && pwd)"
    # Two-pass palette: pass 1 distills 256 best-fitting colours for this
    # video's content, pass 2 maps frames onto them. Roughly half the file
    # size of default 256-colour quantisation at the same perceived quality.
    docker run --rm -v "$repo_root":/work -w /work "$FFMPEG_IMAGE" \
      -i demo/out/demo.mp4 \
      -vf "fps=15,scale=${width}:-1:flags=lanczos,palettegen=stats_mode=diff" \
      -y demo/out/palette.png
    docker run --rm -v "$repo_root":/work -w /work "$FFMPEG_IMAGE" \
      -i demo/out/demo.mp4 -i demo/out/palette.png \
      -filter_complex "fps=15,scale=${width}:-1:flags=lanczos[x];[x][1:v]paletteuse=dither=bayer:bayer_scale=5:diff_mode=rectangle" \
      -loop 0 -y docs/demo.gif
    rm out/palette.png
    echo
    echo "Wrote: $(realpath ../docs/demo.gif)"
    ls -lh ../docs/demo.gif
    ;;
  all)
    build_image
    run_remotion npx remotion render Demo out/demo.mp4
    render_stills
    render_tiles
    render_thumbnail
    render_youtube
    "$0" gif
    publish
    ;;
  *)
    echo "Unknown command: $1" >&2
    sed -n '5,15p' "$0" >&2
    exit 2
    ;;
esac

echo
echo "Done. Output in: $(pwd)/out"
ls -lh out
