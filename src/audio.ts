import type { Note } from "./song";
import type { Transport } from "./engine";
/** Audio and MIDI timestamps share performance.timeOrigin. Frames never advance time. */
export class ReferenceAudio {
  context: AudioContext | null = null;
  voices = new Set<{ osc: OscillatorNode; gain: GainNode }>();
  scheduled = new Set<string>();
  cycle = -1;
  now = () => this.context?.currentTime ?? performance.now() / 1000;
  eventTime(timestamp: number) {
    return this.now() + (timestamp - performance.now()) / 1000;
  }
  async unlock() {
    this.context ??= new AudioContext();
    await this.context.resume();
  }
  stop() {
    for (const v of this.voices) {
      try {
        v.osc.stop();
      } catch {}
      v.gain.disconnect();
    }
    this.voices.clear();
    this.scheduled.clear();
  }
  tone(pitch: number, velocity: number, when: number, duration: number) {
    const context = this.context;
    if (!context || context.state !== "running") return;
    const osc = context.createOscillator(),
      gain = context.createGain();
    osc.type = "triangle";
    osc.frequency.value = 440 * 2 ** ((pitch - 69) / 12);
    gain.gain.setValueAtTime(0, when);
    gain.gain.linearRampToValueAtTime(
      Math.max(0.015, velocity * 0.15),
      when + 0.012,
    );
    gain.gain.exponentialRampToValueAtTime(
      0.001,
      when + Math.max(0.04, duration),
    );
    osc.connect(gain).connect(context.destination);
    const voice = { osc, gain };
    this.voices.add(voice);
    osc.onended = () => {
      this.voices.delete(voice);
      gain.disconnect();
    };
    osc.start(when);
    osc.stop(when + Math.max(0.06, duration) + 0.03);
  }
  schedule(notes: Note[], transport: Transport, enabled: boolean) {
    if (!enabled || !transport.playing || !this.context) return;
    if (this.cycle !== transport.cycle) {
      this.stop();
      this.cycle = transport.cycle;
    }
    const now = this.now(),
      position = transport.at(now),
      lookahead = 0.12 * transport.speed;
    for (const n of notes) {
      if (
        this.scheduled.has(n.id) ||
        n.soundEnd <= position ||
        n.start > position + lookahead
      )
        continue;
      if (
        transport.loop &&
        (n.start >= transport.loop[1] || n.soundEnd <= transport.loop[0])
      )
        continue;
      this.scheduled.add(n.id);
      const start = Math.max(0, (n.start - position) / transport.speed),
        end =
          (Math.min(n.soundEnd, transport.loop?.[1] ?? Infinity) - position) /
          transport.speed;
      if (end > 0) this.tone(n.pitch, n.velocity, now + start, end - start);
    }
  }
}
