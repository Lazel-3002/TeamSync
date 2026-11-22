package com.teamsync.mobile;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.content.pm.ServiceInfo;
import android.net.wifi.WifiManager;
import android.os.Build;
import android.os.IBinder;
import android.os.PowerManager;

import androidx.core.app.NotificationCompat;
import androidx.core.app.ServiceCompat;

/**
 * Sesli odadayken çalışan ön plan servisi.
 *
 * Neden gerekli: Android, ekran kilitlenince ya da kullanıcı başka uygulamaya
 * geçince arka plandaki uygulamanın mikrofonunu keser ve işlemi uyutur. Ön plan
 * servisi (tür: microphone) + bildirim, sistemin "kullanıcı şu an bu uygulamayla
 * görüşüyor" demesini sağlar; WebView'daki WebRTC sesi sürmeye devam eder.
 * Ayrıca Wi-Fi ve CPU uyumasın diye kilit tutulur (yalnızca görüşme boyunca).
 */
public class CallService extends Service {
    public static final String EXTRA_TITLE = "title";
    public static final String EXTRA_TEXT = "text";
    private static final String CHANNEL_ID = "teamsync_call";
    private static final int NOTIFICATION_ID = 4101;

    private PowerManager.WakeLock cpuLock;
    private WifiManager.WifiLock wifiLock;

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        String title = intent != null && intent.getStringExtra(EXTRA_TITLE) != null ? intent.getStringExtra(EXTRA_TITLE) : "TeamSync";
        String text = intent != null && intent.getStringExtra(EXTRA_TEXT) != null ? intent.getStringExtra(EXTRA_TEXT) : "Sesli odadasın";

        ensureChannel();
        Intent open = new Intent(this, MainActivity.class).setFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP);
        PendingIntent pi = PendingIntent.getActivity(this, 0, open, PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);
        Notification n = new NotificationCompat.Builder(this, CHANNEL_ID)
                .setSmallIcon(android.R.drawable.ic_btn_speak_now)
                .setContentTitle(title)
                .setContentText(text)
                .setContentIntent(pi)
                .setOngoing(true)
                .setCategory(NotificationCompat.CATEGORY_CALL)
                .setPriority(NotificationCompat.PRIORITY_LOW)
                .build();

        int type = Build.VERSION.SDK_INT >= Build.VERSION_CODES.R ? ServiceInfo.FOREGROUND_SERVICE_TYPE_MICROPHONE : 0;
        ServiceCompat.startForeground(this, NOTIFICATION_ID, n, type);
        acquireLocks();
        return START_NOT_STICKY;
    }

    private void ensureChannel() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return;
        NotificationManager nm = getSystemService(NotificationManager.class);
        if (nm.getNotificationChannel(CHANNEL_ID) != null) return;
        NotificationChannel ch = new NotificationChannel(CHANNEL_ID, "Süren görüşme", NotificationManager.IMPORTANCE_LOW);
        ch.setDescription("Sesli odadayken görünen kalıcı bildirim");
        ch.setShowBadge(false);
        nm.createNotificationChannel(ch);
    }

    private void acquireLocks() {
        if (cpuLock == null) {
            PowerManager pm = (PowerManager) getSystemService(Context.POWER_SERVICE);
            cpuLock = pm.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "TeamSync:call");
            cpuLock.setReferenceCounted(false);
        }
        // Güvenlik sınırı: uygulama çökse bile kilit en geç 6 saatte bırakılır.
        cpuLock.acquire(6L * 60 * 60 * 1000);
        if (wifiLock == null) {
            WifiManager wm = (WifiManager) getApplicationContext().getSystemService(Context.WIFI_SERVICE);
            int mode = Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q
                    ? WifiManager.WIFI_MODE_FULL_LOW_LATENCY
                    : WifiManager.WIFI_MODE_FULL_HIGH_PERF;
            wifiLock = wm.createWifiLock(mode, "TeamSync:call");
            wifiLock.setReferenceCounted(false);
        }
        wifiLock.acquire();
    }

    @Override
    public void onDestroy() {
        if (cpuLock != null && cpuLock.isHeld()) cpuLock.release();
        if (wifiLock != null && wifiLock.isHeld()) wifiLock.release();
        super.onDestroy();
    }

    @Override
    public void onTaskRemoved(Intent rootIntent) {
        // Kullanıcı uygulamayı son uygulamalardan kaydırıp kapattı: görüşme biter.
        stopSelf();
        super.onTaskRemoved(rootIntent);
    }

    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }
}
