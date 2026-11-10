// @ts-check
// Plays items one clip at a time, fetching a few sentences ahead.
// Events: "position" (index changed), "state" (playing changed), "ended", "error" (detail: Error).

/** @typedef {{ speech: string, pauseAfter: number }} PlayItem */

const AHEAD = 3; // sentences fetched ahead of the current one
const BEHIND = 2; // clips kept behind it, for quick "previous"
const REFETCH_DELAY_MS = 350; // wait for speed presses to settle before regenerating

/** @typedef {{ controller: AbortController, promise: Promise<Clip>, url: string | null, speed: number }} ClipEntry */
/** @typedef {{ url: string, speed: number }} Clip */

export class Player extends EventTarget {
  /**
   * @param {{ server: string, items: PlayItem[], speed?: number, voice?: string | null }} options
   */
  constructor({ server, items, speed = 1, voice = null }) {
    super();
    this.server = server;
    this.items = items;
    this.speed = speed;
    this.voice = voice;
    this.index = 0;
    this.playing = false;

    /** @type {Map<number, ClipEntry>} */
    this.clips = new Map();
    this.audio = new Audio();
    this.audio.preservesPitch = true;
    /** Which item the audio element holds, or -1. */
    this.audioIndex = -1;
    /** The speed the loaded clip was generated at. */
    this.audioSpeed = 1;
    /** @type {ReturnType<typeof setTimeout> | null} */
    this.refetchTimer = null;
    /** Bumped on every jump; async work from an older token is ignored. */
    this.token = 0;
    /** @type {ReturnType<typeof setTimeout> | null} */
    this.gapTimer = null;
    /** Paused during the gap after a sentence: resume starts the next one. */
    this.pausedInGap = false;
  }

  /** Start playing at `from` (default: the current item). */
  async play(from = this.index) {
    const token = ++this.token;
    this.clearGap();
    this.audio.pause();
    this.audioIndex = -1;
    this.pausedInGap = false;
    this.index = clamp(from, 0, this.items.length - 1);
    this.playing = true;
    this.emit("position");
    this.emit("state");
    this.prefetch(this.index);

    const index = this.index;
    let clip;
    try {
      clip = await this.clip(index);
    } catch (err) {
      if (token !== this.token || isAbort(err)) return;
      this.fail(err);
      return;
    }
    if (token !== this.token) return;

    this.audio.src = clip.url;
    this.audioIndex = index;
    this.audioSpeed = clip.speed;
    this.applyRate();
    this.audio.onended = () => {
      if (token !== this.token) return;
      if (index + 1 >= this.items.length) {
        this.playing = false;
        this.emit("state");
        this.emit("ended");
        return;
      }
      this.gapTimer = setTimeout(() => {
        this.gapTimer = null;
        this.play(index + 1);
      }, this.items[index].pauseAfter);
    };
    if (!this.playing) return; // paused while the clip was loading
    try {
      await this.audio.play();
    } catch (err) {
      if (token === this.token && !isAbort(err)) this.fail(err);
    }
  }

  pause() {
    if (!this.playing) return;
    this.playing = false;
    if (this.gapTimer) {
      this.clearGap();
      this.pausedInGap = true;
    }
    this.audio.pause();
    this.emit("state");
  }

  resume() {
    if (this.playing) return;
    if (this.pausedInGap) {
      this.pausedInGap = false;
      return this.play(Math.min(this.index + 1, this.items.length - 1));
    }
    if (this.audioIndex === this.index && !this.audio.ended) {
      this.playing = true;
      this.emit("state");
      this.audio.play().catch((err) => isAbort(err) || this.fail(err));
      return;
    }
    return this.play(this.index);
  }

  toggle() {
    return this.playing ? this.pause() : this.resume();
  }

  /** Move to `index`. Keeps playing if playing, otherwise just moves. */
  jump(index) {
    index = clamp(index, 0, this.items.length - 1);
    if (this.playing) return this.play(index);
    this.token++;
    this.clearGap();
    this.audio.pause();
    this.audioIndex = -1;
    this.pausedInGap = false;
    this.index = index;
    this.emit("position");
    this.prefetch(index);
  }

