-- Campus Companion UI additions — run AFTER schema.sql (and 02_...sql if used).
--   mysql -u root -p < sql/03_campus_companion_ui.sql
--
-- Adds what the Android UI needs beyond the original lab schema:
--   * accounts.display_name / accounts.avatar  -> lecturer names + profile pictures
--   * lab_groups schedule columns              -> lecturer-editable weekly lab timetable
USE student_registration;

ALTER TABLE accounts
  ADD COLUMN display_name VARCHAR(100) NULL AFTER username,
  ADD COLUMN avatar       VARCHAR(40)  NULL AFTER display_name;   -- e.g. 'cat-1' -> assets/www/pfps/cat-1.svg

ALTER TABLE lab_groups
  ADD COLUMN schedule_day ENUM('MON','TUE','WED','THU','FRI','SAT') NULL,
  ADD COLUMN start_time   TIME        NULL,
  ADD COLUMN end_time     TIME        NULL,
  ADD COLUMN room         VARCHAR(60) NULL;

-- Default weekly lab slots (lecturers can change these from the app)
UPDATE lab_groups SET schedule_day='TUE', start_time='10:00', end_time='12:00', room='Engineering Lab 3' WHERE group_code='G01';
UPDATE lab_groups SET schedule_day='WED', start_time='14:00', end_time='16:00', room='CS Block Lab 1'    WHERE group_code='G02';
UPDATE lab_groups SET schedule_day='THU', start_time='08:00', end_time='10:00', room='IT Centre Lab 2'   WHERE group_code='G03';
UPDATE lab_groups SET schedule_day='FRI', start_time='14:00', end_time='16:00', room='Data Science Lab 4' WHERE group_code='G04';
