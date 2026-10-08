package com.example.ict361_lab.viewmodel;

import androidx.lifecycle.LiveData;
import androidx.lifecycle.ViewModel;

import com.example.ict361_lab.model.AuthResult;
import com.example.ict361_lab.model.GroupInfo;
import com.example.ict361_lab.model.Student;
import com.example.ict361_lab.repository.Resource;
import com.example.ict361_lab.repository.StudentRepository;

import java.util.List;
import java.util.UUID;

/**
 * Thin pass-through to whichever StudentRepository was injected (Fake or
 * Remote today; an offline-first Room-backed one once the sync team adds
 * it — see notes.txt). Screens observe the returned LiveData and render
 * Resource.LOADING / SUCCESS / ERROR; no networking or SQL happens here.
 *
 * Each write method generates its own operationId via UUID.randomUUID()
 * so a fragment doesn't have to think about idempotency — call the method
 * again with the SAME arguments and it'll go through as a fresh action
 * (fresh id), which is what you want for "the user tapped Save again".
 * WorkManager-driven retries of a QUEUED, already-attempted operation
 * (the offline case) are different — that path should reuse the id that
 * was stored with the queued operation, which is why createStudent's
 * repository-level signature exposes operationId as a parameter rather
 * than generating it internally.
 */
public class StudentViewModel extends ViewModel {

    private final StudentRepository repository;

    public StudentViewModel(StudentRepository repository) {
        this.repository = repository;
    }

    // ---- Auth ---------------------------------------------------------

    public LiveData<Resource<AuthResult>> login(String username, String password) {
        return repository.login(username, password);
    }

    public LiveData<Resource<AuthResult>> register(String claimCode, String studentName, String studentNumber,
                                                     String programCode, String username, String password) {
        return repository.register(claimCode, studentName, studentNumber, programCode, username, password);
    }

    // ---- Reads ----------------------------------------------------------

    public LiveData<Resource<List<Student>>> getStudents(String search, String programCode, String groupCode,
                                                           int page, int pageSize) {
        return repository.getStudents(search, programCode, groupCode, page, pageSize);
    }

    public LiveData<Resource<Student>> getMyProfile() {
        return repository.getMyProfile();
    }

    public LiveData<Resource<Student>> getStudentById(String studentId) {
        return repository.getStudentById(studentId);
    }

    public LiveData<Resource<List<GroupInfo>>> getGroups() {
        return repository.getGroups();
    }

    // ---- Writes ---------------------------------------------------------

    public LiveData<Resource<String>> createStudent(String studentName, String studentNumber,
                                                      String programCode, String groupCode) {
        return repository.createStudent(newOperationId(), studentName, studentNumber, programCode, groupCode);
    }

    public LiveData<Resource<Student>> updateStudent(String studentId, String studentName,
                                                       String programCode, Integer expectedVersion) {
        return repository.updateStudent(studentId, newOperationId(), studentName, programCode, expectedVersion);
    }

    public LiveData<Resource<Student>> transferGroup(String studentId, String groupCode, Integer expectedVersion) {
        return repository.transferGroup(studentId, newOperationId(), groupCode, expectedVersion);
    }

    public LiveData<Resource<Void>> deleteStudent(String studentId) {
        return repository.deleteStudent(studentId, newOperationId());
    }

    public LiveData<Resource<Void>> requestNumberCorrection(String studentId, String requestedNumber) {
        return repository.requestNumberCorrection(studentId, requestedNumber);
    }

    private static String newOperationId() {
        return UUID.randomUUID().toString();
    }
}
