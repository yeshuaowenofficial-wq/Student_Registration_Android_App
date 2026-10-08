package com.example.ict361_lab.repository;

import androidx.lifecycle.LiveData;
import androidx.lifecycle.MutableLiveData;

import com.example.ict361_lab.model.AuthResult;
import com.example.ict361_lab.model.GroupInfo;
import com.example.ict361_lab.model.Student;

import java.util.ArrayList;
import java.util.List;

/**
 * In-memory stand-in for RemoteStudentRepository. Useful for building and
 * demoing screens before an emulator/device can reach the Node backend, or
 * for UI tests that shouldn't depend on a live server. Every call resolves
 * immediately and "succeeds" unless the inputs are obviously invalid —
 * this is a development aid, not a spec for the server's real validation
 * or concurrency rules (see backend/src/services/groupAssignment.js for
 * those).
 */
public class FakeStudentRepository implements StudentRepository {

    private final List<Student> mockStudents = new ArrayList<>();

    public FakeStudentRepository() {
        mockStudents.add(new Student("11111111-1111-4111-8111-111111111111", "200912345",
                "Alice Johnson", "active", 1, "CS", "G01"));
        mockStudents.add(new Student("22222222-2222-4222-8222-222222222222", "200912346",
                "Bob Smith", "active", 1, "IT", "G01"));
        mockStudents.add(new Student("33333333-3333-4333-8333-333333333333", "200912347",
                "Charlie Brown", "active", 1, "DS", null));
    }

    @Override
    public LiveData<Resource<AuthResult>> login(String username, String password) {
        MutableLiveData<Resource<AuthResult>> result = new MutableLiveData<>(Resource.loading(null));
        AuthResult fake = new AuthResult(1, "11111111-1111-4111-8111-111111111111", "student", "fake-token");
        result.setValue(Resource.success(fake));
        return result;
    }

    @Override
    public LiveData<Resource<AuthResult>> register(String claimCode, String studentName, String studentNumber,
                                                     String programCode, String username, String password) {
        MutableLiveData<Resource<AuthResult>> result = new MutableLiveData<>(Resource.loading(null));
        String newId = java.util.UUID.randomUUID().toString();
        mockStudents.add(new Student(newId, studentNumber, studentName, "active", 1, programCode, null));
        result.setValue(Resource.success(new AuthResult(mockStudents.size(), newId, "student", "fake-token")));
        return result;
    }

    @Override
    public LiveData<Resource<List<Student>>> getStudents(String search, String programCode, String groupCode,
                                                           int page, int pageSize) {
        MutableLiveData<Resource<List<Student>>> result = new MutableLiveData<>(Resource.loading(null));
        List<Student> filtered = new ArrayList<>();
        for (Student s : mockStudents) {
            if (search != null && !s.getStudentName().toLowerCase().contains(search.toLowerCase())
                    && !s.getStudentNumber().contains(search)) continue;
            if (programCode != null && !programCode.equals(s.getProgramCode())) continue;
            if ("UNASSIGNED".equals(groupCode) && s.getGroupCode() != null) continue;
            if (groupCode != null && !"UNASSIGNED".equals(groupCode) && !groupCode.equals(s.getGroupCode())) continue;
            filtered.add(s);
        }
        result.setValue(Resource.success(filtered));
        return result;
    }

    @Override
    public LiveData<Resource<Student>> getMyProfile() {
        MutableLiveData<Resource<Student>> result = new MutableLiveData<>(Resource.loading(null));
        result.setValue(Resource.success(mockStudents.get(0)));
        return result;
    }

    @Override
    public LiveData<Resource<Student>> getStudentById(String studentId) {
        MutableLiveData<Resource<Student>> result = new MutableLiveData<>(Resource.loading(null));
        for (Student s : mockStudents) {
            if (s.getStudentId().equals(studentId)) {
                result.setValue(Resource.success(s));
                return result;
            }
        }
        result.setValue(Resource.error("Student not found", null));
        return result;
    }

