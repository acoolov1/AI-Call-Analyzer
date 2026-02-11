# Voicemail Page – Logic and Behavior

Short reference for how the voicemail UI and backend work together.

## Overview

The voicemail page shows FreePBX voicemails per selected user. Data is **DB-first**: mailboxes and message list come from our database; a background sync job keeps the DB in sync with the PBX. No AI analysis—only **transcription** (Whisper); the UI shows a single transcript per message.

---

## Data Flow

1. **Mailboxes** – `GET /api/v1/integrations/freepbx/voicemail/mailboxes-db` returns per-mailbox counts: **new** (INBOX, not listened) and **old** (Old folder or listened). Frontend shows extension cards (e.g. "200 Eduard Akulov") with "X new • Y old".
2. **Messages** – Selecting a mailbox calls `GET .../messages-db?mailbox=200`. Messages are **sorted**: INBOX first, then by received date newest first. Selection is by **message ID**; the list does not reorder when you click a row.
3. **Selection** – `selectedMessageId` tracks the active row. The detail panel and audio player show the message for that ID. Duration in the player is pre-filled from `durationSeconds` when the selection changes so total time shows without loading the file.

---

## Play = Mark as Listened

When the user presses **play** on an INBOX message:

1. **Optimistic UI** – The message is immediately updated in local state to `folder: 'Old'`, so the purple "new" dot disappears and list order is unchanged. Mailbox counts are updated optimistically (new −1, old +1).
2. **Backend** – Frontend sends `PATCH .../messages/:id` with `{ listened: true }`. Backend:
   - Moves the recording on the **PBX** from INBOX to **Old** using the **next free slot** (e.g. `msg0002`) so existing Old messages are never overwritten.
   - Updates the **DB** row: `folder: 'Old'`, `msg_id` = new slot, paths updated, `listened_at` set.
3. **Audio** – Play is triggered **after** the PATCH succeeds so the audio URL is requested when the DB already has the Old path (avoids "file not found" race).
4. **On failure** – If the PATCH fails, the frontend reverts the message back to INBOX so the dot and counts are correct again.

---

## Backend (Summary)

- **Sync job** – Periodically lists INBOX + Old on the PBX per mailbox, upserts into `voicemail_messages`, and deletes DB rows no longer seen on the PBX (`last_seen_at`).
- **Processing job** – Picks pending rows, downloads the recording, runs **Whisper only** (no redaction, no analysis), and saves `transcript`; `analysis` is left empty.
- **Move to Old** – Uses SSH to run a small script: find next free `msgNNNN` in Old, move and rename INBOX files into that slot, return the new `msg_id` so the controller can update the row.

---

## UI Details

- **Extension cards** – Title = mailbox + selected user name (e.g. "200 Eduard Akulov"). When a mailbox has new messages, "X new" is shown in the app purple and bold.
- **Message list** – Each row: bold caller line (internal = "200 Name", external = full caller ID), then sub line: timestamp • duration • filename (e.g. `Old/msg0002`). Purple dot only for INBOX; status line only for pending/transcribing.
- **Detail panel** – Same title/sub format as the list. Transcript only; no analysis block.
- **Settings** – "Enable voicemail transcribing" toggle (app purple when on). Sync interval and folders (INBOX, Old) configure what the sync job lists.

---

## Key Files

| Layer   | Path |
|--------|------|
| Frontend | `frontend/app/(dashboard)/voicemail/page.tsx` |
| API proxy | `frontend/app/api/v1/integrations/freepbx/voicemail/messages/[id]/route.ts`, `frontend/app/api/voicemail-audio/[id]/route.ts` |
| Backend controller | `backend/src/controllers/freepbx-voicemail.controller.js` |
| Move on PBX | `backend/src/services/freepbx-voicemail.service.js` (`moveVoicemailToOldOnPbx`) |
| Transcribe only | `backend/src/services/voicemail-processing.service.js` |
| Sync + processing jobs | `backend/src/jobs/freepbx-voicemail.job.js` |
