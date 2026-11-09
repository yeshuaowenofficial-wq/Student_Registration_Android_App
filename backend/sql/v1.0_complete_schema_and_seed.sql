-- ================================================================================
-- CAMPUS COMPANION — DATABASE VERSION 1.0 (BASELINE RELEASE)
-- ================================================================================
-- Database Engine: MySQL 8.0+ / InnoDB
-- Character Set:   utf8mb4 / utf8mb4_unicode_ci
-- Release Tag:     v1.0.0 (Consolidated Authoritative Baseline)
--
-- USAGE:
--   mysql -u root -p < v1.0_complete_schema_and_seed.sql
-- ================================================================================

CREATE DATABASE IF NOT EXISTS student_registration
  CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
USE student_registration;

-- --------------------------------------------------------------------------------
-- 0. SCHEMA VERSION TRACKING
-- --------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS schema_version (
  version_id   INT AUTO_INCREMENT PRIMARY KEY,
  version_tag  VARCHAR(20) NOT NULL UNIQUE,
  description  VARCHAR(255) NOT NULL,
  applied_at   TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB;

DELETE FROM schema_version WHERE version_tag = '1.0.0';
INSERT INTO schema_version (version_tag, description)
VALUES ('1.0.0', 'Campus Companion V1.0.0 Official Production Baseline');

-- --------------------------------------------------------------------------------
-- 1. REFERENCE TABLES: PROGRAMMES & LAB GROUPS
-- --------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS programmes (
  program_id    INT AUTO_INCREMENT PRIMARY KEY,
  program_code  VARCHAR(10)  NOT NULL UNIQUE,   -- CS, IT, DS
  program_name  VARCHAR(100) NOT NULL
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS lab_groups (
  group_id      INT AUTO_INCREMENT PRIMARY KEY,
  group_code    VARCHAR(10) NOT NULL UNIQUE,      -- G01, G02, G03, G04
  capacity      INT NOT NULL DEFAULT 15,          -- Strict 15 capacity rule
  schedule_day  ENUM('MON','TUE','WED','THU','FRI','SAT') NULL,
  start_time    TIME        NULL,
  end_time      TIME        NULL,
  room          VARCHAR(60) NULL
) ENGINE=InnoDB;

-- --------------------------------------------------------------------------------
-- 2. STUDENTS TABLE
-- --------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS students (
  student_id      CHAR(36)     NOT NULL PRIMARY KEY,        -- UUID
  student_number  CHAR(9)      NOT NULL UNIQUE,             -- Exactly 9 digits
  student_name    VARCHAR(100) NOT NULL,
  program_id      INT          NOT NULL,
  group_id        INT          NULL,                        -- NULL = Unassigned
  status          ENUM('active','deleted') NOT NULL DEFAULT 'active',
  version         INT          NOT NULL DEFAULT 1,          -- Optimistic locking
  deleted_at      DATETIME     NULL,
  created_at      TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at      TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

  CONSTRAINT fk_students_program FOREIGN KEY (program_id) REFERENCES programmes(program_id),
  CONSTRAINT fk_students_group FOREIGN KEY (group_id) REFERENCES lab_groups(group_id),
  INDEX idx_students_name (student_name),
  INDEX idx_students_group_status (group_id, status),
  INDEX idx_students_program_status (program_id, status)
) ENGINE=InnoDB;

-- --------------------------------------------------------------------------------
-- 3. ACCOUNTS (AUTH IDENTITY)
-- --------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS accounts (
  account_id     INT AUTO_INCREMENT PRIMARY KEY,
  student_id     CHAR(36)     NULL UNIQUE,
  username       VARCHAR(100) NOT NULL UNIQUE,
  display_name   VARCHAR(100) NULL,
  avatar         VARCHAR(40)  NULL,                         -- e.g. 'cat-1', 'dog-1'
  password_hash  VARCHAR(255) NOT NULL,                     -- bcrypt hash
  role           ENUM('student','lecturer') NOT NULL,
  is_active      TINYINT(1)   NOT NULL DEFAULT 1,
  last_login_at  DATETIME     NULL,
  created_at     TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT fk_accounts_student FOREIGN KEY (student_id) REFERENCES students(student_id)
) ENGINE=InnoDB;

-- --------------------------------------------------------------------------------
-- 4. CLAIM CODES (STUDENT OWNERSHIP VERIFICATION)
-- --------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS claim_codes (
  claim_code      VARCHAR(20) NOT NULL PRIMARY KEY,
  student_number  CHAR(9)     NULL,
  used_at         DATETIME    NULL,
  used_by_student CHAR(36)    NULL,

  CONSTRAINT fk_claim_used_by FOREIGN KEY (used_by_student) REFERENCES students(student_id)
) ENGINE=InnoDB;

-- --------------------------------------------------------------------------------
-- 5. CORRECTION & GROUP TRANSFER REQUESTS
-- --------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS correction_requests (
  request_id      INT AUTO_INCREMENT PRIMARY KEY,
  student_id      CHAR(36)    NOT NULL,
  requested_by    INT         NOT NULL,                     -- accounts.account_id
  field_name      VARCHAR(50) NOT NULL,                     -- 'student_number' or 'group_code'
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

-- --------------------------------------------------------------------------------
-- 6. MOBILE SYNC & IDEMPOTENCY
-- --------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS sync_events (
  event_id       BIGINT AUTO_INCREMENT PRIMARY KEY,
  student_id     CHAR(36) NOT NULL,
  event_type     ENUM('created','updated','group_changed','deleted') NOT NULL,
  event_version  INT NOT NULL,
  event_payload  JSON NULL,
  created_at     TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT fk_sync_student FOREIGN KEY (student_id) REFERENCES students(student_id),
  INDEX idx_sync_created (created_at)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS operation_receipts (
  operation_id     CHAR(36)     NOT NULL PRIMARY KEY,
  account_id       INT          NOT NULL,
  endpoint         VARCHAR(150) NOT NULL,
  request_hash     CHAR(64)     NOT NULL,
  response_status  INT          NOT NULL,
  response_body    JSON         NOT NULL,
  created_at       TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT fk_receipt_account FOREIGN KEY (account_id) REFERENCES accounts(account_id)
) ENGINE=InnoDB;

-- --------------------------------------------------------------------------------
-- 7. COURSES, GRADES, ATTENDANCE & TIMETABLE
-- --------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS courses (
  course_id           INT AUTO_INCREMENT PRIMARY KEY,
  course_code         VARCHAR(20)  NOT NULL UNIQUE,
  course_name         VARCHAR(150) NOT NULL,
  lecturer_account_id INT NULL,

  CONSTRAINT fk_courses_lecturer FOREIGN KEY (lecturer_account_id) REFERENCES accounts(account_id)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS course_programmes (
  course_id  INT NOT NULL,
  program_id INT NOT NULL,
  PRIMARY KEY (course_id, program_id),
  CONSTRAINT fk_cp_course FOREIGN KEY (course_id) REFERENCES courses(course_id) ON DELETE CASCADE,
  CONSTRAINT fk_cp_program FOREIGN KEY (program_id) REFERENCES programmes(program_id)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS grades (
  grade_id     INT AUTO_INCREMENT PRIMARY KEY,
  student_id   CHAR(36)    NOT NULL,
  course_id    INT         NOT NULL,
  grade_value  VARCHAR(10) NOT NULL,
  recorded_by  INT         NOT NULL,
  recorded_at  TIMESTAMP   NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

  CONSTRAINT fk_grades_student FOREIGN KEY (student_id) REFERENCES students(student_id),
  CONSTRAINT fk_grades_course FOREIGN KEY (course_id) REFERENCES courses(course_id) ON DELETE CASCADE,
  CONSTRAINT fk_grades_recorder FOREIGN KEY (recorded_by) REFERENCES accounts(account_id)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS attendance (
  attendance_id   INT AUTO_INCREMENT PRIMARY KEY,
  student_id      CHAR(36)    NOT NULL,
  course_id       INT         NOT NULL,
  attendance_date DATE        NOT NULL,
  status          ENUM('present','absent','excused','late') NOT NULL DEFAULT 'present',
  recorded_by     INT         NOT NULL,
  recorded_at     TIMESTAMP   NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

  UNIQUE KEY uq_attendance_entry (student_id, course_id, attendance_date),
  CONSTRAINT fk_att_student FOREIGN KEY (student_id) REFERENCES students(student_id),
  CONSTRAINT fk_att_course FOREIGN KEY (course_id) REFERENCES courses(course_id) ON DELETE CASCADE,
  CONSTRAINT fk_att_recorder FOREIGN KEY (recorded_by) REFERENCES accounts(account_id)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS timetable (
  timetable_id INT AUTO_INCREMENT PRIMARY KEY,
  course_id    INT         NOT NULL,
  day_of_week  ENUM('MON','TUE','WED','THU','FRI','SAT') NOT NULL,
  start_time   TIME        NOT NULL,
  end_time     TIME        NOT NULL,
  room         VARCHAR(60) NOT NULL,

  CONSTRAINT fk_tt_course FOREIGN KEY (course_id) REFERENCES courses(course_id) ON DELETE CASCADE
) ENGINE=InnoDB;

-- --------------------------------------------------------------------------------
-- 8. VERSION 1.0 REFERENCE SEED DATA
-- --------------------------------------------------------------------------------

-- Programmes
INSERT INTO programmes (program_id, program_code, program_name) VALUES
  (1, 'CS', 'Computer Science'),
  (2, 'IT', 'Information Technology'),
  (3, 'DS', 'Data Science')
ON DUPLICATE KEY UPDATE program_name = VALUES(program_name);

-- Lab Groups with Weekly Timetable
INSERT INTO lab_groups (group_id, group_code, capacity, schedule_day, start_time, end_time, room) VALUES
  (1, 'G01', 15, 'TUE', '10:00:00', '12:00:00', 'Engineering Lab 3'),
  (2, 'G02', 15, 'WED', '14:00:00', '16:00:00', 'CS Block Lab 1'),
  (3, 'G03', 15, 'THU', '08:00:00', '10:00:00', 'IT Centre Lab 2'),
  (4, 'G04', 15, 'FRI', '14:00:00', '16:00:00', 'Data Science Lab 4')
ON DUPLICATE KEY UPDATE
  capacity = VALUES(capacity),
  schedule_day = VALUES(schedule_day),
  start_time = VALUES(start_time),
  end_time = VALUES(end_time),
  room = VALUES(room);

-- Demo Student Profile
INSERT INTO students (student_id, student_number, student_name, program_id, group_id, status, version) VALUES
  ('11111111-1111-4111-8111-111111111111', '202408138', 'Chanda Mubanga', 1, 1, 'active', 1)
ON DUPLICATE KEY UPDATE
  student_name = VALUES(student_name),
  program_id = VALUES(program_id),
  group_id = VALUES(group_id),
  status = 'active';

-- Demo Accounts (Pre-hashed bcrypt cost 12):
-- Lecturer password: Lecturer#2026
-- Student password:  Student#2026
INSERT INTO accounts (account_id, student_id, username, display_name, avatar, password_hash, role, is_active) VALUES
  (1, NULL, 'lecturer1', 'Dr. Mwansa', 'dog-1', '$2b$12$k6089QWfCglmb6Z/FJsCBOaE28JoXY84dB2s0MPfivvbAfI6pLI/O', 'lecturer', 1),
  (2, '11111111-1111-4111-8111-111111111111', '202408138', 'Chanda Mubanga', 'cat-1', '$2b$12$fRPiwaizqXHRoMkQXUQuKOcELqxctQuu5jDLWAwSOo61S6kAkvMhG', 'student', 1)
ON DUPLICATE KEY UPDATE
  display_name = VALUES(display_name),
  avatar = VALUES(avatar),
  password_hash = VALUES(password_hash),
  role = VALUES(role),
  is_active = 1;

-- Self-Service & Student Claim Codes
INSERT INTO claim_codes (claim_code, student_number) VALUES
  ('CLAIM-AAA111', NULL),
  ('CLAIM-BBB222', NULL),
  ('CLAIM-CCC333', NULL),
  ('MU-STUDENT-2026', NULL),
  ('CLAIM-1001', NULL),
  ('CLAIM-1002', NULL),
  ('CLAIM-PRESET-01', '202408138')
ON DUPLICATE KEY UPDATE student_number = VALUES(student_number);

-- Core Courses
INSERT INTO courses (course_id, course_code, course_name, lecturer_account_id) VALUES
  (1, 'CS301', 'Advanced Software Engineering', 1),
  (2, 'IT302', 'Network & Mobile Systems', 1),
  (3, 'DS303', 'Database Systems & Architecture', 1)
ON DUPLICATE KEY UPDATE course_name = VALUES(course_name);

INSERT INTO course_programmes (course_id, program_id) VALUES
  (1, 1), (1, 2),
  (2, 2), (2, 1),
  (3, 3), (3, 1)
ON DUPLICATE KEY UPDATE program_id = VALUES(program_id);
