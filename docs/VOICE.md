# Voice: what we measured, and what it means

Everything below was measured on this machine (Apple M5, 16GB, macOS 26.6) against
this project's own Gemini key, in September 2026. Numbers from vendor marketing
are marked as such; everything else is reproducible with the scripts named at the
bottom.

The short version: **Gemini's batch API cannot do voice, its Live API can, and the
gap between them is 14×.** If you remember one thing from this file, remember to
measure the serving path you will actually use rather than the one that is easiest
to call.

---

## 1. The headline numbers

| Path | Time to first audio/token | Verdict |
|---|---|---|
| Gemini batch `streamGenerateContent` | **20.75s** | unusable |
| Gemini **Live**, realtime audio in | **1.43s** | usable |
| Gemini Live, text in | 0.98s | — |
| Gemini Live, tool call dispatched | 0.54s | — |
| Local `gemma4:e4b-mlx`, reasoning **off** | **0.31s** | usable |
| Local `gemma4:e4b-mlx`, reasoning **on** | 4.79s | unusable |

Anything above roughly **300ms of dead air** is audible to a caller, and above
~1.5s people start talking over the agent. 1.43s is workable; it is not good.

### The batch API is not slow because of us

This was measured at the raw HTTP level, bypassing the AI SDK entirely, on a
trivial prompt:

```
chunk 1 @ 20.75s  'Yes,'
chunk 2 @ 20.75s  " that's correct. The frame warranty is ten years."
```

Three things this rules out, each of which we tested:

- **Not the SDK.** Raw `curl`/`urllib` against `streamGenerateContent?alt=sse`
  behaves identically.
- **Not `thinkingLevel`.** `minimal` gave 18.3s, `low` gave 25.1s, on the same
  prompt. (`none` is not a valid value — see §5.)
- **Not prompt size.** A 2,122-character system prompt and a 150-character one
  both land in the 18–25s band.

The entire response also arrives in a single burst: `TTFT ≈ total` in every batch
run. So "streaming" on the batch endpoint buys nothing for voice.

---

## 2. Gemini Live: what actually works

Endpoint:

```
wss://generativelanguage.googleapis.com/ws/
  google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContent?key=…
```

Models on this key with `bidiGenerateContent`:

| Model | Use |
|---|---|
| `gemini-3.1-flash-live-preview` | speech-to-speech, the one we use |
| `gemini-3.5-transcribe-live` | streaming STT only |
| `gemini-3.5-live-translate-preview` | streaming translation |
| `gemini-2.5-flash-native-audio-latest` | older native-audio line |

### It does the whole pipeline

One socket carries STT, the LLM, and TTS. For a **testing** environment this
removes the need for Pipecat, Deepgram, ElevenLabs and Sarvam entirely.

### Tool calling works, and enforces our authority model

This is the finding that decided the architecture. Given Corva's real
`take_action` declaration and the real v11 ceilings:

```
► TOOL CALL @0.54s: waive_fee 8500p → REFUSED
► said: "I understand your frustration, but I'm unable to waive that fee
         myself. Would you like to speak to a manager about it?"
```

It called the tool, our `checkAuthority()` refused it, and the model told the
caller plainly without inventing a promise. **Every guardrail in `lib/agent/`
works inside a Live session** — the ceilings, the blocked set, the never-rules.
We do not need an orchestration framework to police actions.

### Transcripts come free

Setting both of these in `setup` returns text alongside the audio:

```json
{ "inputAudioTranscription": {}, "outputAudioTranscription": {} }
```

Which means no separate STT pass, and both sides drop straight into the `turns`
table exactly as `respondStream()` writes them today.

### Sessions are resumable

The server periodically sends `sessionResumptionUpdate` with a handle. Worth
wiring for dropped calls before this touches real telephony.

---

## 3. Gotchas that cost us time

**Automatic VAD did not endpoint on trailing silence.** Streaming 1s of digital
silence at realtime pace after the speech hung until timeout, twice. You must
send `realtimeInput.audioStreamEnd`, or configure
`realtimeInputConfig.automaticActivityDetection` explicitly. At integration time
this looks exactly like a dead socket.

