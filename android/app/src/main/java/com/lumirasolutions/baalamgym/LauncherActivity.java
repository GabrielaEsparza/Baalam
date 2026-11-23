/*
 * Copyright 2020 Google Inc. All Rights Reserved.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */
package com.lumirasolutions.baalamgym;

import android.content.pm.ActivityInfo;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;

import com.google.firebase.messaging.FirebaseMessaging;

public class LauncherActivity
        extends com.google.androidbrowserhelper.trusted.LauncherActivity {

    /** Tiempo máximo para esperar el identificador de Firebase antes de abrir la web. */
    private static final long TOKEN_WAIT_MS = 3000;
    private static String lastTokenError = null;
    private boolean launched = false;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        // Setting an orientation crashes the app due to the transparent background on Android 8.0
        // Oreo and below. We only set the orientation on Oreo and above. This only affects the
        // splash screen and Chrome will still respect the orientation.
        // See https://github.com/GoogleChromeLabs/bubblewrap/issues/496 for details.
        if (Build.VERSION.SDK_INT > Build.VERSION_CODES.O) {
            setRequestedOrientation(ActivityInfo.SCREEN_ORIENTATION_USER_PORTRAIT);
        } else {
            setRequestedOrientation(ActivityInfo.SCREEN_ORIENTATION_UNSPECIFIED);
        }
    }

    /** Si aún no hay identificador de Firebase, lo pide y abre la web cuando llega (máx. 3 s). */
    @Override
    protected boolean shouldLaunchImmediately() {
        if (FcmService.token(this) != null) return true;
        FirebaseMessaging.getInstance().getToken().addOnCompleteListener(task -> {
            if (task.isSuccessful() && task.getResult() != null) {
                FcmService.saveToken(this, task.getResult());
                lastTokenError = null;
            } else {
                Exception e = task.getException();
                lastTokenError = e == null ? "sin token" : e.getClass().getSimpleName() + ": " + e.getMessage();
            }
            launchOnce();
        });
        new Handler(Looper.getMainLooper()).postDelayed(() -> {
            if (!launched && FcmService.token(this) == null && lastTokenError == null) lastTokenError = "tiempo agotado";
            launchOnce();
        }, TOKEN_WAIT_MS);
        return false;
    }

    private void launchOnce() {
        if (launched || isFinishing()) return;
        launched = true;
        launchTwa();
    }

    @Override
    protected Uri getLaunchingUrl() {
        // Get the original launch Url (o la del aviso que se tocó).
        Uri uri = super.getLaunchingUrl();
        // Le avisa a la web que corre dentro de la app y le pasa el identificador de Firebase,
        // para que los avisos lleguen como notificación nativa de la app.
        if (uri == null || !getString(R.string.hostName).equals(uri.getHost())) return uri;
        Uri.Builder b = uri.buildUpon().appendQueryParameter("twa", "1");
        String token = FcmService.token(this);
        if (token != null) {
            b.appendQueryParameter("fcm_token", token);
        } else if (lastTokenError != null) {
            String err = lastTokenError.length() > 150 ? lastTokenError.substring(0, 150) : lastTokenError;
            b.appendQueryParameter("fcm_error", err);
        }
        return b.build();
    }
}
