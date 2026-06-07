import { TARGET_SAMPLE_RATE } from "../../shared/constants";

export async function blobToMono16Khz(blob: Blob): Promise<Float32Array> {
  const arrayBuffer = await blob.arrayBuffer();
  const decodeContext = new AudioContext();
  const audioBuffer = await decodeContext.decodeAudioData(arrayBuffer);
  await decodeContext.close();

  const mono = downmixToMono(audioBuffer);

  if (audioBuffer.sampleRate === TARGET_SAMPLE_RATE) {
    return mono;
  }

  return resampleFloat32Mono(mono, audioBuffer.sampleRate, TARGET_SAMPLE_RATE);
}

function downmixToMono(audioBuffer: AudioBuffer) {
  const length = audioBuffer.length;
  const channels = audioBuffer.numberOfChannels;
  const mono = new Float32Array(length);

  for (let channel = 0; channel < channels; channel += 1) {
    const data = audioBuffer.getChannelData(channel);
    for (let index = 0; index < length; index += 1) {
      mono[index] += data[index] / channels;
    }
  }

  return mono;
}

export function resampleFloat32Mono(input: Float32Array, fromRate: number, toRate = TARGET_SAMPLE_RATE) {
  const ratio = fromRate / toRate;
  const outputLength = Math.round(input.length / ratio);
  const output = new Float32Array(outputLength);

  for (let index = 0; index < outputLength; index += 1) {
    const sourceIndex = index * ratio;
    const before = Math.floor(sourceIndex);
    const after = Math.min(before + 1, input.length - 1);
    const weight = sourceIndex - before;
    output[index] = input[before] * (1 - weight) + input[after] * weight;
  }

  return output;
}
