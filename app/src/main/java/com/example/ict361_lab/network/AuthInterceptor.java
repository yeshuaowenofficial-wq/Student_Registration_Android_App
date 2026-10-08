package com.example.ict361_lab.network;

import androidx.annotation.NonNull;

import java.io.IOException;

import okhttp3.Interceptor;
import okhttp3.Request;
import okhttp3.Response;

/**
 * Attaches "Authorization: Bearer <token>" to every outgoing request once
 * TokenStore has one. The two /api/auth/* routes are called before a token
 * exists, so this is a no-op for them — nothing needs to special-case the
 * URL here.
 */
public class AuthInterceptor implements Interceptor {

    private final TokenStore tokenStore;

    public AuthInterceptor(TokenStore tokenStore) {
        this.tokenStore = tokenStore;
    }

    @NonNull
    @Override
    public Response intercept(@NonNull Chain chain) throws IOException {
        Request original = chain.request();
        String token = tokenStore.getToken();
        if (token == null) {
            return chain.proceed(original);
        }
        Request authorised = original.newBuilder()
                .header("Authorization", "Bearer " + token)
                .build();
        return chain.proceed(authorised);
    }
}
