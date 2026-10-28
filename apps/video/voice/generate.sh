#!/usr/bin/env bash
# Builds one MP3 per scene from voice/script.json.
# Uses edge-tts (Microsoft neural voices, no key needed) when available, else the macOS "say" voice.
# Drop a better recording with the same name into public/voice/ to replace any clip.
set -euo pipefail
cd "$(dirname "$0")/.."
cfg() { python3 -c "import json,sys;v=json.load(open('voice/script.json'));print(v$1)"; }
engine=$(cfg '["engine"]')
rate=$(cfg '["rate"]')
for name in $(python3 -c "import json;print(' '.join(json.load(open('voice/script.json'))['lines']))"); do
  text=$(cfg "['lines']['$name']")
  tmp="/tmp/sl-$name.raw"
  if [ "$engine" = "edge" ]; then
    uvx edge-tts --voice "$(cfg '["edgeVoice"]')" --rate="$rate" --text "$text" --write-media "$tmp.mp3" >/dev/null
    src="$tmp.mp3"
  else
    say -v "$(cfg '["sayVoice"]')" -r "$rate" -o "$tmp.aiff" "$text"
    src="$tmp.aiff"
  fi
  ffmpeg -v error -y -i "$src" -af "highpass=f=80,loudnorm=I=-16:TP=-1.5:LRA=11" -codec:a libmp3lame -q:a 2 "public/voice/$name.mp3"
  rm -f "$tmp.mp3" "$tmp.aiff"
  printf '%-9s %5.2fs\n' "$name" "$(ffprobe -v error -show_entries format=duration -of csv=p=0 "public/voice/$name.mp3")"
done
