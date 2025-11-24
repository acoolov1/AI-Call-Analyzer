# FreePBX Integration Notes

## Platform Baseline

- **PBX Version:** 16.0.41.1  
- **PBX Distro:** 12.7.8-2204-1.sng7  
- **Asterisk Version:** 16.25.0

These versions ship with Asterisk ARI/AMI endpoints enabled by default (though the
listener may be disabled in `ari.conf`/`manager.conf`). The integration outlined
in this repo expects at least feature parity with this stack.

## Credentials & Network Requirements

| Item | Description | Notes |
|------|-------------|-------|
| Hostname / IP | Reachable address of the FreePBX/Asterisk server | Prefer private network or VPN |
| ARI Port | Default `8088` (HTTP) / `8089` (HTTPS) | Enable TLS whenever possible |
| AMI Port | Default `5038` | Only needed if we later consume AMI events |
| Username / Password | `ari.conf` user entry with `read_only` or `read_write` as needed | Create dedicated user such as `aicall` |
| TLS Certificate | Optional but recommended | Upload to backend so node-fetch/axios trusts the PBX |

Firewall rules must allow the backend host to connect to the ARI endpoint. No RTP
ports are required because we are only downloading recordings, not proxying calls.

## API Surface Needed

1. **Recording listing**  
   - `GET /ari/recordings/stored` returns metadata + file names.  
   - Filter by `date_created` to limit payload.

2. **Recording download**  
   - `GET /ari/recordings/stored/{recordingName}` streams the file (WAV by default).

3. **(Optional) Call Details**  
   - `GET /ari/channels/{id}` or reading from the CDR database if richer metadata is required.

The backend will normalize ARI responses into the shared calls schema. For Asterisk
deployments that store recordings in custom directories, ensure the ARI user has
rights to access those files.

## Frontend Configuration Steps

1. Sign in to the dashboard and open **Settings ▸ FreePBX Integration**.
2. Fill in the host, port, username, and password that match `ari.conf`.
3. Click **Save settings** – credentials are stored encrypted per-user.
4. Use **Test Connection** to confirm the ARI endpoint is reachable.
5. Navigate to **Interactions** and click **Sync FreePBX** to pull recordings immediately.
6. Automatic sync runs every `FREEPBX_SYNC_INTERVAL_MINUTES` (default 10 minutes).

Calls sourced from FreePBX display a `FreePBX` badge in the call list and behave
identically to Twilio calls (audio playback, transcript, AI analysis).

## Manual Testing Checklist

1. Place a call that FreePBX records to disk (ensure the ARI user can read it).
2. In the dashboard, click **Sync FreePBX** and wait for the toast confirmation.
3. Verify the new call appears under Interactions with the FreePBX badge.
4. Expand the row to confirm audio playback works (proxied through `/api/audio/:id`).
5. Ensure the transcript and AI summary are generated (status switches to **Completed**).

## Future Considerations

- If near-real-time ingestion is needed, expose AMI events or custom FreePBX hooks
  that call the backend when a recording is finalized.
- Multi-tenant deployments should scope ARI users per PBX to avoid cross-account
  leakage.

