-- Migration 02 — courses, grades, attendance, timetable.
-- Run this AFTER schema.sql (and seed.sql if you use it).
--   mysql -u root -p < sql/02_courses_grades_attendance_timetable.sql
--
-- Scope note: these four features are NOT part of the ICT361 lab brief
-- (which only asks for student registration + lab group management).
-- They were added because the team's UI/UX work (CampusCompanion)
-- included them and the team chose to keep that scope. Flag this to
-- whoever is grading against the brief, since it's extra surface area
-- beyond what was asked for.
--
-- Design simplifications made here, worth a team look before relying on
-- them for anything beyond a demo:
--   - A course belongs to one or more PROGRAMMES (course_programmes), and
--     "enrollment" is implicit: every active student in a matching
--     programme can see/be marked for that course. There's no per-student
--     opt-in/opt-out enrollment table.
--   - Any "lecturer" account can manage any course's grades/attendance —
--     course.lecturer_account_id is informational (who's nominally
--     teaching it) but NOT enforced as an access restriction. The whole
--     backend only has one lecturer role tier today; splitting "my
--     course" vs "any course" permissions would be a reasonable follow-up.
--   - A grade is ONE current value per (student, course) — submitting
--     again overwrites it. No grade history/versioning.
--   - Attendance is ONE record per (student, course, date) — marking
--     again for the same day updates that record, it doesn't duplicate.
--   - Deleting a course cascades to its grades/attendance/timetable rows.

USE student_registration;

CREATE TABLE courses (
  course_id    INT AUTO_INCREMENT PRIMARY KEY,
  course_code  VARCHAR(20)  NOT NULL UNIQUE,   -- e.g. "CS301"
  course_name  VARCHAR(150) NOT NULL,
  lecturer_account_id INT NULL,                -- informational only, see note above

  CONSTRAINT fk_courses_lecturer FOREIGN KEY (lecturer_account_id)
      REFERENCES accounts(account_id)
) ENGINE=InnoDB;

-- Which programme(s) a course is offered to; a student "sees" a course
-- if their programme appears here.
CREATE TABLE course_programmes (
  course_id  INT NOT NULL,
  program_id INT NOT NULL,
  PRIMARY KEY (course_id, program_id),
  CONSTRAINT fk_cp_course FOREIGN KEY (course_id) REFERENCES courses(course_id) ON DELETE CASCADE,
  CONSTRAINT fk_cp_program FOREIGN KEY (program_id) REFERENCES programmes(program_id)
) ENGINE=InnoDB;

CREATE TABLE grades (
  grade_id     INT AUTO_INCREMENT PRIMARY KEY,
  student_id   CHAR(36)    NOT NULL,
  course_id    INT         NOT NULL,
  grade_value  VARCHAR(10) NOT NULL,   -- free-form: "A", "B+", "75" — not validated against a fixed scale
  recorded_by  INT         NOT NULL,   -- accounts.account_id of the lecturer who entered it
  recorded_at  TIMESTAMP   NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

  CONSTRAINT fk_grades_student FOREIGN KEY (student_id) REFERENCES students(student_id),
  CONSTRAINT fk_grades_course FOREIGN KEY (course_id) REFERENCES courses(course_id) ON DELETE CASCADE,
  CONSTRAINT fk_grades_recorded_by FOREIGN KEY (recorded_by) REFERENCES accounts(account_id),
  CONSTRAINT uq_grade_per_student_course UNIQUE (student_id, course_id)
) ENGINE=InnoDB;

CREATE TABLE attendance (
  attendance_id INT AUTO_INCREMENT PRIMARY KEY,
  student_id    CHAR(36) NOT NULL,
  course_id     INT      NOT NULL,
  session_date  DATE     NOT NULL,
  status        ENUM('present','absent','late') NOT NULL,
  recorded_by   INT      NOT NULL,
  recorded_at   TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

  CONSTRAINT fk_attendance_student FOREIGN KEY (student_id) REFERENCES students(student_id),
  CONSTRAINT fk_attendance_course FOREIGN KEY (course_id) REFERENCES courses(course_id) ON DELETE CASCADE,
  CONSTRAINT fk_attendance_recorded_by FOREIGN KEY (recorded_by) REFERENCES accounts(account_id),
  CONSTRAINT uq_attendance_per_day UNIQUE (student_id, course_id, session_date)
) ENGINE=InnoDB;

CREATE TABLE timetable (
  timetable_id INT AUTO_INCREMENT PRIMARY KEY,
  course_id    INT NOT NULL,
  day_of_week  ENUM('MON','TUE','WED','THU','FRI','SAT') NOT NULL,
  start_time   TIME NOT NULL,
  end_time     TIME NOT NULL,
  room         VARCHAR(50) NULL,

  CONSTRAINT fk_timetable_course FOREIGN KEY (course_id) REFERENCES courses(course_id) ON DELETE CASCADE
) ENGINE=InnoDB;

-- A couple of demo courses so the new endpoints have something to return immediately.
INSERT INTO courses (course_code, course_name) VALUES
  ('CS301', 'Mobile Application Development'),
  ('IT250', 'Database Systems');

INSERT INTO course_programmes (course_id, program_id)
SELECT c.course_id, p.program_id FROM courses c, programmes p
WHERE c.course_code = 'CS301' AND p.program_code IN ('CS', 'IT');

INSERT INTO course_programmes (course_id, program_id)
SELECT c.course_id, p.program_id FROM courses c, programmes p
WHERE c.course_code = 'IT250' AND p.program_code = 'IT';

INSERT INTO timetable (course_id, day_of_week, start_time, end_time, room)
SELECT course_id, 'MON', '09:00:00', '11:00:00', 'Lab 2' FROM courses WHERE course_code = 'CS301';
INSERT INTO timetable (course_id, day_of_week, start_time, end_time, room)
SELECT course_id, 'WED', '13:00:00', '15:00:00', 'Lab 2' FROM courses WHERE course_code = 'CS301';
INSERT INTO timetable (course_id, day_of_week, start_time, end_time, room)
SELECT course_id, 'TUE', '08:00:00', '10:00:00', 'Room 14' FROM courses WHERE course_code = 'IT250';
