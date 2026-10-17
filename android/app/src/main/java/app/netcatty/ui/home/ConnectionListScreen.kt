package app.netcatty.ui.home

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.Add
import androidx.compose.material.icons.outlined.Dns
import androidx.compose.material.icons.outlined.Lan
import androidx.compose.material.icons.outlined.LinkOff
import androidx.compose.material.icons.outlined.MoreVert
import androidx.compose.material.icons.outlined.Settings
import androidx.compose.material.icons.outlined.Terminal
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.text.font.FontStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import app.netcatty.ai.OpsExecution
import app.netcatty.session.LiveSession
import app.netcatty.session.LiveStatus
import app.netcatty.session.listStatus
import app.netcatty.ssh.HostPing
import app.netcatty.ssh.HostPingMonitor
import app.netcatty.ssh.HostStats
import app.netcatty.ssh.HostStatsMonitor
import app.netcatty.ssh.NetQuality
import app.netcatty.ui.host.tint
import app.netcatty.ui.theme.CardRadius
import app.netcatty.ui.theme.MidnightBackground
import app.netcatty.ui.theme.MidnightBorder
import app.netcatty.ui.theme.MidnightMuted
import app.netcatty.ui.theme.MidnightPrimary
import app.netcatty.ui.theme.MidnightSurface
import app.netcatty.ui.theme.MidnightText
import app.netcatty.ui.theme.ScreenPad
import app.netcatty.ui.theme.StatusGreen
import app.netcatty.ui.theme.StatusOrange
import app.netcatty.ui.theme.StatusRed
import kotlinx.coroutines.delay

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun ConnectionListScreen(
    sessions: List<LiveSession>,
    pings: Map<String, HostPing>,
    pingMonitor: HostPingMonitor,
    stats: Map<String, HostStats>,
    statsMonitor: HostStatsMonitor,
    aiByHost: Map<String, OpsExecution>,
    onPickHost: () -> Unit,
    onOpen: (LiveSession) -> Unit,
    onDisconnect: (LiveSession) -> Unit,
    onRetry: (LiveSession) -> Unit,
    onHosts: () -> Unit,
    onTunnels: () -> Unit,
    onSettings: () -> Unit,
    updateHint: String? = null,
) {
    LaunchedEffect(sessions) {
        while (true) {
            val skip = sessions.filter { it.listStatus() == LiveStatus.CONNECTED }.map { it.spec.hostId }.toSet()
            pingMonitor.refresh(sessions.map { it.spec }, skipHostIds = skip)
            delay(15_000)
        }
    }
    LaunchedEffect(sessions) {
        while (true) {
            statsMonitor.refresh(sessions)
            delay(15_000)
        }
    }
    Scaffold(containerColor = MidnightBackground) { padding ->
        Column(
            Modifier
                .fillMaxSize()
                .padding(padding)
                .padding(horizontal = ScreenPad),
        ) {
            Row(
                Modifier
                    .fillMaxWidth()
                    .padding(top = 4.dp, bottom = 8.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                IconButton(onClick = onPickHost) {
                    Icon(Icons.Outlined.Add, contentDescription = "选择主机连接", tint = MidnightPrimary)
                }
                Column(Modifier.weight(1f)) {
                    Text(
                        "连接",
                        color = MidnightText,
                        fontSize = 22.sp,
                        fontWeight = FontWeight.Black,
                        fontStyle = FontStyle.Italic,
                    )
                    Text(
                        if (updateHint != null) "有新版本 $updateHint 可更新" else "仅显示正在进行的会话",
                        color = if (updateHint != null) MidnightPrimary else MidnightMuted,
                        fontSize = 12.sp,
                    )
                }
                IconButton(onClick = onTunnels) {
                    Icon(Icons.Outlined.Lan, contentDescription = "隧道", tint = MidnightMuted)
                }
                IconButton(onClick = onHosts) {
                    Icon(Icons.Outlined.Dns, contentDescription = "主机", tint = MidnightMuted)
                }
                IconButton(onClick = onSettings) {
                    Icon(Icons.Outlined.Settings, contentDescription = "设置", tint = MidnightMuted)
                }
            }
            if (sessions.isEmpty()) {
                Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
                    Column(horizontalAlignment = Alignment.CenterHorizontally) {
                        Text(
                            "还没有正在进行的连接",
                            color = MidnightText,
                            fontWeight = FontWeight.SemiBold,
                            fontSize = 15.sp,
                        )
                        Text(
                            "点左上角 + 选择主机开始连接。",
                            color = MidnightMuted,
                            fontSize = 12.sp,
                            modifier = Modifier.padding(top = 4.dp),
                        )
                    }
                }
            } else {
                LazyColumn(
                    contentPadding = PaddingValues(bottom = 24.dp),
                    verticalArrangement = Arrangement.spacedBy(8.dp),
                ) {
                    items(sessions, key = { it.id }) { live ->
                        LiveSessionCard(
                            live = live,
                            ping = pings[live.spec.hostId],
                            stats = stats[live.id],
                            ai = aiByHost[live.spec.hostId],
                            onOpen = { onOpen(live) },
                            onDisconnect = { onDisconnect(live) },
                            onRetry = { onRetry(live) },
                        )
                    }
                }
            }
        }
    }
}

