package app.netcatty.ui.tunnel

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
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.outlined.ArrowBack
import androidx.compose.material.icons.outlined.Add
import androidx.compose.material.icons.outlined.Delete
import androidx.compose.material.icons.outlined.Lan
import androidx.compose.material.icons.outlined.MoreVert
import androidx.compose.material.icons.outlined.PlayArrow
import androidx.compose.material.icons.outlined.Stop
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.Scaffold
import androidx.compose.material3.SmallFloatingActionButton
import androidx.compose.material3.Text
import androidx.compose.material3.TopAppBar
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import app.netcatty.data.Host
import app.netcatty.data.SshConnection
import app.netcatty.data.TunnelRule
import app.netcatty.session.TunnelPhase
import app.netcatty.session.TunnelStatus
import app.netcatty.ui.theme.CardRadius
import app.netcatty.ui.theme.CompactBarTitle
import app.netcatty.ui.theme.MidnightBackground
import app.netcatty.ui.theme.MidnightBorder
import app.netcatty.ui.theme.MidnightDanger
import app.netcatty.ui.theme.MidnightMuted
import app.netcatty.ui.theme.MidnightOnPrimary
import app.netcatty.ui.theme.MidnightPrimary
import app.netcatty.ui.theme.MidnightSurface
import app.netcatty.ui.theme.MidnightText
import app.netcatty.ui.theme.ScreenPad
import app.netcatty.ui.theme.StatusGreen
import app.netcatty.ui.theme.StatusOrange
import app.netcatty.ui.theme.StatusRed
import app.netcatty.ui.theme.appTopBarColors

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun TunnelListScreen(
    rules: List<TunnelRule>,
    status: Map<String, TunnelStatus>,
    hosts: List<Host>,
    connections: List<SshConnection>,
    onBack: () -> Unit,
    onAdd: () -> Unit,
    onOpen: (TunnelRule) -> Unit,
    onStart: (TunnelRule) -> Unit,
    onStop: (TunnelRule) -> Unit,
    onDelete: (TunnelRule) -> Unit,
) {
    Scaffold(
        containerColor = MidnightBackground,
        topBar = {
            TopAppBar(
                title = { CompactBarTitle("隧道", "经 SSH 转发端口，或在手机上开 SOCKS5") },
                navigationIcon = {
                    IconButton(onClick = onBack) {
                        Icon(Icons.AutoMirrored.Outlined.ArrowBack, contentDescription = "返回")
                    }
                },
                colors = appTopBarColors(),
            )
        },
        floatingActionButton = {
            SmallFloatingActionButton(
                onClick = onAdd,
                containerColor = MidnightPrimary,
                contentColor = MidnightOnPrimary,
                modifier = Modifier.navigationBarsPadding(),
            ) {
                Icon(Icons.Outlined.Add, contentDescription = "添加隧道")
            }
        },
    ) { padding ->
        if (rules.isEmpty()) {
            Box(
                Modifier
                    .fillMaxSize()
                    .padding(padding)
                    .padding(horizontal = ScreenPad),
                contentAlignment = Alignment.Center,
            ) {
                Column(horizontalAlignment = Alignment.CenterHorizontally) {
                    Text("还没有隧道", color = MidnightText, fontWeight = FontWeight.SemiBold, fontSize = 15.sp)
                    Text(
                        "本地转发可以把服务器上的端口开到手机。动态代理则是一个 SOCKS5。",
                        color = MidnightMuted,
                        fontSize = 12.sp,
                        modifier = Modifier.padding(top = 4.dp),
                    )
                }
            }
        } else {
            LazyColumn(
                modifier = Modifier
                    .fillMaxSize()
                    .padding(padding),
                contentPadding = PaddingValues(start = ScreenPad, end = ScreenPad, bottom = 88.dp),
                verticalArrangement = Arrangement.spacedBy(8.dp),
            ) {
                items(rules, key = { it.id }) { rule ->
                    val host = hosts.firstOrNull { host ->
                        connections.firstOrNull { it.id == rule.connectionId }?.hostId == host.id
                    }
                    val connection = connections.firstOrNull { it.id == rule.connectionId }
                    TunnelCard(
                        rule = rule,
                        status = status[rule.id] ?: TunnelStatus(TunnelPhase.STOPPED),
                        connectionLabel = connection?.title(host) ?: "连接已删除",
                        onOpen = { onOpen(rule) },
                        onStart = { onStart(rule) },
                        onStop = { onStop(rule) },
                        onDelete = { onDelete(rule) },
                    )
                }
            }
        }
    }
}

