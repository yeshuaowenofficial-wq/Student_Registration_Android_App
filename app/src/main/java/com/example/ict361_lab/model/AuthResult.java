package com.example.ict361_lab.model;

/** Result of a successful login or registration — the ViewModel doesn't need the raw JWT shape. */
public class AuthResult {
    private final int accountId;
    private final String studentId; // null for a lecturer account
    private final String role;      // "student" | "lecturer"
    private final String token;

    public AuthResult(int accountId, String studentId, String role, String token) {
        this.accountId = accountId;
        this.studentId = studentId;
        this.role = role;
        this.token = token;
    }

    public int getAccountId() { return accountId; }
    public String getStudentId() { return studentId; }
    public String getRole() { return role; }
    public String getToken() { return token; }
}
