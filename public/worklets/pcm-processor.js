class SnowPcmProcessor extends AudioWorkletProcessor {
  process(inputs, outputs) {
    const output = outputs[0]?.[0];
    if (output) {
      output.fill(0);
    }

    const input = inputs[0]?.[0];
    if (input?.length) {
      const copy = new Float32Array(input.length);
      copy.set(input);
      this.port.postMessage(copy, [copy.buffer]);
    }

    return true;
  }
}

registerProcessor("snow-pcm-processor", SnowPcmProcessor);
