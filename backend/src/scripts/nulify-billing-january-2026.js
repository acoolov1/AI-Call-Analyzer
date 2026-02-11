import { query, getPool, closePool } from '../config/database.js';

async function nulifyJanuary2026() {
  console.log('🧾 Nullifying billing_months for January 2026 (month=2026-01-01) for ALL users...');

  try {
    // Initialize pool
    getPool();

    const month = '2026-01-01';

    const upsertSql = `
      INSERT INTO billing_months (
        user_id,
        month,
        base_plan_monthly_charge_usd,
        base_plan_included_audio_hours,
        audio_seconds,
        audio_minutes,
        overage_seconds,
        overage_minutes,
        overage_charge_usd,
        total_charge_usd,
        is_finalized,
        calculated_at,
        updated_at
      )
      SELECT
        u.id AS user_id,
        $1::date AS month,
        0::numeric AS base_plan_monthly_charge_usd,
        0::numeric AS base_plan_included_audio_hours,
        0::bigint AS audio_seconds,
        0::numeric AS audio_minutes,
        0::bigint AS overage_seconds,
        0::numeric AS overage_minutes,
        0::numeric AS overage_charge_usd,
        0::numeric AS total_charge_usd,
        true AS is_finalized,
        NOW() AS calculated_at,
        NOW() AS updated_at
      FROM users u
      ON CONFLICT (user_id, month) DO UPDATE SET
        base_plan_monthly_charge_usd = 0,
        base_plan_included_audio_hours = 0,
        audio_seconds = 0,
        audio_minutes = 0,
        overage_seconds = 0,
        overage_minutes = 0,
        overage_charge_usd = 0,
        total_charge_usd = 0,
        is_finalized = true,
        calculated_at = NOW(),
        updated_at = NOW()
    `;

    await query(upsertSql, [month]);

    const verify = await query(
      `
        SELECT
          COUNT(*)::bigint AS row_count,
          COALESCE(SUM(CASE WHEN
            COALESCE(base_plan_monthly_charge_usd, 0) <> 0 OR
            COALESCE(base_plan_included_audio_hours, 0) <> 0 OR
            COALESCE(audio_seconds, 0) <> 0 OR
            COALESCE(audio_minutes, 0) <> 0 OR
            COALESCE(overage_seconds, 0) <> 0 OR
            COALESCE(overage_minutes, 0) <> 0 OR
            COALESCE(overage_charge_usd, 0) <> 0 OR
            COALESCE(total_charge_usd, 0) <> 0 OR
            COALESCE(is_finalized, false) <> true
          THEN 1 ELSE 0 END), 0)::bigint AS non_zero_rows
        FROM billing_months
        WHERE month = $1::date
      `,
      [month]
    );

    const rowCount = Number(verify.rows?.[0]?.row_count ?? 0);
    const nonZero = Number(verify.rows?.[0]?.non_zero_rows ?? 0);

    console.log(`✅ Done. billing_months rows for ${month}: ${rowCount}`);
    if (nonZero === 0) {
      console.log('✅ Verification OK: all rows are zeroed and finalized.');
    } else {
      console.log(`⚠️  Verification warning: ${nonZero} rows are not fully zeroed/finalized.`);
    }
  } catch (error) {
    console.error('❌ Failed to nullify January 2026 billing:', error?.message || error);
    throw error;
  } finally {
    await closePool();
  }
}

nulifyJanuary2026();

