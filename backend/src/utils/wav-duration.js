/**
 * Parse WAV duration (seconds) from a header buffer.
 *
 * Returns a floating-point seconds value or null if not parseable.
 * This is a lightweight parser that reads the RIFF/WAVE container, finds `fmt ` and `data` chunks,
 * and computes duration as dataSize / byteRate.
 */
export function parseWavDurationSeconds(buf) {
  try {
    if (!buf || buf.length < 12) return null;
    const riff = buf.toString('ascii', 0, 4);
    const wave = buf.toString('ascii', 8, 12);
    if (riff !== 'RIFF' || wave !== 'WAVE') return null;

    let byteRate = null;
    let dataSize = null;

    let offset = 12;
    while (offset + 8 <= buf.length) {
      const chunkId = buf.toString('ascii', offset, offset + 4);
      const chunkSize = buf.readUInt32LE(offset + 4);
      offset += 8;

      if (chunkId === 'fmt ') {
        // We only need the first 16 bytes of fmt to read byteRate (at offset + 8).
        // If the full fmt chunk isn't present in the buffer, bail (caller can provide a larger buffer).
        if (chunkSize >= 16) {
          if (offset + 12 <= buf.length) {
            byteRate = buf.readUInt32LE(offset + 8);
          } else {
            break;
          }
        }
      } else if (chunkId === 'data') {
        // For duration we only need the `data` chunk size from the header.
        // We do NOT need the actual audio bytes in the buffer.
        dataSize = chunkSize;
        break;
      } else if (offset + chunkSize > buf.length) {
        // Not enough bytes in header window to fully parse this non-data chunk.
        break;
      }

      offset += chunkSize;
      if (chunkSize % 2 === 1) offset += 1; // padding byte
    }

    if (!byteRate || !dataSize) return null;
    const duration = dataSize / byteRate;
    return Number.isFinite(duration) && duration > 0 ? duration : null;
  } catch {
    return null;
  }
}

/**
 * Convenience wrapper returning integer seconds for billing.
 * Uses Math.ceil to avoid undercounting.
 */
export function wavDurationSecondsToBillingSeconds(durationSeconds) {
  if (!Number.isFinite(durationSeconds) || durationSeconds <= 0) return null;
  return Math.ceil(durationSeconds);
}

