package app.netcatty.ssh

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.net.wifi.WifiManager
import android.os.Build
import android.os.IBinder
import androidx.core.app.NotificationCompat
import androidx.core.content.ContextCompat
import app.netcatty.MainActivity
import app.netcatty.R

class SessionKeepAliveService : Service() {
    private var wifiLock: WifiManager.WifiLock? = null

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        val notification = buildNotification(intent ?: Intent())
        if (Build.VERSION.SDK_INT >= 34) {
            startForeground(
                NOTIFICATION_ID,
                notification,
                ServiceInfo.FOREGROUND_SERVICE_TYPE_SPECIAL_USE,
            )
        } else {
            startForeground(NOTIFICATION_ID, notification)
        }
        getSystemService(NotificationManager::class.java).notify(NOTIFICATION_ID, notification)
        acquireWifi()
        return START_STICKY
    }

    override fun onDestroy() {
        wifiLock?.let { if (it.isHeld) it.release() }
        wifiLock = null
        stopForeground(STOP_FOREGROUND_REMOVE)
        super.onDestroy()
    }

    private fun buildNotification(intent: Intent): Notification {
        val manager = getSystemService(NotificationManager::class.java)
        if (Build.VERSION.SDK_INT >= 26 && manager.getNotificationChannel(CHANNEL_ID) == null) {
            manager.createNotificationChannel(
                NotificationChannel(
                    CHANNEL_ID,
                    "SSH 连接",
                    NotificationManager.IMPORTANCE_LOW,
                ).apply {
                    description = "有 SSH 会话时保持连接，并显示 Catty 执行进度"
                    setShowBadge(false)
                },
            )
        }
        val title = intent.getStringExtra(EXTRA_TITLE).orEmpty().ifBlank { "Netcatty 正在保持连接" }
        val text = intent.getStringExtra(EXTRA_TEXT).orEmpty().ifBlank { "切到后台时 SSH 会话会继续保持" }
        val progress = intent.getBooleanExtra(EXTRA_PROGRESS, false)
        val open = Intent(this, MainActivity::class.java).apply {
            action = ACTION_OPEN
            flags = Intent.FLAG_ACTIVITY_NEW_TASK or
                Intent.FLAG_ACTIVITY_SINGLE_TOP or
                Intent.FLAG_ACTIVITY_REORDER_TO_FRONT or
                Intent.FLAG_ACTIVITY_CLEAR_TOP
            putExtra(EXTRA_OPEN_DEST, intent.getStringExtra(EXTRA_OPEN_DEST) ?: OPEN_HOME)
            putExtra(EXTRA_HOST_ID, intent.getStringExtra(EXTRA_HOST_ID))
            putExtra(EXTRA_SESSION_ID, intent.getStringExtra(EXTRA_SESSION_ID))
        }
        val pending = PendingIntent.getActivity(
            this,
            1,
            open,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
        )
        val builder = NotificationCompat.Builder(this, CHANNEL_ID)
            .setSmallIcon(R.mipmap.ic_launcher)
            .setContentTitle(title)
            .setContentText(text)
            .setStyle(NotificationCompat.BigTextStyle().bigText(text))
            .setContentIntent(pending)
            .setAutoCancel(false)
            .setOngoing(true)
            .setOnlyAlertOnce(true)
            .setCategory(NotificationCompat.CATEGORY_SERVICE)
        if (progress) {
            builder.setProgress(0, 0, true)
        }
        return builder.build()
    }

    private fun acquireWifi() {
        if (wifiLock?.isHeld == true) return
        val wifi = applicationContext.getSystemService(WifiManager::class.java) ?: return
        val mode = if (Build.VERSION.SDK_INT >= 29) {
            WifiManager.WIFI_MODE_FULL_LOW_LATENCY
        } else {
            @Suppress("DEPRECATION")
            WifiManager.WIFI_MODE_FULL_HIGH_PERF
        }
        wifiLock = wifi.createWifiLock(mode, "netcatty-ssh").apply {
            setReferenceCounted(false)
            acquire()
        }
    }

    companion object {
        private const val CHANNEL_ID = "ssh-session"
        private const val NOTIFICATION_ID = 42
        const val EXTRA_TITLE = "app.netcatty.NOTICE_TITLE"
        const val EXTRA_TEXT = "app.netcatty.NOTICE_TEXT"
        const val EXTRA_PROGRESS = "app.netcatty.NOTICE_PROGRESS"
        const val EXTRA_OPEN_DEST = "app.netcatty.OPEN_DEST"
        const val EXTRA_HOST_ID = "app.netcatty.OPEN_HOST_ID"
        const val EXTRA_SESSION_ID = "app.netcatty.OPEN_SESSION_ID"
        const val ACTION_OPEN = "app.netcatty.OPEN_FROM_NOTIFICATION"
        const val OPEN_HOME = "home"
        const val OPEN_SESSION = "session"
        const val OPEN_CATTY = "catty"
        const val OPEN_TUNNELS = "tunnels"

        fun start(
            context: Context,
            title: String,
            text: String,
            progress: Boolean,
            dest: String,
            hostId: String?,
            sessionId: String?,
        ) {
            val intent = Intent(context, SessionKeepAliveService::class.java).apply {
                putExtra(EXTRA_TITLE, title)
                putExtra(EXTRA_TEXT, text)
                putExtra(EXTRA_PROGRESS, progress)
                putExtra(EXTRA_OPEN_DEST, dest)
                putExtra(EXTRA_HOST_ID, hostId)
                putExtra(EXTRA_SESSION_ID, sessionId)
            }
            ContextCompat.startForegroundService(context, intent)
        }

        fun stop(context: Context) {
            context.stopService(Intent(context, SessionKeepAliveService::class.java))
        }
    }
}
