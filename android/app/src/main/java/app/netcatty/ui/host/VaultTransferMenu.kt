package app.netcatty.ui.host

import android.widget.Toast
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import app.netcatty.data.VaultImportSummary
import app.netcatty.data.VaultPayload
import app.netcatty.data.VaultTransfer
import app.netcatty.data.VaultTransferException
import app.netcatty.data.readBackupBytes
import app.netcatty.ui.theme.FieldRadius
import app.netcatty.ui.theme.MidnightDanger
import app.netcatty.ui.theme.MidnightMuted
import app.netcatty.ui.theme.MidnightText
import app.netcatty.ui.theme.appFieldColors
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

private enum class TransferStage {
    NONE,
    EXPORT,
    IMPORT_PASSWORD,
    IMPORT_CONFIRM,
}

@Composable
fun VaultTransferActions(
    onExport: suspend (String) -> ByteArray,
    onOpenImport: suspend (ByteArray, String) -> VaultPayload,
    onCommitImport: suspend (VaultPayload, Boolean) -> VaultImportSummary,
) {
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    val colors = appFieldColors()
    var stage by remember { mutableStateOf(TransferStage.NONE) }
    var password by remember { mutableStateOf("") }
    var confirmPassword by remember { mutableStateOf("") }
    var error by remember { mutableStateOf<String?>(null) }
    var busy by remember { mutableStateOf(false) }
    var importBytes by remember { mutableStateOf<ByteArray?>(null) }
    var pendingExport by remember { mutableStateOf<ByteArray?>(null) }
    var prepared by remember { mutableStateOf<VaultPayload?>(null) }

    fun resetFields() {
        password = ""
        confirmPassword = ""
        error = null
        busy = false
    }

    fun toast(message: String) {
        Toast.makeText(context, message, Toast.LENGTH_SHORT).show()
    }

    val createDocument = rememberLauncherForActivityResult(
        ActivityResultContracts.CreateDocument("application/octet-stream"),
    ) { uri ->
        val bytes = pendingExport
        pendingExport = null
        if (uri == null || bytes == null) {
            bytes?.fill(0)
            return@rememberLauncherForActivityResult
        }
        val written = runCatching {
            context.contentResolver.openOutputStream(uri)?.use { stream ->
                stream.write(bytes)
            } ?: error("无法写入文件")
        }
        bytes.fill(0)
        written.onSuccess { toast("已保存加密备份") }
            .onFailure { toast(it.message ?: "导出失败") }
    }

    val openDocument = rememberLauncherForActivityResult(ActivityResultContracts.OpenDocument()) { uri ->
        if (uri == null) return@rememberLauncherForActivityResult
        scope.launch {
            val bytes = runCatching {
                withContext(Dispatchers.IO) {
                    context.contentResolver.openInputStream(uri)?.use { readBackupBytes(it) }
                        ?: throw VaultTransferException("无法读取文件")
                }
            }
            bytes.onSuccess {
                importBytes?.fill(0)
                importBytes = it
                resetFields()
                stage = TransferStage.IMPORT_PASSWORD
            }.onFailure {
                toast(it.message ?: "无法读取文件")
            }
        }
    }

    Column(
        modifier = Modifier.fillMaxWidth(),
        verticalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        Button(
            onClick = {
                resetFields()
                stage = TransferStage.EXPORT
            },
            modifier = Modifier.fillMaxWidth(),
        ) { Text("加密导出") }
        OutlinedButton(
            onClick = { openDocument.launch(arrayOf("*/*")) },
            modifier = Modifier.fillMaxWidth(),
        ) { Text("导入备份") }
    }

    if (stage == TransferStage.EXPORT || stage == TransferStage.IMPORT_PASSWORD) {
        val exporting = stage == TransferStage.EXPORT
        AlertDialog(
            onDismissRequest = {
                if (!busy) {
                    stage = TransferStage.NONE
                    importBytes?.fill(0)
                    importBytes = null
                    resetFields()
                }
            },
            title = { Text(if (exporting) "加密导出" else "导入备份") },
            text = {
                Column {
                    Text(
                        if (exporting) {
                            "包含主机信息、登录配置、隧道和 Catty 模型配置（含密钥）。文件用密码加密，忘记密码将无法打开。"
                        } else {
                            "输入导出时设置的密码。"
                        },
                        color = MidnightMuted,
                        fontSize = 13.sp,
                    )
                    OutlinedTextField(
                        value = password,
                        onValueChange = { password = it },
                        label = { Text("密码") },
                        singleLine = true,
                        enabled = !busy,
                        visualTransformation = PasswordVisualTransformation(),
                        keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Password),
                        modifier = Modifier
                            .fillMaxWidth()
                            .padding(top = 12.dp),
                        colors = colors,
                        shape = FieldRadius,
                    )
                    if (exporting) {
                        OutlinedTextField(
                            value = confirmPassword,
                            onValueChange = { confirmPassword = it },
                            label = { Text("确认密码") },
                            singleLine = true,
                            enabled = !busy,
                            visualTransformation = PasswordVisualTransformation(),
                            keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Password),
                            modifier = Modifier
                                .fillMaxWidth()
                                .padding(top = 8.dp),
                            colors = colors,
                            shape = FieldRadius,
                        )
                    }
                    if (busy) {
                        CircularProgressIndicator(
                            modifier = Modifier.padding(top = 12.dp),
                            strokeWidth = 2.dp,
                        )
                    }
                    error?.let {
                        Text(it, color = MidnightDanger, fontSize = 12.sp, modifier = Modifier.padding(top = 8.dp))
                    }
                }
            },
            confirmButton = {
                TextButton(
                    enabled = !busy,
                    onClick = {
                        if (exporting) {
                            when {
                                password.length < 4 -> error = "密码至少 4 位"
                                password != confirmPassword -> error = "两次密码不一致"
                                else -> {
                                    val secret = password
                                    busy = true
                                    error = null
                                    scope.launch {
                                        val bytes = runCatching { onExport(secret) }
                                        busy = false
                                        bytes.onSuccess {
                                            pendingExport = it
                                            stage = TransferStage.NONE
                                            resetFields()
                                            createDocument.launch("netcatty-vault.ncvault")
                                        }.onFailure { failure ->
                                            error = failure.message ?: "导出失败"
                                        }
                                    }
                                }
                            }
                        } else {
                            val bytes = importBytes
                            if (password.isEmpty()) {
                                error = "请输入密码"
                            } else if (bytes == null) {
                                error = "请重新选择文件"
                            } else {
                                val secret = password
                                busy = true
                                error = null
                                scope.launch {
                                    val opened = runCatching { onOpenImport(bytes, secret) }
                                    busy = false
                                    opened.onSuccess {
                                        prepared = it
                                        stage = TransferStage.IMPORT_CONFIRM
                                        resetFields()
                                    }.onFailure { failure ->
                                        error = failure.message ?: "导入失败"
                                    }
                                }
                            }
                        }
                    },
                ) { Text(if (exporting) "保存" else "解密") }
            },
            dismissButton = {
                TextButton(
                    enabled = !busy,
                    onClick = {
                        stage = TransferStage.NONE
                        importBytes?.fill(0)
                        importBytes = null
                        resetFields()
                    },
                ) { Text("取消") }
            },
        )
    }

    val payload = prepared
    if (stage == TransferStage.IMPORT_CONFIRM && payload != null) {
        AlertDialog(
            onDismissRequest = {
                if (!busy) {
                    prepared = null
                    importBytes?.fill(0)
                    importBytes = null
                    stage = TransferStage.NONE
                }
            },
            title = { Text("导入备份") },
            text = {
                Text(
                    buildString {
                        append("文件包含 ${payload.hosts.size} 台主机、${payload.connections.size} 条连接、${payload.tunnels.size} 条隧道。")
                        val agent = payload.agent
                        if (agent == null) {
                            append("这份备份没有 Catty 配置，导入后会保留本机的模型设置。")
                        } else {
                            append("同时会更新 Catty 配置：${agent.preset.label} · ${agent.model.ifBlank { "未填模型" }}。")
                        }
                        append("合并会按编号更新已有项，并保留本地独有项。替换会用文件内容覆盖当前主机列表。")
                    },
                    color = MidnightText,
                    fontSize = 14.sp,
                )
            },
            confirmButton = {
                Row {
                    TextButton(
                        enabled = !busy,
                        onClick = {
                            busy = true
                            scope.launch {
                                val result = runCatching { onCommitImport(payload, false) }
                                busy = false
                                result.onSuccess {
                                    prepared = null
                                    importBytes?.fill(0)
                                    importBytes = null
                                    stage = TransferStage.NONE
                                    toast("已合并 ${it.hosts} 台主机、${it.connections} 条连接")
                                }.onFailure { failure ->
                                    toast(failure.message ?: "导入失败")
                                }
                            }
                        },
                    ) { Text("合并") }
                    TextButton(
                        enabled = !busy,
                        onClick = {
                            busy = true
                            scope.launch {
                                val result = runCatching { onCommitImport(payload, true) }
                                busy = false
                                result.onSuccess {
                                    prepared = null
                                    importBytes?.fill(0)
                                    importBytes = null
                                    stage = TransferStage.NONE
                                    toast("已替换为 ${it.hosts} 台主机、${it.connections} 条连接")
                                }.onFailure { failure ->
                                    toast(failure.message ?: "导入失败")
                                }
                            }
                        },
                        colors = ButtonDefaults.textButtonColors(contentColor = MidnightDanger),
                    ) { Text("替换") }
                }
            },
            dismissButton = {
                TextButton(
                    enabled = !busy,
                    onClick = {
                        prepared = null
                        importBytes?.fill(0)
                        importBytes = null
                        stage = TransferStage.NONE
                    },
                ) { Text("取消") }
            },
        )
    }
}
