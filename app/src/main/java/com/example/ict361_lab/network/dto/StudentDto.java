package com.example.ict361_lab.network.dto;

import com.google.gson.annotations.SerializedName;

/**
 * Wire shape returned by the backend for a student record — see
 * STUDENT_SELECT in backend/src/routes/student.routes.js and
 * API_CONTRACT.md. Kept separate from the domain Student model so the
 * JSON field names (snake_case, matching the SQL columns) don't leak
 * into the rest of the app; repositories map this to/from the domain
 * model.
 */
public class StudentDto {
    @SerializedName("student_id")
    public String studentId;

    @SerializedName("student_number")
    public String studentNumber;

    @SerializedName("student_name")
    public String studentName;

    @SerializedName("status")
    public String status; // "active" | "deleted"

    @SerializedName("version")
    public int version;

    @SerializedName("program_code")
    public String programCode; // "CS" | "IT" | "DS"

    @SerializedName("group_code")
    public String groupCode; // "G01".."G04", or null when Unassigned

    @SerializedName("created_at")
    public String createdAt;

    @SerializedName("updated_at")
    public String updatedAt;

    @SerializedName("group_occupancy")
    public GroupOccupancyDto groupOccupancy; // present only on GET /students/me

    public static class GroupOccupancyDto {
        @SerializedName("active_count")
        public int activeCount;

        @SerializedName("capacity")
        public int capacity;
    }
}
