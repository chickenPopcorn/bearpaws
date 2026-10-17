import { describe, expect, it, vi } from "vitest";
import { MidiConnection, type MidiNavigator } from "../src/midi";

function input(id: string, name = id) {
  return {
    id,
    name,
    state: "connected",
    connection: "closed",
    onmidimessage: null,
    open: vi.fn().mockResolvedValue(undefined),
    close: vi.fn().mockResolvedValue(undefined),
  } as unknown as MIDIInput;
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}
function setup(inputs: MIDIInput[] = []) {
  const access = {
    inputs: new Map(inputs.map((port) => [port.id, port])),
    onstatechange: null,
  } as unknown as MIDIAccess;
  const source = {
    requestMIDIAccess: vi.fn().mockResolvedValue(access),
  } satisfies MidiNavigator;
  const callbacks = { onMessage: vi.fn(), onReset: vi.fn(), onChange: vi.fn() };
  const midi = new MidiConnection(callbacks, source);
  const change = () =>
    access.onstatechange?.call(access, {} as MIDIConnectionEvent);
  const send = (port: MIDIInput, data: number[], timeStamp = 1234.5) =>
    port.onmidimessage?.call(port, {
      data: new Uint8Array(data),
      timeStamp,
    } as MIDIMessageEvent);
  return { midi, source, access, callbacks, change, send };
}

