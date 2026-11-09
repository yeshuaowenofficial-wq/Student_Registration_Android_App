-- ================================================================================
-- CAMPUS COMPANION — DATABASE VERSION 2.1 (15 GROUPS & SPREADSHEET INGESTION)
-- ================================================================================
-- Database Engine: MySQL 8.0+ / MariaDB / InnoDB
-- Character Set:   utf8mb4 / utf8mb4_unicode_ci
-- Release Tag:     v2.1.0 (Authoritative 15-Group Spreadsheet Release)
--
-- USAGE:
--   mysql -u root -p < v2.0_schema_and_spreadsheet_seed.sql
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

DELETE FROM schema_version WHERE version_tag IN ('2.0.0', '2.1.0');
INSERT INTO schema_version (version_tag, description)
VALUES ('2.1.0', 'Campus Companion V2.1.0 — 15 Lab Groups, Updated Roster & Nullable Duplicate IDs');

-- --------------------------------------------------------------------------------
-- 1. REFERENCE TABLES: PROGRAMMES & LAB GROUPS
-- --------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS programmes (
  program_id    INT AUTO_INCREMENT PRIMARY KEY,
  program_code  VARCHAR(10)  NOT NULL UNIQUE,   -- CS, IT, ITED
  program_name  VARCHAR(100) NOT NULL
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS lab_groups (
  group_id      INT AUTO_INCREMENT PRIMARY KEY,
  group_code    VARCHAR(10) NOT NULL UNIQUE,      -- G01 through G15
  capacity      INT NOT NULL DEFAULT 15,
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
  student_number  CHAR(9)      NULL UNIQUE,                 -- 9 digits (or NULL when duplicate left blank)
  student_name    VARCHAR(100) NOT NULL,
  program_id      INT          NOT NULL,
  group_id        INT          NULL,                        -- NULL = Unassigned, 1..15 = G01..G15
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

-- Ensure existing tables allow NULL student_number for duplicate-ID students left without an ID
ALTER TABLE students MODIFY COLUMN student_number CHAR(9) NULL;

-- --------------------------------------------------------------------------------
-- 3. ACCOUNTS (AUTH IDENTITY)
-- --------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS accounts (
  account_id     INT AUTO_INCREMENT PRIMARY KEY,
  student_id     CHAR(36)     NULL UNIQUE,
  username       VARCHAR(100) NOT NULL UNIQUE,
  display_name   VARCHAR(100) NULL,
  avatar         VARCHAR(40)  NULL,
  password_hash  VARCHAR(255) NOT NULL,
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
  claim_code      VARCHAR(30) NOT NULL PRIMARY KEY,
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
  requested_by    INT         NOT NULL,
  field_name      VARCHAR(50) NOT NULL,
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
-- 8. VERSION 2.1 SEED DATA (15 GROUPS & 224 STUDENTS)
-- --------------------------------------------------------------------------------

INSERT INTO programmes (program_id, program_code, program_name) VALUES
  (1, 'CS', 'Computer Science'),
  (2, 'IT', 'Information Technology'),
  (3, 'ITED', 'ICT with Education')
ON DUPLICATE KEY UPDATE program_name = VALUES(program_name);

INSERT INTO lab_groups (group_id, group_code, capacity, schedule_day, start_time, end_time, room) VALUES
  (1, 'G01', 15, 'MON', '15:00:00', '17:00:00', 'CS - Old Dining Hall B'),
  (2, 'G02', 15, 'MON', '15:00:00', '17:00:00', 'CS - Old Dining Hall B'),
  (3, 'G03', 15, 'TUE', '07:00:00', '09:00:00', 'CS - Engineering Lab 3'),
  (4, 'G04', 15, 'TUE', '07:00:00', '09:00:00', 'CS - Engineering Lab 3'),
  (5, 'G05', 15, 'WED', '13:00:00', '15:00:00', 'CS - SSS Block-C RM 2'),
  (6, 'G06', 15, 'WED', '13:00:00', '15:00:00', 'CS - SSS Block-C RM 2'),
  (7, 'G07', 15, 'WED', '15:00:00', '17:00:00', 'CS - SSS Block-E RM 1'),
  (8, 'G08', 15, 'WED', '15:00:00', '17:00:00', 'CS - SSS Block-E RM 1'),
  (9, 'G09', 15, 'WED', '17:00:00', '19:00:00', 'IT - Old Dining Hall B'),
  (10, 'G10', 15, 'WED', '17:00:00', '19:00:00', 'IT - Old Dining Hall B'),
  (11, 'G11', 15, 'THU', '07:00:00', '09:00:00', 'IT - Multi Purpose Hall'),
  (12, 'G12', 15, 'THU', '07:00:00', '09:00:00', 'IT - Multi Purpose Hall'),
  (13, 'G13', 15, 'FRI', '11:00:00', '13:00:00', 'ITED - SSS Block-B RM 2'),
  (14, 'G14', 15, 'FRI', '11:00:00', '13:00:00', 'ITED - SSS Block-B RM 2'),
  (15, 'G15', 15, 'FRI', '11:00:00', '13:00:00', 'CS - SSS Block-B RM 2')
ON DUPLICATE KEY UPDATE
  capacity = VALUES(capacity),
  schedule_day = VALUES(schedule_day),
  start_time = VALUES(start_time),
  end_time = VALUES(end_time),
  room = VALUES(room);

-- Remove synthetic IDs generated in older seed versions so duplicate-ID students cleanly use NULL
DELETE FROM students WHERE student_number IN ('202407016', '202403847');

INSERT INTO students (student_id, student_number, student_name, program_id, group_id, status, version) VALUES
  ('b6a54e30-04a2-45fd-abb4-351b14834898', '202402387', 'Mulemwa Muchima', 1, 1, 'active', 1),
  ('52e387c6-2e2c-4ba8-a795-14124a731353', '202406643', 'Edwin Kampamba', 1, 1, 'active', 1),
  ('3182cc4f-2fab-4edb-a165-dfe5e81e03d1', '202400442', 'Ivwananji Chipasha', 1, 1, 'active', 1),
  ('fec67e9c-e3a3-413c-a56e-a4afef990b4c', '202305208', 'Alinani Sinyangwe', 1, 1, 'active', 1),
  ('0422137a-47f5-450e-a960-e2f29456501d', '202408399', 'Grace Chilufya', 1, 1, 'active', 1),
  ('3b575aa3-2583-41d1-a055-95b81554bcfc', '202402615', 'Charity Namangolwa', 1, 1, 'active', 1),
  ('683e24d9-f8a5-4bb8-a975-afe3c6b01e8e', '202404528', 'Memory Mutemwa', 1, 1, 'active', 1),
  ('4be41c8c-eac5-42a7-a74d-25e2a58101ce', '202409048', 'Mwila Siaciti', 1, 1, 'active', 1),
  ('ff9699b3-f2a4-45a3-af75-1cb9c3fdb736', '202402859', 'Hope Nsana', 1, 1, 'active', 1),
  ('3032e35c-e4bb-4ed2-acca-42ca2e9fd99d', '202403063', 'Judith Mushabati', 1, 1, 'active', 1),
  ('457fadad-2ae6-493b-aac4-cd0bb82eb918', '202406887', 'Mcnaldo Chilanga', 1, 1, 'active', 1),
  ('06f02898-23b6-4bcb-a920-2990815d4002', '202403266', 'Collins Kalela', 1, 1, 'active', 1),
  ('640d795a-1c49-4eb6-ae0f-b8bff2b1cf74', '202409163', 'Nancy Mailoni', 1, 1, 'active', 1),
  ('303ff1de-4668-4c2a-a2ff-3e5053e25ac6', '202408720', 'Onester Kalunga', 1, 1, 'active', 1),
  ('d20fe85e-1ae0-4502-acc3-ba4b75355b02', '202409779', 'Mayamiko Phiri', 1, 1, 'active', 1),
  ('5d104d61-5404-4b7b-a6b8-b79e66060163', '202408882', 'Atupele Andende', 1, NULL, 'active', 1),
  ('6a442ede-f243-4be5-a14c-e7995eba70b9', '202400549', 'Joseph Chiwuswa', 1, 2, 'active', 1),
  ('39279a59-8999-46a0-ac05-0d506ad8d209', '202400526', 'Maluba B Akakandelwa', 1, 2, 'active', 1),
  ('9cc5b4f9-da51-40ad-a340-69b6a3a6e592', '202403134', 'Emmanuel Viazi', 1, 2, 'active', 1),
  ('e2f875ea-6094-4827-a784-3137fb33cdb1', '202408701', 'Memory Tembo', 1, 2, 'active', 1),
  ('b1375043-b334-4770-a395-0a6ceaec3e87', '202401737', 'Salome Sitwala', 1, 2, 'active', 1),
  ('8bdc93e6-f711-4da8-ab79-e86f2f3af238', '202405690', 'Mwansa Mubanga', 1, 2, 'active', 1),
  ('f811c4ba-dd54-44cb-ac91-c98490dad1c0', '202404540', 'Paul Munene', 1, 2, 'active', 1),
  ('89672849-c861-4628-a21b-d4a628859630', '202408808', 'Blessings Sinkamba', 1, 2, 'active', 1),
  ('d0fa3f04-2d48-472c-aa28-f21e0920c909', '202308808', 'Joshua Chibale', 1, 2, 'active', 1),
  ('f5e9caeb-bcc3-45c8-a7ba-14320c1473ae', '202408439', 'Blessings Tembo', 1, 2, 'active', 1),
  ('967b64b1-5177-49ff-a2bc-07f0e5be50db', '202402633', 'Mwaka Hamilemba', 1, 2, 'active', 1),
  ('9c58a535-dc6b-46c7-a3f7-b51bb0685729', '202408554', 'Luumbi Malambo', 1, 2, 'active', 1),
  ('beff7c62-0a71-47d8-ae68-afa1c418cbe8', '202406948', 'Liseli Faustina Kalowa', 1, 2, 'active', 1),
  ('1446ce6f-e93f-4609-ab39-9acd9de64ec2', '202407170', 'Lute Walusungu Gondwe', 1, 2, 'active', 1),
  ('da863977-982c-473a-ae24-204e60f27378', '202405590', 'Matildah Yusiku', 1, 2, 'active', 1),
  ('9baa41a3-64db-4e0a-abbc-127ddcd82f49', '202404194', 'Gift Chabuka', 1, 3, 'active', 1),
  ('d672720d-ea3e-4477-a080-079b46456c98', '202307232', 'Ruth Kangwa', 1, 3, 'active', 1),
  ('0f80063f-1f06-4d53-a584-543dd005e1f5', '202406919', 'Jason Mbao', 1, 3, 'active', 1),
  ('f456484b-c27f-4ae5-a838-067c86a7165d', '202404164', 'Chiko Mutale', 1, 3, 'active', 1),
  ('6ca38b54-967d-46a5-a4b0-b2b347277eab', '202407862', 'Fabian Muloongo', 1, 3, 'active', 1),
  ('124008cb-253d-4750-aca9-2094a1879148', '202402069', 'Richard Mwansa', 1, 3, 'active', 1),
  ('5a35bac3-0d32-455f-abe3-aacebee3f6d0', '202410371', 'Memory Mwela', 1, 3, 'active', 1),
  ('2b4dafbe-ada7-4ff1-a820-ba478375cdb7', '202406543', 'Gillian Mpola', 2, 3, 'active', 1),
  ('116fdb5a-0588-46d4-a994-b0845aaab27f', '201901101', 'Christabel Chikomona', 3, 3, 'active', 1),
  ('f8424c36-686e-4692-a2bc-d494b1303ede', '202301795', 'Steven Zulu', 1, 3, 'active', 1),
  ('4d6c8cc6-f952-4058-ae9b-ff150b3fd758', '202409282', 'Kapunza Gwenani', 1, 3, 'active', 1),
  ('a806205d-6129-43db-a275-e88ef6a1d9c9', '202408164', 'Lenganji Simwanza', 1, 3, 'active', 1),
  ('c28c0938-8c37-409d-a2a5-b39c9635b595', '202403669', 'Eustane Chulu', 1, 3, 'active', 1),
  ('8e66d642-2297-4b85-ae9e-bc19f97c73e9', '202401965', 'Erastas Michelo', 1, 3, 'active', 1),
  ('81b9b4ba-3591-40a4-a2ff-f1ab1d847562', '202405342', 'Manda Dickson', 1, 4, 'active', 1),
  ('2207bb63-a9cf-418f-a19a-bb7e0dfde9c7', '202405228', 'Nemar Kanyondwi', 1, 4, 'active', 1),
  ('760484e5-000a-47e4-a0de-e9417b95fbce', '202402427', 'Michael Mutale', 2, 4, 'active', 1),
  ('a54eb366-46e1-4b6c-aeda-b88a479e6c79', '202402839', 'Sikumbuzo Monde', 1, 4, 'active', 1),
  ('d528d25e-cfa8-4a96-ad52-b1761393ef8f', '202107598', 'Cleopatra Ngulube', 1, 4, 'active', 1),
  ('6bc073d8-9729-4391-a88f-4bcc9b878bde', '202404130', 'Hellen Mwanza', 1, 4, 'active', 1),
  ('886be6e9-d72f-4a08-a960-3acd30e118c1', '202306274', 'Lloyd Bulaya', 1, 4, 'active', 1),
  ('657df0d0-a207-4299-a88e-6d6d8c55fbeb', '202407149', 'Gedan Simbeye', 1, 4, 'active', 1),
  ('c3385048-ee3b-43eb-a0a0-09cac38ef43f', '202408185', 'Muleba Mwashi', 1, 4, 'active', 1),
  ('e61fa74f-3807-4ef9-a26f-6a02f546f257', '202402132', 'Nkonde R Zimba', 2, 4, 'active', 1),
  ('db4adbbe-10f6-441f-a99b-b4c00b58bcf3', '202105977', 'Memory Sokontwe', 3, 4, 'active', 1),
  ('0ce0e7a0-30ea-48af-ad15-05047b6b9317', '202408941', 'David Kanyama', 1, 4, 'active', 1),
  ('68dd36af-1065-45af-ae69-57c970e804e9', '202302576', 'Frackson Mkandawire', 2, 4, 'active', 1),
  ('05cadd71-624c-474d-a98b-a442f3d123ec', '202203671', 'Andrew Moyo', 1, 4, 'active', 1),
  ('338e4378-be14-414a-a2bc-642723cdb021', '202404135', 'Thabo Muliwana', 1, 4, 'active', 1),
  ('6f470553-875c-4459-ad1c-13d10c150d23', '202402261', 'Mwila Stephen', 1, NULL, 'active', 1),
  ('1e7a1028-0d8e-482a-a5b7-7d09deb00141', '202406213', 'Simazuwo Brian', 1, 5, 'active', 1),
  ('6f1378f3-d0a9-459b-a62a-40bf58d47984', '202406222', 'Sanalumba Wakun’oli', 1, 5, 'active', 1),
  ('4338f635-5f01-4aaa-a0c4-e45aa8fafe27', '202406591', 'David Mbilima', 1, 5, 'active', 1),
  ('df2eb328-75c8-4fe0-a2fb-c84d94361a3e', '202410059', 'Tembo Kunda', 1, 5, 'active', 1),
  ('0c3962fe-aa21-4d7f-a97a-6d5a9f2cc24d', '202407895', 'Chabu Chileleko', 1, 5, 'active', 1),
  ('3051b51c-dd18-4eb9-a828-22a5fee428a0', '202400756', 'Nachinga Thelma', 1, 5, 'active', 1),
  ('83810a1f-6be1-41cb-ad97-763b3062e31b', '202406797', 'Kamwana Miriam', 1, 5, 'active', 1),
  ('3c4b0d18-8c02-4f70-a884-c9a64e95033d', '202409524', 'Mwelwa Maggie', 1, 5, 'active', 1),
  ('f09270f9-ed37-42e9-ae47-c20acc383818', '202200670', 'Mshisha Dada', 1, 5, 'active', 1),
  ('3ab4cb7a-eb57-4414-a990-cb4afd706840', '202409126', 'Mukangwa Brian', 1, 5, 'active', 1),
  ('7e2a725b-ccc2-4631-a349-18ea2fa5f861', '202408328', 'Shikupa Charles', 1, 5, 'active', 1),
  ('ec036792-9368-4bd2-a232-5acd89445f1f', '202307112', 'Mwape Prisca', 1, 5, 'active', 1),
  ('ef9a95d4-d53b-4bb5-acaa-a7785d3a4028', '202400260', 'Shikabanga Cecilia', 1, 5, 'active', 1),
  ('8e546ae4-e287-4bb1-a7ba-f17600e14609', '202403973', 'Nevers Mwaba', 1, 5, 'active', 1),
  ('7c52d453-e90b-4b24-ac10-891f055d8aad', '202403184', 'Febby Ng''anwe', 1, 5, 'active', 1),
  ('029c0462-4a61-43ff-aa5c-c9ae4d88b490', '202407184', 'Muyoba Mulako', 1, 6, 'active', 1),
  ('d1dc2c61-097e-47e3-a21a-0c4d2f4c759d', '202400975', 'Owen M. Mukela', 1, 6, 'active', 1),
  ('554400ee-e4b9-453f-a065-f0151257fa4d', '202407403', 'Previous Mukosha', 1, 6, 'active', 1),
  ('1c2b476f-edd6-418b-a1a2-29c84a494e71', '202400421', 'Immaculate Mwanangombe', 1, 6, 'active', 1),
  ('12f113a1-be26-46cc-a177-5e72b89aada4', '202301165', 'Houghton Chibozyi', 1, 6, 'active', 1),
  ('24e811e3-1221-41a0-a5f9-a717f23091b8', '202402071', 'Winnia Mwanza', 1, 6, 'active', 1),
  ('b1a26c6f-9b94-4ac5-aa65-77e5c4ed0b14', '202400957', 'Bosswell Habenzu', 1, 6, 'active', 1),
  ('9ee46f20-81b0-4420-aab9-98844df3659e', '202402043', 'Kamwemba Kulumuku', 1, 6, 'active', 1),
  ('8404c139-5b68-428c-aa19-ae6f90850e89', '202409550', 'Wilfred Lungo', 1, 6, 'active', 1),
  ('ab778731-3b85-461a-a9d2-cf2f03bb9bc2', '202405691', 'Chakuletela Musukwa', 1, 6, 'active', 1),
  ('7e5082e2-057a-474c-a803-7917aed995b3', '202403830', 'Charles Chisala', 1, 6, 'active', 1),
  ('8399e0a0-cd97-4de2-acc1-3cb41c3a8cbc', '202407202', 'Namasiku Beauty Siemisa', 1, 6, 'active', 1),
  ('45ee1843-216e-4fb0-ad4a-372931d69e17', '202401889', 'Fridah Muzungu', 1, 6, 'active', 1),
  ('459df0a5-91b8-40b0-af3e-2c72fa0f21f6', '202406520', 'Mundia Mundia', 1, 6, 'active', 1),
  ('66b146f2-0eda-4b3a-adcb-caab4ad87000', '202408897', 'Marcus Malulu', 1, 6, 'active', 1),
  ('f4b5478a-861c-496c-a6dc-3e228a938259', '202303351', 'Mwendalubi Mike Manyika', 1, 7, 'active', 1),
  ('c453e17b-ae88-4a7c-a009-fcabae0788a3', '202406767', 'Bwalya Manyando', 1, 7, 'active', 1),
  ('578b99b4-2790-4b80-af2a-1a7eb6de7231', '202404746', 'Rachael Shabolyo', 1, 7, 'active', 1),
  ('3e60e434-17b1-494e-aeea-b5d81cc765a2', '202408031', 'Edwin Makuya', 1, 7, 'active', 1),
  ('552c13a6-da31-44c9-af12-2a7c783c09f4', '202408025', 'Cryvet Simfukwe', 1, 7, 'active', 1),
  ('06a0de2c-214b-4972-a25b-f57a62cb89e6', '202404317', 'Yeshua Owen', 1, 7, 'active', 1),
  ('506eb644-0a12-4ea2-a67a-10546dbf142a', '202407565', 'Reagan Chisanga', 1, 7, 'active', 1),
  ('11111111-1111-4111-8111-111111111111', '202408138', 'Chanda Mubanga', 1, 7, 'active', 1),
  ('9223b6f9-0156-4a6f-a7d2-72ee0dec60f7', '202405883', 'Isaiah Mbangweta', 1, 7, 'active', 1),
  ('95be963a-c338-4b53-aeef-f459a48fa390', '202409469', 'Mapalo Mwape', 1, 7, 'active', 1),
  ('af02c0c3-167c-4948-af6c-52025334d819', '202402434', 'Ngosa Florence', 1, 7, 'active', 1),
  ('46aaca6a-e5d9-40ac-a2be-2e0e7d4b8430', '202403931', 'M''manga Modester', 1, 7, 'active', 1),
  ('5435c91e-7e18-4d40-a337-a3d821565230', '202400114', 'Kazembe Sing''ambwa', 1, 7, 'active', 1),
  ('8d3d7866-25cd-4b8c-a828-be2ee0a6c67e', '202404096', 'Temwini Phiri', 1, 7, 'active', 1),
  ('f7688340-e9b9-4fed-a10e-377c72fa28f4', '202401761', 'Caleb Mukelabai Kalimina', 1, 7, 'active', 1),
  ('3df4b7e8-793d-4e66-ac37-131b64f5bdda', '202406501', 'Bwalya Marvelous', 1, 8, 'active', 1),
  ('5e2dfb3b-9cbf-47ec-a061-594ade6dc497', '202408157', 'Soko Zilombo Choolwe', 1, 8, 'active', 1),
  ('dd16651b-1e0d-42d9-ab29-7c76bc5e5ad8', '202408295', 'Mbewe Mathews', 1, 8, 'active', 1),
  ('4ab0a0b5-6035-485c-a1c0-72cebace7a71', '202404634', 'Sakala Blessings', 1, 8, 'active', 1),
  ('1ad4cf66-d763-4494-a2ad-807b5d309548', '202409794', 'Moyo Sibongile', 1, 8, 'active', 1),
  ('d53d5907-9d30-452e-a0ab-04d02f9036d7', '202406011', 'Gumbo Dailess', 1, 8, 'active', 1),
  ('d8a0d985-93f9-491c-af75-1d741798b9ce', '202409214', 'Shaba Patience', 1, 8, 'active', 1),
  ('b0b80580-0ab7-4ff6-a415-a259a9b8e417', '202400397', 'Chishala Juliet', 1, 8, 'active', 1),
  ('3734492b-e197-44e5-a86f-852597a8874b', '202407247', 'Chileshe Sampa', 1, 8, 'active', 1),
  ('b4565a75-4929-430d-ad6a-a8d6334b226d', '201802185', 'Kabengele Remmy', 1, 8, 'active', 1),
  ('4c947484-fb6e-4a65-ae15-5389ec5608c0', '202402295', 'Miyambo Emmanuel', 2, 8, 'active', 1),
  ('3b42f151-b934-4ac7-a0b5-cf007fe589fb', '202106741', 'Kanjela Musenge', 1, 8, 'active', 1),
  ('d04f61e9-796c-4ddb-a0e1-551c78222a90', '202406031', 'Florence Shimpa Musonda', 1, 9, 'active', 1),
  ('44faadc0-a5aa-425a-a6c0-ac9026354922', '202407879', 'Gerald Gondwe', 1, 9, 'active', 1),
  ('f52530d0-03b7-4b35-a801-b7a7b32b1c5e', '202400653', 'Bernadette Chanda', 2, 9, 'active', 1),
  ('2a2b10f8-097e-42fd-ade8-dc84ccced735', '202403271', 'William Simbeye', 1, 9, 'active', 1),
  ('3b9cb54b-d1b8-41d1-a9dc-3e3b1c53b444', '202402510', 'Derrick Kabonso', 1, 9, 'active', 1),
  ('d028abd6-820f-4f57-ae35-a230867a0865', '202405283', 'Miti Steven', 1, 9, 'active', 1),
  ('64a185ed-b710-45aa-a3f5-081445ed6799', '202409051', 'Kampamba Charity', 1, 9, 'active', 1),
  ('85d2ba8c-1f1a-4cb8-a542-8a7bf1f007e9', '202403132', 'Benzu Himoonde', 1, 9, 'active', 1),
  ('83b168f0-832f-4e18-ae93-b3c031febe99', '202405388', 'Frazer Macha', 1, 9, 'active', 1),
  ('824db210-56f3-4e4c-a0cf-799c04cefd3d', '202408282', 'Timothy Malasha', 1, 9, 'active', 1),
  ('0ec921aa-f7c6-4335-a727-47d35ac5d17d', '202410672', 'Kalunga Mervis', 2, 9, 'active', 1),
  ('97f7997a-84c6-4385-aefc-ceb4e7b4b050', '202407064', 'Violet Ngoma', 1, 9, 'active', 1),
  ('3413e29b-3457-4086-a70f-9f9d21237915', '201701343', 'Mweene Simon', 1, 9, 'active', 1),
  ('57bc6b8c-8350-43b2-aab1-5693ca88a1ab', '202406408', 'Chimbala Christopher', 1, 9, 'active', 1),
  ('a72c79b8-171c-4fa8-a7fe-0b03f44412d7', '202406593', 'Enock Simumba', 1, 9, 'active', 1),
  ('4cc2db81-6812-4b88-a7bf-50145dac676c', '202406805', 'Eustuce Kasongo', 1, NULL, 'active', 1),
  ('2291c4e5-8bc8-495c-ac8e-907e58c997ae', '202404114', 'Beatrice Chibesa', 1, 10, 'active', 1),
  ('bf829225-0d23-4c14-a721-3e09f2ad2f15', '202400350', 'Angel Bwalya', 1, 10, 'active', 1),
  ('0daf70e9-b44b-4ed0-a12e-f0a57be6bf2c', '202400550', 'Evans Saikolo', 1, 10, 'active', 1),
  ('8abb6af7-33f6-413e-a6b1-06115d750436', '202402843', 'Titus Bwalya', 1, 10, 'active', 1),
  ('6c937a55-62e7-4e01-a9b7-35951622eb45', '202404621', 'Ezron Chiluba', 1, 10, 'active', 1),
  ('05291cc2-05ce-41d6-a972-16c953b4a28a', '202410470', 'Juliet Mulenga', 1, 10, 'active', 1),
  ('2ceeb96e-d5e6-4aa6-ad04-46e857f30d4a', '202402030', 'Ilukena Mundia', 1, 10, 'active', 1),
  ('74ac3c2e-e480-432a-a9d2-971dfb8ef55c', '202409245', 'Cascious Nyambe', 1, 10, 'active', 1),
  ('ddad5ec1-dc68-4e25-afc9-dd0e3865817c', '202410007', 'Aquirina Mulauzi', 1, 10, 'active', 1),
  ('cfd48da0-c48a-4ef3-ae7f-157e3dfcfb18', '202402824', 'Tobias Phiri', 2, 10, 'active', 1),
  ('0c72a2b0-677b-4fb5-af18-31db3292feb1', '202410384', 'Mary Mula', 1, 10, 'active', 1),
  ('cc0fddcc-1fce-4d8c-a77c-515448a17290', '202407468', 'Weston Mulenga', 2, 10, 'active', 1),
  ('e9bcc25d-3776-41cb-a46a-cce57b303937', '202404891', 'Christopher C.chimfwembe', 1, 10, 'active', 1),
  ('c946c351-743f-49b1-a90c-92cb91225132', '202405964', 'Choolwe Mweembe', 1, 10, 'active', 1),
  ('7deb1068-cf4c-4166-a889-299399112b70', '202410253', 'Oscar Chipango', 1, 10, 'active', 1),
  ('b2fd7f50-099b-4442-a7b7-1f4ee40eaad4', '202109428', 'Gaidon Sichone', 1, NULL, 'active', 1),
  ('b47ae52a-e116-4506-abdb-dc3ef897b0a2', '202407015', 'Miti Katanga', 1, 11, 'active', 1),
  ('a26a95d8-a8d9-453e-a1f0-b4a39537a724', '202404688', 'Mbasela Fabian', 1, 11, 'active', 1),
  ('7072c488-2472-4a2e-a4a4-96d02feba4b7', '202404172', 'Chola Ben', 1, 11, 'active', 1),
  ('67866172-aa19-4e83-a36c-c63a4237d208', '202403019', 'Hamasukwa Agrippa C.', 1, 11, 'active', 1),
  ('be352015-944f-4bcf-ad3c-4ba11a5db4ba', '202401150', 'Muunda Mainza', 1, 11, 'active', 1),
  ('0b37077d-58a8-42f3-a523-796006f9fbb8', '202001699', 'Mumbi Chibesa', 1, 11, 'active', 1),
  ('d0d96244-578e-4f71-ab0e-ac3135950d20', NULL, 'Simasiku Abel', 1, 11, 'active', 1),
  ('0a83f0e1-ca41-43b6-ac84-aab1b3df6a5c', '202403846', 'Chanda Collins', 1, 11, 'active', 1),
  ('3873f6cd-3a9a-468a-a3e5-d210b3874673', NULL, 'Traore Mordecai Salim', 1, 11, 'active', 1),
  ('f23e952f-2312-49f7-a884-1fa76d917f26', '202405943', 'Chilufya Mapalo', 1, 11, 'active', 1),
  ('f394362f-816e-46ab-ae8e-f8d0cf69d9c2', '202203897', 'Mwape Kelvin', 1, 11, 'active', 1),
  ('385277cc-5952-482c-a18d-79a4dee134e7', '202206607', 'Kansamba Auxiria', 1, 11, 'active', 1),
  ('ce6890c1-db12-40ae-af2c-c3abd603fcb2', NULL, 'Makuyu Edwin', 1, 11, 'active', 1),
  ('826bf594-84d7-4c53-aba2-831ff37b114b', '202305732', 'Banda Salima', 1, 11, 'active', 1),
  ('56d90737-4b8e-4ed1-a531-292ebc38f9dc', '202403844', 'Traore Lamin', 1, 11, 'active', 1),
  ('f1ea1788-c201-4152-aaad-4ae16c7372af', '202303375', 'Daka Racheal', 1, NULL, 'active', 1),
  ('a16229f3-a1df-47e0-af18-5a13ada37bdc', '202401321', 'Moon Clive', 2, 12, 'active', 1),
  ('315edda5-283d-4f0f-a55f-3d518a32971f', '202404407', 'Zimba Emmanuel', 2, 12, 'active', 1),
  ('779d0745-e9ce-44fe-a573-226657fb70bf', '202405095', 'Kaonga Memory', 1, 12, 'active', 1),
  ('e9a6906b-6457-41d1-a0ac-07e71fd654df', '202405321', 'Mukupa Franscine', 1, 12, 'active', 1),
  ('f6b69fe1-ae36-4572-ac02-fb00095bc17b', '202409728', 'Nakanyika Nsungani', 1, 12, 'active', 1),
  ('42ce84a8-bed6-42b5-af51-743686c43bdf', '202406233', 'Chipampe Stanslous', 1, 12, 'active', 1),
  ('de782cdb-ca3f-4bec-ab2f-670d5811f6c1', '202401475', 'Mukonta Davis', 1, 12, 'active', 1),
  ('af057bf7-3fcf-4a6d-a4d8-d2d5f801ad2b', '202406877', 'Chishala Alfred', 1, 12, 'active', 1),
  ('c3dd731d-16b6-4846-a91d-3791abcdfd12', '202301116', 'Phiri Brian', 1, 12, 'active', 1),
  ('8ec3de1c-9a0c-4361-a370-07cc6d9eafef', '202301173', 'Chola Simon', 1, 12, 'active', 1),
  ('3bc3f577-2e78-48fd-add7-5bd45108b080', '202300654', 'Ng''omba Kangwa', 1, 12, 'active', 1),
  ('82ae952e-2f3c-4ea6-a609-bac40b56c56e', '202404608', 'Kabutu Ethel', 2, 12, 'active', 1),
  ('3697be4b-01f1-477d-a8ba-7b1d8e1beced', '202409694', 'Mwenda Hamulambo Sostern', 1, 12, 'active', 1),
  ('8235b831-c63a-4392-a00c-a17f8048f93a', '202404703', 'Masambu Kalenga', 1, 12, 'active', 1),
  ('61800034-35ab-48a7-aaf0-b3f51834033f', '202408913', 'Silunji Victor', 1, 13, 'active', 1),
  ('1da59178-7630-4b0f-af03-cb720dccba96', '202404454', 'Sakala Daniel', 1, 13, 'active', 1),
  ('2b744097-aa34-4ab6-a306-9caa4cd6b833', '202410021', 'Mawere Saidi', 1, 13, 'active', 1),
  ('5db8fafd-e6b9-4e8e-a568-66602e462b0d', '202408632', 'Mwanza Taizya', 1, 13, 'active', 1),
  ('fdf91780-404f-4226-afa2-5d2315d59820', '202406171', 'Mwitwa Clement', 1, 13, 'active', 1),
  ('11a876f8-805f-4dc8-a0b4-e93d7aa0c161', '202408752', 'Banda Agness', 1, 13, 'active', 1),
  ('05c2ba64-2802-4827-acce-8e52df78224f', '202400961', 'N''gandwe Charles', 1, 13, 'active', 1),
  ('5a523960-2a2f-451b-a70f-9eb8865a398f', '202409714', 'M''soni Deborah', 1, 13, 'active', 1),
  ('9d3625a4-0bdb-461f-abf2-6a71effcffa5', '202402226', 'Ng''andu Lwendo', 1, 13, 'active', 1),
  ('7c3a1886-1a09-4333-ae3d-ef1e32da4795', '202400014', 'Chile Bwalya', 1, 13, 'active', 1),
  ('b68221d0-7855-4759-a646-d2b6a69a4ca6', '202404480', 'Banda Mphaso', 1, 13, 'active', 1),
  ('4d734692-514f-445c-a3cf-e4b6f5fc9b8b', '202406515', 'Tembo Patience', 1, 13, 'active', 1),
  ('cd831328-a4ba-4854-a73b-f9300e9e4733', '202407984', 'Mwambazi Grace', 1, 13, 'active', 1),
  ('4537ade0-6521-4856-a2c3-48462fe588fc', '202401433', 'Ndhlovu Godfrey', 1, 13, 'active', 1),
  ('b3aa31cd-02f9-4549-a9e5-8d41c168f244', '202406496', 'Lungu Rebecca', 1, 13, 'active', 1),
  ('d0e36c79-87c2-4978-a253-aa90c72beead', '202406168', 'Jumbe Thabo', 1, 14, 'active', 1),
  ('bfd75ccd-390a-4477-a531-a708404d9d24', '202410082', 'Gondwe Joyce', 1, 14, 'active', 1),
  ('b67e4fdc-2dbe-4628-a4a1-01bd21184555', '202401120', 'Kapinga Antonette', 1, 14, 'active', 1),
  ('89844442-9ca7-4a12-a2ff-bf73c38f6c24', '202403000', 'Lungu Josephat', 1, 14, 'active', 1),
  ('4814c8e3-0420-4676-ad5e-095f054f03af', '202407636', 'Namukanzye Foster', 1, 14, 'active', 1),
  ('6afa4310-b705-4652-abb5-e2d0fc250645', '202308118', 'Sikubeka Emmanuel', 1, 14, 'active', 1),
  ('8221528f-e2d3-4cab-a305-f40da9c84a8e', '202410125', 'Judge Ezekiel', 1, 14, 'active', 1),
  ('5c6c5917-0bdf-4154-a979-89b372c1e29a', '202408068', 'Nduba Joel', 1, 14, 'active', 1),
  ('925d451e-f517-449b-a706-74c761bad786', '202407198', 'Maseba Neo', 1, 14, 'active', 1),
  ('8120c763-952a-46bc-aea4-5547bbd7812b', '202402976', 'Mapulanga Henry', 1, 14, 'active', 1),
  ('9883515d-1b20-4464-a75b-72a81dfa1f12', '202406795', 'Kalengo Andrew', 1, 14, 'active', 1),
  ('3c4503ca-a4c9-4fa5-a3d3-45b204ebf469', '202408447', 'Kamfwa Nathan', 1, 14, 'active', 1),
  ('47b3f2dc-0777-4738-aa59-95912a63a5e0', '202406183', 'Chansa Sylvester', 1, 14, 'active', 1),
  ('e4f0d342-f545-422b-a1d8-80955abfe06d', '202301847', 'Njunga Emmanuel', 1, 14, 'active', 1),
  ('279d202b-4bd9-41a9-a440-dea8a29653fd', '202407073', 'Chabota Siyingwa', 2, 15, 'active', 1),
  ('eaa206fd-5d85-45d5-a44f-6209a65f2975', '202404367', 'Reagan Chikumbutso Mbao', 1, 15, 'active', 1),
  ('453c7511-9be3-44f1-a1ff-6fe938666379', '202406336', 'Fedness Malilwe', 2, 15, 'active', 1),
  ('49f203a0-7a13-4604-a22e-b0e38ddc2b79', '202408460', 'Musonda Amos', 1, 15, 'active', 1),
  ('b7935838-68cf-4d47-aa6d-74f902e30bd2', '202409112', 'Munesu Lemba', 1, 15, 'active', 1),
  ('49d15d16-7820-4fc8-a0ba-30a6ed23c850', '202408468', 'Arthur Sinyenga', 1, 15, 'active', 1),
  ('9908ee64-fbe1-4b9b-a5bc-25ec8976c593', '202403876', 'Libuku Libuku', 1, 15, 'active', 1),
  ('178b1fd0-78e9-4df5-a3bd-3a8aadf8bde3', '202402399', 'Alicia Kunda Muteba', 2, 15, 'active', 1),
  ('c8c3500d-a332-43d7-ad74-ed3d7257c313', '202405510', 'Lutema Jutine Lutangu', 1, 15, 'active', 1),
  ('1eec5bf2-c978-4cd3-ae91-fc6109cfc640', '202407579', 'Lushomo Muteteete', 1, 15, 'active', 1),
  ('63497376-9545-4d1c-a0e2-c5a124802713', '202106055', 'Chirwa Janet', 2, 15, 'active', 1),
  ('d71682a2-619a-478f-a2ea-7e292601eaa6', '202408026', 'John Kabemba', 2, 15, 'active', 1),
  ('7ad5e271-fb75-418b-a7fc-d2c9e346fdaa', '202403212', 'Victor Lupenga', 1, 15, 'active', 1),
  ('385c678e-2cdd-4c42-a2ab-4348ba99e728', '202407907', 'George Kunda', 1, 15, 'active', 1),
  ('3fa5bc58-35a5-42ec-a0f4-0c36d7177f5b', '202404116', 'Temwananji Mutambo', 2, 15, 'active', 1)
ON DUPLICATE KEY UPDATE
  student_number = VALUES(student_number),
  student_name = VALUES(student_name),
  program_id = VALUES(program_id),
  group_id = VALUES(group_id),
  status = 'active';

-- Demo Accounts (Bcrypt cost 12):
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

INSERT INTO claim_codes (claim_code, student_number) VALUES
  ('MU-STUDENT-2026', NULL),
  ('CLAIM-AAA111', NULL),
  ('CLAIM-BBB222', NULL),
  ('CLAIM-CCC333', NULL),
  ('CLAIM-PRESET-01', '202408138')
ON DUPLICATE KEY UPDATE student_number = VALUES(student_number);

INSERT INTO courses (course_id, course_code, course_name, lecturer_account_id) VALUES
  (1, 'ICT361', 'Systems Analysis & Design (Mobile App Lab)', 1),
  (2, 'ICS341', 'Software Architecture & Theory', 1),
  (3, 'ICT351', 'Advanced Web & Cloud Systems', 1),
  (4, 'ICT381', 'Computer Networks & Distributed Systems', 1),
  (5, 'ICT371', 'Information Systems Project', 1)
ON DUPLICATE KEY UPDATE course_name = VALUES(course_name);

INSERT INTO course_programmes (course_id, program_id) VALUES
  (1, 1), (1, 2), (1, 3),
  (2, 1), (2, 2),
  (3, 1), (3, 2), (3, 3),
  (4, 1), (4, 2),
  (5, 1), (5, 3)
ON DUPLICATE KEY UPDATE program_id = VALUES(program_id);

INSERT INTO timetable (timetable_id, course_id, day_of_week, start_time, end_time, room) VALUES
  (1, 1, 'MON', '15:00:00', '17:00:00', 'Old Dining Hall B'),
  (2, 2, 'TUE', '07:00:00', '09:00:00', 'New Dining Hall'),
  (3, 3, 'WED', '13:00:00', '15:00:00', 'SSS Block-C RM 2'),
  (4, 4, 'WED', '15:00:00', '17:00:00', 'SSS Block-E RM 1'),
  (5, 5, 'THU', '09:00:00', '11:00:00', 'Old Dining Hall B'),
  (6, 1, 'FRI', '11:00:00', '13:00:00', 'SSS Block-B RM 2')
ON DUPLICATE KEY UPDATE room = VALUES(room);