@Composable
private fun TunnelCard(
    rule: TunnelRule,
    status: TunnelStatus,
    connectionLabel: String,
    onOpen: () -> Unit,
    onStart: () -> Unit,
    onStop: () -> Unit,
    onDelete: () -> Unit,
) {
    var menu by remember { mutableStateOf(false) }
    val running = status.phase == TunnelPhase.ACTIVE || status.phase == TunnelPhase.STARTING
    val color = when {
        status.phase == TunnelPhase.ACTIVE && status.error != null -> StatusOrange
        status.phase == TunnelPhase.ACTIVE -> StatusGreen
        status.phase == TunnelPhase.STARTING -> MidnightPrimary
        status.phase == TunnelPhase.ERROR -> StatusRed
        else -> MidnightMuted
    }
    val phaseLabel = when (status.phase) {
        TunnelPhase.ACTIVE -> status.error?.let { "转发中 · $it" } ?: "转发中"
        TunnelPhase.STARTING -> "正在启动"
        TunnelPhase.ERROR -> status.error?.let { "失败：$it" } ?: "启动失败"
        TunnelPhase.STOPPED -> if (rule.autoStart) "已停止 · 下次打开自动启动" else "已停止"
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
                .background(color.copy(alpha = 0.16f)),
            contentAlignment = Alignment.Center,
        ) {
            Icon(Icons.Outlined.Lan, contentDescription = null, tint = color, modifier = Modifier.size(18.dp))
        }
        Column(
            Modifier
                .weight(1f)
                .padding(horizontal = 10.dp),
        ) {
            Text(
                rule.title(),
                color = MidnightText,
                fontWeight = FontWeight.SemiBold,
                fontSize = 14.sp,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
            )
            Text(
                "${rule.kindLabel()} · $connectionLabel",
                color = MidnightMuted,
                fontSize = 12.sp,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
            )
            Text(
                rule.endpointLine(),
                color = MidnightText,
                fontSize = 12.sp,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
            )
            Text(
                phaseLabel,
                color = color,
                fontSize = 11.sp,
                maxLines = 2,
                overflow = TextOverflow.Ellipsis,
            )
        }
        when (status.phase) {
            TunnelPhase.STARTING -> CircularProgressIndicator(
                modifier = Modifier.size(22.dp),
                strokeWidth = 2.dp,
                color = MidnightPrimary,
            )
            TunnelPhase.ACTIVE -> IconButton(onClick = onStop, modifier = Modifier.size(36.dp)) {
                Icon(Icons.Outlined.Stop, contentDescription = "停止", tint = MidnightPrimary)
            }
            else -> IconButton(onClick = onStart, modifier = Modifier.size(36.dp)) {
                Icon(Icons.Outlined.PlayArrow, contentDescription = "启动", tint = MidnightPrimary)
            }
        }
        Box {
            IconButton(onClick = { menu = true }, modifier = Modifier.size(36.dp)) {
                Icon(Icons.Outlined.MoreVert, contentDescription = "更多", tint = MidnightMuted, modifier = Modifier.size(18.dp))
            }
            DropdownMenu(expanded = menu, onDismissRequest = { menu = false }) {
                DropdownMenuItem(
                    text = { Text(if (running) "停止" else "启动") },
                    onClick = {
                        menu = false
                        if (running) onStop() else onStart()
                    },
                )
                DropdownMenuItem(text = { Text("编辑") }, onClick = { menu = false; onOpen() })
                DropdownMenuItem(
                    text = { Text("删除", color = MidnightDanger) },
                    leadingIcon = { Icon(Icons.Outlined.Delete, contentDescription = null, tint = MidnightDanger) },
                    onClick = { menu = false; onDelete() },
                )
            }
        }
    }
}
