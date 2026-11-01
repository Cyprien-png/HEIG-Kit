/** The soundtrack of a video: spoken lines (16-bit mono WAV, as Piper writes them) placed at their time in the video. */

export interface Wav {
  rate: number;
  pcm: Buffer;
}

/** Reads a 16-bit mono PCM WAV file. */
export function parseWav(file: Buffer): Wav {
  if (file.toString("latin1", 0, 4) !== "RIFF" || file.toString("latin1", 8, 12) !== "WAVE") throw new Error("Not a WAV file");
  let rate: number | undefined;
  for (let at = 12; at + 8 <= file.length; ) {
    const id = file.toString("latin1", at, at + 4);
    const size = file.readUInt32LE(at + 4);
    const body = at + 8;
    if (id === "fmt ") {
      const [format, channels, bits] = [file.readUInt16LE(body), file.readUInt16LE(body + 2), file.readUInt16LE(body + 14)];
      if (format !== 1 || channels !== 1 || bits !== 16) throw new Error("Expected a 16-bit mono PCM WAV file");
      rate = file.readUInt32LE(body + 4);
    } else if (id === "data") {
      if (!rate) throw new Error("WAV file without format");
      return { rate, pcm: file.subarray(body, body + size) };
    }
    at = body + size + (size % 2); // chunks are aligned on even offsets
  }
  throw new Error("WAV file without audio");
}

export function wavSeconds(wav: Wav): number {
  return wav.pcm.length / 2 / wav.rate;
}

/** A WAV file of `seconds` (or longer if a line ends later) with each line starting at its time. */
export function buildTrack(lines: { time: number; wav: Wav }[], seconds: number): Buffer {
  const rate = lines[0]?.wav.rate ?? 22050;
  const end = Math.max(seconds, ...lines.map((l) => l.time + wavSeconds(l.wav)));
  const pcm = Buffer.alloc(Math.ceil(end * rate) * 2);
  for (const { time, wav } of lines) {
    if (wav.rate !== rate) throw new Error("The spoken lines do not have the same sample rate");
    wav.pcm.copy(pcm, Math.round(time * rate) * 2);
  }
  const header = Buffer.alloc(44);
  header.write("RIFF", 0, "latin1");
  header.writeUInt32LE(36 + pcm.length, 4);
  header.write("WAVEfmt ", 8, "latin1");
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(1, 22);
  header.writeUInt32LE(rate, 24);
  header.writeUInt32LE(rate * 2, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  header.write("data", 36, "latin1");
  header.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([header, pcm]);
}
