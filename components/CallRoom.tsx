"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/**
 * On the line with a caller, after taking the call from the AI.
 *
 * The caller's voice plays through this computer's speakers or headphones.
 * Hold the button — or the space bar — and speak; let go to listen. That is
 * the same push-to-talk the caller uses, so the two of you never talk over
 * each other's microphone, and the caller hears you through the same call
 * they were already on with the AI.
 *
 * What you say is transcribed here by the browser (Chrome does this best) and
 * written into the conversation under your name; what the caller says keeps
 * being transcribed by the voice bridge. The transcript below stays one
 * record of the whole call, AI and person alike.
 */

type Status = "starting" | "finding" | "connected" | "no_line" | "released" | "ended" | "error";

const CALLER_RATE = 16000;
const YOUR_RATE = 24000;

/** Float samples at the device's rate → 16-bit PCM at `toRate`. */
function toPcm16(input: Float32Array, fromRate: number, toRate: number): Int16Array {
  const ratio = fromRate / toRate;
  const out = new Int16Array(Math.floor(input.length / ratio));
  for (let i = 0; i < out.length; i++) {
    const s = Math.max(-1, Math.min(1, input[Math.floor(i * ratio)]));
    out[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
  }
  return out;
}

type Recognition = {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  start: () => void;
  stop: () => void;
  onresult: ((e: { resultIndex: number; results: ArrayLike<{ isFinal: boolean; 0: { transcript: string } }> }) => void) | null;
  onerror: ((e: { error: string }) => void) | null;
};

export function CallRoom({
  conversationId,
  caller,
  aiName,
  joinCallAudio,
  handBack,
}: {
  conversationId: string;
  caller: string;
  aiName: string;
  joinCallAudio: (conversationId: string) => Promise<{ token: string; bridgeUrl: string }>;
  handBack: (conversationId: string) => Promise<unknown>;
}) {
  const [status, setStatus] = useState<Status>("starting");
  const [error, setError] = useState<string | null>(null);
  const [talking, setTalking] = useState(false);
  const [callerWords, setCallerWords] = useState("");
  const [yourWords, setYourWords] = useState("");
  const [limit, setLimit] = useState<{ endsAt: number; startedAt: number } | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const [needsTap, setNeedsTap] = useState(false);
  const [canTranscribe, setCanTranscribe] = useState(true);
  const [handingBack, setHandingBack] = useState(false);

  const ws = useRef<WebSocket | null>(null);
  const audio = useRef<{ ctx: AudioContext; stream: MediaStream; node: ScriptProcessorNode; at: number } | null>(null);
  const talkingRef = useRef(false);
  const recognition = useRef<Recognition | null>(null);
  // The page refreshes every few seconds and may hand down a new function
  // each time; the call must not reconnect because of it.
  const join = useRef(joinCallAudio);
  useEffect(() => {
    join.current = joinCallAudio;
  }, [joinCallAudio]);

  const stopAll = useCallback(() => {
    ws.current?.close();
    ws.current = null;
    recognition.current?.stop();
    if (audio.current) {
      audio.current.node.disconnect();
      audio.current.stream.getTracks().forEach((t) => t.stop());
      void audio.current.ctx.close();
      audio.current = null;
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      let stream: MediaStream;
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
        });
      } catch {
        setError("Allow the microphone for this site to speak to the caller. You can still reply by typing below.");
        setStatus("error");
        return;
      }
      if (cancelled) return stream.getTracks().forEach((t) => t.stop());

      const ctx = new AudioContext();
      if (ctx.state === "suspended") {
        // Browsers start sound only after a click on the page.
        setNeedsTap(true);
        void ctx.resume().then(() => setNeedsTap(ctx.state === "suspended"));
      }

      let line: { token: string; bridgeUrl: string };
      try {
        line = await join.current(conversationId);
      } catch (e) {
        stream.getTracks().forEach((t) => t.stop());
        void ctx.close();
        setError(e instanceof Error ? e.message.replace(/^Error:\s*/, "") : "Could not join the call.");
        setStatus("error");
        return;
      }
      if (cancelled) {
        stream.getTracks().forEach((t) => t.stop());
        void ctx.close();
        return;
      }

      // Your microphone → 24 kHz PCM, only while you hold to talk.
      const source = ctx.createMediaStreamSource(stream);
      const node = ctx.createScriptProcessor(4096, 1, 1);
      node.onaudioprocess = (ev) => {
        const socket = ws.current;
        if (!talkingRef.current || socket?.readyState !== WebSocket.OPEN) return;
        socket.send(toPcm16(ev.inputBuffer.getChannelData(0), ctx.sampleRate, YOUR_RATE).buffer);
      };
      source.connect(node);
      node.connect(ctx.destination);
      audio.current = { ctx, stream, node, at: 0 };

      const socket = new WebSocket(line.bridgeUrl);
      socket.binaryType = "arraybuffer";
      ws.current = socket;
      socket.onopen = () => {
        socket.send(JSON.stringify({ type: "join", token: line.token }));
        setStatus("finding");
      };
      socket.onerror = () => {
        setError("The call connection dropped. Reload the page to rejoin.");
        setStatus("error");
      };
      socket.onmessage = (e) => {
        if (e.data instanceof ArrayBuffer) {
          // The caller's voice, 16 kHz: queued so pieces play back to back.
          const a = audio.current;
          const pcm = new Int16Array(e.data);
          if (!a || !pcm.length) return;
          const buffer = a.ctx.createBuffer(1, pcm.length, CALLER_RATE);
          const channel = buffer.getChannelData(0);
          for (let i = 0; i < pcm.length; i++) channel[i] = pcm[i] / 32768;
          const src = a.ctx.createBufferSource();
          src.buffer = buffer;
          src.connect(a.ctx.destination);
          const at = Math.max(a.ctx.currentTime, a.at);
          src.start(at);
          a.at = at + buffer.duration;
          return;
        }
        const m = JSON.parse(e.data as string);
        if (m.type === "connected") {
          setStatus("connected");
          const startedAt = new Date(m.startedAt).getTime();
          setLimit({ startedAt, endsAt: startedAt + m.limitSeconds * 1000 });
        } else if (m.type === "heard") setCallerWords(m.text);
        else if (m.type === "no_line") setStatus((s) => (s === "connected" ? s : "no_line"));
        else if (m.type === "released") {
          setStatus("released");
          stopAll();
        } else if (m.type === "ended") {
          setStatus("ended");
          stopAll();
        } else if (m.type === "error") {
          setError(m.message);
          setStatus("error");
        }
      };
      socket.onclose = () => setStatus((s) => (s === "connected" || s === "finding" ? "ended" : s));

      // Your words, transcribed by the browser and written into the call.
      const SR =
        (window as unknown as { SpeechRecognition?: new () => Recognition; webkitSpeechRecognition?: new () => Recognition })
          .SpeechRecognition ??
        (window as unknown as { webkitSpeechRecognition?: new () => Recognition }).webkitSpeechRecognition;
      if (!SR) {
        setCanTranscribe(false);
        return;
      }
      const rec = new SR();
      rec.lang = "en-IN";
      rec.continuous = true;
      rec.interimResults = true;
      rec.onresult = (e) => {
        let final = "";
        let interim = "";
        for (let i = e.resultIndex; i < e.results.length; i++) {
          const r = e.results[i];
          if (r.isFinal) final += r[0].transcript;
          else interim += r[0].transcript;
        }
        setYourWords(interim);
        if (final.trim() && ws.current?.readyState === WebSocket.OPEN) {
          ws.current.send(JSON.stringify({ type: "said", text: final.trim() }));
        }
      };
      rec.onerror = (e) => {
        if (e.error === "not-allowed" || e.error === "service-not-allowed") setCanTranscribe(false);
      };
      recognition.current = rec;
    })();
    return () => {
      cancelled = true;
      stopAll();
    };
  }, [conversationId, stopAll]);

  useEffect(() => {
    if (status !== "connected") return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [status]);

  const begin = useCallback(() => {
    if (status !== "connected" || talkingRef.current) return;
    void audio.current?.ctx.resume();
    talkingRef.current = true;
    setTalking(true);
    try {
      recognition.current?.start();
    } catch {}
  }, [status]);

  const end = useCallback(() => {
    if (!talkingRef.current) return;
    talkingRef.current = false;
    setTalking(false);
    recognition.current?.stop();
  }, []);

  // Space bar to talk, unless you are typing a reply.
  useEffect(() => {
    const typing = () => {
      const tag = document.activeElement?.tagName;
      return tag === "TEXTAREA" || tag === "INPUT" || (document.activeElement as HTMLElement | null)?.isContentEditable;
    };
    const down = (e: KeyboardEvent) => {
      if (e.code !== "Space" || e.repeat || typing()) return;
      e.preventDefault();
      begin();
    };
    const up = (e: KeyboardEvent) => {
      if (e.code !== "Space" || typing()) return;
      e.preventDefault();
      end();
    };
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    return () => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
    };
  }, [begin, end]);

  const clock = (ms: number) => {
    const s = Math.max(0, Math.round(ms / 1000));
    return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
  };

  const line =
    status === "starting"
      ? "Starting your microphone…"
      : status === "finding"
        ? `${aiName} is telling ${caller} you're joining — connecting…`
        : status === "connected"
          ? talking
            ? "You're speaking — let go to listen"
            : `On the line with ${caller} · ${limit ? clock(now - limit.startedAt) : ""}`
          : status === "no_line"
            ? "This conversation has no live voice line. Reply by typing below."
            : status === "released"
              ? `Handed back to ${aiName}.`
              : status === "ended"
                ? "The call has ended."
                : "Not connected";

  const remaining = limit ? limit.endsAt - now : null;
  const live = status === "connected";

  return (
    <div
      style={{
        background: "var(--color-text)",
        color: "var(--color-bg)",
        padding: "16px 24px",
        display: "grid",
        gridTemplateColumns: "auto 1fr auto",
        gap: 20,
        alignItems: "center",
        borderBottom: "2px solid var(--color-divider)",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
        <span
          aria-hidden
          style={{
            width: 52,
            height: 52,
            borderRadius: "50%",
            display: "grid",
            placeItems: "center",
            fontWeight: 800,
            fontSize: 20,
            background: "var(--color-accent)",
            boxShadow: live ? "0 0 0 4px rgba(255,255,255,0.25)" : "none",
          }}
        >
          {caller.trim()[0]?.toUpperCase() ?? "?"}
        </span>
        <div>
          <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: "0.12em", textTransform: "uppercase", opacity: 0.7 }}>
            {live ? "You are on the call" : "Call"}
          </div>
          <div style={{ fontWeight: 800, fontSize: 18 }}>{caller}</div>
          <div style={{ fontSize: 12, opacity: 0.8 }}>{line}</div>
          {live && remaining !== null && remaining < 90_000 && (
            <div style={{ fontSize: 11.5, fontWeight: 700, color: "var(--color-accent-100)" }}>
              {clock(remaining)} left on this call
            </div>
          )}
        </div>
      </div>

      <div style={{ minWidth: 0, fontSize: 13, lineHeight: 1.45 }}>
        {callerWords && (
          <p style={{ margin: 0, opacity: 0.9, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            <b style={{ opacity: 0.7, fontSize: 10.5, letterSpacing: "0.08em", textTransform: "uppercase" }}>{caller}</b>{" "}
            {callerWords}
          </p>
        )}
        {yourWords && (
          <p style={{ margin: "4px 0 0", opacity: 0.75, fontStyle: "italic" }}>
            <b style={{ fontSize: 10.5, letterSpacing: "0.08em", textTransform: "uppercase", fontStyle: "normal" }}>You</b>{" "}
            {yourWords}
          </p>
        )}
        {!canTranscribe && live && (
          <p style={{ margin: "4px 0 0", fontSize: 11.5, opacity: 0.7 }}>
            This browser can&rsquo;t transcribe you — the caller still hears you. Use Chrome to keep your side in the transcript.
          </p>
        )}
        {needsTap && (
          <button
            type="button"
            onClick={() => void audio.current?.ctx.resume().then(() => setNeedsTap(false))}
            style={{ marginTop: 6, fontSize: 12, fontWeight: 700, color: "var(--color-bg)", textDecoration: "underline" }}
          >
            Click to hear the caller
          </button>
        )}
        {error && (
          <p role="alert" style={{ margin: "4px 0 0", fontSize: 12, color: "var(--color-accent-100)" }}>
            {error}
          </p>
        )}
      </div>

      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        {live && (
          <button
            type="button"
            onPointerDown={(e) => {
              e.preventDefault();
              begin();
            }}
            onPointerUp={end}
            onPointerLeave={end}
            onPointerCancel={end}
            style={{
              userSelect: "none",
              minWidth: 190,
              padding: "13px 18px",
              fontSize: 13,
              fontWeight: 800,
              background: talking ? "var(--color-accent)" : "var(--color-bg)",
              color: talking ? "var(--color-bg)" : "var(--color-text)",
              cursor: "pointer",
            }}
          >
            {talking ? "● Speaking — release" : "Hold to talk  (Space)"}
          </button>
        )}
        {(live || status === "finding" || status === "no_line") && (
          <button
            type="button"
            disabled={handingBack}
            onClick={async () => {
              setHandingBack(true);
              try {
                await handBack(conversationId);
              } catch (e) {
                setError(e instanceof Error ? e.message.replace(/^Error:\s*/, "") : "Could not hand back.");
              } finally {
                setHandingBack(false);
              }
            }}
            style={{
              padding: "12px 14px",
              fontSize: 12,
              fontWeight: 700,
              border: "1px solid rgba(255,255,255,0.5)",
              color: "var(--color-bg)",
              cursor: handingBack ? "progress" : "pointer",
            }}
          >
            {handingBack ? "Handing back…" : `Hand back to ${aiName}`}
          </button>
        )}
        {live && (
          <button
            type="button"
            onClick={() => {
              ws.current?.send(JSON.stringify({ type: "hangup" }));
              setStatus("ended");
            }}
            style={{
              padding: "12px 14px",
              fontSize: 12,
              fontWeight: 700,
              background: "var(--color-accent)",
              color: "var(--color-bg)",
              cursor: "pointer",
            }}
          >
            End call
          </button>
        )}
      </div>
    </div>
  );
}
