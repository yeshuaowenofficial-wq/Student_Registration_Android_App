package com.example.ict361_lab.repository;

import androidx.lifecycle.LiveData;

import com.example.ict361_lab.model.AuthResult;
import com.example.ict361_lab.model.GroupInfo;
import com.example.ict361_lab.model.Student;

import java.util.List;

/**
 * Single seam between the UI/ViewModel layer and however data actually
 * gets fetched or stored. Two implementations exist today:
 *   - FakeStudentRepository: in-memory mock data, no network — useful for
 *     UI development before the backend or a device/emulator is available.
 *   - RemoteStudentRepository: talks to the real Node/Express API via
 *     Retrofit (see network/ApiClient.java).
 *
 * The local-storage/sync team's future Room-backed, offline-first
 * repository should implement this SAME interface (composing Room +
 * RemoteStudentRepository + WorkManager internally) so neither the
 * ViewModel nor any screen needs to change when that lands — see
 * notes.txt for the suggested approach.
 *
 * Every LiveData follows the Resource<T> convention: LOADING first, then
 * exactly one of SUCCESS or ERROR. Mutating calls take an operationId the
 * caller generates once per logical user action (see idempotency notes on
 * ApiService) so a retried call is safe to repeat.
 */
public interface StudentRepository {

    // ---- Auth ---------------------------------------------------------

    LiveData<Resource<AuthResult>> login(String username, String password);

    LiveData<Resource<AuthResult>> register(String claimCode, String studentName, String studentNumber,
                                             String programCode, String username, String password);

    // ---- Reads ----------------------------------------------------------

    /** Lecturer roster. Pass null for any filter you don't want applied. groupCode may be "UNASSIGNED". */
    LiveData<Resource<List<Student>>> getStudents(String search, String programCode, String groupCode,
                                                   int page, int pageSize);

    /** The signed-in student's own profile. */
    LiveData<Resource<Student>> getMyProfile();

    /** Lecturer: any student. Student: only their own id — the server enforces this either way. */
    LiveData<Resource<Student>> getStudentById(String studentId);

    LiveData<Resource<List<GroupInfo>>> getGroups();

    // ---- Writes (each needs a fresh operationId per logical action) -----

    LiveData<Resource<String>> createStudent(String operationId, String studentName, String studentNumber,
                                              String programCode, String groupCode);

    LiveData<Resource<Student>> updateStudent(String studentId, String operationId, String studentName,
                                               String programCode, Integer expectedVersion);

    LiveData<Resource<Student>> transferGroup(String studentId, String operationId, String groupCode,
                                               Integer expectedVersion);

    LiveData<Resource<Void>> deleteStudent(String studentId, String operationId);

    LiveData<Resource<Void>> requestNumberCorrection(String studentId, String requestedNumber);
}
