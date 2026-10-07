package com.example.ict361_lab.data;

import androidx.room.Entity;
import androidx.room.PrimaryKey;

@Entity(tableName = "students")
public class Student {
    @PrimaryKey(autoGenerate = true)
    public int id;
    public String name;
    public String studentNumber;
    public String email;

    public Student(String name, String studentNumber, String email) {
        this.name = name;
        this.studentNumber = studentNumber;
        this.email = email;
    }
}