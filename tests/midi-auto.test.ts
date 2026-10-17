import { describe, expect, it, vi } from "vitest";
import { MidiConnection, type MidiNavigator } from "../src/midi";

function port(id: string, state: MIDIPortDeviceState = "connected") {
  return {
    id,
    name: `Piano ${id}`,
    state,
    connection: "closed",
    onmidimessage: null,
    open: vi.fn().mockResolvedValue(undefined),
    close: vi.fn().mockResolvedValue(undefined),
  } as unknown as MIDIInput;
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

function setup(inputs: MIDIInput[] = []) {
  const access = {
    inputs: new Map(inputs.map((input) => [input.id, input])),
    onstatechange: null,
  } as unknown as MIDIAccess;
  const query = vi.fn<NonNullable<MidiNavigator["permissions"]>["query"]>();
  query.mockResolvedValue({ state: "granted" });
  const source = {
    permissions: { query },
    requestMIDIAccess: vi.fn().mockResolvedValue(access),
  } satisfies MidiNavigator;
  const callbacks = { onMessage: vi.fn(), onReset: vi.fn(), onChange: vi.fn() };
  const midi = new MidiConnection(callbacks, source);
  const change = () =>
    access.onstatechange?.call(access, {} as MIDIConnectionEvent);
  return { midi, source, query, access, callbacks, change };
}

describe("automatic MIDI connection", () => {
  it.each(["available", "connected later"] as const)(
    "does not reset practice input during initial automatic access when a piano is %s",
    async (availability) => {
      const piano = port("first");
      const permission = deferred<{ state: PermissionState }>();
      const accessRequest = deferred<MIDIAccess>();
      const { midi, query, source, access, callbacks, change } = setup(
        availability === "available" ? [piano] : [],
      );
      query.mockReturnValue(permission.promise);
      source.requestMIDIAccess.mockReturnValue(accessRequest.promise);

      const automatic = midi.autoConnect();
      permission.resolve({ state: "granted" });
      await Promise.resolve();
      expect(source.requestMIDIAccess).toHaveBeenCalledOnce();
      expect(callbacks.onReset).not.toHaveBeenCalled();

      accessRequest.resolve(access);
      await automatic;
      expect(callbacks.onReset).not.toHaveBeenCalled();
      if (availability === "connected later") {
        expect(midi.status).toBe("no-device");
        change();
        change();
        expect(callbacks.onReset).not.toHaveBeenCalled();
        (access.inputs as unknown as Map<string, MIDIInput>).set(
          piano.id,
          piano,
        );
        change();
        await Promise.resolve();
      }

      expect(midi.status).toBe("connected");
      expect(callbacks.onReset).not.toHaveBeenCalled();
      piano.onmidimessage?.call(piano, {
        data: new Uint8Array([0x90, 60, 90]),
        timeStamp: 231.5,
      } as MIDIMessageEvent);
      expect(callbacks.onMessage).toHaveBeenCalledWith(
        new Uint8Array([0x90, 60, 90]),
        231.5,
      );
      midi.dispose();
      expect(callbacks.onReset).toHaveBeenCalledOnce();
      expect(piano.onmidimessage).toBeNull();
    },
  );

  it("silently connects the first available input when permission was already granted", async () => {
    const disconnected = port("unplugged", "disconnected");
    const first = port("first");
    const second = port("second");
    const { midi, source, query, callbacks } = setup([
      disconnected,
      first,
      second,
    ]);
    expect(query).not.toHaveBeenCalled();
    expect(source.requestMIDIAccess).not.toHaveBeenCalled();

    await midi.autoConnect();

    expect(query).toHaveBeenCalledWith({ name: "midi", sysex: false });
    expect(source.requestMIDIAccess).toHaveBeenCalledExactlyOnceWith({
      sysex: false,
    });
    expect(midi.status).toBe("connected");
    expect(midi.selectedId).toBe("first");
    expect(first.open).toHaveBeenCalledOnce();
    expect(second.open).not.toHaveBeenCalled();
    expect(disconnected.open).not.toHaveBeenCalled();
    first.onmidimessage?.call(first, {
      data: new Uint8Array([0x90, 60, 90]),
      timeStamp: 231.5,
    } as MIDIMessageEvent);
    expect(callbacks.onMessage).toHaveBeenCalledWith(
      new Uint8Array([0x90, 60, 90]),
      231.5,
    );
    midi.dispose();
  });

  it.each(["prompt", "denied"] as const)(
    "does not request access or change the connection UI for %s permission",
    async (state) => {
      const { midi, source, query, callbacks } = setup([port("first")]);
      query.mockResolvedValue({ state });
      const message = midi.message;

      await midi.autoConnect();

      expect(source.requestMIDIAccess).not.toHaveBeenCalled();
      expect(midi.status).toBe("disconnected");
      expect(midi.message).toBe(message);
      expect(callbacks.onReset).not.toHaveBeenCalled();
      expect(callbacks.onChange).not.toHaveBeenCalled();
      midi.dispose();
    },
  );

  it("leaves explicit connection available when the Permissions API is missing", async () => {
    const requestMIDIAccess = vi.fn().mockResolvedValue({
      inputs: new Map(),
      onstatechange: null,
    });
    const callbacks = {
      onMessage: vi.fn(),
      onReset: vi.fn(),
      onChange: vi.fn(),
    };
    const midi = new MidiConnection(callbacks, { requestMIDIAccess });

    await midi.autoConnect();
    expect(requestMIDIAccess).not.toHaveBeenCalled();
    expect(midi.status).toBe("disconnected");
    await midi.connect();
    expect(requestMIDIAccess).toHaveBeenCalledOnce();
    expect(midi.status).toBe("no-device");
    midi.dispose();
  });

  it.each(["throw", "reject"] as const)(
    "leaves explicit connection available when the permission query fails by %s",
    async (failure) => {
      const { midi, source, query, callbacks } = setup([port("first")]);
      const error = new TypeError("Unsupported permission descriptor");
      if (failure === "throw")
        query.mockImplementation(() => {
          throw error;
        });
      else query.mockRejectedValue(error);

      await expect(midi.autoConnect()).resolves.toBeUndefined();
      expect(source.requestMIDIAccess).not.toHaveBeenCalled();
      expect(midi.status).toBe("disconnected");
      expect(callbacks.onChange).not.toHaveBeenCalled();
      await midi.connect();
      expect(midi.status).toBe("connected");
      midi.dispose();
    },
  );

  it("coalesces simultaneous automatic connection attempts", async () => {
    const permission = deferred<{ state: PermissionState }>();
    const { midi, query, source } = setup([port("first")]);
    query.mockReturnValue(permission.promise);

    const first = midi.autoConnect();
    const second = midi.autoConnect();
    expect(query).toHaveBeenCalledOnce();
    permission.resolve({ state: "granted" });
    await Promise.all([first, second]);

    expect(source.requestMIDIAccess).toHaveBeenCalledOnce();
    expect(midi.status).toBe("connected");
    midi.dispose();
  });

  it("ignores a granted query that finishes after disposal", async () => {
    const permission = deferred<{ state: PermissionState }>();
    const { midi, query, source, callbacks } = setup([port("first")]);
    query.mockReturnValue(permission.promise);
    const connecting = midi.autoConnect();
    midi.dispose();
    callbacks.onReset.mockClear();
    callbacks.onChange.mockClear();

    permission.resolve({ state: "granted" });
    await connecting;

    expect(source.requestMIDIAccess).not.toHaveBeenCalled();
    expect(callbacks.onReset).not.toHaveBeenCalled();
    expect(callbacks.onChange).not.toHaveBeenCalled();
  });

  it("does not reopen or reset a manually selected input after a late permission query", async () => {
    const permission = deferred<{ state: PermissionState }>();
    const first = port("first");
    const second = port("second");
    const { midi, query, source, callbacks } = setup([first, second]);
    query.mockReturnValue(permission.promise);
    const automatic = midi.autoConnect();
    await midi.connect();
    midi.select("second");
    await Promise.resolve();
    callbacks.onReset.mockClear();
    callbacks.onChange.mockClear();

    permission.resolve({ state: "granted" });
    await automatic;

    expect(source.requestMIDIAccess).toHaveBeenCalledOnce();
    expect(midi.selectedId).toBe("second");
    expect(midi.status).toBe("connected");
    expect(second.open).toHaveBeenCalledOnce();
    expect(second.onmidimessage).not.toBeNull();
    expect(callbacks.onReset).not.toHaveBeenCalled();
    expect(callbacks.onChange).not.toHaveBeenCalled();
    midi.dispose();
  });

  it("does not duplicate a manual request that is pending when permission is confirmed", async () => {
    const permission = deferred<{ state: PermissionState }>();
    const accessRequest = deferred<MIDIAccess>();
    const { midi, query, source, access } = setup([port("first")]);
    query.mockReturnValue(permission.promise);
    source.requestMIDIAccess.mockReturnValue(accessRequest.promise);
    const automatic = midi.autoConnect();
    const manual = midi.connect();
    permission.resolve({ state: "granted" });
    await Promise.resolve();
    expect(source.requestMIDIAccess).toHaveBeenCalledOnce();

    accessRequest.resolve(access);
    await Promise.all([automatic, manual]);

    expect(source.requestMIDIAccess).toHaveBeenCalledOnce();
    expect(midi.status).toBe("connected");
    midi.dispose();
  });

  it("automatically opens the first piano plugged in after an empty initial scan", async () => {
    const { midi, source, query, access, change } = setup();
    await midi.autoConnect();
    expect(midi.status).toBe("no-device");
    const first = port("first");
    (access.inputs as unknown as Map<string, MIDIInput>).set("first", first);

    change();
    await Promise.resolve();

    expect(midi.status).toBe("connected");
    expect(midi.selectedId).toBe("first");
    expect(first.open).toHaveBeenCalledOnce();
    expect(query).toHaveBeenCalledOnce();
    expect(source.requestMIDIAccess).toHaveBeenCalledOnce();
    midi.dispose();
  });
});
