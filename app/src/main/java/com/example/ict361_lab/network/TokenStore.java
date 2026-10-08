package com.example.ict361_lab.network;

import android.content.Context;
import android.content.SharedPreferences;

/**
 * Holds the current session: the JWT and a couple of identity fields the
 * UI needs (role, student_id). Deliberately never stores a password — the
 * lab requires the phone to never save passwords, only the server-issued
 * token.
 *
 * This is plain SharedPreferences, which is adequate to prove the wiring
 * end-to-end, but it is NOT encrypted at rest. Before this ships, swap the
 * backing store for androidx.security:security-crypto's
 * EncryptedSharedPreferences (same get/put API) — flagged again in
 * notes.txt for whichever team owns hardening the client.
 *
 * clear() is called on logout per the lab's "clear or lock account data on
 * logout" requirement; call it there and nowhere else drops the session.
 */
public class TokenStore {
    private static final String PREFS_NAME = "auth_session";
    private static final String KEY_TOKEN = "token";
    private static final String KEY_ROLE = "role";
    private static final String KEY_STUDENT_ID = "student_id";
    private static final String KEY_ACCOUNT_ID = "account_id";

    private final SharedPreferences prefs;

    public TokenStore(Context context) {
        this.prefs = context.getApplicationContext()
                .getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE);
    }

    public void save(String token, String role, String studentId, int accountId) {
        prefs.edit()
                .putString(KEY_TOKEN, token)
                .putString(KEY_ROLE, role)
                .putString(KEY_STUDENT_ID, studentId)
                .putInt(KEY_ACCOUNT_ID, accountId)
                .apply();
    }

    public String getToken() {
        return prefs.getString(KEY_TOKEN, null);
    }

    public String getRole() {
        return prefs.getString(KEY_ROLE, null);
    }

    public String getStudentId() {
        return prefs.getString(KEY_STUDENT_ID, null);
    }

    public boolean isLoggedIn() {
        return getToken() != null;
    }

    public boolean isLecturer() {
        return "lecturer".equals(getRole());
    }

    /** Call on logout and whenever the server reports the session is no longer valid (401). */
    public void clear() {
        prefs.edit().clear().apply();
    }
}
