package app.netcatty.ui.tunnel

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.outlined.ArrowBack
import androidx.compose.material3.Button
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.ExposedDropdownMenuBox
import androidx.compose.material3.ExposedDropdownMenuDefaults
import androidx.compose.material3.FilterChip
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Switch
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TopAppBar
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import app.netcatty.data.Host
import app.netcatty.data.SshConnection
import app.netcatty.data.TunnelKind
import app.netcatty.data.TunnelRule
import app.netcatty.data.validateTunnel
import app.netcatty.ui.host.EditorField
import app.netcatty.ui.theme.CompactBarTitle
import app.netcatty.ui.theme.FieldRadius
import app.netcatty.ui.theme.MidnightBackground
import app.netcatty.ui.theme.MidnightDanger
import app.netcatty.ui.theme.MidnightMuted
import app.netcatty.ui.theme.MidnightText
import app.netcatty.ui.theme.ScreenPad
import app.netcatty.ui.theme.appFieldColors
import app.netcatty.ui.theme.appTopBarColors
import java.util.UUID

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun TunnelEditorScreen(
    hosts: List<Host>,
    connections: List<SshConnection>,
    initial: TunnelRule?,
    presetConnectionId: String?,
    onBack: () -> Unit,
    onCreateConnection: () -> Unit,
    onSave: (TunnelRule, Boolean) -> Unit,
) {
    var connectionId by remember { mutableStateOf(initial?.connectionId ?: presetConnectionId.orEmpty()) }
    var label by remember { mutableStateOf(initial?.label.orEmpty()) }
    var kind by remember { mutableStateOf(initial?.kind ?: TunnelKind.LOCAL) }
    var bindHost by remember { mutableStateOf(initial?.bindHost ?: "127.0.0.1") }
    var listenPort by remember { mutableStateOf(initial?.listenPort?.toString().orEmpty()) }
    var targetHost by remember { mutableStateOf(initial?.targetHost ?: "127.0.0.1") }
    var targetPort by remember { mutableStateOf(initial?.targetPort?.takeIf { it > 0 }?.toString().orEmpty()) }
    var autoStart by remember { mutableStateOf(initial?.autoStart == true) }
    var error by remember { mutableStateOf<String?>(null) }
    var connectionOpen by remember { mutableStateOf(false) }
    val colors = appFieldColors()
    val connection = connections.firstOrNull { it.id == connectionId }
    val host = hosts.firstOrNull { it.id == connection?.hostId }

    fun draft(): TunnelRule? {
        val parsedListen = listenPort.toIntOrNull() ?: 0
        val parsedTarget = targetPort.toIntOrNull() ?: 0
        val problem = validateTunnel(
            connectionId = connectionId,
            listenPort = parsedListen,
            kind = kind,
            bindHost = bindHost,
            targetHost = targetHost.trim(),
            targetPort = parsedTarget,
        )
        if (problem != null || connection == null) {
            error = problem ?: "请选择一条连接"
            return null
        }
        error = null
        return TunnelRule(
            id = initial?.id ?: UUID.randomUUID().toString(),
            connectionId = connectionId,
            label = label.trim(),
            kind = kind,
            bindHost = bindHost,
            listenPort = parsedListen,
            targetHost = if (kind == TunnelKind.DYNAMIC) "127.0.0.1" else targetHost.trim(),
            targetPort = if (kind == TunnelKind.DYNAMIC) 0 else parsedTarget,
            autoStart = autoStart,
            createdAt = initial?.createdAt ?: System.currentTimeMillis(),
        )
    }

    Scaffold(
        containerColor = MidnightBackground,
        topBar = {
            TopAppBar(
                title = { CompactBarTitle(if (initial == null) "新建隧道" else "编辑隧道") },
                navigationIcon = {
                    IconButton(onClick = onBack) {
                        Icon(Icons.AutoMirrored.Outlined.ArrowBack, contentDescription = "返回")
                    }
                },
                colors = appTopBarColors(),
            )
        },
        bottomBar = {
            Column(
                Modifier
                    .fillMaxWidth()
                    .navigationBarsPadding()
                    .imePadding()
                    .padding(horizontal = ScreenPad, vertical = 8.dp),
            ) {
                Button(
                    onClick = { draft()?.let { onSave(it, true) } },
                    modifier = Modifier.fillMaxWidth(),
                    enabled = connections.isNotEmpty(),
                ) { Text("保存并启动") }
                OutlinedButton(
                    onClick = { draft()?.let { onSave(it, false) } },
                    modifier = Modifier
                        .fillMaxWidth()
                        .padding(top = 6.dp),
                    enabled = connections.isNotEmpty(),
                ) { Text("仅保存") }
            }
        },
    ) { padding ->
        Column(
            Modifier
                .fillMaxSize()
                .padding(padding)
                .verticalScroll(rememberScrollState())
                .padding(horizontal = ScreenPad, vertical = 8.dp),
        ) {
            if (connections.isEmpty()) {
                Text("还没有连接。请先添加主机和连接。", color = MidnightDanger, fontSize = 13.sp)
                TextButton(onClick = onCreateConnection) { Text("去添加主机") }
                return@Column
            }
            ExposedDropdownMenuBox(expanded = connectionOpen, onExpandedChange = { connectionOpen = it }) {
                OutlinedTextField(
                    value = connection?.let { "${it.title(host)}  (${it.connectionLine(host)})" } ?: "选择连接",
                    onValueChange = {},
                    readOnly = true,
                    label = { Text("SSH 连接") },
                    trailingIcon = { ExposedDropdownMenuDefaults.TrailingIcon(expanded = connectionOpen) },
                    modifier = Modifier
                        .menuAnchor()
                        .fillMaxWidth()
                        .padding(bottom = 8.dp),
                    textStyle = TextStyle(fontSize = 14.sp, color = MidnightText),
                    colors = colors,
                    shape = FieldRadius,
                )
                ExposedDropdownMenu(expanded = connectionOpen, onDismissRequest = { connectionOpen = false }) {
                    connections.forEach { item ->
                        val itemHost = hosts.firstOrNull { it.id == item.hostId }
                        DropdownMenuItem(
                            text = { Text("${item.title(itemHost)}  ${item.connectionLine(itemHost)}") },
                            onClick = {
                                connectionId = item.id
                                connectionOpen = false
                            },
                        )
                    }
                }
            }
            Text("类型", color = MidnightMuted, fontSize = 12.sp)
            Row(
                Modifier
                    .fillMaxWidth()
                    .padding(top = 4.dp, bottom = 8.dp),
                horizontalArrangement = Arrangement.spacedBy(8.dp),
            ) {
                KindChip("本地", kind == TunnelKind.LOCAL) { kind = TunnelKind.LOCAL }
                KindChip("远程", kind == TunnelKind.REMOTE) { kind = TunnelKind.REMOTE }
                KindChip("动态", kind == TunnelKind.DYNAMIC) { kind = TunnelKind.DYNAMIC }
            }
            Text(kindHelp(kind), color = MidnightMuted, fontSize = 12.sp, modifier = Modifier.padding(bottom = 8.dp))
            EditorField(label, { label = it }, "名称（可选）", colors)
            EditorField(
                listenPort,
                { listenPort = it.filter(Char::isDigit).take(5) },
                if (kind == TunnelKind.REMOTE) "服务器监听端口" else "手机监听端口",
                colors,
                keyboard = KeyboardOptions(keyboardType = KeyboardType.Number),
            )
            Text(if (kind == TunnelKind.REMOTE) "服务器绑定" else "手机绑定", color = MidnightMuted, fontSize = 12.sp)
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp), modifier = Modifier.padding(top = 4.dp, bottom = 8.dp)) {
                KindChip("仅本机", bindHost == "127.0.0.1") { bindHost = "127.0.0.1" }
                KindChip("所有网卡", bindHost == "0.0.0.0") { bindHost = "0.0.0.0" }
            }
            if (bindHost == "0.0.0.0" && kind != TunnelKind.REMOTE) {
                Text(
                    "同一局域网里的设备也能连这个端口。",
                    color = MidnightMuted,
                    fontSize = 12.sp,
                    modifier = Modifier.padding(bottom = 8.dp),
                )
            }
            if (kind != TunnelKind.DYNAMIC) {
                EditorField(
                    targetHost,
                    { targetHost = it },
                    if (kind == TunnelKind.LOCAL) "目标主机（从服务器访问）" else "目标主机（从手机访问）",
                    colors,
                )
                EditorField(
                    targetPort,
                    { targetPort = it.filter(Char::isDigit).take(5) },
                    "目标端口",
                    colors,
                    keyboard = KeyboardOptions(keyboardType = KeyboardType.Number),
                )
            }
            Row(
                Modifier
                    .fillMaxWidth()
                    .padding(bottom = 8.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Column(Modifier.weight(1f)) {
                    Text("打开应用时自动启动", color = MidnightText, fontSize = 14.sp)
                    Text("会保持一条 SSH 连接，直到你停止这条隧道。", color = MidnightMuted, fontSize = 12.sp)
                }
                Switch(checked = autoStart, onCheckedChange = { autoStart = it })
            }
            error?.let { Text(it, color = MidnightDanger, fontSize = 13.sp) }
        }
    }
}

@Composable
private fun KindChip(label: String, selected: Boolean, onClick: () -> Unit) {
    FilterChip(selected = selected, onClick = onClick, label = { Text(label) })
}

private fun kindHelp(kind: TunnelKind): String = when (kind) {
    TunnelKind.LOCAL -> "手机监听端口，流量经 SSH 转到目标。适合打开服务器上的网页或数据库。"
    TunnelKind.REMOTE -> "SSH 服务器监听端口，连进来的流量转到手机上的地址。"
    TunnelKind.DYNAMIC -> "手机上的 SOCKS5 代理。把应用的代理指到这里，由 SSH 服务器代为访问。"
}
