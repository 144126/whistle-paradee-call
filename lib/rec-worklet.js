// AudioWorklet that posts the microphone to the page in 20 ms frames.

registerProcessor("rec", class extends AudioWorkletProcessor {
  buf = new Float32Array(Math.round(sampleRate * 0.02));
  n = 0;
  process(inputs) {
    const ch = inputs[0][0];
    if (!ch) return true;
    for (let i = 0; i < ch.length; i++) {
      this.buf[this.n++] = ch[i];
      if (this.n === this.buf.length) { this.port.postMessage(this.buf.slice()); this.n = 0; }
    }
    return true;
  }
});