describe("USB MIDI connection lifecycle", () => {
  it("requests permission only on connect, enumerates devices, and preserves event data and timestamps", async () => {
    const piano = input("piano", "My piano");
    const { midi, source, callbacks, send } = setup([piano]);
    expect(source.requestMIDIAccess).not.toHaveBeenCalled();
    await midi.connect();
    expect(source.requestMIDIAccess).toHaveBeenCalledWith({ sysex: false });
    expect(midi.status).toBe("connected");
    expect(midi.devices).toEqual([{ id: "piano", name: "My piano" }]);
    send(piano, [0x90, 60, 92], 105.25);
    send(piano, [0x90, 60, 0], 207.5);
    send(piano, [0xb0, 64, 127], 210);
    expect(callbacks.onMessage.mock.calls).toEqual([
      [new Uint8Array([0x90, 60, 92]), 105.25],
      [new Uint8Array([0x90, 60, 0]), 207.5],
      [new Uint8Array([0xb0, 64, 127]), 210],
    ]);
  });

  it("waits for the selected input to open before reporting connected", async () => {
    const piano = input("piano", "My piano");
    const opening = deferred<MIDIPort>();
    vi.mocked(piano.open).mockReturnValueOnce(opening.promise);
    const { midi, change, callbacks } = setup([piano]);
    await midi.connect();
    expect(midi.status).toBe("opening");
    expect(midi.message).toContain("Connecting to My piano");
    change();
    expect(midi.status).toBe("opening");
    expect(piano.open).toHaveBeenCalledOnce();
    callbacks.onChange.mockClear();
    opening.resolve(piano);
    await opening.promise;
    expect(midi.status).toBe("connected");
    expect(callbacks.onChange).toHaveBeenCalledOnce();
  });

  it.each(["resolve", "reject"] as const)(
    "ignores a stale open %s and message handler after returning to the same input",
    async (settlement) => {
      const first = input("first"),
        second = input("second");
      const oldOpening = deferred<MIDIPort>();
      const newOpening = deferred<MIDIPort>();
      vi.mocked(first.open)
        .mockReturnValueOnce(oldOpening.promise)
        .mockReturnValueOnce(newOpening.promise);
      const { midi, callbacks, send } = setup([first, second]);
      await midi.connect();
      const oldHandler = first.onmidimessage;
      midi.select("second");
      midi.select("first");
      callbacks.onReset.mockClear();
      if (settlement === "resolve") oldOpening.resolve(first);
      else oldOpening.reject(new Error("Superseded open failed"));
      await Promise.resolve();
      expect(midi.status).toBe("opening");
      expect(callbacks.onReset).not.toHaveBeenCalled();
      oldHandler?.call(first, {
        data: new Uint8Array([0x90, 60, 100]),
        timeStamp: 12,
      } as MIDIMessageEvent);
      expect(callbacks.onMessage).not.toHaveBeenCalled();
      newOpening.resolve(first);
      await newOpening.promise;
      expect(midi.status).toBe("connected");
      send(first, [0x90, 64, 100]);
      expect(callbacks.onMessage).toHaveBeenCalledOnce();
    },
  );

  it("ignores an open result after the input is unplugged", async () => {
    const piano = input("piano");
    const opening = deferred<MIDIPort>();
    vi.mocked(piano.open).mockReturnValueOnce(opening.promise);
    const { midi, change } = setup([piano]);
    await midi.connect();
    Object.defineProperty(piano, "state", { value: "disconnected" });
    change();
    expect(midi.status).toBe("disconnected");
    opening.resolve(piano);
    await opening.promise;
    expect(midi.status).toBe("disconnected");
    expect(piano.onmidimessage).toBeNull();
  });

  it("binds only the selected input and clears held input on device selection", async () => {
    const first = input("first"),
      second = input("second");
    const { midi, callbacks, send } = setup([first, second]);
    await midi.connect();
    const oldHandler = first.onmidimessage;
    callbacks.onReset.mockClear();
    midi.select("second");
    expect(callbacks.onReset).toHaveBeenCalledOnce();
    expect(first.close).toHaveBeenCalledOnce();
    expect(first.onmidimessage).toBeNull();
    expect(midi.selectedId).toBe("second");
    oldHandler?.call(first, {
      data: new Uint8Array([0x90, 60, 100]),
      timeStamp: 12,
    } as MIDIMessageEvent);
    send(second, [0x90, 64, 100]);
    expect(callbacks.onMessage).toHaveBeenCalledOnce();
    expect(callbacks.onMessage.mock.calls[0][0][1]).toBe(64);
  });

  it("cleans up on unplug and reconnects the selected stable ID without silently changing inputs", async () => {
    const first = input("piano"),
      other = input("other");
    const { midi, callbacks, access, change, send } = setup([first, other]);
    await midi.connect();
    send(first, [0x90, 60, 100]);
    send(first, [0xb0, 64, 127]);
    callbacks.onReset.mockClear();
    Object.defineProperty(first, "state", {
      value: "disconnected",
      configurable: true,
    });
    change();
    expect(midi.status).toBe("disconnected");
    expect(callbacks.onReset).toHaveBeenCalledOnce();
    expect(first.onmidimessage).toBeNull();
    expect(other.onmidimessage).toBeNull();
    const reconnected = input("piano", "Reconnected piano");
    (access.inputs as unknown as Map<string, MIDIInput>).set(
      "piano",
      reconnected,
    );
    change();
    expect(midi.status).toBe("opening");
    await Promise.resolve();
    expect(midi.status).toBe("connected");
    expect(midi.selectedId).toBe("piano");
    send(reconnected, [0x90, 67, 80]);
    expect(callbacks.onMessage).toHaveBeenLastCalledWith(
      new Uint8Array([0x90, 67, 80]),
      1234.5,
    );
  });

  it("shows no-device and automatically notices a newly connected piano", async () => {
    const { midi, access, change } = setup();
    await midi.connect();
    expect(midi.status).toBe("no-device");
    (access.inputs as unknown as Map<string, MIDIInput>).set(
      "new",
      input("new"),
    );
    change();
    expect(midi.status).toBe("opening");
    await Promise.resolve();
    expect(midi.status).toBe("connected");
    expect(midi.selectedId).toBe("new");
  });

  it("surfaces denied permission and allows another explicit attempt", async () => {
    const { midi, source, callbacks } = setup();
    source.requestMIDIAccess.mockRejectedValueOnce(
      new DOMException("Permission denied", "NotAllowedError"),
    );
    await midi.connect();
    expect(midi.status).toBe("denied");
    expect(midi.message).toContain("Import and Listen still work");
    expect(callbacks.onReset).not.toHaveBeenCalled();
    await midi.connect();
    expect(midi.status).toBe("no-device");
    expect(callbacks.onReset).not.toHaveBeenCalled();
  });

  it("resets a bound input once when replacing MIDI access", async () => {
    const original = input("piano", "Original piano");
    const replacement = input("piano", "Replacement piano");
    const { midi, source, access, callbacks, send } = setup([original]);
    await midi.connect();
    send(original, [0x90, 60, 100]);
    const oldHandler = original.onmidimessage;
    const newAccess = {
      inputs: new Map([[replacement.id, replacement]]),
      onstatechange: null,
    } as unknown as MIDIAccess;
    source.requestMIDIAccess.mockResolvedValueOnce(newAccess);
    callbacks.onReset.mockClear();
    callbacks.onMessage.mockClear();

    await midi.connect();

    expect(callbacks.onReset).toHaveBeenCalledOnce();
    expect(original.close).toHaveBeenCalledOnce();
    expect(original.onmidimessage).toBeNull();
    expect(access.onstatechange).toBeNull();
    expect(midi.status).toBe("connected");
    oldHandler?.call(original, {
      data: new Uint8Array([0x90, 60, 100]),
      timeStamp: 12,
    } as MIDIMessageEvent);
    expect(callbacks.onMessage).not.toHaveBeenCalled();
    send(replacement, [0x90, 64, 100]);
    expect(callbacks.onMessage).toHaveBeenCalledOnce();
    midi.dispose();
  });

  it("reports port-open failure without repeatedly reopening on connection events, and supports retry", async () => {
    const piano = input("piano");
    vi.mocked(piano.open).mockRejectedValueOnce(new Error("Port unavailable"));
    const { midi, callbacks, change } = setup([piano]);
    await midi.connect();
    expect(midi.status).toBe("disconnected");
    expect(piano.onmidimessage).toBeNull();
    expect(callbacks.onReset).toHaveBeenCalled();
    change();
    expect(piano.open).toHaveBeenCalledOnce();
    midi.select("piano");
    expect(piano.open).toHaveBeenCalledTimes(2);
    expect(midi.status).toBe("opening");
    await Promise.resolve();
    expect(midi.status).toBe("connected");
  });

  it("coalesces simultaneous permission requests", async () => {
    let resolve!: (value: MIDIAccess) => void;
    const { midi, source, access } = setup();
    source.requestMIDIAccess.mockImplementationOnce(
      () =>
        new Promise<MIDIAccess>((r) => {
          resolve = r;
        }),
    );
    const first = midi.connect(),
      second = midi.connect();
    expect(first).toBe(second);
    expect(source.requestMIDIAccess).toHaveBeenCalledOnce();
    resolve(access);
    await first;
    expect(midi.status).toBe("no-device");
  });

  it("reports unsupported Web MIDI without asking for permission", async () => {
    vi.stubGlobal("navigator", {});
    try {
      const midi = new MidiConnection({
        onMessage: vi.fn(),
        onReset: vi.fn(),
        onChange: vi.fn(),
      });
      expect(midi.status).toBe("unsupported");
      await midi.connect();
      expect(midi.status).toBe("unsupported");
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("disposes handlers, clears held state, and ignores pending permission results", async () => {
    const piano = input("piano");
    const { midi, callbacks, access } = setup([piano]);
    await midi.connect();
    callbacks.onReset.mockClear();
    midi.dispose();
    expect(piano.onmidimessage).toBeNull();
    expect(access.onstatechange).toBeNull();
    expect(callbacks.onReset).toHaveBeenCalledOnce();
    midi.dispose();
    expect(callbacks.onReset).toHaveBeenCalledOnce();
    let resolve!: (value: MIDIAccess) => void;
    const source = {
      requestMIDIAccess: () =>
        new Promise<MIDIAccess>((r) => {
          resolve = r;
        }),
    };
    const pending = new MidiConnection(callbacks, source);
    const permission = pending.connect();
    pending.dispose();
    resolve(access);
    await permission;
    expect(piano.onmidimessage).toBeNull();
    expect(access.onstatechange).toBeNull();
  });
});
