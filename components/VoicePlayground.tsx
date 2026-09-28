"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/**
 * Talking to the agent as a caller would.
 *
 * Push-to-talk rather than open-mic, for two reasons. The honest one is cost:
 * Gemini Live bills per second of audio in either direction, and an open
 * microphone on a forgotten tab is the expensive failure. The other is that
 * automatic endpointing on the Live API did not fire on trailing silence in
 * testing (see docs/VOICE.md), so something has to say "I have stopped
 * talking" — and a held key is the most predictable something.
 *
 * Audio in is PCM16 at 16kHz, audio out is PCM16 at 24kHz. The rates differ by
 * direction and are not negotiable.
 */

const INPUT_RATE = 16000;
const OUTPUT_RATE = 24000;

type Event =
  | { kind: "heard"; text: string }
  | { kind: "said"; text: string }
  /** A person on the console, typing. The playground has no voice for them. */
  | { kind: "human"; name: string; text: string }
  | { kind: "tool"; name: string; summary: string; allowed: boolean; detail?: string }
  | { kind: "system"; text: string };

type Status = "idle" | "connecting" | "ready" | "listening" | "thinking" | "speaking" | "closed";

export function VoicePlayground({
  bridgeUrl,
  brands,
  callers,
  liveModels,
  costPerMinutePaise,
}: {
  bridgeUrl: string;
  brands: { slug: string; name: string; agentName: string | null }[];
  /** Who you can ring in as, per brand. An empty choice is an unknown number. */
  callers: Record<string, { id: string; name: string; detail: string }[]>;
  /** The speech-to-speech models a call can be placed on. */
  liveModels: { id: string; label: string; blurb: string }[];
  costPerMinutePaise: number;
}) {
  const [status, setStatus] = useState<Status>("idle");
  const [brandSlug, setBrandSlug] = useState(brands[0]?.slug ?? "");
  const [callerId, setCallerId] = useState("");
  const [liveModel, setLiveModel] = useState(liveModels[0]?.id ?? "");
  const [countsInMetrics, setCountsInMetrics] = useState(false);
  const [events, setEvents] = useState<Event[]>([]);
  const [session, setSession] = useState<{
    brand: string;
    agent: string;
    version: number;
    customer: string | null;
    capSeconds: number;
    liveModel?: string;
    conversationId?: string;
  } | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [talking, setTalking] = useState(false);

  const ws = useRef<WebSocket | null>(null);
  const micCtx = useRef<AudioContext | null>(null);
  const stream = useRef<MediaStream | null>(null);
  const node = useRef<ScriptProcessorNode | null>(null);
  const playCtx = useRef<AudioContext | null>(null);
  const playAt = useRef(0);
  const talkingRef = useRef(false);
  /** A person has the line, so no answer is coming from the AI. */
  const heldRef = useRef(false);
  const log = useRef<HTMLDivElement | null>(null);

  const push = (e: Event) => setEvents((prev) => [...prev, e]);

  useEffect(() => {
    log.current?.scrollTo({ top: log.current.scrollHeight, behavior: "smooth" });
  }, [events]);

  useEffect(() => {
    if (status === "idle" || status === "closed") return;
    const t = setInterval(() => setElapsed((s) => s + 1), 1000);
    return () => clearInterval(t);
  }, [status]);

  const teardown = useCallback(() => {
    node.current?.disconnect();
    node.current = null;
    stream.current?.getTracks().forEach((t) => t.stop());
    stream.current = null;
    void micCtx.current?.close();
    micCtx.current = null;
    ws.current?.close();
    ws.current = null;
  }, []);

  // A tab closed mid-call must not leave a metered socket open.
  useEffect(() => () => teardown(), [teardown]);

  /** Queue a 24kHz PCM chunk so consecutive chunks play gaplessly. */
  const play = useCallback((pcm: ArrayBuffer) => {
    if (!playCtx.current) playCtx.current = new AudioContext({ sampleRate: OUTPUT_RATE });
    const ctx = playCtx.current;
    const samples = new Int16Array(pcm);
    if (samples.length === 0) return;

    const buffer = ctx.createBuffer(1, samples.length, OUTPUT_RATE);
    const channel = buffer.getChannelData(0);
    for (let i = 0; i < samples.length; i++) channel[i] = samples[i] / 32768;

    const source = ctx.createBufferSource();
    source.buffer = buffer;
    source.connect(ctx.destination);
    // Schedule against a running cursor rather than "now", or chunks overlap.
    const at = Math.max(ctx.currentTime, playAt.current);
    source.start(at);
    playAt.current = at + buffer.duration;
    setStatus("speaking");
    source.onended = () => {
      if (ctx.currentTime >= playAt.current - 0.05) {
        setStatus((s) => (s === "speaking" ? "ready" : s));
      }
    };
  }, []);

  const start = async () => {
    setError(null);
    setEvents([]);
    setElapsed(0);
    heldRef.current = false;
    setStatus("connecting");

    try {
      stream.current = await navigator.mediaDevices.getUserMedia({
        audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true },
      });
    } catch {
      setError("No microphone. Allow access and try again.");
      setStatus("idle");
      return;
    }

    const socket = new WebSocket(bridgeUrl);
    socket.binaryType = "arraybuffer";
    ws.current = socket;

    socket.onopen = () =>
      socket.send(
        JSON.stringify({
          type: "start",
          brandSlug,
          customerId: callerId || null,
          countsInMetrics,
          liveModel,
        }),
      );

    socket.onmessage = (e) => {
      if (e.data instanceof ArrayBuffer) {
        play(e.data);
        return;
      }
      const m = JSON.parse(e.data);
      if (m.type === "ready") {
        setSession(m);
        setStatus("ready");
        push({
          kind: "system",
          text:
            `Connected to ${m.agent} on ${m.brand}, agent v${m.version}. ` +
            (m.customer
              ? `Ringing in as ${m.customer}.`
              : "Ringing in from a number the brand does not recognise."),
        });
      } else if (m.type === "heard") {
        setEvents((prev) => {
          const rest = prev.filter((x, i) => !(x.kind === "heard" && i === prev.length - 1));
          return [...rest, { kind: "heard", text: m.text }];
        });
      } else if (m.type === "said") {
        setStatus("speaking");
        setEvents((prev) => {
          const rest = prev.filter((x, i) => !(x.kind === "said" && i === prev.length - 1));
          return [...rest, { kind: "said", text: m.text }];
        });
      } else if (m.type === "tool") {
        setStatus("thinking");
        push({ kind: "tool", name: m.name, summary: m.summary, allowed: m.allowed, detail: m.detail });
      } else if (m.type === "held") {
        // Cut what is already queued, not just what arrives next — the bridge
        // stops sending, but a second of scheduled audio would still play.
        void playCtx.current?.close();
        playCtx.current = null;
        playAt.current = 0;
        heldRef.current = true;
        setStatus("ready");
        push({ kind: "system", text: `${m.by} took the line. The AI has stopped replying.` });
      } else if (m.type === "released") {
        heldRef.current = false;
        push({ kind: "system", text: "Handed back to the AI." });
      } else if (m.type === "human") {
        push({ kind: "human", name: m.name, text: m.text });
      } else if (m.type === "interrupted") {
        push({ kind: "system", text: "You interrupted — it stopped." });
        playAt.current = 0;
      } else if (m.type === "error") {
        setError(m.message);
      } else if (m.type === "closed") {
        push({ kind: "system", text: `Session closed after ${m.seconds}s — ${m.reason}.` });
        setStatus("closed");
        teardown();
      }
    };

    socket.onerror = () => setError("Could not reach the bridge. Is `npm run voice` running?");
    socket.onclose = () => setStatus((s) => (s === "closed" ? s : "closed"));

    // Downsample the browser's native rate to the 16kHz the Live API wants.
    const ctx = new AudioContext({ sampleRate: INPUT_RATE });
    micCtx.current = ctx;
    const source = ctx.createMediaStreamSource(stream.current!);
    const proc = ctx.createScriptProcessor(2048, 1, 1);
    node.current = proc;

    proc.onaudioprocess = (ev) => {
      if (!talkingRef.current || socket.readyState !== WebSocket.OPEN) return;
      const input = ev.inputBuffer.getChannelData(0);
      const pcm = new Int16Array(input.length);
      for (let i = 0; i < input.length; i++) {
        const clamped = Math.max(-1, Math.min(1, input[i]));
        pcm[i] = clamped < 0 ? clamped * 0x8000 : clamped * 0x7fff;
      }
      socket.send(pcm.buffer);
    };

    source.connect(proc);
    proc.connect(ctx.destination);
  };

  const beginTalking = () => {
    if (!["ready", "speaking", "thinking"].includes(status)) return;
    talkingRef.current = true;
    setTalking(true);
    setStatus("listening");
    // Barging in stops whatever is playing, as it would on a real line.
    playAt.current = 0;
  };

  const endTalking = () => {
    if (!talkingRef.current) return;
    talkingRef.current = false;
    setTalking(false);
    setStatus(heldRef.current ? "ready" : "thinking");
    ws.current?.send(JSON.stringify({ type: "end_turn" }));
  };

  // Space bar is push-to-talk, so you can keep your eyes on the transcript.
  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (e.code === "Space" && !e.repeat && !talkingRef.current) {
        e.preventDefault();
        beginTalking();
      }
    };
    const up = (e: KeyboardEvent) => {
      if (e.code === "Space") {
        e.preventDefault();
        endTalking();
      }
    };
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    return () => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
    };
  });

  const live = status !== "idle" && status !== "closed";
  const cap = session?.capSeconds ?? 180;
  const remaining = Math.max(0, cap - elapsed);
  const cost = ((elapsed / 60) * costPerMinutePaise) / 100;

  const STATUS_TEXT: Record<Status, string> = {
    idle: "Not connected",
    connecting: "Connecting…",
    ready: "Ready — hold space to talk",
    listening: "Listening…",
    thinking: "Working…",
    speaking: "Speaking",
    closed: "Session closed",
  };

  return (
    <div style={{ display: "grid", gridTemplateColumns: "1fr 340px", minHeight: 520 }}>
      {/* Transcript */}
      <div style={{ borderRight: "2px solid var(--color-neutral-700)", display: "flex", flexDirection: "column" }}>
        <div
          style={{
            padding: "12px 20px",
            borderBottom: "1px solid var(--color-neutral-800)",
            display: "flex",
            alignItems: "center",
            gap: 12,
            fontSize: 12,
          }}
        >
          <span
            style={{
              width: 8,
              height: 8,
              display: "block",
              background: live ? "var(--color-accent)" : "var(--color-neutral-600)",
              animation: status === "listening" ? "cv-pulse 1s ease-in-out infinite" : undefined,
            }}
          />
          <b style={{ color: "var(--color-bg)" }}>{STATUS_TEXT[status]}</b>
          {live && (
            <span style={{ marginLeft: "auto", display: "flex", gap: 14, color: "var(--color-neutral-400)" }}>
              <span>
                {Math.floor(elapsed / 60)}:{String(elapsed % 60).padStart(2, "0")} / {Math.floor(cap / 60)}:
                {String(cap % 60).padStart(2, "0")}
              </span>
              <span style={{ color: remaining < 30 ? "var(--color-accent-400)" : undefined }}>
                {remaining}s left
              </span>
              <span>≈ ₹{cost.toFixed(2)}</span>
            </span>
          )}
        </div>

        <div ref={log} style={{ flex: 1, overflowY: "auto", padding: "16px 20px", display: "flex", flexDirection: "column", gap: 12, maxHeight: 460 }}>
          {events.length === 0 && (
            <p style={{ margin: 0, fontSize: 12.5, color: "var(--color-neutral-500)", lineHeight: 1.6, maxWidth: "56ch" }}>
              Press <b style={{ color: "var(--color-bg)" }}>Start</b>, then hold <b style={{ color: "var(--color-bg)" }}>space</b> and
              talk as a customer would. Try asking about the warranty, then ask it to waive a fee —
              the first it can answer from a document, the second its authority ceiling forbids.
            </p>
          )}
          {events.map((e, i) => {
            if (e.kind === "system") {
              return (
                <div key={i} style={{ fontSize: 11.5, color: "var(--color-neutral-500)", fontStyle: "italic" }}>
                  {e.text}
                </div>
              );
            }
            if (e.kind === "tool") {
              return (
                <div
                  key={i}
                  style={{
                    borderLeft: `3px solid ${e.allowed ? "var(--color-neutral-600)" : "var(--color-accent)"}`,
                    paddingLeft: 10,
                    fontSize: 11.5,
                  }}
                >
                  <span
                    style={{
                      fontWeight: 700,
                      letterSpacing: "0.08em",
                      textTransform: "uppercase",
                      fontSize: 9.5,
                      color: e.allowed ? "var(--color-neutral-400)" : "var(--color-accent-400)",
                    }}
                  >
                    {e.name.replace(/_/g, " ")} {e.allowed ? "" : "· refused"}
                  </span>
                  <div style={{ marginTop: 2, color: "var(--color-neutral-300)" }}>
                    {e.summary}
                    {e.detail && <span style={{ color: "var(--color-neutral-500)" }}> · {e.detail}</span>}
                  </div>
                </div>
              );
            }
            if (e.kind === "human") {
              return (
                <div key={i} style={{ display: "grid", gridTemplateColumns: "70px 1fr", gap: 12 }}>
                  <span
                    style={{
                      fontSize: 9.5,
                      fontWeight: 700,
                      letterSpacing: "0.1em",
                      textTransform: "uppercase",
                      color: "var(--color-bg)",
                      paddingTop: 3,
                    }}
                  >
                    {e.name.split(" ")[0]}
                  </span>
                  <span style={{ fontSize: 13.5, lineHeight: 1.5, color: "var(--color-bg)" }}>{e.text}</span>
                </div>
              );
            }
            const isCaller = e.kind === "heard";
            return (
              <div key={i} style={{ display: "grid", gridTemplateColumns: "70px 1fr", gap: 12 }}>
                <span
                  style={{
                    fontSize: 9.5,
                    fontWeight: 700,
                    letterSpacing: "0.1em",
                    textTransform: "uppercase",
                    color: isCaller ? "var(--color-neutral-500)" : "var(--color-accent-400)",
                    paddingTop: 3,
                  }}
                >
                  {isCaller ? "You" : "Agent"}
                </span>
                <span style={{ fontSize: 13.5, lineHeight: 1.5, color: "var(--color-bg)" }}>{e.text}</span>
              </div>
            );
          })}
        </div>

        {/* Push to talk */}
        <div style={{ borderTop: "2px solid var(--color-neutral-700)", padding: "14px 20px", display: "flex", alignItems: "center", gap: 14 }}>
          <button
            type="button"
            disabled={!["ready", "listening", "speaking", "thinking"].includes(status)}
            onMouseDown={beginTalking}
            onMouseUp={endTalking}
            onMouseLeave={endTalking}
            onTouchStart={(e) => {
              e.preventDefault();
              beginTalking();
            }}
            onTouchEnd={(e) => {
              e.preventDefault();
              endTalking();
            }}
            style={{
              fontSize: 12.5,
              fontWeight: 700,
              padding: "12px 22px",
              background: talking ? "var(--color-accent)" : live ? "var(--color-bg)" : "var(--color-neutral-700)",
              color: talking ? "var(--color-bg)" : live ? "var(--color-text)" : "var(--color-neutral-500)",
              cursor: live ? "pointer" : "not-allowed",
              userSelect: "none",
            }}
          >
            {talking ? "● Release to send" : "Hold to talk (space)"}
          </button>
          <span style={{ fontSize: 11.5, color: "var(--color-neutral-500)", lineHeight: 1.45 }}>
            Speak, then release. Talking while it speaks interrupts it, as a real line would.
          </span>
        </div>
      </div>

      {/* Controls */}
      <div style={{ padding: "16px 20px", display: "flex", flexDirection: "column", gap: 16 }}>
        <div>
          <div style={{ fontSize: 9.5, fontWeight: 700, letterSpacing: "0.14em", textTransform: "uppercase", color: "var(--color-neutral-500)" }}>
            Brand
          </div>
          <select
            value={brandSlug}
            onChange={(e) => setBrandSlug(e.target.value)}
            disabled={live}
            style={{
              marginTop: 8,
              width: "100%",
              border: "1px solid var(--color-neutral-600)",
              background: "transparent",
              color: "var(--color-bg)",
              padding: "7px 9px",
              fontSize: 12.5,
              fontFamily: "inherit",
              borderRadius: 0,
            }}
          >
            {brands.map((b) => (
              <option key={b.slug} value={b.slug} style={{ color: "var(--color-text)" }}>
                {b.name}
                {b.agentName ? ` · ${b.agentName}` : ""}
              </option>
            ))}
          </select>
        </div>

        <div>
          <div style={{ fontSize: 9.5, fontWeight: 700, letterSpacing: "0.14em", textTransform: "uppercase", color: "var(--color-neutral-500)" }}>
            Calling as
          </div>
          <select
            value={callerId}
            onChange={(e) => setCallerId(e.target.value)}
            disabled={live}
            style={{
              marginTop: 8,
              width: "100%",
              border: "1px solid var(--color-neutral-600)",
              background: "transparent",
              color: "var(--color-bg)",
              padding: "7px 9px",
              fontSize: 12.5,
              fontFamily: "inherit",
              borderRadius: 0,
            }}
          >
            <option value="" style={{ color: "var(--color-text)" }}>
              An unrecognised number
            </option>
            {(callers[brandSlug] ?? []).map((c) => (
              <option key={c.id} value={c.id} style={{ color: "var(--color-text)" }}>
                {c.name}
                {c.detail ? ` · ${c.detail}` : ""}
              </option>
            ))}
          </select>
          <p style={{ margin: "8px 0 0", fontSize: 11, color: "var(--color-neutral-500)", lineHeight: 1.5 }}>
            The agent sees this caller&rsquo;s record — their tier, lifetime value, priority and
            open orders. Ringing in unrecognised is a different call, and worth trying too.
          </p>
        </div>

        <div>
          <div style={{ fontSize: 9.5, fontWeight: 700, letterSpacing: "0.14em", textTransform: "uppercase", color: "var(--color-neutral-500)" }}>
            Voice model
          </div>
          <select
            value={liveModel}
            onChange={(e) => setLiveModel(e.target.value)}
            disabled={live}
            aria-label="Voice model"
            style={{
              marginTop: 8,
              width: "100%",
              border: "1px solid var(--color-neutral-600)",
              background: "transparent",
              color: "var(--color-bg)",
              padding: "7px 9px",
              fontSize: 12.5,
              fontFamily: "inherit",
              borderRadius: 0,
            }}
          >
            {liveModels.map((m) => (
              <option key={m.id} value={m.id} style={{ color: "var(--color-text)" }}>
                {m.label}
              </option>
            ))}
          </select>
          <p style={{ margin: "8px 0 0", fontSize: 11, color: "var(--color-neutral-500)", lineHeight: 1.5 }}>
            {liveModels.find((m) => m.id === liveModel)?.blurb}
          </p>
        </div>

        <label
          style={{
            display: "flex",
            alignItems: "flex-start",
            gap: 9,
            fontSize: 12,
            cursor: live ? "default" : "pointer",
            opacity: live ? 0.6 : 1,
          }}
        >
          <input
            type="checkbox"
            checked={countsInMetrics}
            disabled={live}
            onChange={(e) => setCountsInMetrics(e.target.checked)}
            style={{ accentColor: "var(--color-accent)", marginTop: 2 }}
          />
          <span>
            Count this call in the numbers
            <span style={{ display: "block", fontSize: 11, color: "var(--color-neutral-500)", lineHeight: 1.5, marginTop: 3 }}>
              Off by default. A rehearsal still appears on the live console and in the archive —
              it just stays out of containment, cost, fleet health and the caller&rsquo;s priority
              score.
            </span>
          </span>
        </label>

        {!live ? (
          <button
            type="button"
            className="hov-accent-dark"
            onClick={start}
            style={{ fontSize: 12.5, fontWeight: 700, background: "var(--color-accent)", color: "var(--color-bg)", padding: "12px 16px" }}
          >
            Start the call
          </button>
        ) : (
          <button
            type="button"
            className="hov-invert-dark"
            onClick={() => {
              ws.current?.send(JSON.stringify({ type: "stop" }));
              teardown();
              setStatus("closed");
            }}
            style={{ fontSize: 12.5, fontWeight: 700, border: "2px solid var(--color-bg)", padding: "11px 16px" }}
          >
            Hang up
          </button>
        )}

        {error && (
          <div role="alert" style={{ fontSize: 11.5, color: "var(--color-accent-400)", lineHeight: 1.45, border: "1px solid var(--color-accent-800)", padding: "9px 11px" }}>
            {error}
          </div>
        )}

        {session && (
          <div style={{ fontSize: 12, color: "var(--color-neutral-400)", lineHeight: 1.6 }}>
            <div style={{ fontSize: 9.5, fontWeight: 700, letterSpacing: "0.14em", textTransform: "uppercase", color: "var(--color-neutral-500)", marginBottom: 6 }}>
              This session
            </div>
            <div>Agent <b style={{ color: "var(--color-bg)" }}>{session.agent} v{session.version}</b></div>
            {session.customer && <div>Caller record <b style={{ color: "var(--color-bg)" }}>{session.customer}</b></div>}
            {session.liveModel && (
              <div>
                On{" "}
                <b style={{ color: "var(--color-bg)" }}>
                  {liveModels.find((m) => m.id === session.liveModel)?.label ?? session.liveModel}
                </b>
              </div>
            )}
            {session.conversationId && (
              <a
                href={`/app/live?call=${session.conversationId}`}
                target="_blank"
                rel="noreferrer"
                style={{
                  display: "inline-block",
                  marginTop: 10,
                  fontSize: 11.5,
                  fontWeight: 700,
                  color: "var(--color-accent-400)",
                }}
              >
                Watch this call in the console →
              </a>
            )}
          </div>
        )}

        <div style={{ marginTop: "auto", fontSize: 11, color: "var(--color-neutral-500)", lineHeight: 1.5, borderTop: "1px solid var(--color-neutral-800)", paddingTop: 12 }}>
          Billed per second of audio both ways. The bridge hangs up at the cap, on idle, and when
          this tab closes — but do not leave a call open while you do something else.
        </div>
      </div>
    </div>
  );
}
