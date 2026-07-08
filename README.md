# Audio Blocks — Obsidian Plugin

An Obsidian plugin that renders **interactive audio blocks** directly in Markdown notes. Tap drum pads, play a piano keyboard, step-sequence patterns, or view a full piano-roll — all inside your vault.

Audio is processed entirely in the browser via [Elementary Audio](https://www.elementary.audio/) (`@elemaudio/core` + `@elemaudio/web-renderer`) running in an `AudioWorklet`, so there is no server and no latency from the main thread.

> **Desktop only** — requires Electron (Obsidian desktop app). Mobile is not supported because the `AudioWorklet` and Node.js `fs` APIs used for soundbank loading are not available on mobile.

---

## Features

| Feature | Description |
|---|---|
| **Drum pads** | 16-pad grid wired to built-in synthesized samples or external soundbanks |
| **Piano keys** | Scrollable keyboard with polyphonic note-on/off and sustain |
| **Piano roll** | Read-only or editable note display with transport playback |
| **Step sequencer** | Pattern-based drum/melodic sequencer (`music pattern`) |
| **Transport** | Standalone play/pause/BPM control block |
| **Soundbanks** | Lazy-load WAV sample libraries from disk, with pitch-shifted playback |
| **Exclusive focus** | Only one block captures keyboard input at a time |
| **Zero-config audio** | Built-in synthesized drum kit and piano — works with no soundbanks installed |

---

## Music Markdown Spec

All interactive blocks are written as fenced code blocks with the language tag `music <variant>`.

### `music drums` — Drum Pad Grid

```music drums
pads: 16
kit: synth
highlight: 0,4,8,12
```

| Key | Default | Description |
|---|---|---|
| `pads` | `16` | Number of pads (1–16) |
| `kit` | `synth` | Soundbank slug or `synth` for built-in kit |
| `highlight` | — | Comma-separated pad indices to highlight |

### `music keys` — Piano Keyboard

```music keys
octaves: 2
sound: synth
highlight: C4,E4,G4
color: "#00FF9E"
```

| Key | Default | Description |
|---|---|---|
| `octaves` | `2` | Number of octaves to display |
| `sound` | `synth` | Soundbank slug or `synth` for built-in piano |
| `highlight` | — | Comma-separated note names to highlight (e.g. `C4,E4,G4`) |
| `color` | `#00FF9E` | Highlight colour (CSS colour string) |

### `music sequence` — Piano Roll (melodic clip)

Notes are written in the block body using the format `noteNumber velocity position duration` (space-separated, one note per line). YAML config goes before a blank line.

````
```music sequence
tempo: 120
bars: 2
metronome: true

60 80 0.0 1.0
64 80 1.0 1.0
67 80 2.0 1.0
```
````

| Key | Default | Description |
|---|---|---|
| `tempo` | `120` | BPM |
| `bars` | auto | Clip length in bars (inferred from note positions if omitted) |
| `metronome` | `false` | Show/play metronome click |
| `name` | `Sequence` | Display title |
| `editable` | `false` | Allow note editing (future) |

### `music pattern` — Step Sequencer

Rows are written as `Label: 1 0 1 0 ...` (1 = step on, 0 = step off).

````
```music pattern
tempo: 128

Kick:    1 0 0 0 1 0 0 0 1 0 0 0 1 0 0 0
Snare:   0 0 0 0 1 0 0 0 0 0 0 0 1 0 0 0
Hi-Hat:  1 1 1 1 1 1 1 1 1 1 1 1 1 1 1 1
```
````

| Key | Default | Description |
|---|---|---|
| `tempo` | `120` | BPM |
| `editable` | `false` | Allow step editing (future) |

### `music transport` — Transport Controls

```music transport
tempo: 120
time: 4/4
loop: true
```

| Key | Default | Description |
|---|---|---|
| `tempo` | `120` | BPM |
| `time` | `4/4` | Time signature (display only) |
| `loop` | `true` | Enable loop mode |

---

## Architecture

```
src/
├── main.ts                    # Plugin entry point — registers processors, settings, commands
│
├── audio/
│   ├── engine.ts              # AudioEngine — central DSP state machine
│   ├── elementary-renderer.ts # Thin wrapper around @elemaudio/web-renderer (AudioWorklet)
│   ├── focus-manager.ts       # Exclusive keyboard focus across interactive blocks
│   ├── sampler.ts             # (legacy) AudioBuffer-based one-shot sampler
│   ├── soundbank-manager.ts   # Discovers, loads, and VFS-mounts WAV soundbanks
│   └── synth-samples.ts       # Pure-math drum/piano sample generators (no AudioContext)
│
├── components/                # React UI components (thin wrappers over elementary-audio-kit/ui)
│   ├── DrumPads.tsx
│   ├── PianoKeys.tsx
│   ├── PianoRoll.tsx
│   ├── MusicPatternPlayer.tsx
│   ├── Transport.tsx
│   ├── AudioPlayer.tsx
│   ├── Callout.tsx
│   └── Question.tsx
│
├── renderers/                 # Obsidian code-block processors (one per block type)
│   ├── music.ts               # Unified `music <variant>` dispatcher (primary entry point)
│   ├── drum-pads.ts
│   ├── piano-keys.ts
│   ├── piano-roll.ts
│   ├── transport.ts
│   ├── audio-player.ts
│   ├── callout.ts
│   └── question.ts
│
└── playground/
    ├── reader.ts              # Reads .mcplayground ZIP archives → PlaygroundData
    └── writer.ts              # (future) writes .mcplayground files
```

### AudioEngine

`engine.ts` is the single source of truth for DSP state. It owns:

- **Built-in drum kit** — 16 synthesized pads loaded into Elementary's Virtual File System (VFS) at startup, keyed `kit/0` … `kit/15`.
- **Soundbank one-shot pads** — per-slug maps of `{ gate, rate }` enabling pitch-shifted one-shot playback.
- **Polyphonic melodic voices** — an 8-voice `VoiceAllocator` driving `el.sample` + `el.adsr` envelopes to avoid clicks.
- **Transport-driven playback** — `createTransport` from `elementary-audio-kit` produces an audio-thread clock; `sequencedDrumSampler` / `sequencedMelodicSampler` schedule notes with sample accuracy (no JS timer jitter).
- **Click track** — a synthesized metronome click loaded as `synth/click`.

Every state change calls `renderGraph()`, which rebuilds the full Elementary node graph and calls `renderer.render(left, right)`. Elementary's internal diff engine only recomputes changed nodes.

### ElementaryRenderer

A thin wrapper around `@elemaudio/web-renderer` v4:

1. Creates a `WebRenderer` instance.
2. Calls `renderer.initialize(audioCtx)` to spin up the `AudioWorklet` node.
3. Connects the node to `audioCtx.destination`.
4. Exposes `render(left, right)`, `loadSamplesToVFS(samples)`, and `dispose()`.

### SoundbankManager

Soundbanks are directories containing a `config.json` and WAV files:

```
Default SoundBanks/
└── my-drums/
    ├── config.json      # { instrumentSlug, name, defaultOctave, samples: [...] }
    ├── BD.wav
    ├── SD.wav
    └── CH.wav
```

`config.json` sample entry:
```json
{
  "midiNumber": 36,
  "minRange": 35,
  "maxRange": 36,
  "fileName": "BD",
  "urls": { "wav": "BD" }
}
```

Loading flow:
1. `discoverSoundbanks()` — scans the root directory, reads every `config.json`, registers slug → config.
2. `loadSoundbank(slug, audioCtx)` — decodes WAV files to `AudioBuffer` (cached).
3. `loadSoundbankToVFS(slug, renderer)` — copies channel-0 data to `Float32Array` and mounts into Elementary's VFS as `{slug}/{midiNumber}`.

Pitch-shifted playback uses `findNearestSample()` (direct hit → range → nearest by distance) to pick the best root note, then computes `rate = 2^(semitones/12)`.

### FocusManager

Maintains a single `activeRelease` callback. When a block calls `requestFocus(releaseFn)`, any previously focused block's `releaseFn` is invoked first. Clicking outside all `.ea-block-container` elements triggers `releaseFocus()`.

### PlaygroundReader

Reads `.mcplayground` ZIP archives (produced by the Midicircuit app) using `jszip` and Node.js `fs`. Extracts `bundle/song.json` and maps it to a typed `PlaygroundData` structure with tracks, clips, and MIDI note data.

---

## Installation (Development)

### Prerequisites

- Node.js ≥ 18
- An Obsidian vault for testing

### Setup

```bash
git clone https://github.com/yonkolevel/obsidian-audio-blocks
cd obsidian-audio-blocks
npm install
```

### Development build (watch mode)

```bash
npm run dev
```

Bundles to `main.js` with inline sourcemaps and rebuilds on file change.

### Production build

```bash
npm run build
```

Bundles to `main.js` with tree-shaking and no sourcemaps.

### Install in Obsidian

1. Copy `main.js`, `manifest.json`, and `styles.css` to:
   ```
   <vault>/.obsidian/plugins/audio-blocks/
   ```
2. In Obsidian: **Settings → Community Plugins → Reload plugins → enable Audio Blocks**.

---

## Settings

| Setting | Description |
|---|---|
| **Soundbanks path** | Absolute path to the folder containing soundbank subdirectories. Each subdirectory must have a `config.json` and `.wav` files. |

Default: `/Users/ricardoabreu/Development/midicircuit-macos/Sounds/Default SoundBanks` — change this after install.

---

## Commands

| Command | Description |
|---|---|
| **Export Circuit** | Reads frontmatter (`id`, `title`) and counts chapter headings (`# Learn:`, `# Practice:`, `# Challenge:`). Shows a summary via Obsidian Notice. |
| **Validate Lesson** | Checks frontmatter (`id`, `type: lesson`) and confirms at least one chapter heading exists. |

---

## Lesson Frontmatter

Lesson files should have the following frontmatter:

```markdown
---
id: my-lesson-01
type: lesson
title: My First Lesson
---

# Learn: Introduction

...

# Practice: Try It

...

# Challenge: Level Up

...
```

---

## Dependencies

| Package | Purpose |
|---|---|
| `@elemaudio/core` | Elementary Audio DSP graph builder |
| `@elemaudio/web-renderer` | AudioWorklet host for Elementary graphs |
| `elementary-audio-kit` | Higher-level instruments, mixers, transports, and UI components built on Elementary |
| `react` / `react-dom` | UI component rendering |
| `lucide-react` | Icon set |
| `js-yaml` | YAML parsing (block config) |
| `jszip` | `.mcplayground` ZIP archive reading |

---

## Built-in Synthesized Samples

No external samples are required. At startup `synth-samples.ts` generates all sounds mathematically:

| VFS Key | Sound |
|---|---|
| `kit/0` | Kick (pitch 1×) |
| `kit/1` | Kick (pitch 1.05×) |
| `kit/2` | Snare (tone mix 0.3) |
| `kit/3` | Snare (tone mix 0.5) |
| `kit/4` | Closed hi-hat |
| `kit/5` | Open hi-hat |
| `kit/6` | Rim shot |
| `kit/7` | Clap |
| `kit/8`–`kit/15` | Additional variations |
| `synth/piano` | One-shot piano tone (root: MIDI 60, C4) |
| `synth/click` | Metronome click |

---

## Exclusive Playback

Piano roll blocks (`music sequence`) register with a shared `requestExclusivePlayback` callback so that starting one sequence automatically stops any other that is playing. Drum pads and piano keys use `FocusManager` to ensure only one block receives keyboard input at a time.
