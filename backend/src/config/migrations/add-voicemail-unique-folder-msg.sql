-- Ensure ON CONFLICT (user_id, vm_context, mailbox, folder, msg_id) has a matching constraint.
-- Table may have been created without this (e.g. CREATE TABLE IF NOT EXISTS skipped the constraint).
CREATE UNIQUE INDEX IF NOT EXISTS idx_voicemail_messages_user_folder_msg
  ON voicemail_messages(user_id, vm_context, mailbox, folder, msg_id);
