-- Allow unauthenticated mock-test attempts until user accounts are added.
ALTER TABLE attempts
ALTER COLUMN user_id DROP NOT NULL;
