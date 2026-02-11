# System Monitor (Admin)

The **System Monitor** page is a **super-admin-only** dashboard for:

- A **live snapshot** of server health (CPU, memory, disk, services, top processes).
- A **historic chart** showing **hourly averages** for CPU%, Memory%, and Disk%.

## Where it lives

- **UI**: `Settings → System Monitor` (`/settings/system`)
- **Live snapshot API**: `GET /api/v1/admin/system`
- **History API**: `GET /api/v1/admin/system/history?startDate=&endDate=`

## How history is collected

- The backend records a lightweight sample **every 10 minutes** at wall‑clock boundaries:
  - `:00, :10, :20, :30, :40, :50`
- Samples are stored in the database table **`system_metrics_samples`**.
- A retention policy prunes samples older than **30 days**.

### What is stored per sample

Only the data needed for the chart:

- `cpu_percent`
- `memory_percent`
- `disk_percent`
- `recorded_at`

The “Top processes” and “Services status” panels remain **live snapshot only** (not stored historically).

## How hourly averages are calculated

The history endpoint aggregates samples using SQL:

- `AVG(cpu_percent)`
- `AVG(memory_percent)`
- `AVG(disk_percent)`

grouped by `date_trunc('hour', recorded_at)`.

## After a reboot

- The chart **does not reset** (history is persisted in Postgres).
- You’ll see a **gap** for downtime (no samples while the server is offline).
- Sampling resumes automatically when the backend process starts (PM2 restart/boot).

