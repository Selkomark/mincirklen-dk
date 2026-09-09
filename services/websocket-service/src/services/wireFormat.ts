import { pack, unpack } from 'msgpackr'

// The wire format for a single WebSocket connection — negotiated once per
// connection via wsController.ts's `hello` frame (always sent as JSON text,
// regardless of this setting, so it's readable before the client has
// locked anything in), then applied to every frame after it. See
// context.ts's AppEnv.wireFormat / index.ts's WS_WIRE_FORMAT for how this
// gets set per-deployment.
export type WireFormat = 'json' | 'binary'

// A `string` payload becomes a WS text frame (readable in DevTools, same
// as today); a `Uint8Array` becomes a WS binary frame (opaque). The WS
// opcode itself carries the format — no separate per-frame tag needed.
// msgpackr's `pack()` returns a pooled-buffer-backed `Buffer`, whose
// underlying ArrayBuffer TS can't statically guarantee isn't a
// SharedArrayBuffer (Hono's WSContext.send is typed strictly against a
// plain ArrayBuffer) — copying into a fresh Uint8Array sidesteps that
// entirely, at a small, worthwhile cost given how small these payloads are.
export function encodeFrame(format: WireFormat, payload: unknown): string | Uint8Array<ArrayBuffer> {
  return format === 'json' ? JSON.stringify(payload) : new Uint8Array(pack(payload))
}

// `raw` is whatever Bun's onMessage handed us: a `string` for a text frame,
// or a binary frame's bytes (an ArrayBuffer, or a Uint8Array view over
// one). Malformed input decodes to `undefined` rather than throwing —
// callers (wsController.ts's onMessage, via parseClientFrame) already
// treat `undefined`/unrecognized shapes as "ignore this frame," so there's
// no separate error path needed here for a client sending garbage.
export function decodeFrame(format: WireFormat, raw: string | ArrayBufferLike | Uint8Array): unknown {
  if (format === 'json') {
    if (typeof raw !== 'string') return undefined
    try {
      return JSON.parse(raw)
    } catch {
      return undefined
    }
  }
  if (typeof raw === 'string') return undefined
  try {
    return unpack(raw instanceof Uint8Array ? raw : new Uint8Array(raw))
  } catch {
    return undefined
  }
}

// NATS payloads are always canonical JSON text (see natsAdapter.ts) —
// this is the one per-connection transcode point, at the WS edge only.
// Keeping NATS itself JSON-only (rather than also switching its internal
// representation) means roomRelayService.ts and natsAdapter.ts need no
// changes: it's pod-to-pod traffic only, never inspected by end users, so
// there's no payload-size or security reason to touch it.
export function reencodeForClient(format: WireFormat, natsJson: string): string | Uint8Array<ArrayBuffer> {
  return encodeFrame(format, JSON.parse(natsJson))
}
