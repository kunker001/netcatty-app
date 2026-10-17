package app.netcatty.ui.update

import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import app.netcatty.ui.theme.MidnightMuted
import app.netcatty.ui.theme.MidnightPrimary
import app.netcatty.ui.theme.MidnightText
import app.netcatty.update.AppRelease
import kotlin.math.roundToInt

@Composable
fun UpdateDialog(
    release: AppRelease,
    currentVersion: String,
    downloading: Boolean,
    progress: Float,
    error: String?,
    onLater: () -> Unit,
    onDownload: () -> Unit,
) {
    AlertDialog(
        onDismissRequest = { if (!downloading) onLater() },
        title = {
            Text("发现新版本 ${release.version}", fontWeight = FontWeight.SemiBold)
        },
        text = {
            Column {
                Text(
                    "当前 $currentVersion，可从 GitHub Release 更新。",
                    color = MidnightMuted,
                    fontSize = 13.sp,
                )
                if (release.notes.isNotBlank()) {
                    Text(
                        release.notes.take(600),
                        color = MidnightText,
                        fontSize = 13.sp,
                        modifier = Modifier.padding(top = 10.dp),
                    )
                }
                if (downloading) {
                    LinearProgressIndicator(
                        progress = { progress.coerceIn(0f, 1f) },
                        modifier = Modifier
                            .fillMaxWidth()
                            .padding(top = 14.dp),
                        color = MidnightPrimary,
                    )
                    Text(
                        if (progress > 0f) "正在下载 ${(progress * 100).roundToInt()}%" else "正在连接…",
                        color = MidnightMuted,
                        fontSize = 12.sp,
                        modifier = Modifier.padding(top = 6.dp),
                    )
                }
                if (!error.isNullOrBlank()) {
                    Text(
                        error,
                        color = MidnightText,
                        fontSize = 12.sp,
                        modifier = Modifier.padding(top = 10.dp),
                    )
                }
            }
        },
        confirmButton = {
            TextButton(onClick = onDownload, enabled = !downloading) {
                Text(if (error.isNullOrBlank()) "下载更新" else "重试")
            }
        },
        dismissButton = {
            TextButton(onClick = onLater, enabled = !downloading) { Text("稍后") }
        },
    )
}
