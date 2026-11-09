package com.example.ict361_lab;

import androidx.lifecycle.LiveData;

import com.example.ict361_lab.model.AuthResult;
import com.example.ict361_lab.model.GroupInfo;
import com.example.ict361_lab.model.Student;
import com.example.ict361_lab.repository.FakeStudentRepository;
import com.example.ict361_lab.repository.Resource;

import org.junit.Before;
import org.junit.Test;

import java.util.List;

import static org.junit.Assert.*;

/**
 * Unit test verifying FakeStudentRepository behaves correctly as an in-memory test double
 * for ViewModel and UI tests without needing a running Node.js / MySQL backend.
 * Satisfies Activity B competency evidence ("a test with a fake repository").
 */
public class FakeRepositoryTest {

    private FakeStudentRepository repository;

    @Before
    public void setUp() {
        repository = new FakeStudentRepository();
    }

    @Test
    public void login_withValidMockCredentials_returnsSuccess() {
        LiveData<Resource<AuthResult>> liveData = repository.login("student1", "Password123!");
        Resource<AuthResult> resource = liveData.getValue();

        assertNotNull(resource);
        assertEquals(Resource.Status.SUCCESS, resource.status);
        assertNotNull(resource.data);
        assertEquals("fake-token", resource.data.getToken());
        assertEquals("student", resource.data.getRole());
    }

    @Test
    public void getStudents_filtersCorrectlyByProgram() {
        LiveData<Resource<List<Student>>> liveData = repository.getStudents(null, "CS", null, 1, 50);
        Resource<List<Student>> resource = liveData.getValue();

        assertNotNull(resource);
        assertEquals(Resource.Status.SUCCESS, resource.status);
        assertNotNull(resource.data);
        assertFalse(resource.data.isEmpty());

        for (Student s : resource.data) {
            assertEquals("CS", s.getProgramCode());
        }
    }

    @Test
    public void getGroups_returnsGroupListWithOccupancy() {
        LiveData<Resource<List<GroupInfo>>> liveData = repository.getGroups();
        Resource<List<GroupInfo>> resource = liveData.getValue();

        assertNotNull(resource);
        assertEquals(Resource.Status.SUCCESS, resource.status);
        assertNotNull(resource.data);
        assertTrue(resource.data.size() >= 4);

        boolean foundG01 = false;
        for (GroupInfo g : resource.data) {
            if ("G01".equals(g.getGroupCode())) {
                foundG01 = true;
                assertEquals(15, g.getCapacity());
                assertTrue(g.getActiveCount() >= 0);
            }
        }
        assertTrue(foundG01);
    }
}
