package com.example.ict361_lab.repository;

import androidx.lifecycle.LiveData;
import androidx.lifecycle.MutableLiveData;
import com.example.ict361_lab.model.Student;
import java.util.ArrayList;
import java.util.List;

public class FakeStudentRepository implements StudentRepository {

    @Override
    public LiveData<Resource<List<Student>>> getStudents() {
        MutableLiveData<Resource<List<Student>>> result = new MutableLiveData<>();
        result.setValue(Resource.loading(null));

        List<Student> mockList = new ArrayList<>();
        mockList.add(new Student("101", "Alice Johnson"));
        mockList.add(new Student("102", "Bob Smith"));
        mockList.add(new Student("103", "Charlie Brown"));

        result.setValue(Resource.success(mockList));
        return result;
    }

    @Override
    public LiveData<Resource<Student>> getStudentById(String studentId) {
        MutableLiveData<Resource<Student>> result = new MutableLiveData<>();
        result.setValue(Resource.loading(null));

        Student mockStudent = new Student(studentId, "Sample Student (" + studentId + ")");
        result.setValue(Resource.success(mockStudent));

        return result;
    }
}