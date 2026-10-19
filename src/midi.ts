import { closeOutput, MidiPlayer } from "./midiPlayer";
/** New MIDI permission stays behind Connect; saved permission can reconnect at startup. */
export type MidiConnectionStatus =
  | "unsupported"
  | "denied"
  | "no-device"
  | "disconnected"
  | "opening"
  | "connected";
export interface MidiDevice {
  id: string;
  name: string;
}
export interface MidiCallbacks {
  onMessage(data: Uint8Array, timeStamp: number): void;
  /** Clear physical keys, pedals, and pending input when a bound source changes or is disposed. */
  onReset(): void;
  onChange(): void;
  /**
   * The app chose output `id` itself, as the piano connected. `opened`
   * settles once the output is open or has failed.
   */
  onOutputChosen(id: string, opened: Promise<void>): void;
  /** The output in use failed or went away; sound is back on the laptop. */
  onOutputLost(): void;
}
export interface MidiNavigator {
  requestMIDIAccess(options?: MIDIOptions): Promise<MIDIAccess>;
  permissions?: {
    query(descriptor: { name: "midi"; sysex: false }): Promise<{
      state: PermissionState;
    }>;
  };
}

const OPEN_FAILED =
  "This MIDI input could not be opened. Check the USB connection and choose it again.";
const OUTPUT_LOST =
  "Piano output disconnected. Sound plays on the laptop until the piano reconnects or you choose it again under Sound.";
const label = (input: MIDIInput) => input.name || "MIDI input";

