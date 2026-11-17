/**
 * The WAV container of the recorded audio (spec §15.1, Milestone 8).
 *
 * The local speech engine reads a WAV file from its standard input, so the
 * samples are wrapped in a minimal, canonical header: 16 kHz, mono, 16 bit
 * signed PCM. The header is built in the main process — the renderer never
 * writes a file and the audio never touches the disk.
 */
import { SPEECH_SAMPLE_RATE } from '../../shared/voice-types';

/** The size of the canonical WAV header (bytes). */
export const WAV_HEADER_BYTES = 44;

/**
 * Wraps 16 bit samples in a WAV file.
 *
 * @param samples The samples (mono, 16 bit signed).
 * @param sampleRate The rate of the samples (16 kHz by default).
 * @returns The bytes of the WAV file.
 */
export function encodeWav(
  samples: Int16Array,
  sampleRate: number = SPEECH_SAMPLE_RATE,
): Buffer {
  const dataBytes = samples.length * 2;
  const buffer = Buffer.alloc(WAV_HEADER_BYTES + dataBytes);
  buffer.write('RIFF', 0, 'ascii');
  // The size of the file minus the first eight bytes.
  buffer.writeUInt32LE(36 + dataBytes, 4);
  buffer.write('WAVE', 8, 'ascii');
  buffer.write('fmt ', 12, 'ascii');
  // The size of the format block (PCM).
  buffer.writeUInt32LE(16, 16);
  // Format 1 = PCM.
  buffer.writeUInt16LE(1, 20);
  // One channel (mono).
  buffer.writeUInt16LE(1, 22);
  buffer.writeUInt32LE(sampleRate, 24);
  // Bytes per second: rate × channels × 2.
  buffer.writeUInt32LE(sampleRate * 2, 28);
  // Bytes per frame: channels × 2.
  buffer.writeUInt16LE(2, 32);
  // Bits per sample.
  buffer.writeUInt16LE(16, 34);
  buffer.write('data', 36, 'ascii');
  buffer.writeUInt32LE(dataBytes, 40);
  for (let index = 0; index < samples.length; index += 1) {
    buffer.writeInt16LE(samples[index] ?? 0, WAV_HEADER_BYTES + index * 2);
  }
  return buffer;
}