**Audio formats differ by direction, and are not negotiable:**

| Direction | Format |
|---|---|
| in | PCM **16-bit, 16 kHz**, mono — `audio/pcm;rate=16000` |
| out | PCM 16-bit, **24 kHz**, mono |

The rate change is easy to miss and produces chipmunk audio if you assume one
rate for both.

**Pace input at 1× realtime.** Dumping 8s of audio in 80ms made the model wait
~4.0s before replying; the same audio paced properly replied in 1.43s.

---

## 4. Local models

Benchmarked on 8.06s of speech, best of two warm runs.

### Speech to text

| Engine | Time | × realtime | WER |
|---|---|---|---|
| `parakeet-mlx` 0.6b-v3 | **0.18s** | **44×** | 7.7%\* |
| `mlx-whisper` small.en | 0.24s | 33× | **3.8%** |
| `faster-whisper` small.en | 1.02s | 7.9× | 3.8% |

\* Parakeet's WER is inflated by formatting: it wrote `£50` where the reference
said "fifty pounds". Both transcripts are correct.

**Do not use `faster-whisper` on a Mac.** Its CTranslate2 backend is CPU-only on
Apple Silicon, making it 4–5× slower than the MLX builds. It remains the right
choice on NVIDIA.

### Text to speech — the weak link

`piper-tts` 1.7.0 **does not run on macOS arm64**. The wheel's native library has
the CI build path compiled in:

```
Error processing file '/Users/runner/work/piper1-gpl/…/espeak-ng-data/phontab'
```

The data ships correctly at `site-packages/piper/espeak-ng-data/`, but
`ESPEAK_DATA_PATH` is not honoured — the path is baked into the binary. Fixing it
means building from source.

Published figures for time-to-first-audio, which we did not independently verify:
Piper ~1,720ms, Kokoro ~3,658ms, Orca ~106ms. Only the last clears the 300ms bar.
**Local TTS is the reason to keep using Gemini Live rather than assembling a local
stack.**

### Local LLM

`gemma4:e4b-mlx` runs the full Corva pipeline correctly — it cited the right
document, then the guardrail pre-empted it on "cancelling" and queued a handoff.

Two things to know:

- **It is a reasoning model.** 4.79s to first token with reasoning on, 0.31s with
  it off. Send `think: false` (native API) or `reasoning_effort: "none"` (the
  `/v1` OpenAI-compatible endpoint); both work.
- **It is verbose.** 380–420 output tokens unprompted. `tone.brevity: 8` in the
  agent config is persona text, not a constraint — cap `maxOutputTokens` for
  voice.

We proved the swap was cheap — one environment variable routed the turn path to
Ollama with no change at any call site — and then **removed both the local path
and Ollama itself**, having settled on Gemini. `lib/agent/model.ts` is Gemini-only
again.

The measurements above are kept because they are the argument for how a future
swap should be judged, and because Sarvam will face the same questions. To repeat
any of it:

```bash
brew install ollama && brew services start ollama
ollama pull gemma4:e4b-mlx
# then reinstate the provider in lib/agent/model.ts (~25 lines, see git history)
brew services stop ollama          # it is not needed while idle
```

---

## 5. API corrections

Things that were true in older docs and are not true now:

- `thinkingLevel` accepts **`minimal` | `low` | `medium` | `high`**. There is no
  `"none"`; passing it throws a Zod validation error from the AI SDK.
- **`gemini-2.5-flash` is retired** — 404 with "no longer available to new users",
  pointing at `gemini-3.6-flash`.
- **Next.js Route Handlers cannot serve WebSockets.** The Next docs are explicit:
  "the connection closes on timeout, or after the response is generated". The
  Live bridge therefore runs as its own process (see `scripts/voice-server.ts`),
  not as a route.

---

## 6. Building the playground taught us two more things

### Withholding the ceilings from the prompt is what makes them enforced

