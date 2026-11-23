package com.lumirasolutions.baalamgym;

import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.net.Uri;
import android.os.Build;

import androidx.core.app.NotificationCompat;
import androidx.core.app.NotificationManagerCompat;

import com.google.firebase.messaging.FirebaseMessagingService;
import com.google.firebase.messaging.RemoteMessage;

import java.util.Map;

/**
 * Avisos nativos (Firebase Cloud Messaging). El servidor manda solo datos
 * (title, body, url, tag) y aquí se arma la notificación a nombre de la app:
 * sin el dominio que agrega Chrome a los avisos web.
 */
public class FcmService extends FirebaseMessagingService {
    static final String CHANNEL_ID = "avisos";
    private static final String PREFS = "baalam";
    private static final String KEY_TOKEN = "fcm_token";
    private static final int ACCENT = 0xFFE05A00; // naranja BÁALAM

    static void saveToken(Context c, String token) {
        c.getSharedPreferences(PREFS, MODE_PRIVATE).edit().putString(KEY_TOKEN, token).apply();
    }

    static String token(Context c) {
        return c.getSharedPreferences(PREFS, MODE_PRIVATE).getString(KEY_TOKEN, null);
    }

    static void createChannel(Context c) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return;
        NotificationChannel ch = new NotificationChannel(CHANNEL_ID, "Avisos", NotificationManager.IMPORTANCE_HIGH);
        ch.setDescription("Agua, comidas, entrenamiento, sesiones y medidas");
        c.getSystemService(NotificationManager.class).createNotificationChannel(ch);
    }

    @Override
    public void onNewToken(String token) {
        saveToken(this, token);
    }

    @Override
    public void onMessageReceived(RemoteMessage message) {
        Map<String, String> d = message.getData();
        String title = d.get("title");
        String body = d.get("body");
        String path = d.get("url");
        String tag = d.get("tag");
        if (title == null || title.isEmpty()) title = getString(R.string.appName);
        if (body == null) body = "";
        if (path == null || path.isEmpty()) path = "/app";
        if (!path.startsWith("/")) path = "/" + path;

        createChannel(this);
        Uri uri = Uri.parse("https://" + getString(R.string.hostName) + path);
        Intent open = new Intent(this, LauncherActivity.class)
                .setAction(Intent.ACTION_VIEW)
                .setData(uri)
                .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP);
        int id = (tag != null && !tag.isEmpty()) ? tag.hashCode() : (int) System.currentTimeMillis();
        PendingIntent pending = PendingIntent.getActivity(
                this, id, open, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);

        NotificationCompat.Builder n = new NotificationCompat.Builder(this, CHANNEL_ID)
                .setSmallIcon(R.drawable.ic_notification_icon)
                .setColor(ACCENT)
                .setContentTitle(title)
                .setContentText(body)
                .setStyle(new NotificationCompat.BigTextStyle().bigText(body))
                .setPriority(NotificationCompat.PRIORITY_HIGH)
                .setAutoCancel(true)
                .setContentIntent(pending);
        try {
            NotificationManagerCompat.from(this).notify(id, n.build());
        } catch (SecurityException e) {
            // Sin permiso de notificaciones (Android 13+): no se muestra.
        }
    }
}
