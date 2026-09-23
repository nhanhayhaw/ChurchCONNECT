-- ============================================================================
-- 002 - Account invitations
--
-- Reuses the existing password_resets table rather than adding a parallel one:
-- an invitation and a password reset are the same mechanism (a single-use,
-- expiring, hashed token that authorises setting a password). Only three things
-- differ, and all three follow from `purpose`:
--
--   * the wording of the email
--   * the wording of the page the recipient lands on
--   * the lifetime (an invitation lasts days, a reset lasts an hour)
--
-- Additive and safe on a populated database: existing rows become 'reset',
-- which is what they are.
-- ============================================================================

BEGIN;

ALTER TABLE password_resets
  ADD COLUMN IF NOT EXISTS purpose VARCHAR(20) NOT NULL DEFAULT 'reset'
    CHECK (purpose IN ('reset', 'invite'));

-- Who issued an invitation. Null for self-service resets, which nobody issues.
ALTER TABLE password_resets
  ADD COLUMN IF NOT EXISTS created_by BIGINT REFERENCES users(id) ON DELETE SET NULL;

COMMENT ON COLUMN password_resets.purpose IS
  'reset = the user asked to recover their own account; invite = an administrator created the account and the user has not set a password yet.';

-- Supports "does this user have an invitation outstanding?", which drives the
-- Resend invitation action and the Invitation pending badge.
CREATE INDEX IF NOT EXISTS idx_password_resets_open
  ON password_resets (user_id, purpose)
  WHERE used_at IS NULL;

COMMIT;
