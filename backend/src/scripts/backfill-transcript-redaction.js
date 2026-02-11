import { getPool } from '../config/database.js';
import { logger } from '../utils/logger.js';
import { PciRedactionService } from '../services/pci-redaction.service.js';

/**
 * Backfill transcript/analysis redaction for already-processed calls.
 *
 * This updates ONLY text fields (transcript + analysis) to their sanitized versions.
 * It does NOT attempt to re-download/re-mute audio or upload replacements.
 *
 * Usage:
 *   node src/scripts/backfill-transcript-redaction.js --call-id <uuid>
 *   node src/scripts/backfill-transcript-redaction.js --user-id <uuid> [--limit 500]
 */

function getArg(flag) {
  const idx = process.argv.indexOf(flag);
  if (idx === -1) return null;
  return process.argv[idx + 1] || null;
}

async function main() {
  const callId = getArg('--call-id');
  const userId = getArg('--user-id');
  const limitRaw = getArg('--limit');
  const limit = limitRaw ? Math.max(1, Math.min(parseInt(limitRaw, 10) || 500, 5000)) : 500;

  if (!callId && !userId) {
    console.error('Provide --call-id <uuid> or --user-id <uuid>');
    process.exit(1);
  }

  const pool = getPool();

  let rows = [];
  if (callId) {
    const res = await pool.query(
      'SELECT id, transcript, analysis FROM calls WHERE id = $1',
      [callId]
    );
    rows = res.rows;
  } else {
    const res = await pool.query(
      `SELECT id, transcript, analysis
       FROM calls
       WHERE user_id = $1
         AND (transcript IS NOT NULL OR analysis IS NOT NULL)
       ORDER BY COALESCE(external_created_at, created_at) DESC
       LIMIT $2`,
      [userId, limit]
    );
    rows = res.rows;
  }

  let updated = 0;
  for (const r of rows) {
    const transcript = r.transcript || '';
    const analysis = r.analysis || '';
    const sanitizedTranscript = transcript ? PciRedactionService.sanitizeTranscriptText(transcript) : transcript;
    const sanitizedAnalysis = analysis ? PciRedactionService.sanitizeTranscriptText(analysis) : analysis;

    if (sanitizedTranscript !== transcript || sanitizedAnalysis !== analysis) {
      await pool.query(
        `UPDATE calls
         SET transcript = $1,
             analysis = $2,
             updated_at = NOW()
         WHERE id = $3`,
        [sanitizedTranscript, sanitizedAnalysis, r.id]
      );
      updated += 1;
    }
  }

  logger.info({ scanned: rows.length, updated }, 'Backfill transcript redaction completed');
  console.log(`Scanned: ${rows.length}, Updated: ${updated}`);
}

main().catch((err) => {
  console.error('Backfill failed:', err?.message || err);
  process.exit(1);
});

