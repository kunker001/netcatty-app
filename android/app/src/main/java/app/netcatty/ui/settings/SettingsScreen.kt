package app.netcatty.ui.settings

import androidx.activity.compose.BackHandler
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.outlined.ArrowBack
import androidx.compose.material.icons.automirrored.outlined.KeyboardArrowRight
import androidx.compose.material.icons.outlined.AutoAwesome
import androidx.compose.material.icons.outlined.Info
import androidx.compose.material.icons.outlined.Language
import androidx.compose.material.icons.outlined.Refresh
import androidx.compose.material.icons.outlined.Shield
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
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import app.netcatty.ai.AiSettings
import app.netcatty.ai.AiSettingsStore
import app.netcatty.ai.PROVIDER_PRESETS
import app.netcatty.ai.fetchLlmModels
import app.netcatty.ai.labelZh
import app.netcatty.ui.theme.CardRadius
import app.netcatty.ui.theme.CompactBarTitle
import app.netcatty.ui.theme.FieldRadius
import app.netcatty.ui.theme.MidnightBackground
import app.netcatty.ui.theme.MidnightBorder
import app.netcatty.ui.theme.MidnightDanger
import app.netcatty.ui.theme.MidnightMuted
import app.netcatty.ui.theme.MidnightPrimary
import app.netcatty.ui.theme.MidnightSurface
import app.netcatty.ui.theme.MidnightText
import app.netcatty.ui.theme.ScreenPad
import app.netcatty.ui.theme.appFieldColors
import app.netcatty.ui.theme.appTopBarColors
import kotlinx.coroutines.launch

private const val PAGE_HUB = "hub"
private const val PAGE_MODEL = "model"
private const val PAGE_SAFETY = "safety"
private const val PAGE_SEARCH = "search"
private const val PAGE_ABOUT = "about"

