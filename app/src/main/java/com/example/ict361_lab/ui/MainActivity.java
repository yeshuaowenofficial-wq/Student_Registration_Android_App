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
import android.view.inputmethod.InputMethodManager;
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

import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

public class MainActivity extends AppCompatActivity {

    private WebView webView;
    private TokenStore tokenStore;
    private final ExecutorService networkExecutor = Executors.newCachedThreadPool();

    @SuppressLint("SetJavaScriptEnabled")
    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        EdgeToEdge.enable(this);
        setContentView(R.layout.activity_main);

        tokenStore = new TokenStore(this);
        webView = findViewById(R.id.webView);

        // Hardware accelerated WebView layer for 60fps rendering and zero lag
        webView.setLayerType(android.view.View.LAYER_TYPE_HARDWARE, null);

        ViewCompat.setOnApplyWindowInsetsListener(findViewById(R.id.main), (v, insets) -> {
            Insets systemBars = insets.getInsets(WindowInsetsCompat.Type.systemBars());
            v.setPadding(systemBars.left, systemBars.top, systemBars.right, systemBars.bottom);
            return insets;
        });

        WebSettings settings = webView.getSettings();
        settings.setDefaultTextEncodingName("UTF-8");
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setAllowFileAccess(true);
        settings.setAllowContentAccess(true);
        settings.setDatabaseEnabled(true);
        settings.setLoadWithOverviewMode(true);
        settings.setUseWideViewPort(true);

        // Allow cleartext HTTP & cross-origin AJAX/fetch from file:///android_asset to local network server
        settings.setMixedContentMode(WebSettings.MIXED_CONTENT_ALWAYS_ALLOW);
        settings.setAllowFileAccessFromFileURLs(true);
        settings.setAllowUniversalAccessFromFileURLs(true);

        webView.setWebChromeClient(new WebChromeClient());
        webView.setWebViewClient(new WebViewClient() {
            @Override
            public boolean shouldOverrideUrlLoading(WebView view, String url) {
                return false;
            }
        });

        // Register two-way Javascript Interface Bridge
        webView.addJavascriptInterface(new WebAppInterface(this), "Android");

        // Force Android process to prioritize Wi-Fi network routing over cellular (prevents Pixel cellular fallback)
        bindToWifiNetworkIfAvailable();

        // Load modern responsive SPA from assets
        webView.loadUrl("file:///android_asset/www/index.html");

