-- Fictitious seed data for demo/testing. Run after schema.sql.
-- Password for the lecturer account below is: Lecturer#2026
-- (bcrypt hash generated with cost factor 12 — see src/utils/hashSeedPassword.js
--  if you need to regenerate it.)
USE student_registration;

INSERT INTO accounts (student_id, username, password_hash, role, is_active)
VALUES (
  NULL,
  'lecturer1',
  '$2b$12$W8N0m8s0z2m8f1yV8B0hxOQxG4t9m8mYV2z1kzYV0kq0m0f7pQm0e', -- placeholder, regenerate before use
  'lecturer',
  1
);

-- Fictitious claim codes
-- Generic self-service codes (no pre-existing lecturer record)
INSERT INTO claim_codes (claim_code, student_number) VALUES
  ('CLAIM-AAA111', NULL),
  ('CLAIM-BBB222', NULL),
  ('CLAIM-CCC333', NULL);

-- A student the lecturer pre-entered; the real student must claim it
-- with this code, not create a second profile.
INSERT INTO students (student_id, student_number, student_name, program_id, group_id, status, version)
VALUES ('11111111-1111-4111-8111-111111111111', '200912345', 'Chanda Mwape',
        (SELECT program_id FROM programmes WHERE program_code = 'CS'),
        (SELECT group_id FROM lab_groups WHERE group_code = 'G01'),
        'active', 1);

INSERT INTO claim_codes (claim_code, student_number) VALUES
  ('CLAIM-PRESET-01', '200912345');
