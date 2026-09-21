package com.example.ict361_lab.repository;

import androidx.lifecycle.LiveData;
import com.example.ict361_lab.model.Student;
import java.util.List;

public interface StudentRepository {
    LiveData<Resource<List<Student>>> getStudents();
    LiveData<Resource<Student>> getStudentById(String studentId);

}

