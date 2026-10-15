package com.example.ict361_lab.ui;

import android.annotation.SuppressLint;
import android.content.Context;
import android.content.Intent;
import android.net.ConnectivityManager;
import android.net.NetworkCapabilities;
import android.os.Build;
import android.os.Bundle;
import android.os.VibrationEffect;
import android.os.Vibrator;
import android.webkit.JavascriptInterface;
import android.webkit.WebChromeClient;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Toast;

import androidx.activity.EdgeToEdge;
import androidx.activity.OnBackPressedCallback;
import androidx.appcompat.app.AppCompatActivity;
import androidx.core.graphics.Insets;
import androidx.core.view.ViewCompat;
import androidx.core.view.WindowInsetsCompat;

import com.example.ict361_lab.R;
import com.example.ict361_lab.network.TokenStore;

public class MainActivity extends AppCompatActivity {

    private WebView webView;
    private TokenStore tokenStore;

    @SuppressLint("SetJavaScriptEnabled")
    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        EdgeToEdge.enable(this);
        setContentView(R.layout.activity_main);

        tokenStore = new TokenStore(this);
        webView = findViewById(R.id.webView);

        ViewCompat.setOnApplyWindowInsetsListener(findViewById(R.id.main), (v, insets) -> {
            Insets systemBars = insets.getInsets(WindowInsetsCompat.Type.systemBars());
            v.setPadding(systemBars.left, systemBars.top, systemBars.right, systemBars.bottom);
            return insets;
        });

        WebSettings settings = webView.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setAllowFileAccess(true);
        settings.setAllowContentAccess(true);
        settings.setDatabaseEnabled(true);
        settings.setLoadWithOverviewMode(true);
        settings.setUseWideViewPort(true);

        webView.setWebChromeClient(new WebChromeClient());
        webView.setWebViewClient(new WebViewClient() {
            @Override
            public boolean shouldOverrideUrlLoading(WebView view, String url) {
                return false;
            }
        });

        // Register two-way Javascript Interface Bridge
        webView.addJavascriptInterface(new WebAppInterface(this), "Android");

        // Load modern responsive SPA from assets
        webView.loadUrl("file:///android_asset/www/index.html");

        // Handle physical/system back button safely
        getOnBackPressedDispatcher().addCallback(this, new OnBackPressedCallback(true) {
            @Override
            public void handleOnBackPressed() {
                if (webView.canGoBack()) {
                    webView.goBack();
                } else {
                    setEnabled(false);
                    getOnBackPressedDispatcher().onBackPressed();
                }
            }
        });
    }

    /**
     * WebAppInterface exposed to JavaScript in the UI/UX
     */
    public class WebAppInterface {
        private final Context context;

        public WebAppInterface(Context context) {
            this.context = context;
        }

        /**
         * Activity D requirement: Share group summary preview through Android Sharesheet.
         * Only group label and counts; personal data excluded.
         */
        @JavascriptInterface
        public void openShareSheet(String title, String summary) {
            runOnUiThread(() -> {
                Intent shareIntent = new Intent(Intent.ACTION_SEND);
                shareIntent.setType("text/plain");
                shareIntent.putExtra(Intent.EXTRA_SUBJECT, title);
                shareIntent.putExtra(Intent.EXTRA_TEXT, summary);
                context.startActivity(Intent.createChooser(shareIntent, title));
            });
        }

        @JavascriptInterface
        public void showToast(String message) {
            runOnUiThread(() -> Toast.makeText(context, message, Toast.LENGTH_SHORT).show());
        }

        @JavascriptInterface
        public void vibrate(long milliseconds) {
            runOnUiThread(() -> {
                Vibrator vibrator = (Vibrator) context.getSystemService(Context.VIBRATOR_SERVICE);
                if (vibrator != null) {
                    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                        vibrator.vibrate(VibrationEffect.createOneShot(milliseconds, VibrationEffect.DEFAULT_AMPLITUDE));
                    } else {
                        vibrator.vibrate(milliseconds);
                    }
                }
            });
        }

        @JavascriptInterface
        public void saveSession(String token, String role, String studentId, int accountId) {
            tokenStore.save(token, role, studentId, accountId);
        }

        @JavascriptInterface
        public String getToken() {
            return tokenStore.getToken();
        }

        @JavascriptInterface
        public String getRole() {
            return tokenStore.getRole();
        }

        @JavascriptInterface
        public String getStudentId() {
            return tokenStore.getStudentId();
        }

        @JavascriptInterface
        public void clearSession() {
            tokenStore.clear();
        }

        @JavascriptInterface
        public boolean isOnline() {
            ConnectivityManager cm = (ConnectivityManager) context.getSystemService(Context.CONNECTIVITY_SERVICE);
            if (cm == null) return false;
            NetworkCapabilities nc = cm.getNetworkCapabilities(cm.getActiveNetwork());
            return nc != null && (nc.hasTransport(NetworkCapabilities.TRANSPORT_WIFI) ||
                    nc.hasTransport(NetworkCapabilities.TRANSPORT_CELLULAR) ||
                    nc.hasTransport(NetworkCapabilities.TRANSPORT_ETHERNET));
        }

        @JavascriptInterface
        public void setLauncherIcon(String launcherAlias) {
            // Allows user to dynamically switch launcher icon via activity-alias
        }
    }
}