package com.teamsync.mobile;

import android.Manifest;
import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.media.AudioDeviceInfo;
import android.media.AudioManager;
import android.net.Uri;
import android.os.Build;
import android.os.PowerManager;
import android.provider.Settings;

import androidx.core.app.ActivityCompat;
import androidx.core.app.NotificationCompat;
import androidx.core.content.ContextCompat;
import androidx.core.content.FileProvider;

import java.io.File;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;

import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.util.Arrays;
import java.util.List;

/**
 * JS tarafı: mobile/src/native.js
 *   TsCall.start({title, text})  → ön plan servisini başlatır (CallService)
 *   TsCall.stop()                → servisi durdurur, ses modunu geri alır
 *   TsCall.setRoute({route})     → 'speaker' | 'earpiece'
 * Kulaklık (kablolu, USB, Bluetooth) takılıysa 'earpiece' isteği ona gider.
 */
@CapacitorPlugin(name = "TsCall")
public class TsCallPlugin extends Plugin {
    private PowerManager.WakeLock proximityLock;

    @PluginMethod
    public void start(PluginCall call) {
        Context ctx = getContext();
        if (Build.VERSION.SDK_INT >= 33
                && ContextCompat.checkSelfPermission(ctx, Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED
                && getActivity() != null) {
            // Bildirim izni olmasa da servis çalışır; yalnızca bildirim görünmez.
            ActivityCompat.requestPermissions(getActivity(), new String[]{Manifest.permission.POST_NOTIFICATIONS}, 4102);
        }
        Intent i = new Intent(ctx, CallService.class)
                .putExtra(CallService.EXTRA_TITLE, call.getString("title", "TeamSync"))
                .putExtra(CallService.EXTRA_TEXT, call.getString("text", "Sesli odadasın"));
        try {
            ContextCompat.startForegroundService(ctx, i);
            AudioManager am = audio();
            am.setMode(AudioManager.MODE_IN_COMMUNICATION);
            call.resolve();
        } catch (Exception e) {
            call.reject("Servis başlatılamadı: " + e.getMessage());
        }
    }

    @PluginMethod
    public void stop(PluginCall call) {
        Context ctx = getContext();
        ctx.stopService(new Intent(ctx, CallService.class));
        releaseProximity();
        AudioManager am = audio();
        if (Build.VERSION.SDK_INT >= 31) am.clearCommunicationDevice();
        else am.setSpeakerphoneOn(false);
        am.setMode(AudioManager.MODE_NORMAL);
        call.resolve();
    }

    @PluginMethod
    public void setRoute(PluginCall call) {
        String route = call.getString("route", "earpiece");
        AudioManager am = audio();
        am.setMode(AudioManager.MODE_IN_COMMUNICATION);
        boolean speaker = "speaker".equals(route);
        if (Build.VERSION.SDK_INT >= 31) {
            AudioDeviceInfo pick = null;
            List<AudioDeviceInfo> devices = am.getAvailableCommunicationDevices();
            if (speaker) {
                pick = find(devices, AudioDeviceInfo.TYPE_BUILTIN_SPEAKER);
            } else {
                pick = find(devices, AudioDeviceInfo.TYPE_WIRED_HEADSET, AudioDeviceInfo.TYPE_WIRED_HEADPHONES,
                        AudioDeviceInfo.TYPE_USB_HEADSET, AudioDeviceInfo.TYPE_BLE_HEADSET,
                        AudioDeviceInfo.TYPE_BLUETOOTH_SCO, AudioDeviceInfo.TYPE_BUILTIN_EARPIECE);
            }
            if (pick != null) am.setCommunicationDevice(pick);
        } else {
            am.setSpeakerphoneOn(speaker);
        }
        // Ahizedeyken telefon kulağa yaklaşınca ekran kapansın (yanak tuşlara basmasın).
        if (speaker) releaseProximity(); else acquireProximity();
        call.resolve();
    }

    // ---------------------------------------------------------------
    // Bildirim: uygulama arka plandayken odaya biri girince/çıkınca,
    // yeni sürüm çıkınca. (Uygulama tamamen kapalıyken gelen bildirimler
    // için Firebase gerekir; o ayrı iş.)
    // ---------------------------------------------------------------
    private static final String EVENTS_CHANNEL = "teamsync_events";

    @PluginMethod
    public void notify(PluginCall call) {
        Context ctx = getContext();
        if (Build.VERSION.SDK_INT >= 33
                && ContextCompat.checkSelfPermission(ctx, Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) {
            call.resolve();
            return;
        }
        NotificationManager nm = (NotificationManager) ctx.getSystemService(Context.NOTIFICATION_SERVICE);
        if (Build.VERSION.SDK_INT >= 26 && nm.getNotificationChannel(EVENTS_CHANNEL) == null) {
            NotificationChannel ch = new NotificationChannel(EVENTS_CHANNEL, "Oda ve güncellemeler", NotificationManager.IMPORTANCE_DEFAULT);
            ch.setDescription("Odaya biri girince ya da yeni sürüm çıkınca");
            nm.createNotificationChannel(ch);
        }
        Intent open = new Intent(ctx, MainActivity.class).setFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP);
        PendingIntent pi = PendingIntent.getActivity(ctx, 1, open, PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);
        Notification n = new NotificationCompat.Builder(ctx, EVENTS_CHANNEL)
                .setSmallIcon(android.R.drawable.stat_notify_chat)
                .setContentTitle(call.getString("title", "TeamSync"))
                .setContentText(call.getString("text", ""))
                .setContentIntent(pi)
                .setAutoCancel(true)
                .build();
        nm.notify(call.getInt("id", 4200), n);
        call.resolve();
    }

    @PluginMethod
    public void requestNotifications(PluginCall call) {
        if (Build.VERSION.SDK_INT >= 33 && getActivity() != null
                && ContextCompat.checkSelfPermission(getContext(), Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) {
            ActivityCompat.requestPermissions(getActivity(), new String[]{Manifest.permission.POST_NOTIFICATIONS}, 4102);
        }
        call.resolve();
    }

    // ---------------------------------------------------------------
    // Uygulama içi güncelleme: APK'yı önbelleğe indirir, Android'in kurulum
    // ekranını açar. Kurulumu kullanıcı onaylar (Android bunu zorunlu tutar).
    // Yalnızca bu deponun GitHub release adreslerinden indirilir.
    // ---------------------------------------------------------------
    private static final String UPDATE_PREFIX = "https://github.com/Lazel-3002/TeamSync/releases/download/mobil-v";

    @PluginMethod
    public void installApk(PluginCall call) {
        String url = call.getString("url", "");
        if (url == null || !url.startsWith(UPDATE_PREFIX) || !url.endsWith(".apk")) {
            call.reject("Geçersiz güncelleme adresi");
            return;
        }
        Context ctx = getContext();
        if (Build.VERSION.SDK_INT >= 26 && !ctx.getPackageManager().canRequestPackageInstalls()) {
            // Bir kerelik izin: "Bu kaynaktan uygulama yüklemeye izin ver".
            Intent perm = new Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES, Uri.parse("package:" + ctx.getPackageName()))
                    .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            ctx.startActivity(perm);
            call.reject("NEEDS_PERMISSION");
            return;
        }
        new Thread(() -> {
            File out = new File(ctx.getCacheDir(), "teamsync-update.apk");
            try {
                HttpURLConnection conn = (HttpURLConnection) new URL(url).openConnection();
                conn.setInstanceFollowRedirects(true);
                conn.setConnectTimeout(15000);
                conn.setReadTimeout(30000);
                if (conn.getResponseCode() != 200) throw new Exception("HTTP " + conn.getResponseCode());
                try (InputStream in = conn.getInputStream(); FileOutputStream fos = new FileOutputStream(out)) {
                    byte[] buf = new byte[64 * 1024];
                    int r;
                    while ((r = in.read(buf)) > 0) fos.write(buf, 0, r);
                }
                Uri uri = FileProvider.getUriForFile(ctx, ctx.getPackageName() + ".fileprovider", out);
                Intent install = new Intent(Intent.ACTION_VIEW)
                        .setDataAndType(uri, "application/vnd.android.package-archive")
                        .addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_ACTIVITY_NEW_TASK);
                ctx.startActivity(install);
                call.resolve();
            } catch (Exception e) {
                call.reject("İndirilemedi: " + e.getMessage());
            }
        }).start();
    }