@Composable
fun SettingsScreen(
    store: AiSettingsStore,
    initial: AiSettings,
    defaultBlocklist: List<String>,
    onSaved: (AiSettings) -> Unit = {},
    onBack: () -> Unit,
) {
    var page by remember { mutableStateOf(PAGE_HUB) }
    BackHandler(enabled = page != PAGE_HUB) { page = PAGE_HUB }
    when (page) {
        PAGE_MODEL -> ModelSettingsPage(
            store = store,
            initial = initial,
            onSaved = onSaved,
            onBack = { page = PAGE_HUB },
        )
        PAGE_SAFETY -> SafetySettingsPage(
            store = store,
            initial = initial,
            defaultBlocklist = defaultBlocklist,
            onSaved = onSaved,
            onBack = { page = PAGE_HUB },
        )
        PAGE_SEARCH -> SearchSettingsPage(
            store = store,
            initial = initial,
            onSaved = onSaved,
            onBack = { page = PAGE_HUB },
        )
        PAGE_ABOUT -> AboutSettingsPage(onBack = { page = PAGE_HUB })
        else -> SettingsHub(initial = initial, onOpen = { page = it }, onBack = onBack)
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun SettingsHub(
    initial: AiSettings,
    onOpen: (String) -> Unit,
    onBack: () -> Unit,
) {
    val entries = listOf(
        SettingsEntry(
            page = PAGE_MODEL,
            title = "Catty 模型",
            subtitle = if (initial.configured) "${initial.preset.label} · ${initial.model}" else "未配置密钥",
            icon = Icons.Outlined.AutoAwesome,
        ),
        SettingsEntry(
            page = PAGE_SAFETY,
            title = "安全",
            subtitle = "权限：${initial.permissionMode.labelZh()}",
            icon = Icons.Outlined.Shield,
        ),
        SettingsEntry(
            page = PAGE_SEARCH,
            title = "网络搜索",
            subtitle = if (initial.webSearch.enabled) {
                "已启用 · ${initial.webSearch.preset.name}"
            } else {
                "未启用"
            },
            icon = Icons.Outlined.Language,
        ),
        SettingsEntry(
            page = PAGE_ABOUT,
            title = "关于",
            subtitle = "版本 0.2.0",
            icon = Icons.Outlined.Info,
        ),
    )
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
    ) { padding ->
        Column(
            Modifier
                .fillMaxSize()
                .padding(padding)
                .padding(horizontal = ScreenPad)
                .padding(top = 4.dp),
            verticalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            entries.forEach { entry ->
                SettingsEntryRow(entry) { onOpen(entry.page) }
            }
        }
    }
}

@Composable
private fun SettingsEntryRow(entry: SettingsEntry, onClick: () -> Unit) {
    Row(
        Modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(CardRadius))
            .background(MidnightSurface)
            .border(1.dp, MidnightBorder, RoundedCornerShape(CardRadius))
            .clickable(onClick = onClick)
            .padding(horizontal = 12.dp, vertical = 12.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Box(
            Modifier
                .size(36.dp)
                .clip(CircleShape)
                .background(MidnightPrimary.copy(alpha = 0.12f)),
            contentAlignment = Alignment.Center,
        ) {
            Icon(entry.icon, contentDescription = null, tint = MidnightPrimary, modifier = Modifier.size(18.dp))
        }
        Column(
            Modifier
                .weight(1f)
                .padding(horizontal = 12.dp),
        ) {
            Text(entry.title, color = MidnightText, fontWeight = FontWeight.SemiBold, fontSize = 15.sp)
            Text(entry.subtitle, color = MidnightMuted, fontSize = 12.sp)
        }
        Icon(
            Icons.AutoMirrored.Outlined.KeyboardArrowRight,
            contentDescription = null,
            tint = MidnightMuted,
        )
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun ModelSettingsPage(
    store: AiSettingsStore,
    initial: AiSettings,
    onSaved: (AiSettings) -> Unit,
    onBack: () -> Unit,
) {
    val scope = rememberCoroutineScope()
    var providerId by remember { mutableStateOf(initial.providerId) }
    var baseUrl by remember { mutableStateOf(initial.baseUrl) }
    var model by remember { mutableStateOf(initial.model) }
    var apiKey by remember { mutableStateOf(initial.apiKey) }
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
    LaunchedEffect(providerId, baseUrl, model, apiKey) { saved = false }
    LaunchedEffect(Unit) {
        if (baseUrl.isNotBlank() && (apiKey.isNotBlank() || providerId == "ollama")) {
            loadModels(openWhenReady = false)
        }
    }

    SettingsDetail(
        title = "Catty 模型",
        onBack = onBack,
        saveLabel = if (saved) "已保存" else "保存",
        onSave = {
            scope.launch {
                val next = initial.copy(
                    providerId = providerId,
                    baseUrl = baseUrl.trim(),
                    model = model.trim(),
                    apiKey = apiKey.trim(),
                )
                store.save(next)
                onSaved(next)
                saved = true
            }
        },
    ) {
        Text(
            "使用 OpenAI 兼容接口。",
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
    }
}

@Composable
private fun SafetySettingsPage(
    store: AiSettingsStore,
    initial: AiSettings,
    defaultBlocklist: List<String>,
    onSaved: (AiSettings) -> Unit,
    onBack: () -> Unit,
) {
    val scope = rememberCoroutineScope()
    var mode by remember { mutableStateOf(initial.permissionMode) }
    var timeout by remember { mutableStateOf(initial.timeoutSeconds.toString()) }
    var idleTimeout by remember { mutableStateOf(initial.responseIdleTimeoutSeconds.toString()) }
    var maxIterations by remember { mutableStateOf(initial.maxIterations.toString()) }
    var blocklist by remember { mutableStateOf(initial.commandBlocklist ?: defaultBlocklist) }
    var saved by remember { mutableStateOf(false) }
    LaunchedEffect(mode, timeout, idleTimeout, maxIterations, blocklist) { saved = false }
    SettingsDetail(
        title = "安全",
        onBack = onBack,
        saveLabel = if (saved) "已保存" else "保存",
        onSave = {
            scope.launch {
                val next = initial.copy(
                    permissionMode = mode,
                    timeoutSeconds = timeout.toIntOrNull()?.coerceIn(1, 86_400) ?: 60,
                    responseIdleTimeoutSeconds = idleTimeout.toIntOrNull()?.coerceIn(1, 86_400) ?: 120,
                    maxIterations = maxIterations.toIntOrNull()?.coerceIn(1, 100) ?: 8,
                    commandBlocklist = blocklist,
                )
                store.save(next)
                onSaved(next)
                saved = true
            }
        },
    ) {
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
    }
}

@Composable
private fun SearchSettingsPage(
    store: AiSettingsStore,
    initial: AiSettings,
    onSaved: (AiSettings) -> Unit,
    onBack: () -> Unit,
) {
    val scope = rememberCoroutineScope()
    var webSearch by remember { mutableStateOf(initial.webSearch) }
    var saved by remember { mutableStateOf(false) }
    LaunchedEffect(webSearch) { saved = false }
    SettingsDetail(
        title = "网络搜索",
        onBack = onBack,
        saveLabel = if (saved) "已保存" else "保存",
        onSave = {
            scope.launch {
                val next = initial.copy(
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
    ) {
        WebSearchSettings(config = webSearch, onChange = { webSearch = it })
    }
}

@Composable
private fun AboutSettingsPage(onBack: () -> Unit) {
    SettingsDetail(title = "关于", onBack = onBack) {
        ListItem(
            headlineContent = { Text("Netcatty Android", fontSize = 14.sp) },
            supportingContent = { Text("SSH 连接、终端、SFTP、Catty 运维", fontSize = 12.sp) },
            colors = listColors(),
        )
        ListItem(
            headlineContent = { Text("版本", fontSize = 14.sp) },
            supportingContent = { Text("0.2.0") },
            colors = listColors(),
        )
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun SettingsDetail(
    title: String,
    onBack: () -> Unit,
    saveLabel: String? = null,
    onSave: (() -> Unit)? = null,
    content: @Composable ColumnScope.() -> Unit,
) {
    Scaffold(
        containerColor = MidnightBackground,
        topBar = {
            TopAppBar(
                title = { CompactBarTitle(title) },
                navigationIcon = {
                    IconButton(onClick = onBack) {
                        Icon(Icons.AutoMirrored.Outlined.ArrowBack, contentDescription = "返回设置列表")
                    }
                },
                colors = appTopBarColors(),
            )
        },
        bottomBar = {
            if (saveLabel != null && onSave != null) {
                Button(
                    onClick = onSave,
                    modifier = Modifier
                        .fillMaxWidth()
                        .navigationBarsPadding()
                        .imePadding()
                        .padding(horizontal = ScreenPad, vertical = 8.dp),
                ) {
                    Text(saveLabel)
                }
            }
        },
    ) { padding ->
        Column(
            Modifier
                .padding(padding)
                .verticalScroll(rememberScrollState())
                .padding(horizontal = ScreenPad),
            content = content,
        )
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

private data class SettingsEntry(
    val page: String,
    val title: String,
    val subtitle: String,
    val icon: ImageVector,
)
