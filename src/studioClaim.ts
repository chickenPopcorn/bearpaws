/**
 * Only one tab of the site runs the studio at a time, so its saves and uploads
 * never race another tab's. The claim is a Web Lock held while the studio is
 * open; another tab can take it over, and this one is then told. Browsers
 * without Web Locks let every tab run the studio.
 */
const LOCK = "pawpal-studio";

export class StudioClaim {
  private release: (() => void) | null = null;

  /** Called when another tab takes the studio over. */
  constructor(private onTaken: () => void) {}

  get held() {
    return this.release !== null;
  }

  /**
   * Claim the studio for this tab. False if another tab has it, unless `take`
   * claims it from that tab.
   */
  claim(take = false): Promise<boolean> {
    const locks =
      typeof navigator === "undefined" ? undefined : navigator.locks;
    if (!locks || this.release) return Promise.resolve(true);
    return new Promise((resolve) => {
      let answered = false;
      locks
        .request(
          LOCK,
          take ? { steal: true } : { ifAvailable: true },
          (lock) => {
            answered = true;
            if (!lock) {
              resolve(false);
              return;
            }
            return new Promise<void>((done) => {
              this.release = () => {
                this.release = null;
                done();
              };
              resolve(true);
            });
          },
        )
        .catch(() => {
          // Refused before an answer, as where this page cannot use Web
          // Locks: run the studio here, as browsers without them do.
          if (!answered) {
            resolve(true);
            return;
          }
          // Another tab took the lock: its request rejects this one's.
          if (!this.release) return;
          this.release = null;
          this.onTaken();
        });
    });
  }

  /** Let another tab run the studio, such as after signing out. */
  give() {
    this.release?.();
  }
}