The console's system prompt lists the authority table via `describeAuthority()`.
Carried straight into the Live instruction, that produced a model which refused
correctly — and never called the tool:

```
► AGENT: "Unfortunately, I am not able to waive that fee."
  actions recorded: 0
```

The answer was right and the audit trail was empty. A refusal that leaves no row
behind is invisible to the Handoffs screen, the Live console and the quality
counts — which is worse than the refusal, because the whole product claim is
that you can see why the AI stopped.

Removing the table and telling the model *"you do not know what your limits are;
the only way to find out is to call `take_action`"* fixed it:

```
► tool take_action: Waive installation fee [REFUSED] — Waive a fee is blocked for the AI.
  actions recorded: 1 waive_fee=false
```

**The prompt should not contain the answer to a question the code is supposed to
decide.** This is worth carrying to the text path too.

### Transcription arrives in fragments that do not carry their own spacing

Concatenating `outputTranscription` deltas naively gives:

> "One moment.The frame has a ten-year structural warranty"

`persistTurn` normalises whitespace and re-inserts the space after terminal
punctuation before writing the row.

---

## 7. What this means for the architecture

**For testing: Gemini Live alone.** One socket, one key, no Pipecat, no Sarvam,
no Deepgram. Our authority model is enforced natively.

**Pipecat earns its place later**, for the two things Live cannot do:

1. Per-tenant model routing — Sarvam Saaras/Bulbul for Hinglish and Indian
   languages, where Gemini's accent coverage is weaker.
2. Bridging Exotel's media stream to the Live socket, including the 16k/24k
   conversion and DTMF.

**Local models stay useful** for iterating on prompts and guardrails without
burning quota: `parakeet-mlx` for STT at 44× realtime, local Gemma for turns at
0.31s. Both are faster than anything hosted, and free.

### What the playground is

`/operator/testing` — in the operator console, not a tenant's, because it costs
money per second, it can reach any brand, and it exercises whatever agent
version is live.

```
browser ──PCM16 @16k──► bridge (npm run voice) ──► Gemini Live
        ◄─PCM16 @24k── bridge ◄──
                          │
                          └─ retrieval · authority · handoffs · turn rows
```

The bridge is `scripts/voice-server.ts`, a plain `ws` server, because Next.js
route handlers cannot hold a socket open. Corva's rules live in the bridge
rather than the page, so when Exotel replaces the browser the same code applies.

Measured through the full stack, end to end:

| | |
|---|---|
| first audio after the caller stops | **926–1051ms** |
| `search_knowledge` → grounded answer | works, 2 sources cited |
| `take_action` on a blocked fee | refused, recorded, spoken plainly |
| turns written to `conversations`/`turns` | yes — appears in the archive |

It also does the thing that makes it feel like a call: it speaks *before* it
looks anything up, and varies the phrasing.

> "Hello. I can certainly check that for you. One moment, I'll pull up the
> details." … "Let me look into that for you. Bear with me a moment."

That is instructed, not emergent — see `liveInstruction()`.

---

## 8. Cost

Live is billed per second of audio in **and** out, so an idle open microphone
costs money. Everything we built is defensive about this:

- the playground never auto-connects; a person presses **Start**
- every session has a **hard cap** (`VOICE_SESSION_CAP_SECONDS`, default 180s)
  enforced by the bridge, not the browser
- the socket closes on cap, on tab close, and on idle
- elapsed time and the cap are on screen the whole time

Do not leave the playground connected while you go and do something else.

---

## 9. Reproducing any of this

The probe scripts live in the session scratchpad, not the repo, because they are
throwaway measurement rigs rather than product code:

| Script | Measures |
|---|---|
| `live_probe.py` | connect, setup, text → audio |
| `live_audio.py` | audio in → audio out, transcriptions |
| `live_realtime.py` | latency with 1× realtime pacing |
| `live_tools.py` | tool calling and authority enforcement |
| `bench_stt.py` | parakeet-mlx vs mlx-whisper vs faster-whisper |
| `bench_tts.py` | Piper (currently fails on macOS arm64) |