@Composable
private fun LiveSessionCard(
    live: LiveSession,
    ping: HostPing?,
    stats: HostStats?,
    ai: OpsExecution?,
    onOpen: () -> Unit,
    onDisconnect: () -> Unit,
    onRetry: () -> Unit,
) {
    var menu by remember { mutableStateOf(false) }
    val quality = ping?.quality ?: NetQuality.UNKNOWN
    val netColor = quality.tint()
    val shown = live.listStatus()
    val statusColor = when {
        shown == LiveStatus.FAILED -> StatusRed
        shown == LiveStatus.CONNECTING -> MidnightPrimary
        ai != null -> if (ai.awaitingConfirm) StatusOrange else MidnightPrimary
        else -> when (quality) {
            NetQuality.GOOD -> StatusGreen
            NetQuality.FAIR -> StatusOrange
            NetQuality.POOR -> StatusRed
            NetQuality.UNKNOWN -> StatusGreen
        }
    }
    val statusLabel = buildString {
        append(
            when (shown) {
                LiveStatus.CONNECTING -> "正在连接"
                LiveStatus.CONNECTED -> "已连接"
                LiveStatus.FAILED -> live.error?.let { "失败：$it" } ?: "连接失败"
            },
        )
        if (ai != null) {
            append(" · ")
            append(ai.label)
            if (ai.step.isNotBlank()) {
                append(" · ")
                append(ai.step)
            }
        }
    }
    Row(
        Modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(CardRadius))
            .background(MidnightSurface)
            .border(1.dp, MidnightBorder, RoundedCornerShape(CardRadius))
            .clickable(onClick = onOpen)
            .padding(start = 10.dp, end = 2.dp, top = 8.dp, bottom = 8.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Box(
            Modifier
                .size(34.dp)
                .clip(CircleShape)
                .background(statusColor.copy(alpha = 0.16f)),
            contentAlignment = Alignment.Center,
        ) {
            Icon(Icons.Outlined.Terminal, contentDescription = null, tint = statusColor, modifier = Modifier.size(18.dp))
        }
        Column(
            Modifier
                .weight(1f)
                .padding(horizontal = 10.dp),
        ) {
            Text(
                live.spec.title,
                color = MidnightText,
                fontWeight = FontWeight.SemiBold,
                fontSize = 14.sp,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
            )
            Text(
                live.spec.connectionLine,
                color = MidnightMuted,
                fontSize = 12.sp,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
            )
            Text(
                statusLabel,
                color = statusColor,
                fontWeight = if (ai != null) FontWeight.SemiBold else FontWeight.Normal,
                fontSize = 11.sp,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
            )
            live.spec.notes.trim().lineSequence().firstOrNull { it.isNotBlank() }?.let { preview ->
                Text(
                    preview,
                    color = MidnightMuted,
                    fontSize = 11.sp,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                    modifier = Modifier.padding(top = 2.dp),
                )
            }
            if (shown == LiveStatus.CONNECTED) {
                Row(
                    Modifier
                        .fillMaxWidth()
                        .padding(top = 6.dp),
                    horizontalArrangement = Arrangement.spacedBy(8.dp),
                ) {
                    UsageMeter("CPU", stats?.cpuPercent, stats?.cpuLabel ?: "—", Modifier.weight(1f))
                    UsageMeter("内存", stats?.memPercent, stats?.memLabel ?: "—", Modifier.weight(1f))
                    UsageMeter("磁盘", stats?.diskPercent, stats?.diskLabel ?: "—", Modifier.weight(1f))
                }
            }
        }
        if (ai != null) {
            Text(
                if (ai.awaitingConfirm) "等待确认" else "执行中",
                color = if (ai.awaitingConfirm) StatusOrange else MidnightPrimary,
                fontWeight = FontWeight.SemiBold,
                fontSize = 11.sp,
                modifier = Modifier.padding(end = 4.dp),
            )
        }
        if (shown == LiveStatus.CONNECTED) {
            Text(
                ping?.label ?: "检测中",
                color = netColor,
                fontWeight = FontWeight.SemiBold,
                fontSize = 12.sp,
                modifier = Modifier.padding(end = 4.dp),
            )
        }
        Box {
            IconButton(onClick = { menu = true }, modifier = Modifier.size(36.dp)) {
                Icon(Icons.Outlined.MoreVert, contentDescription = "更多", tint = MidnightMuted, modifier = Modifier.size(18.dp))
            }
            DropdownMenu(expanded = menu, onDismissRequest = { menu = false }) {
                DropdownMenuItem(text = { Text("打开终端") }, onClick = { menu = false; onOpen() })
                if (shown == LiveStatus.FAILED) {
                    DropdownMenuItem(text = { Text("重试") }, onClick = { menu = false; onRetry() })
                }
                DropdownMenuItem(
                    text = { Text("断开") },
                    leadingIcon = { Icon(Icons.Outlined.LinkOff, contentDescription = null) },
                    onClick = { menu = false; onDisconnect() },
                )
            }
        }
    }
}

@Composable
private fun UsageMeter(
    label: String,
    percent: Int?,
    value: String,
    modifier: Modifier = Modifier,
) {
    val color = usageTint(percent)
    Column(modifier) {
        Row(
            Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.SpaceBetween,
            verticalAlignment = Alignment.Bottom,
        ) {
            Text(label, color = MidnightMuted, fontSize = 9.sp)
            Text(value, color = color, fontSize = 10.sp, fontWeight = FontWeight.SemiBold)
        }
        LinearProgressIndicator(
            progress = { (percent ?: 0).coerceIn(0, 100) / 100f },
            modifier = Modifier
                .fillMaxWidth()
                .padding(top = 2.dp)
                .height(4.dp)
                .clip(RoundedCornerShape(2.dp)),
            color = color,
            trackColor = MidnightBorder,
        )
    }
}

private fun usageTint(percent: Int?) = when {
    percent == null -> MidnightMuted
    percent < 70 -> StatusGreen
    percent < 85 -> StatusOrange
    else -> StatusRed
}
