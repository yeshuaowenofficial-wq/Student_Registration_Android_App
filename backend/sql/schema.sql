-- ICT361 Android Group Lab — Backend/Database team
-- MySQL 8 / InnoDB schema
-- Run as: mysql -u root -p < schema.sql

CREATE DATABASE IF NOT EXISTS student_registration
  CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
USE student_registration;

-- ---------------------------------------------------------------------
-- Reference data
-- ---------------------------------------------------------------------

CREATE TABLE programmes (
  program_id    INT AUTO_INCREMENT PRIMARY KEY,
  program_code  VARCHAR(10)  NOT NULL UNIQUE,   -- CS, IT, DS
  program_name  VARCHAR(100) NOT NULL
) ENGINE=InnoDB;

CREATE TABLE lab_groups (
  group_id    INT AUTO_INCREMENT PRIMARY KEY,
  group_code  VARCHAR(10) NOT NULL UNIQUE,      -- G01, G02, G03, G04
  capacity    INT NOT NULL DEFAULT 15
) ENGINE=InnoDB;

-- ---------------------------------------------------------------------
-- Students — student_id is an immutable surrogate key, independent of
-- the human-readable student_number (which the student cannot self-edit).
-- ---------------------------------------------------------------------

CREATE TABLE students (
  student_id      CHAR(36)     NOT NULL PRIMARY KEY,        -- UUID, never reused/changed
  student_number  CHAR(9)      NOT NULL,                    -- 9 digits, leading zeroes preserved
  student_name    VARCHAR(100) NOT NULL,
  program_id      INT          NOT NULL,
  group_id        INT          NULL,                        -- NULL = Unassigned
  status          ENUM('active','deleted') NOT NULL DEFAULT 'active',
  version         INT          NOT NULL DEFAULT 1,           -- optimistic-lock / sync base version
  deleted_at      DATETIME     NULL,                         -- deletion marker retained for sync
  created_at      TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at      TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP
                               ON UPDATE CURRENT_TIMESTAMP,

  CONSTRAINT fk_students_program FOREIGN KEY (program_id)
      REFERENCES programmes(program_id),
  CONSTRAINT fk_students_group FOREIGN KEY (group_id)
      REFERENCES lab_groups(group_id),

  -- student_number stays UNIQUE forever, even for soft-deleted rows,
  -- so a released number can never be accidentally re-registered.
  CONSTRAINT uq_student_number UNIQUE (student_number),

  INDEX idx_students_name (student_name),
  INDEX idx_students_group_status (group_id, status),
  INDEX idx_students_program_status (program_id, status)
) ENGINE=InnoDB;

-- ---------------------------------------------------------------------
-- Accounts — login identity. student_id is NULL for lecturer accounts.
-- One account per student (enforced by UNIQUE on student_id).
-- ---------------------------------------------------------------------

CREATE TABLE accounts (
  account_id     INT AUTO_INCREMENT PRIMARY KEY,
  student_id     CHAR(36)     NULL UNIQUE,
  username       VARCHAR(100) NOT NULL UNIQUE,
  password_hash  VARCHAR(255) NOT NULL,          -- bcrypt hash, never plaintext
  role           ENUM('student','lecturer') NOT NULL,
  is_active      TINYINT(1)   NOT NULL DEFAULT 1,
  last_login_at  DATETIME     NULL,
  created_at     TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT fk_accounts_student FOREIGN KEY (student_id)
      REFERENCES students(student_id)
) ENGINE=InnoDB;

-- ---------------------------------------------------------------------
-- Claim codes — fictitious codes used to verify ownership at registration.
-- A row with student_number set was pre-issued by a lecturer for a
-- record already entered; a row with student_number NULL is a generic
-- self-service code. Each code can be used exactly once.
-- ---------------------------------------------------------------------

CREATE TABLE claim_codes (
  claim_code      VARCHAR(20) NOT NULL PRIMARY KEY,
  student_number  CHAR(9)     NULL,
  used_at         DATETIME    NULL,
  used_by_student CHAR(36)    NULL,

  CONSTRAINT fk_claim_used_by FOREIGN KEY (used_by_student)
      REFERENCES students(student_id)
) ENGINE=InnoDB;

-- ---------------------------------------------------------------------
-- Correction requests — students cannot edit their own student_number;
-- they raise a request a lecturer must action.
-- ---------------------------------------------------------------------

CREATE TABLE correction_requests (
  request_id      INT AUTO_INCREMENT PRIMARY KEY,
  student_id      CHAR(36)    NOT NULL,
  requested_by    INT         NOT NULL,           -- accounts.account_id
  field_name      VARCHAR(50) NOT NULL,           -- e.g. 'student_number'
  current_value   VARCHAR(100) NOT NULL,
  requested_value VARCHAR(100) NOT NULL,
  status          ENUM('pending','approved','rejected') NOT NULL DEFAULT 'pending',
  resolved_by     INT NULL,
  resolved_at     DATETIME NULL,
  created_at      TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT fk_corr_student FOREIGN KEY (student_id) REFERENCES students(student_id),
  CONSTRAINT fk_corr_requested_by FOREIGN KEY (requested_by) REFERENCES accounts(account_id),
  CONSTRAINT fk_corr_resolved_by FOREIGN KEY (resolved_by) REFERENCES accounts(account_id)
) ENGINE=InnoDB;

-- ---------------------------------------------------------------------
-- Sync events — an append-only feed of changes so mobile clients can
-- pull authorised updates and deletion markers since a given point.
-- ---------------------------------------------------------------------

CREATE TABLE sync_events (
  event_id       BIGINT AUTO_INCREMENT PRIMARY KEY,
  student_id     CHAR(36) NOT NULL,
  event_type     ENUM('created','updated','group_changed','deleted') NOT NULL,
  event_version  INT NOT NULL,
  event_payload  JSON NULL,
  created_at     TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT fk_sync_student FOREIGN KEY (student_id) REFERENCES students(student_id),
  INDEX idx_sync_created (created_at)
) ENGINE=InnoDB;

-- ---------------------------------------------------------------------
-- Operation receipts — idempotency store. The mobile client sends a
-- client-generated operation_id with every mutating request; the server
-- stores the outcome so a retried request (e.g. after a dropped
-- response) replays the same result instead of applying it twice, and
-- reuse of the same id with different content is rejected.
-- ---------------------------------------------------------------------

CREATE TABLE operation_receipts (
  operation_id     CHAR(36)   NOT NULL PRIMARY KEY,
  account_id       INT        NOT NULL,
  endpoint         VARCHAR(150) NOT NULL,
  request_hash     CHAR(64)   NOT NULL,   -- sha256 of method+path+body
  response_status  INT        NOT NULL,
  response_body    JSON       NOT NULL,
  created_at       TIMESTAMP  NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT fk_receipt_account FOREIGN KEY (account_id) REFERENCES accounts(account_id)
) ENGINE=InnoDB;

-- ---------------------------------------------------------------------
-- Seed reference data
-- ---------------------------------------------------------------------

INSERT INTO programmes (program_code, program_name) VALUES
  ('CS', 'Computer Science'),
  ('IT', 'Information Technology'),
  ('DS', 'Data Science');

INSERT INTO lab_groups (group_code, capacity) VALUES
  ('G01', 15), ('G02', 15), ('G03', 15), ('G04', 15);
