package com.example.ict361_lab.network;

import android.content.Context;

import java.util.concurrent.TimeUnit;

import okhttp3.OkHttpClient;
import okhttp3.logging.HttpLoggingInterceptor;
import retrofit2.Retrofit;
import retrofit2.converter.gson.GsonConverterFactory;

/**
 * One Retrofit/OkHttp instance for the whole app.
 *
 * BASE_URL: 10.0.2.2 is the Android EMULATOR's alias for the host
 * machine's loopback — use it when running `npm start` in /backend on
 * the same computer as Android Studio. Change it to:
 *   - your machine's LAN IP (e.g. "http://192.168.1.23:3000/") when
 *     testing on a physical device on the same Wi-Fi, or
 *   - the real deployed HTTPS URL once the backend is hosted somewhere
 *     (and delete the cleartext exception in
 *     res/xml/network_security_config.xml at that point — the lab
 *     requires HTTPS for the remote backend).
 *
 * Call ApiClient.get(context) to obtain the ApiService; the underlying
 * Retrofit/OkHttpClient are built once and reused.
 */
public class ApiClient {

    public static final String BASE_URL = "http://10.0.2.2:3000/";

    private static ApiService apiService;
    private static TokenStore tokenStore;

    public static synchronized ApiService get(Context context) {
        if (apiService == null) {
            tokenStore = new TokenStore(context);

            HttpLoggingInterceptor logging = new HttpLoggingInterceptor();
            // BODY logging is convenient in development but will print request/response
            // JSON — including registration payloads — to Logcat. Switch to
            // HttpLoggingInterceptor.Level.BASIC (or remove the interceptor) before
            // this is ever built in release mode.
            logging.setLevel(HttpLoggingInterceptor.Level.BODY);

            OkHttpClient client = new OkHttpClient.Builder()
                    .addInterceptor(new AuthInterceptor(tokenStore))
                    .addInterceptor(logging)
                    .connectTimeout(15, TimeUnit.SECONDS)
                    .readTimeout(15, TimeUnit.SECONDS)
                    .build();

            Retrofit retrofit = new Retrofit.Builder()
                    .baseUrl(BASE_URL)
                    .client(client)
                    .addConverterFactory(GsonConverterFactory.create())
                    .build();

            apiService = retrofit.create(ApiService.class);
        }
        return apiService;
    }

    public static synchronized TokenStore getTokenStore(Context context) {
        if (tokenStore == null) {
            get(context); // initialises tokenStore as a side effect
        }
        return tokenStore;
    }
}
