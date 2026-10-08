package com.example.ict361_lab.network.dto;

/**
 * Every error the backend returns has this shape (see API_CONTRACT.md).
 * Parse a failed Retrofit response's errorBody() into this with Gson to
 * get a machine-readable code (e.g. "GROUP_FULL", "VERSION_CONFLICT") to
 * branch on, plus a human-readable message to show the user.
 */
public class ApiError {
    public String error;   // machine-readable code, e.g. GROUP_FULL
    public String message; // human-readable, safe to show in the UI
}
