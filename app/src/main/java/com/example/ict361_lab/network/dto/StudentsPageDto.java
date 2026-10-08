package com.example.ict361_lab.network.dto;

import com.google.gson.annotations.SerializedName;
import java.util.List;

/** Response body of GET /api/students (lecturer roster, search + filters). */
public class StudentsPageDto {
    @SerializedName("page")
    public int page;

    @SerializedName("page_size")
    public int pageSize;

    @SerializedName("total")
    public int total;

    @SerializedName("students")
    public List<StudentDto> students;
}
