-- Migration: 0002_profile_fields
-- Adds extended profile columns to the users table.

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS age                 SMALLINT,
  ADD COLUMN IF NOT EXISTS gender              VARCHAR(20),
  ADD COLUMN IF NOT EXISTS blood_group         VARCHAR(5),
  ADD COLUMN IF NOT EXISTS emergency_contact   VARCHAR(150),
  ADD COLUMN IF NOT EXISTS health_conditions   TEXT;