        // Handle physical/system back button safely and predictably
        getOnBackPressedDispatcher().addCallback(this, new OnBackPressedCallback(true) {
            @Override
            public void handleOnBackPressed() {
                webView.evaluateJavascript("window.handleAndroidBack ? window.handleAndroidBack() : false", value -> {
                    boolean handledInJs = "true".equalsIgnoreCase(value);
                    if (!handledInJs) {
                        if (webView.canGoBack()) {
                            webView.goBack();
                        } else {
                            setEnabled(false);
                            getOnBackPressedDispatcher().onBackPressed();
                        }
                    }
                });
            }
        });
    }

    @Override
    protected void onDestroy() {
        super.onDestroy();
        networkExecutor.shutdownNow();
    }

    private void bindToWifiNetworkIfAvailable() {
        try {
            ConnectivityManager cm = (ConnectivityManager) getSystemService(Context.CONNECTIVITY_SERVICE);
            if (cm != null) {
                for (android.net.Network net : cm.getAllNetworks()) {
                    NetworkCapabilities nc = cm.getNetworkCapabilities(net);
                    if (nc != null && nc.hasTransport(NetworkCapabilities.TRANSPORT_WIFI)) {
                        cm.bindProcessToNetwork(net);
                        break;
                    }
                }
            }
        } catch (Exception ignored) {}
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
         * Asynchronous Native HTTP client running on background thread pool.
         * Completely eliminates UI/WebView V8 thread blocking during network calls.
         * Bypasses Chromium Private Network Access (PNA), CORS, and binds directly to Wi-Fi.
         */
        @JavascriptInterface
        public void nativeHttpRequestAsync(String reqId, String method, String urlStr, String headersJson, String bodyStr, int timeoutMs) {
            networkExecutor.execute(() -> {
                String responseBase64 = executeNativeHttpAndEncode(method, urlStr, headersJson, bodyStr, timeoutMs);
                runOnUiThread(() -> {
                    if (webView != null) {
                        webView.evaluateJavascript("window.__onNativeHttpResponse && window.__onNativeHttpResponse('" + reqId + "', '" + responseBase64 + "')", null);
                    }
                });
            });
        }

        private String executeNativeHttpAndEncode(String method, String urlStr, String headersJson, String bodyStr, int timeoutMs) {
            try {
                java.net.URL url = new java.net.URL(urlStr);
                ConnectivityManager cm = (ConnectivityManager) context.getSystemService(Context.CONNECTIVITY_SERVICE);
                android.net.Network wifiNetwork = null;
                if (cm != null) {
                    for (android.net.Network net : cm.getAllNetworks()) {
                        NetworkCapabilities nc = cm.getNetworkCapabilities(net);
                        if (nc != null && nc.hasTransport(NetworkCapabilities.TRANSPORT_WIFI)) {
                            wifiNetwork = net;
                            break;
                        }
                    }
                }

                java.net.HttpURLConnection conn;
                if (wifiNetwork != null) {
                    conn = (java.net.HttpURLConnection) wifiNetwork.openConnection(url);
                } else {
                    conn = (java.net.HttpURLConnection) url.openConnection();
                }

                int timeout = timeoutMs > 0 ? timeoutMs : 10000;
                conn.setConnectTimeout(timeout);
                conn.setReadTimeout(timeout);
                conn.setRequestMethod(method.toUpperCase());
                conn.setDoInput(true);
                conn.setInstanceFollowRedirects(true);

                if (headersJson != null && !headersJson.isEmpty()) {
                    org.json.JSONObject headersObj = new org.json.JSONObject(headersJson);
                    java.util.Iterator<String> keys = headersObj.keys();
                    while (keys.hasNext()) {
                        String key = keys.next();
                        conn.setRequestProperty(key, headersObj.getString(key));
                    }
                }

                if (bodyStr != null && !bodyStr.isEmpty() && 
                    ("POST".equalsIgnoreCase(method) || "PUT".equalsIgnoreCase(method) || "PATCH".equalsIgnoreCase(method))) {
                    conn.setDoOutput(true);
                    byte[] bytes = bodyStr.getBytes(java.nio.charset.StandardCharsets.UTF_8);
                    try (java.io.OutputStream os = conn.getOutputStream()) {
                        os.write(bytes);
                        os.flush();
                    }
                }

                int statusCode = conn.getResponseCode();
                String statusMessage = conn.getResponseMessage();

                java.io.InputStream is = (statusCode >= 200 && statusCode < 400) ? conn.getInputStream() : conn.getErrorStream();
                String responseBody = "";
                if (is != null) {
                    java.io.ByteArrayOutputStream baos = new java.io.ByteArrayOutputStream();
                    byte[] buf = new byte[4096];
                    int read;
                    while ((read = is.read(buf)) != -1) {
                        baos.write(buf, 0, read);
                    }
                    responseBody = baos.toString("UTF-8");
                    is.close();
                }

                org.json.JSONObject result = new org.json.JSONObject();
                result.put("status", statusCode);
                result.put("statusText", statusMessage != null ? statusMessage : "");
                result.put("body", responseBody);

                conn.disconnect();
                return android.util.Base64.encodeToString(result.toString().getBytes(java.nio.charset.StandardCharsets.UTF_8), android.util.Base64.NO_WRAP);
            } catch (Exception e) {
                org.json.JSONObject err = new org.json.JSONObject();
                try {
                    err.put("status", 0);
                    err.put("error", "NETWORK_ERROR");
                    err.put("message", e.getMessage() != null ? e.getMessage() : e.getClass().getSimpleName());
                } catch (Exception ignored) {}
                return android.util.Base64.encodeToString(err.toString().getBytes(java.nio.charset.StandardCharsets.UTF_8), android.util.Base64.NO_WRAP);
            }
        }

        /**
         * Synchronous fallback for legacy or direct callers.
         */
        @JavascriptInterface
        public String nativeHttpRequest(String method, String urlStr, String headersJson, String bodyStr, int timeoutMs) {
            String base64 = executeNativeHttpAndEncode(method, urlStr, headersJson, bodyStr, timeoutMs);
            try {
                byte[] decoded = android.util.Base64.decode(base64, android.util.Base64.DEFAULT);
                return new String(decoded, java.nio.charset.StandardCharsets.UTF_8);
            } catch (Exception e) {
                return "{\"status\":0,\"error\":\"NETWORK_ERROR\",\"message\":\"" + e.getMessage() + "\"}";
            }
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

        /**
         * Generates a native Microsoft Excel (.xlsx) workbook for a specific lab group,
         * saves it to the device's Downloads folder, and opens the Android Sharesheet
         * so it can be opened directly in Excel / Google Sheets or shared via WhatsApp/Email.
         */
        @JavascriptInterface
        public void exportGroupExcel(String fileName, String groupTitle, String rowsJson) {
            networkExecutor.execute(() -> {
                try {
                    String safeName = (fileName != null && !fileName.trim().isEmpty())
                            ? fileName.trim().replaceAll("[^a-zA-Z0-9._-]", "_")
                            : "Group_Roster.xlsx";
                    if (!safeName.toLowerCase().endsWith(".xlsx")) {
                        safeName += ".xlsx";
                    }

                    byte[] xlsxBytes = buildXlsxBytes(groupTitle != null ? groupTitle : "GROUP ROSTER", rowsJson);

                    // 1. Save a copy to public Downloads folder
                    boolean savedToDownloads = false;
                    try {
                        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                            android.content.ContentValues values = new android.content.ContentValues();
                            values.put(android.provider.MediaStore.MediaColumns.DISPLAY_NAME, safeName);
                            values.put(android.provider.MediaStore.MediaColumns.MIME_TYPE, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
                            values.put(android.provider.MediaStore.MediaColumns.RELATIVE_PATH, android.os.Environment.DIRECTORY_DOWNLOADS);
                            android.net.Uri uri = context.getContentResolver().insert(android.provider.MediaStore.Downloads.EXTERNAL_CONTENT_URI, values);
                            if (uri != null) {
                                try (java.io.OutputStream os = context.getContentResolver().openOutputStream(uri)) {
                                    if (os != null) {
                                        os.write(xlsxBytes);
                                        os.flush();
                                        savedToDownloads = true;
                                    }
                                }
                            }
                        } else {
                            java.io.File dlDir = android.os.Environment.getExternalStoragePublicDirectory(android.os.Environment.DIRECTORY_DOWNLOADS);
                            if (dlDir != null && (dlDir.exists() || dlDir.mkdirs())) {
                                java.io.File outFile = new java.io.File(dlDir, safeName);
                                try (java.io.FileOutputStream fos = new java.io.FileOutputStream(outFile)) {
                                    fos.write(xlsxBytes);
                                    fos.flush();
                                    savedToDownloads = true;
                                }
                            }
                        }
                    } catch (Exception ignored) {}

                    // 2. Write to cache/exports and invoke Android Sharesheet via FileProvider
                    java.io.File exportDir = new java.io.File(context.getCacheDir(), "exports");
                    if (!exportDir.exists()) exportDir.mkdirs();
                    java.io.File cacheFile = new java.io.File(exportDir, safeName);
                    try (java.io.FileOutputStream fos = new java.io.FileOutputStream(cacheFile)) {
                        fos.write(xlsxBytes);
                        fos.flush();
                    }

                    final String finalFileName = safeName;
                    final boolean dlOk = savedToDownloads;
                    final android.net.Uri fileUri = androidx.core.content.FileProvider.getUriForFile(
                            context,
                            context.getPackageName() + ".fileprovider",
                            cacheFile
                    );

                    runOnUiThread(() -> {
                        if (dlOk) {
                            Toast.makeText(context, "Saved " + finalFileName + " to Downloads", Toast.LENGTH_LONG).show();
                        }
                        Intent shareIntent = new Intent(Intent.ACTION_SEND);
                        shareIntent.setType("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
                        shareIntent.putExtra(Intent.EXTRA_SUBJECT, groupTitle);
                        shareIntent.putExtra(Intent.EXTRA_STREAM, fileUri);
                        shareIntent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
                        context.startActivity(Intent.createChooser(shareIntent, "Export " + groupTitle + " Excel"));
                    });
                } catch (Exception e) {
                    runOnUiThread(() -> Toast.makeText(context, "Excel export failed: " + e.getMessage(), Toast.LENGTH_LONG).show());
                }
            });
        }

        private byte[] buildXlsxBytes(String groupTitle, String rowsJson) throws Exception {
            org.json.JSONArray arr = new org.json.JSONArray(rowsJson != null ? rowsJson : "[]");
            java.io.ByteArrayOutputStream baos = new java.io.ByteArrayOutputStream();
            try (java.util.zip.ZipOutputStream zos = new java.util.zip.ZipOutputStream(baos)) {
                // [Content_Types].xml
                putZipEntry(zos, "[Content_Types].xml",
                        "<?xml version=\"1.0\" encoding=\"UTF-8\" standalone=\"yes\"?>" +
                        "<Types xmlns=\"http://schemas.openxmlformats.org/package/2006/content-types\">" +
                        "<Default Extension=\"rels\" ContentType=\"application/vnd.openxmlformats-package.relationships+xml\"/>" +
                        "<Default Extension=\"xml\" ContentType=\"application/xml\"/>" +
                        "<Override PartName=\"/xl/workbook.xml\" ContentType=\"application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml\"/>" +
                        "<Override PartName=\"/xl/worksheets/sheet1.xml\" ContentType=\"application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml\"/>" +
                        "<Override PartName=\"/xl/styles.xml\" ContentType=\"application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml\"/>" +
                        "</Types>");

                // _rels/.rels
                putZipEntry(zos, "_rels/.rels",
                        "<?xml version=\"1.0\" encoding=\"UTF-8\" standalone=\"yes\"?>" +
                        "<Relationships xmlns=\"http://schemas.openxmlformats.org/package/2006/relationships\">" +
                        "<Relationship Id=\"rId1\" Type=\"http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument\" Target=\"xl/workbook.xml\"/>" +
                        "</Relationships>");

                // xl/workbook.xml
                putZipEntry(zos, "xl/workbook.xml",
                        "<?xml version=\"1.0\" encoding=\"UTF-8\" standalone=\"yes\"?>" +
                        "<workbook xmlns=\"http://schemas.openxmlformats.org/spreadsheetml/2006/main\" xmlns:r=\"http://schemas.openxmlformats.org/officeDocument/2006/relationships\">" +
                        "<sheets><sheet name=\"Sheet1\" sheetId=\"1\" r:id=\"rId1\"/></sheets>" +
                        "</workbook>");

                // xl/_rels/workbook.xml.rels
                putZipEntry(zos, "xl/_rels/workbook.xml.rels",
                        "<?xml version=\"1.0\" encoding=\"UTF-8\" standalone=\"yes\"?>" +
                        "<Relationships xmlns=\"http://schemas.openxmlformats.org/package/2006/relationships\">" +
                        "<Relationship Id=\"rId1\" Type=\"http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet\" Target=\"worksheets/sheet1.xml\"/>" +
                        "<Relationship Id=\"rId2\" Type=\"http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles\" Target=\"styles.xml\"/>" +
                        "</Relationships>");

                // xl/styles.xml (style 0 = normal, style 1 = bold header)
                putZipEntry(zos, "xl/styles.xml",
                        "<?xml version=\"1.0\" encoding=\"UTF-8\" standalone=\"yes\"?>" +
                        "<styleSheet xmlns=\"http://schemas.openxmlformats.org/spreadsheetml/2006/main\">" +
                        "<fonts count=\"2\">" +
                        "<font><sz val=\"11\"/><name val=\"Calibri\"/></font>" +
                        "<font><b/><sz val=\"11\"/><name val=\"Calibri\"/></font>" +
                        "</fonts>" +
                        "<fills count=\"2\">" +
                        "<fill><patternFill patternType=\"none\"/></fill>" +
                        "<fill><patternFill patternType=\"gray125\"/></fill>" +
                        "</fills>" +
                        "<borders count=\"1\"><border><left/><right/><top/><bottom/><diagonal/></border></borders>" +
                        "<cellStyleXfs count=\"1\"><xf numFmtId=\"0\" fontId=\"0\" fillId=\"0\" borderId=\"0\"/></cellStyleXfs>" +
                        "<cellXfs count=\"2\">" +
                        "<xf numFmtId=\"0\" fontId=\"0\" fillId=\"0\" borderId=\"0\" xfId=\"0\"/>" +
                        "<xf numFmtId=\"0\" fontId=\"1\" fillId=\"0\" borderId=\"0\" xfId=\"0\" applyFont=\"1\"/>" +
                        "</cellXfs>" +
                        "</styleSheet>");

                // xl/worksheets/sheet1.xml
                StringBuilder sb = new StringBuilder();
                sb.append("<?xml version=\"1.0\" encoding=\"UTF-8\" standalone=\"yes\"?>");
                sb.append("<worksheet xmlns=\"http://schemas.openxmlformats.org/spreadsheetml/2006/main\">");
                sb.append("<cols>");
                sb.append("<col min=\"1\" max=\"1\" width=\"4\" customWidth=\"1\"/>");
                sb.append("<col min=\"2\" max=\"2\" width=\"6\" customWidth=\"1\"/>");
                sb.append("<col min=\"3\" max=\"3\" width=\"22\" customWidth=\"1\"/>");
                sb.append("<col min=\"4\" max=\"4\" width=\"22\" customWidth=\"1\"/>");
                sb.append("<col min=\"5\" max=\"5\" width=\"15\" customWidth=\"1\"/>");
                sb.append("<col min=\"6\" max=\"6\" width=\"10\" customWidth=\"1\"/>");
                sb.append("<col min=\"7\" max=\"7\" width=\"26\" customWidth=\"1\"/>");
                sb.append("</cols>");
                sb.append("<sheetData>");

                // Row 2: Group Title in D2 (matching original spreadsheet layout ,,,GROUP X,,,)
                sb.append("<row r=\"2\">");
                sb.append("<c r=\"D2\" s=\"1\" t=\"inlineStr\"><is><t>").append(escapeXml(groupTitle)).append("</t></is></c>");
                sb.append("</row>");

                // Rows 3+: Student rows (Col B = No, Col C = First Name, Col D = Last Name, Col E = Student ID, Col F = Gender, Col G = Programme)
                for (int i = 0; i < arr.length(); i++) {
                    org.json.JSONObject r = arr.getJSONObject(i);
                    int rowNum = i + 3;
                    int slotNo = r.optInt("no", i + 1);
                    String first = r.optString("firstName", "");
                    String last = r.optString("lastName", "");
                    String studentNo = r.optString("studentNumber", "");
                    String gender = r.optString("gender", "");
                    String prog = r.optString("programme", "");

                    sb.append("<row r=\"").append(rowNum).append("\">");
                    sb.append("<c r=\"B").append(rowNum).append("\" t=\"n\"><v>").append(slotNo).append("</v></c>");
                    if (!first.isEmpty()) {
                        sb.append("<c r=\"C").append(rowNum).append("\" t=\"inlineStr\"><is><t>").append(escapeXml(first)).append("</t></is></c>");
                    }
                    if (!last.isEmpty()) {
                        sb.append("<c r=\"D").append(rowNum).append("\" t=\"inlineStr\"><is><t>").append(escapeXml(last)).append("</t></is></c>");
                    }
                    if (!studentNo.isEmpty()) {
                        sb.append("<c r=\"E").append(rowNum).append("\" t=\"inlineStr\"><is><t>").append(escapeXml(studentNo)).append("</t></is></c>");
                    }
                    if (!gender.isEmpty()) {
                        sb.append("<c r=\"F").append(rowNum).append("\" t=\"inlineStr\"><is><t>").append(escapeXml(gender)).append("</t></is></c>");
                    }
                    if (!prog.isEmpty()) {
                        sb.append("<c r=\"G").append(rowNum).append("\" t=\"inlineStr\"><is><t>").append(escapeXml(prog)).append("</t></is></c>");
                    }
                    sb.append("</row>");
                }

                sb.append("</sheetData></worksheet>");
                putZipEntry(zos, "xl/worksheets/sheet1.xml", sb.toString());
            }
            return baos.toByteArray();
        }

        private void putZipEntry(java.util.zip.ZipOutputStream zos, String name, String content) throws java.io.IOException {
            java.util.zip.ZipEntry entry = new java.util.zip.ZipEntry(name);
            zos.putNextEntry(entry);
            byte[] bytes = content.getBytes(java.nio.charset.StandardCharsets.UTF_8);
            zos.write(bytes);
            zos.closeEntry();
        }

        private String escapeXml(String s) {
            if (s == null) return "";
            return s.replace("&", "&amp;")
                    .replace("<", "&lt;")
                    .replace(">", "&gt;")
                    .replace("\"", "&quot;")
                    .replace("'", "&apos;");
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
        public void hideKeyboard() {
            runOnUiThread(() -> {
                InputMethodManager imm = (InputMethodManager) context.getSystemService(Context.INPUT_METHOD_SERVICE);
                if (imm != null && webView != null) {
                    imm.hideSoftInputFromWindow(webView.getWindowToken(), 0);
                }
                if (webView != null) {
                    webView.clearFocus();
                }
            });
        }

        @JavascriptInterface
        public void setLauncherIcon(String launcherAlias) {
            // Allows user to dynamically switch launcher icon via activity-alias
        }

        @JavascriptInterface
        public String getAppFlavor() {
            String pkg = context.getPackageName();
            if (pkg != null && pkg.contains("beta")) {
                return "beta";
            }
            return "base";
        }

        @JavascriptInterface
        public void discoverServer() {
            java.util.concurrent.Executors.newSingleThreadExecutor().execute(() -> {
                android.net.wifi.WifiManager wifi = (android.net.wifi.WifiManager) context.getApplicationContext().getSystemService(Context.WIFI_SERVICE);
                android.net.wifi.WifiManager.MulticastLock lock = null;
                java.net.DatagramSocket socket = null;
                boolean foundViaUdp = false;
                try {
                    if (wifi != null) {
                        lock = wifi.createMulticastLock("cc_multicast_lock");
                        lock.setReferenceCounted(true);
                        lock.acquire();
                    }

                    socket = new java.net.DatagramSocket();
                    socket.setBroadcast(true);
                    socket.setSoTimeout(2200);

                    java.util.List<java.net.InetAddress> targetAddrs = new java.util.ArrayList<>();
                    try {
                        targetAddrs.add(java.net.InetAddress.getByName("255.255.255.255"));
                    } catch (Exception ignored) {}
                    try {
                        for (java.net.NetworkInterface ni : java.util.Collections.list(java.net.NetworkInterface.getNetworkInterfaces())) {
                            if (ni.isLoopback() || !ni.isUp()) continue;
                            for (java.net.InterfaceAddress ia : ni.getInterfaceAddresses()) {
                                if (ia.getBroadcast() != null && !targetAddrs.contains(ia.getBroadcast())) {
                                    targetAddrs.add(ia.getBroadcast());
                                }
                            }
                        }
                    } catch (Exception ignored) {}

                    byte[] requestBytes = "CAMPUS_COMPANION_DISCOVER".getBytes(java.nio.charset.StandardCharsets.UTF_8);
                    for (java.net.InetAddress target : targetAddrs) {
                        try {
                            java.net.DatagramPacket sendPacket = new java.net.DatagramPacket(
                                    requestBytes,
                                    requestBytes.length,
                                    target,
                                    41234
                            );
                            socket.send(sendPacket);
                        } catch (Exception ignored) {}
                    }

                    byte[] recvBuf = new byte[1024];
                    java.net.DatagramPacket recvPacket = new java.net.DatagramPacket(recvBuf, recvBuf.length);
                    socket.receive(recvPacket);

                    String hostIp = recvPacket.getAddress().getHostAddress();
                    String reply = new String(recvPacket.getData(), 0, recvPacket.getLength(), java.nio.charset.StandardCharsets.UTF_8);
                    int port = 3000;
                    try {
                        org.json.JSONObject obj = new org.json.JSONObject(reply);
                        port = obj.optInt("port", 3000);
                    } catch (Exception ignored) {}

                    final String serverUrl = "http://" + hostIp + ":" + port;
                    foundViaUdp = true;
                    runOnUiThread(() -> {
                        webView.evaluateJavascript("window.onServerDiscovered && window.onServerDiscovered('" + serverUrl + "', 'udp')", null);
                    });
                } catch (Exception ignored) {
                } finally {
                    if (socket != null && !socket.isClosed()) socket.close();
                    if (lock != null && lock.isHeld()) {
                        try { lock.release(); } catch (Exception ignored) {}
                    }
                }

                if (!foundViaUdp) {
                    performSubnetFallbackScan();
                }
            });
        }

        private void performSubnetFallbackScan() {
            try {
                java.util.List<java.net.NetworkInterface> interfaces = java.util.Collections.list(java.net.NetworkInterface.getNetworkInterfaces());
                String myIp = null;
                for (java.net.NetworkInterface intf : interfaces) {
                    for (java.net.InetAddress addr : java.util.Collections.list(intf.getInetAddresses())) {
                        if (!addr.isLoopbackAddress() && addr instanceof java.net.Inet4Address) {
                            String s = addr.getHostAddress();
                            if (s != null && (s.startsWith("192.168.") || s.startsWith("172.") || s.startsWith("10."))) {
                                myIp = s;
                                break;
                            }
                        }
                    }
                    if (myIp != null) break;
                }

                if (myIp == null) {
                    runOnUiThread(() -> webView.evaluateJavascript("window.onServerDiscovered && window.onServerDiscovered(null)", null));
                    return;
                }

                int lastDot = myIp.lastIndexOf('.');
                String subnetPrefix = myIp.substring(0, lastDot + 1);
                java.util.concurrent.atomic.AtomicBoolean matchFound = new java.util.concurrent.atomic.AtomicBoolean(false);
                java.util.concurrent.ExecutorService pool = java.util.concurrent.Executors.newFixedThreadPool(16);

                int myHostNum = Integer.parseInt(myIp.substring(lastDot + 1));
                java.util.List<Integer> candidates = new java.util.ArrayList<>();
                candidates.add(1);
                candidates.add(2);
                for (int d = -5; d <= 5; d++) {
                    int c = myHostNum + d;
                    if (c >= 1 && c <= 254 && !candidates.contains(c)) candidates.add(c);
                }
                for (int i = 100; i <= 115; i++) {
                    if (!candidates.contains(i)) candidates.add(i);
                }

                for (int hostNum : candidates) {
                    final String testIp = subnetPrefix + hostNum;
                    pool.execute(() -> {
                        if (matchFound.get()) return;
                        try {
                            java.net.URL url = new java.net.URL("http://" + testIp + ":3000/api/health");
                            java.net.HttpURLConnection conn = (java.net.HttpURLConnection) url.openConnection();
                            conn.setConnectTimeout(650);
                            conn.setReadTimeout(650);
                            conn.setRequestMethod("GET");
                            int code = conn.getResponseCode();
                            if (code == 200 && matchFound.compareAndSet(false, true)) {
                                final String foundUrl = "http://" + testIp + ":3000";
                                runOnUiThread(() -> {
                                    webView.evaluateJavascript("window.onServerDiscovered && window.onServerDiscovered('" + foundUrl + "', 'subnet')", null);
                                });
                            }
                            conn.disconnect();
                        } catch (Exception ignored) {}
                    });
                }
                pool.shutdown();
                try {
                    pool.awaitTermination(3500, java.util.concurrent.TimeUnit.MILLISECONDS);
                } catch (Exception ignored) {}
                if (!matchFound.get()) {
                    runOnUiThread(() -> webView.evaluateJavascript("window.onServerDiscovered && window.onServerDiscovered(null)", null));
                }
            } catch (Exception e) {
                runOnUiThread(() -> webView.evaluateJavascript("window.onServerDiscovered && window.onServerDiscovered(null)", null));
            }
        }
    }
}