package app.netcatty.ui.connection

import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
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
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TopAppBar
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import app.netcatty.data.AuthMethod
import app.netcatty.data.Host
import app.netcatty.data.SshConnection
import app.netcatty.ui.host.EditorField
import app.netcatty.ui.theme.CompactBarTitle
import app.netcatty.ui.theme.FieldRadius
import app.netcatty.ui.theme.MidnightBackground
import app.netcatty.ui.theme.MidnightDanger
import app.netcatty.ui.theme.MidnightText
import app.netcatty.ui.theme.ScreenPad
import app.netcatty.ui.theme.appFieldColors
import app.netcatty.ui.theme.appTopBarColors
import java.util.UUID

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun ConnectionEditorScreen(
    hosts: List<Host>,
    initial: SshConnection?,
    presetHostId: String?,
    onBack: () -> Unit,
    onCreateHost: () -> Unit,
    onSave: (SshConnection) -> Unit,
    onSaveAndConnect: (SshConnection) -> Unit,
) {
    val context = LocalContext.current
    var hostId by remember { mutableStateOf(initial?.hostId ?: presetHostId.orEmpty()) }
    var label by remember { mutableStateOf(initial?.label.orEmpty()) }
    var port by remember { mutableStateOf((initial?.port ?: 22).toString()) }
    var username by remember { mutableStateOf(initial?.username.orEmpty()) }
    var auth by remember { mutableStateOf(initial?.authMethod ?: AuthMethod.PASSWORD) }
    var password by remember { mutableStateOf(initial?.password.orEmpty()) }
    var privateKey by remember { mutableStateOf(initial?.privateKey.orEmpty()) }
    var passphrase by remember { mutableStateOf(initial?.passphrase.orEmpty()) }
    var error by remember { mutableStateOf<String?>(null) }
    var hostOpen by remember { mutableStateOf(false) }
    val colors = appFieldColors()
    val selectedHost = hosts.firstOrNull { it.id == hostId }

    val keyPicker = rememberLauncherForActivityResult(ActivityResultContracts.OpenDocument()) { uri ->
        if (uri == null) return@rememberLauncherForActivityResult
        context.contentResolver.openInputStream(uri)?.use { input ->
            privateKey = input.readBytes().toString(Charsets.UTF_8)
            auth = AuthMethod.KEY
        }
    }

    fun draft(): SshConnection? {
        val user = username.trim()
        val parsedPort = port.toIntOrNull() ?: 22
        if (hostId.isBlank() || selectedHost == null) {
            error = "请选择一台主机"
            return null
        }
        if (user.isBlank()) {
            error = "请填写用户名"
            return null
        }
        if (parsedPort !in 1..65535) {
            error = "端口必须是 1-65535"
            return null
        }
        error = null
        return SshConnection(
            id = initial?.id ?: UUID.randomUUID().toString(),
            hostId = hostId,
            label = label.trim(),
            port = parsedPort,
            username = user,
            authMethod = auth,
            password = password,
            privateKey = privateKey,
            passphrase = passphrase,
            pinned = initial?.pinned == true,
            createdAt = initial?.createdAt ?: System.currentTimeMillis(),
            lastConnectedAt = initial?.lastConnectedAt,
        )
    }

    Scaffold(
        containerColor = MidnightBackground,
        topBar = {
            TopAppBar(
                title = { CompactBarTitle(if (initial == null) "新建连接" else "编辑连接") },
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
                    onClick = { draft()?.let(onSaveAndConnect) },
                    modifier = Modifier.fillMaxWidth(),
                    enabled = hosts.isNotEmpty(),
                ) { Text("保存并连接") }
                OutlinedButton(
                    onClick = { draft()?.let(onSave) },
                    modifier = Modifier
                        .fillMaxWidth()
                        .padding(top = 6.dp),
                    enabled = hosts.isNotEmpty(),
                ) { Text("保存") }
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
            if (hosts.isEmpty()) {
                Text("还没有主机。请先添加主机，再创建连接。", color = MidnightDanger, fontSize = 13.sp)
                TextButton(onClick = onCreateHost) { Text("去添加主机") }
                return@Column
            }
            ExposedDropdownMenuBox(expanded = hostOpen, onExpandedChange = { hostOpen = it }) {
                OutlinedTextField(
                    value = selectedHost?.let { "${it.title}  (${it.hostname})" } ?: "选择主机",
                    onValueChange = {},
                    readOnly = true,
                    label = { Text("主机") },
                    trailingIcon = { ExposedDropdownMenuDefaults.TrailingIcon(expanded = hostOpen) },
                    modifier = Modifier
                        .menuAnchor()
                        .fillMaxWidth()
                        .padding(bottom = 8.dp),
                    textStyle = TextStyle(fontSize = 14.sp, color = MidnightText),
                    colors = colors,
                    shape = FieldRadius,
                )
                ExposedDropdownMenu(expanded = hostOpen, onDismissRequest = { hostOpen = false }) {
                    hosts.forEach { item ->
                        DropdownMenuItem(
                            text = { Text("${item.title}  (${item.hostname})") },
                            onClick = {
                                hostId = item.id
                                hostOpen = false
                            },
                        )
                    }
                }
            }
            TextButton(onClick = onCreateHost, modifier = Modifier.padding(bottom = 4.dp)) {
                Text("新建主机")
            }
            EditorField(label, { label = it }, "连接名称", colors)
            Row(Modifier.fillMaxWidth()) {
                EditorField(username, { username = it }, "用户名", colors, Modifier.weight(1f))
                Spacer(Modifier.width(8.dp))
                EditorField(
                    port,
                    { port = it.filter(Char::isDigit).take(5) },
                    "端口",
                    colors,
                    modifier = Modifier.width(84.dp),
                    keyboard = KeyboardOptions(keyboardType = KeyboardType.Number),
                )
            }
            Row {
                FilterChip(
                    selected = auth == AuthMethod.PASSWORD,
                    onClick = { auth = AuthMethod.PASSWORD },
                    label = { Text("密码", fontSize = 12.sp) },
                    modifier = Modifier.padding(end = 6.dp),
                )
                FilterChip(
                    selected = auth == AuthMethod.KEY,
                    onClick = { auth = AuthMethod.KEY },
                    label = { Text("密钥", fontSize = 12.sp) },
                )
            }
            Spacer(Modifier.height(6.dp))
            if (auth == AuthMethod.PASSWORD) {
                OutlinedTextField(
                    value = password,
                    onValueChange = { password = it },
                    label = { Text("密码") },
                    modifier = Modifier.fillMaxWidth(),
                    visualTransformation = PasswordVisualTransformation(),
                    singleLine = true,
                    textStyle = TextStyle(fontSize = 14.sp, color = MidnightText),
                    colors = colors,
                    shape = FieldRadius,
                )
            } else {
                OutlinedTextField(
                    value = privateKey,
                    onValueChange = { privateKey = it },
                    label = { Text("私钥（PEM）") },
                    modifier = Modifier
                        .fillMaxWidth()
                        .height(120.dp),
                    textStyle = TextStyle(fontSize = 12.sp, color = MidnightText),
                    colors = colors,
                    shape = FieldRadius,
                )
                OutlinedButton(
                    onClick = { keyPicker.launch(arrayOf("*/*")) },
                    modifier = Modifier.padding(top = 6.dp),
                ) { Text("导入密钥文件") }
                OutlinedTextField(
                    value = passphrase,
                    onValueChange = { passphrase = it },
                    label = { Text("密钥口令") },
                    modifier = Modifier
                        .fillMaxWidth()
                        .padding(top = 6.dp),
                    visualTransformation = PasswordVisualTransformation(),
                    singleLine = true,
                    textStyle = TextStyle(fontSize = 14.sp, color = MidnightText),
                    colors = colors,
                    shape = FieldRadius,
                )
            }
            error?.let {
                Text(it, color = MidnightDanger, fontSize = 12.sp, modifier = Modifier.padding(top = 8.dp))
            }
            Spacer(Modifier.height(24.dp))
        }
    }
}
