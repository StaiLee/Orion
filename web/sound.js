// Orion — moteur de son synthétisé (Web Audio, aucun fichier asset).
// Sons d'alerte par sévérité + grondement de supernova. Désactivé par défaut.
// L'AudioContext doit être démarré sur un geste utilisateur (le toggle).

export class SoundEngine {
  constructor() { this.enabled = false; this.ctx = null; }

  enable() {
    this.enabled = true;
    if (!this.ctx) this.ctx = new (window.AudioContext || window.webkitAudioContext)();
    if (this.ctx.state === 'suspended') this.ctx.resume();
  }

  disable() { this.enabled = false; }

  _tone(freq, dur, type = 'sine', gain = 0.06) {
    if (!this.enabled || !this.ctx) return;
    const o = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    o.type = type; o.frequency.value = freq;
    o.connect(g); g.connect(this.ctx.destination);
    const t = this.ctx.currentTime;
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.start(t); o.stop(t + dur + 0.02);
  }

  alert(severity) {
    if (severity === 'critical') {
      this._tone(740, 0.18, 'square', 0.05);
      setTimeout(() => this._tone(880, 0.24, 'square', 0.05), 140);
    } else if (severity === 'high') {
      this._tone(520, 0.16, 'triangle', 0.045);
    }
  }

  supernova() {
    this._tone(120, 0.6, 'sawtooth', 0.09);
    setTimeout(() => this._tone(68, 0.9, 'sine', 0.08), 70);
  }
}