  /**
   * Takes effect immediately: the sentence that's playing speeds up or slows
   * down in place (pitch preserved), and the following sentences are
   * regenerated at the new speed once the presses settle.
   * @param {number} speed
   */
  setSpeed(speed) {
    if (speed === this.speed) return;
    this.speed = speed;
    this.applyRate();
    // Keep the current sentence's clip, even if it's still loading: it plays
    // at an adjusted rate rather than making you wait for a new one.
    this.dropClips((i) => i !== this.audioIndex && i !== this.index);
    if (this.refetchTimer) clearTimeout(this.refetchTimer);
    this.refetchTimer = setTimeout(() => {
      this.refetchTimer = null;
      this.prefetch(this.index);
    }, REFETCH_DELAY_MS);
  }

  /** @param {string | null} voice */
  setVoice(voice) {
    this.voice = voice;
    this.resetClips();
  }

  stop() {
    this.token++;
    this.clearGap();
    this.audio.pause();
    this.audio.removeAttribute("src");
    this.playing = false;
    if (this.refetchTimer) clearTimeout(this.refetchTimer);
    this.refetchTimer = null;
    this.dropClips(() => true);
  }

  // --- internals ---

  /** Play the loaded clip at the requested speed, relative to the speed it was made at. */
  applyRate() {
    const rate = this.speed / this.audioSpeed;
    this.audio.defaultPlaybackRate = rate;
    this.audio.playbackRate = rate;
  }

  /** Voice changed: cached clips are wrong now. Restart the current sentence. */
  resetClips() {
    this.dropClips(() => true);
    if (this.playing) this.play(this.index);
    else this.jump(this.index);
  }

  /** @param {number} i */
  clip(i) {
    const existing = this.clips.get(i);
    if (existing) return existing.promise;

    const speed = this.speed;
    /** @type {ClipEntry} */
    const entry = { controller: new AbortController(), promise: Promise.resolve({ url: "", speed }), url: null, speed };
    entry.promise = fetch(`${this.server}/speak`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: this.items[i].speech, speed, ...(this.voice ? { voice: this.voice } : {}) }),
      signal: entry.controller.signal,
    }).then(async (res) => {
      if (!res.ok) throw new Error(`Server error ${res.status}: ${await res.text()}`);
      entry.url = URL.createObjectURL(await res.blob());
      return { url: entry.url, speed };
    });
    // A failed fetch is forgotten, so the next attempt retries it.
    entry.promise.catch(() => {
      if (this.clips.get(i) === entry) this.clips.delete(i);
    });
    this.clips.set(i, entry);
    return entry.promise;
  }

  /** @param {number} from */
  prefetch(from) {
    if (this.refetchTimer) clearTimeout(this.refetchTimer);
    this.refetchTimer = null;
    this.dropClips((i) => i < from - BEHIND || i > from + AHEAD);
    const last = Math.min(from + AHEAD, this.items.length - 1);
    for (let i = from; i <= last; i++) this.clip(i).catch(() => {});
  }

  /** @param {(index: number) => boolean} predicate */
  dropClips(predicate) {
    for (const [i, entry] of this.clips) {
      if (!predicate(i)) continue;
      entry.controller.abort();
      if (entry.url) URL.revokeObjectURL(entry.url);
      this.clips.delete(i);
    }
  }

  clearGap() {
    if (this.gapTimer) clearTimeout(this.gapTimer);
    this.gapTimer = null;
  }

  /** @param {unknown} err */
  fail(err) {
    this.playing = false;
    this.emit("state");
    this.dispatchEvent(new CustomEvent("error", { detail: err instanceof Error ? err : new Error(String(err)) }));
  }

  /** @param {string} type */
  emit(type) {
    this.dispatchEvent(new Event(type));
  }
}

/** @param {number} n @param {number} lo @param {number} hi */
const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n));

/** @param {unknown} err */
const isAbort = (err) => err instanceof DOMException && err.name === "AbortError";
