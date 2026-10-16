/** Web MIDI stays behind an explicit user gesture; no access request happens at construction. */
export type MidiConnectionStatus =
  "unsupported" | "denied" | "no-device" | "disconnected" | "connected";
export interface MidiDevice {
  id: string;
  name: string;
}
export interface MidiCallbacks {
  onMessage(data: Uint8Array, timeStamp: number): void;
  /** Clear physical keys, pedal state, and pending practice input whenever the source changes. */
  onReset(): void;
  onChange(): void;
}
export interface MidiNavigator {
  requestMIDIAccess(options?: MIDIOptions): Promise<MIDIAccess>;
}

export class MidiConnection {
  status: MidiConnectionStatus;
  message: string;
  devices: MidiDevice[] = [];
  selectedId = "";
  private access: MIDIAccess | undefined;
  private input: MIDIInput | undefined;
  private disposed = false;
  private failedInput: MIDIInput | undefined;
  private pending: Promise<void> | undefined;
  private source: MidiNavigator | undefined;

  constructor(
    private callbacks: MidiCallbacks,
    source?: MidiNavigator,
  ) {
    this.source =
      source ??
      (typeof navigator !== "undefined" &&
      typeof navigator.requestMIDIAccess === "function"
        ? (navigator as unknown as MidiNavigator)
        : undefined);
    this.status = this.source ? "disconnected" : "unsupported";
    this.message = this.source
      ? "Connect your USB piano, then choose Connect piano."
      : "Web MIDI is unavailable. Use desktop Chrome or Edge over HTTPS. Import and Listen still work.";
  }

  /** Request access only from the Connect piano button. Permission failures are visible states. */
  connect(): Promise<void> {
    if (this.disposed) return Promise.resolve();
    if (this.pending) return this.pending;
    if (!this.source) {
      this.status = "unsupported";
      this.callbacks.onChange();
      return Promise.resolve();
    }
    this.pending = this.requestAccess().finally(() => {
      this.pending = undefined;
    });
    return this.pending;
  }

  private async requestAccess(): Promise<void> {
    try {
      const access = await this.source!.requestMIDIAccess({ sysex: false });
      if (this.disposed) return;
      if (this.access) this.access.onstatechange = null;
      this.detach();
      this.access = access;
      this.failedInput = undefined;
      access.onstatechange = () => {
        if (!this.disposed) this.refresh();
      };
      this.refresh();
    } catch (error) {
      if (this.disposed) return;
      if (this.access) this.access.onstatechange = null;
      this.access = undefined;
      this.detach();
      this.devices = [];
      const name =
        error instanceof Error
          ? error.name
          : (error as { name?: string } | null)?.name;
      this.status =
        name === "NotAllowedError" || name === "SecurityError"
          ? "denied"
          : "disconnected";
      this.message =
        this.status === "denied"
          ? "MIDI permission was denied or blocked. Allow MIDI in this site’s browser settings, then reconnect. Import and Listen still work."
          : "Could not open MIDI access. Check your piano connection and try Connect piano again.";
      this.callbacks.onChange();
    }
  }

  select(id: string): void {
    if (this.disposed) return;
    this.selectedId = id;
    this.failedInput = undefined;
    if (this.access) this.refresh();
    else this.callbacks.onChange();
  }

  private refresh(): void {
    if (!this.access || this.disposed) return;
    const inputs: MIDIInput[] = [];
    this.access.inputs.forEach((input) => {
      if (input.state === "connected") inputs.push(input);
    });
    this.devices = inputs.map((input) => ({
      id: input.id,
      name: input.name || "MIDI input",
    }));
    if (!this.selectedId && inputs.length) this.selectedId = inputs[0].id;
    const selected = inputs.find((input) => input.id === this.selectedId);
    if (!selected) {
      this.failedInput = undefined;
      this.detach();
      this.status = this.selectedId ? "disconnected" : "no-device";
      this.message = this.selectedId
        ? "Piano disconnected. Reconnect it, or choose another MIDI input. Import and Listen still work."
        : "No MIDI input found. Plug in a USB piano; it will appear here automatically. Import and Listen still work.";
    } else if (this.failedInput === selected) {
      this.status = "disconnected";
      this.message =
        "This MIDI input could not be opened. Check the USB connection and choose it again.";
    } else {
      if (this.input !== selected) this.bind(selected);
      this.status = "connected";
      this.message = `Connected to ${selected.name || "MIDI input"}.`;
    }
    this.callbacks.onChange();
  }

  private bind(input: MIDIInput): void {
    this.detach();
    this.input = input;
    input.onmidimessage = (event) => {
      if (
        this.disposed ||
        this.input !== input ||
        input.state !== "connected" ||
        !event.data
      )
        return;
      // DOM event timestamps share performance.now()'s clock. Never substitute animation-frame time.
      this.callbacks.onMessage(new Uint8Array(event.data), event.timeStamp);
    };
    void input.open().catch(() => {
      if (this.disposed || this.input !== input) return;
      this.failedInput = input;
      this.detach();
      this.status = "disconnected";
      this.message =
        "This MIDI input could not be opened. Check the USB connection and choose it again.";
      this.callbacks.onChange();
    });
  }

  private detach(): void {
    const input = this.input;
    this.input = undefined;
    if (input) {
      input.onmidimessage = null;
      // Closing a disconnected port can reject; cleanup must still clear held keys and pedals.
      void input.close().catch(() => {});
    }
    this.callbacks.onReset();
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    if (this.access) this.access.onstatechange = null;
    this.access = undefined;
    this.detach();
    this.devices = [];
  }
}
