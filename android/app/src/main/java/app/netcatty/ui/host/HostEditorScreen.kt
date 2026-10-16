package app.netcatty.ui.host

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.outlined.ArrowBack
import androidx.compose.material.icons.outlined.Add
import androidx.compose.material3.Button
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.ListItem
import androidx.compose.material3.ListItemDefaults
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TopAppBar
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import app.netcatty.data.Host
import app.netcatty.data.SshConnection
import app.netcatty.ui.theme.CompactBarTitle
import app.netcatty.ui.theme.FieldRadius
import app.netcatty.ui.theme.MidnightBackground
import app.netcatty.ui.theme.MidnightDanger
import app.netcatty.ui.theme.MidnightMuted
import app.netcatty.ui.theme.MidnightSurface
import app.netcatty.ui.theme.MidnightText
import app.netcatty.ui.theme.ScreenPad
import app.netcatty.ui.theme.appFieldColors
import app.netcatty.ui.theme.appTopBarColors
import java.util.UUID

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun HostEditorScreen(
    initial: Host?,
    connections: List<SshConnection>,
    onBack: () -> Unit,
    onSave: (Host) -> Unit,
    onAddConnection: (Host) -> Unit,
    onEditConnection: (SshConnection) -> Unit,
    onOpenCatty: ((Host) -> Unit)? = null,
) {
    var label by remember { mutableStateOf(initial?.label.orEmpty()) }
    var hostname by remember { mutableStateOf(initial?.hostname.orEmpty()) }
    var group by remember { mutableStateOf(initial?.group.orEmpty()) }
    var notes by remember { mutableStateOf(initial?.notes.orEmpty()) }
    var error by remember { mutableStateOf<String?>(null) }
    val colors = appFieldColors()

    fun draft(): Host? {
        val hostName = hostname.trim()
        if (hostName.isBlank()) {
            error = "请填写主机地址"
            return null
        }
        error = null
        return Host(
            id = initial?.id ?: UUID.randomUUID().toString(),
            label = label.trim(),
            hostname = hostName,
            group = group.trim(),
            notes = notes.trimEnd(),
            createdAt = initial?.createdAt ?: System.currentTimeMillis(),
        )
    }

    Scaffold(
        containerColor = MidnightBackground,
        topBar = {
            TopAppBar(
                title = { CompactBarTitle(if (initial == null) "新建主机" else "编辑主机") },
                navigationIcon = {
                    IconButton(onClick = onBack) {
                        Icon(Icons.AutoMirrored.Outlined.ArrowBack, contentDescription = "返回")
                    }
                },
                colors = appTopBarColors(),
            )
        },
        bottomBar = {
            Button(
                onClick = { draft()?.let(onSave) },
                modifier = Modifier
                    .fillMaxWidth()
                    .navigationBarsPadding()
                    .imePadding()
                    .padding(horizontal = ScreenPad, vertical = 8.dp),
            ) { Text("保存主机") }
        },
    ) { padding ->
        Column(
            Modifier
                .fillMaxSize()
                .padding(padding)
                .verticalScroll(rememberScrollState())
                .padding(horizontal = ScreenPad, vertical = 8.dp),
        ) {
            EditorField(label, { label = it }, "名称", colors)
            EditorField(hostname, { hostname = it }, "主机地址", colors)
            EditorField(group, { group = it }, "分组", colors)
            OutlinedTextField(
                value = notes,
                onValueChange = { notes = it },
                label = { Text("笔记") },
                placeholder = { Text("端口、用途、登录提示、排障记录…") },
                modifier = Modifier
                    .fillMaxWidth()
                    .height(160.dp)
                    .padding(bottom = 8.dp),
                textStyle = TextStyle(fontSize = 14.sp, color = MidnightText, lineHeight = 20.sp),
                colors = colors,
                shape = FieldRadius,
            )
            error?.let {
                Text(it, color = MidnightDanger, fontSize = 12.sp, modifier = Modifier.padding(top = 8.dp))
            }
            if (initial != null) {
                if (onOpenCatty != null) {
                    TextButton(
                        onClick = { draft()?.let(onOpenCatty) },
                        modifier = Modifier.padding(top = 8.dp),
                    ) { Text("查看 Catty 会话") }
                }
                Row(
                    Modifier
                        .fillMaxWidth()
                        .padding(top = 16.dp, bottom = 4.dp),
                ) {
                    Text("连接", color = MidnightText, fontSize = 14.sp, modifier = Modifier.weight(1f))
                    TextButton(onClick = { draft()?.let(onAddConnection) }) {
                        Icon(Icons.Outlined.Add, contentDescription = null, modifier = Modifier.padding(end = 4.dp))
                        Text("添加连接")
                    }
                }
                if (connections.isEmpty()) {
                    Text("这台主机还没有连接。", color = MidnightMuted, fontSize = 12.sp)
                } else {
                    connections.forEach { conn ->
                        ListItem(
                            headlineContent = { Text(conn.label.ifBlank { conn.username }, fontSize = 14.sp) },
                            supportingContent = { Text("${conn.username}  ·  端口 ${conn.port}", fontSize = 12.sp) },
                            modifier = Modifier
                                .fillMaxWidth()
                                .clickable { onEditConnection(conn) },
                            colors = ListItemDefaults.colors(containerColor = MidnightSurface),
                        )
                    }
                }
            }
            Spacer(Modifier.height(24.dp))
        }
    }
}

@Composable
internal fun EditorField(
    value: String,
    onChange: (String) -> Unit,
    label: String,
    colors: androidx.compose.material3.TextFieldColors,
    modifier: Modifier = Modifier.fillMaxWidth(),
    keyboard: KeyboardOptions = KeyboardOptions.Default,
) {
    OutlinedTextField(
        value = value,
        onValueChange = onChange,
        label = { Text(label) },
        modifier = modifier.padding(bottom = 8.dp),
        singleLine = true,
        textStyle = TextStyle(fontSize = 14.sp, color = MidnightText),
        keyboardOptions = keyboard,
        colors = colors,
        shape = FieldRadius,
    )
}