export class MidiConnection {
  status: MidiConnectionStatus;
  message: string;
  devices: MidiDevice[] = [];
  selectedId = "";
  outputs: MidiDevice[] = [];
  selectedOutputId = "";
  outputMessage = "";
  private outputGeneration = 0;
  /** The user chose Laptop, so the app does not choose an output itself. */
  private laptopChosen = false;
  /** An output that failed: the app does not choose it again until it reconnects. */
  private failedOutputId = "";
  player = new MidiPlayer(() => {
    this.loseOutput(OUTPUT_LOST);
    this.callbacks.onChange();
  });
  private access: MIDIAccess | undefined;
  private input: MIDIInput | undefined;
  private disposed = false;
  private failedInput: MIDIInput | undefined;
  private bindingGeneration = 0;
  private pending: Promise<void> | undefined;
  private automatic: Promise<void> | undefined;
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
      ? "Plug in your USB piano, then choose Connect your piano."
      : "Web MIDI is unavailable. Use desktop Chrome or Edge over HTTPS. Listen still works.";
  }

  /** Reuse saved permission without opening a permission prompt on page load. */
  autoConnect(): Promise<void> {
    if (this.automatic) return this.automatic;
    if (
      this.disposed ||
      this.access ||
      this.pending ||
      !this.source?.permissions
    )
      return Promise.resolve();
    this.automatic = this.connectIfAllowed().finally(() => {
      this.automatic = undefined;
    });
    return this.automatic;
  }

  private async connectIfAllowed(): Promise<void> {
    const generation = this.bindingGeneration;
    try {
      const permission = await this.source!.permissions!.query({
        name: "midi",
        sysex: false,
      });
      if (
        permission.state === "granted" &&
        !this.disposed &&
        !this.access &&
        !this.pending &&
        generation === this.bindingGeneration
      )
        await this.connect();
    } catch {
      // Browsers without MIDI permission queries keep the explicit Connect button.
    }
  }

  /** Explicit connection also handles the first permission request and retries. */
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
      this.releaseAccess(true);
      this.detach();
      this.access = access;
      this.failedInput = undefined;
      // One click connects whatever is plugged in if the chosen input is gone.
      let available = false;
      access.inputs.forEach((input) => {
        if (input.id === this.selectedId && input.state === "connected")
          available = true;
      });
      if (!available) this.selectedId = "";
      access.onstatechange = () => {
        if (!this.disposed) this.refresh();
      };
      this.refresh();
    } catch (error) {
      if (this.disposed) return;
      this.releaseAccess(true);
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
          ? "MIDI permission was denied or blocked. Allow MIDI in this site’s browser settings, then reconnect. Listen still works."
          : "Could not open MIDI access. Check your piano connection and try Connect your piano again.";
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

  /** The user's choice of output for all sound, or "" for the laptop. */
  selectOutput(id: string): Promise<void> {
    this.laptopChosen = !id;
    return this.openOutput(id);
  }

  private async openOutput(id: string): Promise<void> {
    const generation = ++this.outputGeneration;
    this.player.setOutput();
    this.selectedOutputId = id;
    this.outputMessage = "";
    this.callbacks.onChange();
    if (!id) return;
    const port = this.access?.outputs?.get(id);
    try {
      if (port?.state !== "connected") throw new Error("Unavailable");
      await port.open();
      if (generation !== this.outputGeneration || this.disposed) {
        // A newer choice replaced this one, and may itself use this port.
        if (this.selectedOutputId !== id) closeOutput(port);
        return;
      }
      if (port.state !== "connected") throw new Error("Disconnected");
      this.player.setOutput(port);
      this.outputMessage = `Sound plays on ${port.name || "MIDI output"} (same channel as your piano).`;
    } catch {
      if (generation !== this.outputGeneration || this.disposed) return;
      if (port) closeOutput(port);
      this.loseOutput(
        "Could not open the piano output. Sound plays on the laptop; choose the piano again under Sound to retry.",
      );
    }
    this.callbacks.onChange();
  }

  /**
   * Return sound to the laptop. The selection goes back to Laptop too, so
   * choosing the output again is a change that retries it.
   */
  private loseOutput(message: string) {
    this.failedOutputId = this.selectedOutputId;
    this.outputGeneration++;
    this.player.setOutput();
    this.selectedOutputId = "";
    this.outputMessage = message;
    this.callbacks.onOutputLost();
  }

  private refresh(): void {
    if (!this.access || this.disposed) return;
    this.outputs = [];
    this.access.outputs?.forEach((output) => {
      if (output.state === "connected")
        this.outputs.push({
          id: output.id,
          name: output.name || "MIDI output",
        });
    });
    if (
      this.selectedOutputId &&
      !this.outputs.some((p) => p.id === this.selectedOutputId)
    )
      this.loseOutput(OUTPUT_LOST);
    if (!this.outputs.some((p) => p.id === this.failedOutputId))
      this.failedOutputId = "";
    const inputs: MIDIInput[] = [];
    this.access.inputs.forEach((input) => {
      if (input.state === "connected") inputs.push(input);
    });
    this.devices = inputs.map((input) => ({
      id: input.id,
      name: label(input),
    }));
    if (!this.selectedId && inputs.length) this.selectedId = inputs[0].id;
    const selected = inputs.find((input) => input.id === this.selectedId);
    if (!selected) {
      this.failedInput = undefined;
      this.detach();
      this.status = this.selectedId ? "disconnected" : "no-device";
      this.message = this.selectedId
        ? "Piano disconnected. Reconnect it, or choose another MIDI input. Listen still works."
        : "No MIDI input found. Plug in a USB piano; it will appear here automatically. Listen still works.";
    } else if (this.failedInput === selected) {
      this.status = "disconnected";
      this.message = OPEN_FAILED;
    } else if (this.input !== selected) this.bind(selected);
    if (selected) this.chooseOutput(selected);
    this.callbacks.onChange();
  }

  /**
   * Send all sound to the piano that connected: the output named like its
   * input, or else the only output. The user can still choose Laptop.
   */
  private chooseOutput(input: MIDIInput): void {
    if (this.selectedOutputId || this.laptopChosen) return;
    const output =
      this.outputs.find((port) => port.name === input.name) ??
      (this.outputs.length === 1 ? this.outputs[0] : undefined);
    if (!output || output.id === this.failedOutputId) return;
    this.callbacks.onOutputChosen(output.id, this.openOutput(output.id));
  }

  private bind(input: MIDIInput): void {
    this.detach();
    this.input = input;
    // A port can be selected again before an earlier open attempt completes.
    const generation = this.bindingGeneration;
    const current = () =>
      !this.disposed &&
      this.input === input &&
      this.bindingGeneration === generation;
    this.status = "opening";
    this.message = `Connecting to ${label(input)}…`;
    input.onmidimessage = (event) => {
      if (!current() || input.state !== "connected" || !event.data) return;
      // DOM event timestamps share performance.now()'s clock. Never substitute animation-frame time.
      // Only physical note-ons select the output channel, never virtual keys
      // or system messages. Channel 1 is used until the first physical note.
      if ((event.data[0] & 0xf0) === 0x90 && event.data[2] > 0)
        this.player.setChannel(event.data[0] & 0x0f);
      this.callbacks.onMessage(new Uint8Array(event.data), event.timeStamp);
    };
    void input.open().then(
      () => {
        if (!current()) return;
        if (input.state !== "connected") {
          this.refresh();
          return;
        }
        this.status = "connected";
        this.message = `Connected to ${label(input)}.`;
        this.callbacks.onChange();
      },
      () => {
        if (!current()) return;
        this.failedInput = input;
        this.detach();
        this.status = "disconnected";
        this.message = OPEN_FAILED;
        this.callbacks.onChange();
      },
    );
  }

  private detach(forceReset = false): void {
    this.bindingGeneration++;
    const input = this.input;
    this.input = undefined;
    if (input) {
      this.player.silence();
      input.onmidimessage = null;
      // Closing a disconnected port can reject; cleanup must still clear held keys and pedals.
      void input.close().catch(() => {});
    }
    // Initial access and an empty scan have no physical state to clear. In
    // particular, automatic connection must not cancel a pending Play request.
    if (input || forceReset) this.callbacks.onReset();
  }

  private releaseAccess(notifyOutputLoss = false): void {
    const hadOutput = !!this.selectedOutputId || this.player.connected;
    this.outputGeneration++;
    this.player.setOutput();
    this.selectedOutputId = "";
    this.failedOutputId = "";
    this.outputs = [];
    this.outputMessage = "";
    if (this.access) this.access.onstatechange = null;
    this.access = undefined;
    if (notifyOutputLoss && hadOutput) this.callbacks.onOutputLost();
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.releaseAccess();
    this.detach(true);
    this.devices = [];
  }
}