The venv they need:

```bash
uv venv --python 3.12 voice-env
uv pip install parakeet-mlx mlx-whisper faster-whisper piper-tts websockets
brew install ffmpeg          # parakeet and faster-whisper both need it
```

## 10. Turn-taking: the bridge says when the caller stops

On 1–2 October 2026 website calls connected and then nothing happened: the assistant never
answered, and Live eventually closed the socket. Nothing in Corva had changed.

`gemini-3.1-flash-live-preview` had stopped ending turns on its own. With automatic activity
detection it reported `voiceActivity: ACTIVITY_START` and then never an end — not after
`audioStreamEnd`, not after two seconds of silence — so it never transcribed and never replied.
A typed turn on the same socket worked. `gemini-2.5-flash-native-audio-latest` was unaffected.

Calls are push-to-talk, so the bridge already knows when the caller starts and stops. It now
says so, and the model's own detection is off:

```jsonc
// setup
"realtimeInputConfig": { "automaticActivityDetection": { "disabled": true } }
// first audio frame after a pause
{ "realtimeInput": { "activityStart": {} } }
// the browser's `end_turn`, or 1.5 s without audio
{ "realtimeInput": { "activityEnd": {} } }
```

Measured with the same recorded question, three calls each: **0.8 s** from `activityEnd` to
first audio on 3.1, **2.6 s** on 2.5 native audio. `activityStart` while the model is speaking
interrupts it, which is the barge-in a caller expects.

Two things kept from that day:

- **The close reason is recorded.** When Live closes the socket, its code and reason go into the
  transcript (`Call ended: live socket closed (1011: …)`) and the caller is told the line
  dropped. Vercel keeps an hour of logs on Hobby; the transcript is the only record that lasts.
- **A spoken smoke test beats a connect test.** `smoke:voice` only checks that a session opens.
  To check that the assistant *answers*, play recorded speech into a call:
  `say -o q.aiff "Do you …?"`, `afconvert -f WAVE -d LEI16@16000 -c 1 q.aiff q.wav`, send the
  PCM in ~85 ms frames, then `end_turn`, and expect `heard` and `said`.

## 11. A person on the call

Taking the line (`conversations.handled_by`) is seen by the bridge within a second. Then:

1. **The hand-over line.** The model is told, as a text turn, to say one sentence transferring
   the caller to the named person. If it was mid-answer, that answer finishes unheard first.
   Live sometimes says the sentence two or three times in one turn, so the bridge passes exactly
   one sentence of audio: when the transcript shows the sentence's end, it works out how long
   that sentence takes to say (≈ 0.05 s a character, measured) and lets through that much audio
   plus 0.3 s; five seconds is the backstop. Only the first sentence is written to the transcript.
2. **Muted, still listening.** The model's audio is dropped and its tool calls refused, but the
   caller's audio still goes to it — that is what keeps the caller's side transcribed.
3. **The relay.** The caller's socket and the person's are on different function instances.
   Each side holds a Postgres session and `LISTEN`s on `call_<conversation id>`; audio is
   `NOTIFY`ed in pieces of 5,400 bytes (the payload limit is 8,000 after base64). Everything
   waiting is sent in one statement while the previous is in flight, so a slow link carries
   bigger batches instead of falling behind — and each piece carries a sequence number, because
   Postgres delivers identical notifications from one transaction only once, and two pieces of
   silence are identical. Within one region a hop is a few milliseconds.
4. **Formats.** Caller → person: PCM16 at 16 kHz. Person → caller: PCM16 at 24 kHz, the same
   frames the model's voice arrives in, so a caller's page needs no new code to hear a person.
5. **The person's words** are transcribed in their browser (Web Speech API; Chrome) and written
   as `human` turns, which the bridge relays to the caller as captions and gives back to the
   model as a note when the call is handed back.

The whole call still lives inside one function invocation: `VOICE_CALL_LIMIT_SECONDS` (290 on
Vercel Hobby) from the moment it started, whoever is speaking.
