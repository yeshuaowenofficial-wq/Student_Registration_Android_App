package com.example.ict361_lab.network.dto;

import com.google.gson.annotations.SerializedName;

public class StudentMutationDtos {

    /** POST /api/students body (lecturer creates a profile ahead of self-registration) */
    public static class CreateStudentRequest {
        @SerializedName("student_name")
        public String studentName;
        @SerializedName("student_number")
        public String studentNumber;
        @SerializedName("program_code")
        public String programCode;
        @SerializedName("group_code")
        public String groupCode; // "G01".."G04" or "UNASSIGNED"

        public CreateStudentRequest(String studentName, String studentNumber, String programCode, String groupCode) {
            this.studentName = studentName;
            this.studentNumber = studentNumber;
            this.programCode = programCode;
            this.groupCode = groupCode;
        }
    }

    /** Response of POST /api/students */
    public static class CreateStudentResponse {
        @SerializedName("student_id")
        public String studentId;
        @SerializedName("claim_code")
        public String claimCode; // hand this to the real student so they can self-register
    }

    /**
     * PUT /api/students/:id body. Lecturers may set either field; students
     * may set studentName/programCode only (never studentNumber/groupCode —
     * the server rejects those for a student caller regardless).
     * expectedVersion enables the optimistic-lock conflict check described
     * in the lab brief; pass the version last read from the server.
     */
    public static class UpdateStudentRequest {
        @SerializedName("student_name")
        public String studentName; // nullable — omit fields you're not changing

        @SerializedName("program_code")
        public String programCode; // nullable

        @SerializedName("expected_version")
        public Integer expectedVersion;

        public UpdateStudentRequest(String studentName, String programCode, Integer expectedVersion) {
            this.studentName = studentName;
            this.programCode = programCode;
            this.expectedVersion = expectedVersion;
        }
    }

    /** POST /api/students/:id/group-transfer body */
    public static class GroupTransferRequest {
        @SerializedName("group_code")
        public String groupCode; // "G01".."G04" or "UNASSIGNED"
        @SerializedName("expected_version")
        public Integer expectedVersion;

        public GroupTransferRequest(String groupCode, Integer expectedVersion) {
            this.groupCode = groupCode;
            this.expectedVersion = expectedVersion;
        }
    }

    /** Response of a successful group transfer */
    public static class GroupTransferResponse {
        @SerializedName("student_id")
        public String studentId;
        @SerializedName("group_code")
        public String groupCode;
        public int version;
    }

    /** POST /api/students/:id/correction-request body (student asks a lecturer to fix their number) */
    public static class CorrectionRequestBody {
        @SerializedName("requested_value")
        public String requestedValue;

        public CorrectionRequestBody(String requestedValue) {
            this.requestedValue = requestedValue;
        }
    }
}
