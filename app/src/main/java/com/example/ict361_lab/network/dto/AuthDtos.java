package com.example.ict361_lab.network.dto;

import com.google.gson.annotations.SerializedName;

public class AuthDtos {

    /** POST /api/auth/login body */
    public static class LoginRequest {
        public String username;
        public String password;

        public LoginRequest(String username, String password) {
            this.username = username;
            this.password = password;
        }
    }

    /** POST /api/auth/register body */
    public static class RegisterRequest {
        @SerializedName("claim_code")
        public String claimCode;
        @SerializedName("student_name")
        public String studentName;
        @SerializedName("student_number")
        public String studentNumber;
        @SerializedName("program_code")
        public String programCode;
        public String username;
        public String password;

        public RegisterRequest(String claimCode, String studentName, String studentNumber,
                                String programCode, String username, String password) {
            this.claimCode = claimCode;
            this.studentName = studentName;
            this.studentNumber = studentNumber;
            this.programCode = programCode;
            this.username = username;
            this.password = password;
        }
    }

    /** Shared response shape for both login and register — see auth.routes.js */
    public static class AuthResponse {
        @SerializedName("account_id")
        public int accountId;
        @SerializedName("student_id")
        public String studentId; // null for a lecturer account
        public String role;      // "student" | "lecturer"
        public String token;     // JWT — send back as "Authorization: Bearer <token>"
    }
}