    @Override
    public LiveData<Resource<List<GroupInfo>>> getGroups() {
        MutableLiveData<Resource<List<GroupInfo>>> result = new MutableLiveData<>(Resource.loading(null));
        List<GroupInfo> groups = new ArrayList<>();
        for (String code : new String[]{"G01", "G02", "G03", "G04"}) {
            int count = 0;
            for (Student s : mockStudents) if (code.equals(s.getGroupCode())) count++;
            groups.add(new GroupInfo(code, 15, count));
        }
        result.setValue(Resource.success(groups));
        return result;
    }

    @Override
    public LiveData<Resource<String>> createStudent(String operationId, String studentName, String studentNumber,
                                                      String programCode, String groupCode) {
        MutableLiveData<Resource<String>> result = new MutableLiveData<>(Resource.loading(null));
        String newId = java.util.UUID.randomUUID().toString();
        mockStudents.add(new Student(newId, studentNumber, studentName, "active", 1, programCode,
                "UNASSIGNED".equals(groupCode) ? null : groupCode));
        result.setValue(Resource.success(newId));
        return result;
    }

    @Override
    public LiveData<Resource<Student>> updateStudent(String studentId, String operationId, String studentName,
                                                       String programCode, Integer expectedVersion) {
        MutableLiveData<Resource<Student>> result = new MutableLiveData<>(Resource.loading(null));
        for (int i = 0; i < mockStudents.size(); i++) {
            Student s = mockStudents.get(i);
            if (s.getStudentId().equals(studentId)) {
                Student updated = new Student(s.getStudentId(), s.getStudentNumber(),
                        studentName != null ? studentName : s.getStudentName(), s.getStatus(),
                        s.getVersion() + 1, programCode != null ? programCode : s.getProgramCode(),
                        s.getGroupCode());
                mockStudents.set(i, updated);
                result.setValue(Resource.success(updated));
                return result;
            }
        }
        result.setValue(Resource.error("Student not found", null));
        return result;
    }

    @Override
    public LiveData<Resource<Student>> transferGroup(String studentId, String operationId, String groupCode,
                                                       Integer expectedVersion) {
        MutableLiveData<Resource<Student>> result = new MutableLiveData<>(Resource.loading(null));
        int activeInTarget = 0;
        for (Student s : mockStudents) if (groupCode != null && groupCode.equals(s.getGroupCode())) activeInTarget++;
        if (groupCode != null && !"UNASSIGNED".equals(groupCode) && activeInTarget >= 15) {
            result.setValue(Resource.error("GROUP_FULL", null));
            return result;
        }
        for (int i = 0; i < mockStudents.size(); i++) {
            Student s = mockStudents.get(i);
            if (s.getStudentId().equals(studentId)) {
                Student updated = new Student(s.getStudentId(), s.getStudentNumber(), s.getStudentName(),
                        s.getStatus(), s.getVersion() + 1, s.getProgramCode(),
                        "UNASSIGNED".equals(groupCode) ? null : groupCode);
                mockStudents.set(i, updated);
                result.setValue(Resource.success(updated));
                return result;
            }
        }
        result.setValue(Resource.error("Student not found", null));
        return result;
    }

    @Override
    public LiveData<Resource<Void>> deleteStudent(String studentId, String operationId) {
        MutableLiveData<Resource<Void>> result = new MutableLiveData<>(Resource.loading(null));
        mockStudents.removeIf(s -> s.getStudentId().equals(studentId));
        result.setValue(Resource.success(null));
        return result;
    }

    @Override
    public LiveData<Resource<Void>> requestNumberCorrection(String studentId, String requestedNumber) {
        MutableLiveData<Resource<Void>> result = new MutableLiveData<>(Resource.loading(null));
        result.setValue(Resource.success(null));
        return result;
    }
}
