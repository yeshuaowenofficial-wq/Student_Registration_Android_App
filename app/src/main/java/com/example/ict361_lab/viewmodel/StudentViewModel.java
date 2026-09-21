package com.example.ict361_lab.viewmodel;

import androidx.lifecycle.LiveData;
import androidx.lifecycle.ViewModel;
import com.example.ict361_lab.model.Student;
import com.example.ict361_lab.repository.Resource;
import com.example.ict361_lab.repository.StudentRepository;
import java.util.List;

public class StudentViewModel extends ViewModel {

    private final StudentRepository repository;

    // Pass repository via constructor or dependency injection
    public StudentViewModel(StudentRepository repository) {
        this.repository = repository;
    }

    public LiveData<Resource<List<Student>>> getStudents() {
        return repository.getStudents();
    }

    public LiveData<Resource<Student>> getStudentById(String studentId) {
        return repository.getStudentById(studentId);
    }
}