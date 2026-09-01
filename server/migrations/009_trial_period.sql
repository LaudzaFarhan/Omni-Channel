-- Custom trial period and trial expiration timestamp per user.
--
-- Lets an admin set a custom trial duration (in days) or specific expiration timestamp
-- for any user, overriding the plan's default trial period.

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS trial_ends_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS custom_trial_days INTEGER CHECK (custom_trial_days IS NULL OR custom_trial_days >= 0);

COMMENT ON COLUMN users.trial_ends_at IS
  'Custom timestamp when this user''s trial period expires. NULL falls back to plan trial_days and created_at.';

COMMENT ON COLUMN users.custom_trial_days IS
  'Custom trial length in days granted by admin. NULL means user follows plan trial_days.';