    @PluginMethod
    public void openUrl(PluginCall call) {
        String url = call.getString("url", "");
        if (url == null || !(url.startsWith("https://") || url.startsWith("teamsync://"))) {
            call.reject("Geçersiz adres");
            return;
        }
        Intent i = new Intent(Intent.ACTION_VIEW, Uri.parse(url)).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        getContext().startActivity(i);
        call.resolve();
    }

    private static AudioDeviceInfo find(List<AudioDeviceInfo> devices, Integer... types) {
        List<Integer> order = Arrays.asList(types);
        for (Integer t : order) {
            for (AudioDeviceInfo d : devices) {
                if (d.getType() == t) return d;
            }
        }
        return null;
    }

    private AudioManager audio() {
        return (AudioManager) getContext().getSystemService(Context.AUDIO_SERVICE);
    }

    private void acquireProximity() {
        PowerManager pm = (PowerManager) getContext().getSystemService(Context.POWER_SERVICE);
        if (!pm.isWakeLockLevelSupported(PowerManager.PROXIMITY_SCREEN_OFF_WAKE_LOCK)) return;
        if (proximityLock == null) {
            proximityLock = pm.newWakeLock(PowerManager.PROXIMITY_SCREEN_OFF_WAKE_LOCK, "TeamSync:proximity");
            proximityLock.setReferenceCounted(false);
        }
        if (!proximityLock.isHeld()) proximityLock.acquire(6L * 60 * 60 * 1000);
    }

    private void releaseProximity() {
        if (proximityLock != null && proximityLock.isHeld()) proximityLock.release();
    }

    @Override
    protected void handleOnDestroy() {
        releaseProximity();
        super.handleOnDestroy();
    }
}
