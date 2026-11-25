/* player.js — shared audio engine (used by index.html and listen.html)
 *
 * Two <audio> "decks" so the next track is preloaded and can start with no gap, or overlap the end of the
 * current one (crossfade) when an item has `overlap` seconds. That is what lets an EP "trail" from one
 * track into the next.
 *
 * Queue items: { fileId, songId, title, label, overlap, duration, ...anything you need in getUrl }
 * Options: getUrl(item) -> Promise<string>, onState(state), onCount(item), onError(err, item)
 */
(function (global) {
  const SILENT = "data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEAESsAABErAAABAAgAZGF0YQAAAAA=";

  class Player {
    constructor(opts = {}) {
      this.o = opts;
      this.decks = [new Audio(), new Audio()];
      this.active = 0;
      this.queue = [];
      this.index = -1;
      this.autoplay = true;
      this.volume = 1;
      this.listened = 0;
      this.counted = false;
      this._last = null;
      this._tok = 0;
      this._starting = false;
      this._fade = null;
      this._pre = null;
      this._seek = null;
      this._unlocked = false;

      this.decks.forEach((d, i) => {
        d.preload = "auto";
        d.addEventListener("timeupdate", () => this._time(i));
        d.addEventListener("ended", () => this._ended(i));
        d.addEventListener("play", () => i === this.active && this._emit());
        d.addEventListener("pause", () => i === this.active && this._emit());
        d.addEventListener("loadedmetadata", () => {
          if (i === this.active && this._seek != null) { d.currentTime = this._seek; this._seek = null; }
          if (i === this.active) this._emit();
        });
        d.addEventListener("error", () => {
          if (i === this.active && d.src && d.src !== SILENT && this.o.onError) this.o.onError(new Error("Couldn't load audio (link may have expired)"), this.item());
        });
      });
      this._mediaSession();
    }

    item() { return this.queue[this.index] || null; }
    deck() { return this.decks[this.active]; }

    state() {
      const d = this.deck(), it = this.item();
      return {
        item: it, index: this.index, length: this.queue.length,
        playing: !!(it && !d.paused && !d.ended),
        time: d.currentTime || 0,
        duration: isFinite(d.duration) && d.duration > 0 ? d.duration : (it && it.duration) || 0,
        autoplay: this.autoplay,
      };
    }
    _emit() { if (this.o.onState) this.o.onState(this.state()); this._mediaMeta(); }

    setQueue(items, index = 0, startAt = 0) { this.queue = items; return this.play(index, startAt); }

    async play(i, startAt = 0) {
      if (i < 0 || i >= this.queue.length) return;
      this._unlock();                                   // must run inside the user's click for iOS
      const tok = ++this._tok;
      this._cancelFade();
      this.decks.forEach(d => d.pause());
      this.index = i; this.listened = 0; this.counted = false; this._last = null; this._pre = null; this._starting = false;
      const it = this.queue[i], d = this.deck();
      this._emit();
      let url;
      try { url = await this._url(it); }
      catch (e) { if (this.o.onError) this.o.onError(e, it); return; }
      if (tok !== this._tok) return;
      this._seek = startAt || null;
      d.src = url; d.volume = this.volume;
      try { await d.play(); }
      catch (e) { if (e.name !== "AbortError" && this.o.onError) this.o.onError(e, it); }
      if (tok === this._tok) this._preloadNext();
    }

    toggle() {
      const d = this.deck();
      if (this.index < 0) return;
      if (d.ended) return this.play(this.index);
      if (d.paused) { this._unlock(); d.play().catch(() => {}); } else d.pause();
    }
    pause() { this.deck().pause(); }
    next() { if (this.index + 1 < this.queue.length) this.play(this.index + 1); }
    prev() {
      const d = this.deck();
      if (d.currentTime > 3 || this.index <= 0) { d.currentTime = 0; this._last = null; }
      else this.play(this.index - 1);
    }
    seek(t) { if (isFinite(t)) { this.deck().currentTime = Math.max(0, t); this._last = null; } }
    setAutoplay(v) { this.autoplay = !!v; if (v) this._preloadNext(); this._emit(); }

    /* ---------- internals ---------- */
    async _url(it) {
      if (it._url && Date.now() - it._at < 50 * 60e3) return it._url;
      const u = await this.o.getUrl(it);
      it._url = u; it._at = Date.now();
      return u;
    }

    _unlock() {
      if (this._unlocked) return;
      this._unlocked = true;
      this.decks.forEach(d => {
        d.src = SILENT;
        const p = d.play();
        if (p && p.then) p.then(() => { if (d.src === SILENT) d.pause(); }).catch(() => {});
      });
    }

    _time(i) {
      if (i !== this.active) return;
      const d = this.decks[i], it = this.item();
      if (!it) return;
      const t = d.currentTime;
      if (this._last != null) { const dt = t - this._last; if (dt > 0 && dt < 1.5 && !d.paused) this.listened += dt; }
      this._last = t;
      if (!this.counted && this.listened >= Math.min(15, (isFinite(d.duration) ? d.duration : 30) * 0.5)) {
        this.counted = true;
        if (this.o.onCount) this.o.onCount(it);
      }
      const n = this.queue[this.index + 1];
      if (this.autoplay && n && it.overlap > 0 && isFinite(d.duration) && d.duration - t <= it.overlap + 0.05 && !this._starting) {
        this._advance(it.overlap);
      }
      this._emit();
    }

    _ended(i) {
      if (i !== this.active) return;                    // the outgoing deck of a crossfade: ignore
      if (this.autoplay && this.queue[this.index + 1] && !this._starting) this._advance(0);
      else this._emit();
    }

    async _advance(overlap) {
      this._starting = true;
      const n = this.index + 1, it = this.queue[n];
      const old = this.deck(), ni = this.active ^ 1, nd = this.decks[ni];
      try {
        const url = await this._url(it);
        if (!(this._pre && this._pre.index === n && this._pre.deck === ni)) nd.src = url;
        nd.currentTime = 0;
        this._tok++;
        this.active = ni; this.index = n; this.listened = 0; this.counted = false; this._last = null; this._seek = null; this._pre = null;
        nd.volume = overlap > 0 ? 0 : this.volume;
        try { await nd.play(); } catch (e) { if (this.o.onError && e.name !== "AbortError") this.o.onError(e, it); }
        if (overlap > 0) this._crossfade(old, nd, overlap);
        else { old.pause(); this._preloadNext(); }
        this._emit();
      } catch (e) {
        if (this.o.onError) this.o.onError(e, it);
      } finally { this._starting = false; }
    }

    _crossfade(old, nd, sec) {
      clearInterval(this._fade);
      const t0 = performance.now();
      this._fade = setInterval(() => {
        const t = Math.min(1, (performance.now() - t0) / (sec * 1000));
        nd.volume = this.volume * t; old.volume = this.volume * (1 - t);
        if (t >= 1) {
          clearInterval(this._fade); this._fade = null;
          old.pause(); old.volume = this.volume;
          this._preloadNext();
        }
      }, 40);
    }
    _cancelFade() { if (this._fade) { clearInterval(this._fade); this._fade = null; } this.decks.forEach(d => { d.volume = this.volume; }); }

    async _preloadNext() {
      const n = this.index + 1, it = this.queue[n];
      if (!this.autoplay || !it || this._fade) return;
      const tok = this._tok, ni = this.active ^ 1, nd = this.decks[ni];
      try {
        const u = await this._url(it);
        if (tok !== this._tok || this.index + 1 !== n || this._fade) return;
        nd.src = u; nd.load();
        this._pre = { index: n, deck: ni };
      } catch (e) { /* non-fatal: _advance fetches the URL itself */ }
    }

    _mediaSession() {
      if (!("mediaSession" in navigator)) return;
      const ms = navigator.mediaSession;
      try {
        ms.setActionHandler("play", () => this.toggle());
        ms.setActionHandler("pause", () => this.pause());
        ms.setActionHandler("previoustrack", () => this.prev());
        ms.setActionHandler("nexttrack", () => this.next());
      } catch (e) {}
    }
    _mediaMeta() {
      const it = this.item();
      if (!it || !("mediaSession" in navigator) || typeof MediaMetadata === "undefined") return;
      try { navigator.mediaSession.metadata = new MediaMetadata({ title: it.title || "", artist: it.artist || "", album: it.label || "" }); } catch (e) {}
    }
  }

  global.Player = Player;
})(window);
