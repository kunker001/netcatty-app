package app.netcatty.ui.settings

import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.outlined.ArrowBack
import androidx.compose.material.icons.outlined.Refresh
import androidx.compose.material3.Button
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.ExposedDropdownMenuBox
import androidx.compose.material3.ExposedDropdownMenuDefaults
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.ListItem
import androidx.compose.material3.ListItemDefaults
import androidx.compose.material3.MenuAnchorType
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TopAppBar
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import app.netcatty.ai.AiSettings
import app.netcatty.ai.AiSettingsStore
import app.netcatty.ai.PROVIDER_PRESETS
import app.netcatty.ai.fetchLlmModels
import app.netcatty.ui.theme.CompactBarTitle
import app.netcatty.ui.theme.FieldRadius
import app.netcatty.ui.theme.MidnightBackground
import app.netcatty.ui.theme.MidnightDanger
import app.netcatty.ui.theme.MidnightMuted
import app.netcatty.ui.theme.MidnightPrimary
import app.netcatty.ui.theme.MidnightText
import app.netcatty.ui.theme.ScreenPad
import app.netcatty.ui.theme.appFieldColors
import app.netcatty.ui.theme.appTopBarColors
import kotlinx.coroutines.launch

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun SettingsScreen(
    store: AiSettingsStore,
    initial: AiSettings,
    defaultBlocklist: List<String>,
    onSaved: (AiSettings) -> Unit = {},
    onBack: () -> Unit,
) {
    val scope = rememberCoroutineScope()
    var providerId by remember { mutableStateOf(initial.providerId) }
    var baseUrl by remember { mutableStateOf(initial.baseUrl) }
    var model by remember { mutableStateOf(initial.model) }
    var apiKey by remember { mutableStateOf(initial.apiKey) }
    var mode by remember { mutableStateOf(initial.permissionMode) }
    var timeout by remember { mutableStateOf(initial.timeoutSeconds.toString()) }
    var idleTimeout by remember { mutableStateOf(initial.responseIdleTimeoutSeconds.toString()) }
    var maxIterations by remember { mutableStateOf(initial.maxIterations.toString()) }
    var blocklist by remember { mutableStateOf(initial.commandBlocklist ?: defaultBlocklist) }
    var webSearch by remember { mutableStateOf(initial.webSearch) }
    var saved by remember { mutableStateOf(false) }
    var providerOpen by remember { mutableStateOf(false) }
    var modelOpen by remember { mutableStateOf(false) }
    var models by remember { mutableStateOf<List<String>>(emptyList()) }
    var loadingModels by remember { mutableStateOf(false) }
    var modelsError by remember { mutableStateOf<String?>(null) }
    val preset = PROVIDER_PRESETS.firstOrNull { it.id == providerId } ?: PROVIDER_PRESETS.last()
    val filteredModels = remember(model, models) {
        val query = model.trim()
        if (query.isEmpty()) models
        else models.filter { it.contains(query, ignoreCase = true) }.ifEmpty { models }
    }

    fun loadModels(openWhenReady: Boolean = false) {
        if (loadingModels) return
        loadingModels = true
        modelsError = null
        scope.launch {
            runCatching { fetchLlmModels(baseUrl, apiKey) }
                .onSuccess { ids ->
                    models = ids
                    if (openWhenReady) modelOpen = ids.isNotEmpty()
                }
                .onFailure { modelsError = it.message ?: "获取模型失败" }
            loadingModels = false
        }
    }

    LaunchedEffect(providerId, baseUrl) {
        models = emptyList()
        modelsError = null
        modelOpen = false
    }

    LaunchedEffect(Unit) {
        if (baseUrl.isNotBlank() && (apiKey.isNotBlank() || providerId == "ollama")) {
            loadModels(openWhenReady = false)
        }
    }

    Scaffold(
        containerColor = MidnightBackground,
        topBar = {
            TopAppBar(
                title = { CompactBarTitle("设置") },
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
                onClick = {
                    scope.launch {
                        val next = AiSettings(
                            providerId = providerId,
                            baseUrl = baseUrl.trim(),
                            model = model.trim(),
                            apiKey = apiKey.trim(),
                            permissionMode = mode,
                            timeoutSeconds = timeout.toIntOrNull()?.coerceIn(1, 86_400) ?: 60,
                            responseIdleTimeoutSeconds = idleTimeout.toIntOrNull()?.coerceIn(1, 86_400) ?: 120,
                            maxIterations = maxIterations.toIntOrNull()?.coerceIn(1, 100) ?: 8,
                            commandBlocklist = blocklist,
                            webSearch = webSearch.copy(
                                apiKey = webSearch.apiKey.trim(),
                                apiHost = webSearch.apiHost.trim(),
                                maxResults = webSearch.maxResults.coerceIn(1, 20),
                            ),
                        )
                        store.save(next)
                        onSaved(next)
                        saved = true
                    }
                },
                modifier = Modifier
                    .fillMaxWidth()
                    .navigationBarsPadding()
                    .imePadding()
                    .padding(horizontal = ScreenPad, vertical = 8.dp),
            ) {
                Text(if (saved) "已保存" else "保存 AI 设置")
            }
        },
    ) { padding ->
        Column(
            Modifier
                .padding(padding)
                .verticalScroll(rememberScrollState())
                .padding(horizontal = ScreenPad),
        ) {
            ListItem(
                headlineContent = { Text("Netcatty Android", fontSize = 14.sp) },
                supportingContent = { Text("SSH 连接、终端、SFTP、Catty 运维", fontSize = 12.sp) },
                colors = ListItemDefaults.colors(containerColor = MidnightBackground),
            )
            ListItem(
                headlineContent = { Text("版本", fontSize = 14.sp) },
                supportingContent = { Text("0.2.0") },
                colors = listColors(),
            )
            Spacer(Modifier.height(4.dp))
            Text("Catty 运维", color = MidnightText, fontSize = 14.sp, modifier = Modifier.padding(bottom = 4.dp))
            Text(
                "使用 OpenAI 兼容接口。命令默认需要确认后才会执行。",
                color = MidnightMuted,
                fontSize = 12.sp,
                modifier = Modifier.padding(bottom = 10.dp),
            )
            ExposedDropdownMenuBox(expanded = providerOpen, onExpandedChange = { providerOpen = it }) {
                OutlinedTextField(
                    value = preset.label,
                    onValueChange = {},
                    readOnly = true,
                    label = { Text("服务商") },
                    trailingIcon = { ExposedDropdownMenuDefaults.TrailingIcon(expanded = providerOpen) },
                    modifier = Modifier
                        .menuAnchor(MenuAnchorType.PrimaryNotEditable)
                        .fillMaxWidth(),
                    textStyle = TextStyle(fontSize = 14.sp, color = MidnightText),
                    colors = appFieldColors(),
                    shape = FieldRadius,
                )
                ExposedDropdownMenu(expanded = providerOpen, onDismissRequest = { providerOpen = false }) {
                    PROVIDER_PRESETS.forEach { item ->
                        DropdownMenuItem(
                            text = { Text(item.label) },
                            onClick = {
                                providerId = item.id
                                if (item.id != "custom") {
                                    baseUrl = item.baseUrl
                                    model = item.model
                                }
                                providerOpen = false
                            },
                        )
                    }
                }
            }
            Spacer(Modifier.height(8.dp))
            Field("接口地址", baseUrl) { baseUrl = it }
            Spacer(Modifier.height(8.dp))
            ExposedDropdownMenuBox(
                expanded = modelOpen && models.isNotEmpty(),
                onExpandedChange = { modelOpen = it && models.isNotEmpty() },
            ) {
                OutlinedTextField(
                    value = model,
                    onValueChange = { model = it },
                    modifier = Modifier
                        .menuAnchor(MenuAnchorType.PrimaryEditable)
                        .fillMaxWidth(),
                    label = { Text("模型") },
                    placeholder = { Text("填写或从列表选择") },
                    singleLine = true,
                    textStyle = TextStyle(fontSize = 14.sp, color = MidnightText),
                    colors = appFieldColors(),
                    shape = FieldRadius,
                    trailingIcon = {
                        Row(verticalAlignment = Alignment.CenterVertically) {
                            if (loadingModels) {
                                CircularProgressIndicator(
                                    modifier = Modifier
                                        .padding(end = 8.dp)
                                        .size(16.dp),
                                    strokeWidth = 2.dp,
                                    color = MidnightPrimary,
                                )
                            } else {
                                IconButton(
                                    onClick = { loadModels(openWhenReady = true) },
                                    modifier = Modifier.size(36.dp),
                                ) {
                                    Icon(Icons.Outlined.Refresh, contentDescription = "获取模型列表", tint = MidnightPrimary)
                                }
                            }
                            ExposedDropdownMenuDefaults.TrailingIcon(expanded = modelOpen && models.isNotEmpty())
                        }
                    },
                )
                ExposedDropdownMenu(
                    expanded = modelOpen && filteredModels.isNotEmpty(),
                    onDismissRequest = { modelOpen = false },
                ) {
                    filteredModels.take(120).forEach { item ->
                        DropdownMenuItem(
                            text = { Text(item, fontSize = 13.sp) },
                            onClick = {
                                model = item
                                modelOpen = false
                            },
                        )
                    }
                }
            }
            Row(
                modifier = Modifier.fillMaxWidth(),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                TextButton(onClick = { loadModels(openWhenReady = true) }, enabled = !loadingModels) {
                    Text(if (loadingModels) "正在获取…" else "获取模型列表")
                }
                if (models.isNotEmpty()) {
                    Text("${models.size} 个模型", color = MidnightMuted, fontSize = 12.sp)
                }
            }
            modelsError?.let { message ->
                Text(message, color = MidnightDanger, fontSize = 12.sp, modifier = Modifier.padding(bottom = 4.dp))
            }
            Spacer(Modifier.height(8.dp))
            OutlinedTextField(
                value = apiKey,
                onValueChange = { apiKey = it },
                modifier = Modifier.fillMaxWidth(),
                label = { Text("API 密钥") },
                visualTransformation = PasswordVisualTransformation(),
                singleLine = true,
                textStyle = TextStyle(fontSize = 14.sp, color = MidnightText),
                shape = FieldRadius,
                colors = appFieldColors(),
            )
            SafetySettings(
                mode = mode,
                onMode = { mode = it },
                timeout = timeout,
                onTimeout = { timeout = it },
                idleTimeout = idleTimeout,
                onIdleTimeout = { idleTimeout = it },
                maxIterations = maxIterations,
                onMaxIterations = { maxIterations = it },
                blocklist = blocklist,
                onBlocklist = { blocklist = it },
                defaultBlocklist = defaultBlocklist,
            )
            WebSearchSettings(
                config = webSearch,
                onChange = { webSearch = it },
            )
            Spacer(Modifier.height(28.dp))
        }
    }
}

@Composable
private fun Field(label: String, value: String, onChange: (String) -> Unit) {
    OutlinedTextField(
        value = value,
        onValueChange = onChange,
        modifier = Modifier.fillMaxWidth(),
        label = { Text(label) },
        singleLine = true,
        textStyle = TextStyle(fontSize = 14.sp, color = MidnightText),
        shape = FieldRadius,
        colors = appFieldColors(),
    )
}

@Composable
private fun listColors() = ListItemDefaults.colors(
    containerColor = MidnightBackground,
    headlineColor = MidnightText,
    supportingColor = MidnightMuted,
)
