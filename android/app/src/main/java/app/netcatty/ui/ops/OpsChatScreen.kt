package app.netcatty.ui.ops

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.outlined.ArrowBack
import androidx.compose.material.icons.automirrored.outlined.Send
import androidx.compose.material.icons.outlined.Add
import androidx.compose.material.icons.outlined.ChatBubbleOutline
import androidx.compose.material.icons.outlined.Delete
import androidx.compose.material.icons.outlined.History
import androidx.compose.material.icons.outlined.Settings
import androidx.compose.material.icons.outlined.Stop
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.FilterChip
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
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
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import app.netcatty.ai.AiSettings
import app.netcatty.ai.ChatItem
import app.netcatty.ai.CommandSafety
import app.netcatty.ai.OPS_QUICK_CHIPS
import app.netcatty.ai.OpsAgent
import app.netcatty.ai.OpsChatBucket
import app.netcatty.ai.OpsChatStore
import app.netcatty.ai.OpsConversation
import app.netcatty.ai.OpsEvent
import app.netcatty.ai.PendingCommand
import app.netcatty.ai.PermissionMode
import app.netcatty.ai.labelZh
import app.netcatty.ai.relativeTime
import app.netcatty.data.ConnectSpec
import app.netcatty.ui.terminal.SessionHolder
import app.netcatty.ui.theme.CardRadius
import app.netcatty.ui.theme.CompactBarTitle
import app.netcatty.ui.theme.FieldRadius
import app.netcatty.ui.theme.MidnightBackground
import app.netcatty.ui.theme.MidnightBorder
import app.netcatty.ui.theme.MidnightDanger
import app.netcatty.ui.theme.MidnightMuted
import app.netcatty.ui.theme.MidnightPrimary
import app.netcatty.ui.theme.MidnightSurface
import app.netcatty.ui.theme.MidnightSurfaceHigh
import app.netcatty.ui.theme.MidnightText
import app.netcatty.ui.theme.appFieldColors
import app.netcatty.ui.theme.appTopBarColors
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

@OptIn(ExperimentalMaterial3Api::class, ExperimentalLayoutApi::class)
@Composable
fun OpsChatScreen(
    title: String,
    subtitle: String,
    target: ConnectSpec?,
    settings: AiSettings,
    safety: CommandSafety,
    sessionHolder: SessionHolder?,
    bucket: OpsChatBucket,
    store: OpsChatStore,
    appScope: CoroutineScope,
    startInHistory: Boolean = false,
    onBack: () -> Unit,
    onOpenSettings: () -> Unit,
    onPermissionChange: (PermissionMode) -> Unit,
) {
    var showHistory by remember { mutableStateOf(startInHistory) }
    if (showHistory) {
        HistoryPane(
            title = title,
            subtitle = subtitle,
            conversations = bucket.conversations.toList(),
            currentId = bucket.currentId,
            onBack = { showHistory = false },
            onNew = {
                bucket.newConversation()
                showHistory = false
            },
            onOpen = { id ->
                bucket.open(id)
                showHistory = false
            },
            onDelete = { bucket.delete(it) },
        )
        return
    }
    ChatPane(
        title = title,
        subtitle = subtitle,
        target = target,
        settings = settings,
        safety = safety,
        sessionHolder = sessionHolder,
        chat = bucket.current(),
        store = store,
        hostId = bucket.hostId,
        appScope = appScope,
        onBack = onBack,
        onOpenSettings = onOpenSettings,
        onPermissionChange = onPermissionChange,
        onNew = { bucket.newConversation() },
        onHistory = { showHistory = true },
    )
}

@OptIn(ExperimentalMaterial3Api::class, ExperimentalLayoutApi::class)
@Composable
private fun ChatPane(
    title: String,
    subtitle: String,
    target: ConnectSpec?,
    settings: AiSettings,
    safety: CommandSafety,
    sessionHolder: SessionHolder?,
    chat: OpsConversation,
    store: OpsChatStore,
    hostId: String,
    appScope: CoroutineScope,
    onBack: () -> Unit,
    onOpenSettings: () -> Unit,
    onPermissionChange: (PermissionMode) -> Unit,
    onNew: () -> Unit,
    onHistory: () -> Unit,
) {
    var draft by remember(chat.id) { mutableStateOf("") }
    val listState = rememberLazyListState()
    val items = chat.items
    val busy = chat.busy
    val pending = chat.pending
    val mode = chat.permissionMode

    LaunchedEffect(chat.id, items.size, busy) {
        if (items.isNotEmpty()) listState.animateScrollToItem(items.lastIndex)
    }

    fun send(text: String) {
        val prompt = text.trim()
        if (prompt.isBlank() || chat.busy) return
        val spec = target
        val holder = sessionHolder
        val session = holder?.session
        if (spec == null || holder == null || session == null || !session.connected) {
            chat.items += ChatItem.Error("先连接这台主机，才能继续对话。历史记录可以随时查看。")
            return
        }
        if (!settings.configured) {
            chat.items += ChatItem.Error("请先在设置里填写 API Key。")
            return
        }
        draft = ""
        if (chat.items.none { it is ChatItem.User }) {
            chat.title = prompt.replace('\n', ' ').take(36)
        }
        chat.items += ChatItem.User(prompt)
        chat.updatedAt = System.currentTimeMillis()
        chat.markBusy(true)
        val current = chat.agent ?: OpsAgent(
            target = spec,
            session = session,
            safety = safety,
            initialMode = chat.permissionMode,
            readContext = { max -> holder.readTerminalContext(max) },
            confirm = { command, reason ->
                val gate = CompletableDeferred<Boolean>()
                withContext(Dispatchers.Main) {
                    chat.markPending(PendingCommand(command, reason, gate))
                }
                gate.await()
            },
            onEvent = { event ->
                appScope.launch(Dispatchers.Main) {
                    when (event) {
                        is OpsEvent.AssistantDelta -> chat.items += ChatItem.Assistant(event.text)
                        is OpsEvent.ToolStarted -> chat.items += ChatItem.Tool(event.name, event.detail, true)
                        is OpsEvent.ToolFinished -> {
                            val last = chat.items.lastOrNull()
                            if (last is ChatItem.Tool && last.name == event.name) {
                                chat.items[chat.items.lastIndex] = ChatItem.Tool(event.name, event.detail, event.ok)
                            } else {
                                chat.items += ChatItem.Tool(event.name, event.detail, event.ok)
                            }
                        }
                        is OpsEvent.Failed -> chat.items += ChatItem.Error(event.message)
                    }
                }
            },
        ).also { agent ->
            agent.restoreHistory(chat.llmHistory)
            chat.agent = agent
        }
        current.setPermissionMode(chat.permissionMode)
        chat.job = appScope.launch {
            try {
                withContext(Dispatchers.IO) {
                    current.send(prompt, settings)
                }
            } finally {
                withContext(Dispatchers.Main) {
                    chat.markBusy(false)
                    chat.llmHistory = current.snapshotHistory()
                    chat.updatedAt = System.currentTimeMillis()
                    store.persist(hostId)
                }
            }
        }
        store.persist(hostId)
    }

    fun stop() {
        if (!chat.busy) return
        chat.stop()
        sessionHolder?.session?.write("\u0003")
        chat.items += ChatItem.Error("已停止")
        store.persist(hostId)
    }

    Scaffold(
        modifier = Modifier.fillMaxSize(),
        containerColor = MidnightBackground,
        topBar = {
            TopAppBar(
                title = { CompactBarTitle(chat.preview(), subtitle.ifBlank { title }) },
                navigationIcon = {
                    IconButton(onClick = onBack) {
                        Icon(Icons.AutoMirrored.Outlined.ArrowBack, contentDescription = "返回")
                    }
                },
                actions = {
                    IconButton(onClick = onHistory) {
                        Icon(Icons.Outlined.History, contentDescription = "历史会话", tint = MidnightMuted)
                    }
                    IconButton(onClick = onNew) {
                        Icon(Icons.Outlined.Add, contentDescription = "新对话", tint = MidnightPrimary)
                    }
                    IconButton(onClick = onOpenSettings) {
                        Icon(Icons.Outlined.Settings, contentDescription = "AI 设置", tint = MidnightMuted)
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
                .navigationBarsPadding()
                .imePadding(),
        ) {
            FlowRow(
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(horizontal = 12.dp, vertical = 4.dp),
                horizontalArrangement = Arrangement.spacedBy(6.dp),
            ) {
                Text(
                    "权限",
                    color = MidnightMuted,
                    fontSize = 12.sp,
                    modifier = Modifier.align(Alignment.CenterVertically),
                )
                PermissionMode.entries.forEach { item ->
                    FilterChip(
                        selected = mode == item,
                        onClick = { onPermissionChange(item) },
                        label = { Text(item.labelZh(), fontSize = 12.sp) },
                    )
                }
            }
            LazyColumn(
                modifier = Modifier
                    .weight(1f)
                    .fillMaxWidth(),
                state = listState,
                contentPadding = PaddingValues(horizontal = 12.dp, vertical = 8.dp),
                verticalArrangement = Arrangement.spacedBy(8.dp),
            ) {
                if (items.isEmpty()) {
                    item {
                        Text(
                            if (target == null) {
                                "这是这台主机上的 Catty 记录。连接后再发消息；关掉连接后历史仍会保留。"
                            } else {
                                "这是这台主机上的 Catty 对话，与具体 SSH 连接无关。关掉连接后再打开还能查看。"
                            },
                            color = MidnightMuted,
                            fontSize = 13.sp,
                        )
                    }
                }
                items(items) { item ->
                    when (item) {
                        is ChatItem.User -> Bubble(item.text, user = true)
                        is ChatItem.Assistant -> Bubble(item.text, user = false)
                        is ChatItem.Tool -> ToolCard(item)
                        is ChatItem.Error -> Text(item.text, color = MidnightDanger, fontSize = 13.sp)
                    }
                }
                if (busy) {
                    item { Text("处理中…", color = MidnightPrimary, fontSize = 13.sp) }
                }
            }
            LazyRow(
                contentPadding = PaddingValues(horizontal = 12.dp, vertical = 2.dp),
                horizontalArrangement = Arrangement.spacedBy(6.dp),
            ) {
                items(OPS_QUICK_CHIPS) { chip ->
                    FilterChip(
                        selected = false,
                        enabled = !busy,
                        onClick = { send(chip.prompt) },
                        label = { Text(chip.label, fontSize = 12.sp) },
                    )
                }
            }
            Row(
                Modifier
                    .fillMaxWidth()
                    .padding(horizontal = 10.dp, vertical = 6.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                OutlinedTextField(
                    value = draft,
                    onValueChange = { draft = it },
                    modifier = Modifier
                        .weight(1f)
                        .height(48.dp),
                    enabled = !busy,
                    placeholder = { Text("问这台主机", fontSize = 13.sp) },
                    singleLine = true,
                    textStyle = TextStyle(fontSize = 14.sp, color = MidnightText),
                    shape = FieldRadius,
                    colors = appFieldColors(),
                )
                if (busy) {
                    IconButton(onClick = { stop() }) {
                        Icon(Icons.Outlined.Stop, contentDescription = "停止", tint = MidnightDanger)
                    }
                } else {
                    IconButton(onClick = { send(draft) }, enabled = draft.isNotBlank()) {
                        Icon(Icons.AutoMirrored.Outlined.Send, contentDescription = "发送", tint = MidnightPrimary)
                    }
                }
            }
        }
    }

    pending?.let { request ->
        AlertDialog(
            onDismissRequest = {
                request.gate.complete(false)
                chat.markPending(null)
            },
            title = { Text("执行这条命令？") },
            text = {
                Column {
                    Text(request.reason, color = MidnightMuted, fontSize = 13.sp)
                    Text(
                        request.command,
                        color = MidnightText,
                        fontFamily = FontFamily.Monospace,
                        modifier = Modifier.padding(top = 10.dp),
                    )
                }
            },
            confirmButton = {
                TextButton(onClick = {
                    request.gate.complete(true)
                    chat.markPending(null)
                }) { Text("允许") }
            },
            dismissButton = {
                TextButton(onClick = {
                    request.gate.complete(false)
                    chat.markPending(null)
                }) { Text("拒绝") }
            },
        )
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun HistoryPane(
    title: String,
    subtitle: String,
    conversations: List<OpsConversation>,
    currentId: String?,
    onBack: () -> Unit,
    onNew: () -> Unit,
    onOpen: (String) -> Unit,
    onDelete: (String) -> Unit,
) {
    Scaffold(
        modifier = Modifier.fillMaxSize(),
        containerColor = MidnightBackground,
        topBar = {
            TopAppBar(
                title = { CompactBarTitle("历史会话", subtitle) },
                navigationIcon = {
                    IconButton(onClick = onBack) {
                        Icon(Icons.AutoMirrored.Outlined.ArrowBack, contentDescription = "返回")
                    }
                },
                actions = {
                    IconButton(onClick = onNew) {
                        Icon(Icons.Outlined.Add, contentDescription = "新对话", tint = MidnightPrimary)
                    }
                },
                colors = appTopBarColors(),
            )
        },
    ) { padding ->
        if (conversations.isEmpty()) {
            Box(
                Modifier
                    .fillMaxSize()
                    .padding(padding),
                contentAlignment = Alignment.Center,
            ) {
                Text("还没有对话", color = MidnightMuted)
            }
        } else {
            LazyColumn(
                modifier = Modifier
                    .fillMaxSize()
                    .padding(padding)
                    .padding(horizontal = 12.dp),
                contentPadding = PaddingValues(top = 8.dp, bottom = 24.dp),
                verticalArrangement = Arrangement.spacedBy(8.dp),
            ) {
                items(conversations, key = { it.id }) { conv ->
                    HistoryRow(
                        conversation = conv,
                        selected = conv.id == currentId,
                        onOpen = { onOpen(conv.id) },
                        onDelete = { onDelete(conv.id) },
                    )
                }
            }
        }
    }
}

@Composable
private fun HistoryRow(
    conversation: OpsConversation,
    selected: Boolean,
    onOpen: () -> Unit,
    onDelete: () -> Unit,
) {
    val subtitle = buildString {
        append(relativeTime(conversation.updatedAt))
        if (conversation.busy) append(" · 进行中")
        val count = conversation.items.count { it is ChatItem.User }
        if (count > 0) append(" · ${count} 条提问")
    }
    Row(
        Modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(CardRadius))
            .background(if (selected) MidnightPrimary.copy(alpha = 0.10f) else MidnightSurface)
            .border(
                1.dp,
                if (selected) MidnightPrimary.copy(alpha = 0.5f) else MidnightBorder,
                RoundedCornerShape(CardRadius),
            )
            .clickable(onClick = onOpen)
            .padding(start = 10.dp, end = 2.dp, top = 10.dp, bottom = 10.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Box(
            Modifier
                .size(34.dp)
                .clip(CircleShape)
                .background(MidnightPrimary.copy(alpha = 0.16f)),
            contentAlignment = Alignment.Center,
        ) {
            Icon(
                Icons.Outlined.ChatBubbleOutline,
                contentDescription = null,
                tint = MidnightPrimary,
                modifier = Modifier.size(16.dp),
            )
        }
        Column(
            Modifier
                .weight(1f)
                .padding(horizontal = 10.dp),
        ) {
            Text(
                conversation.preview(),
                color = MidnightText,
                fontWeight = FontWeight.SemiBold,
                fontSize = 14.sp,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
            )
            Text(subtitle, color = MidnightMuted, fontSize = 12.sp, maxLines = 1, overflow = TextOverflow.Ellipsis)
        }
        IconButton(onClick = onDelete, modifier = Modifier.size(36.dp)) {
            Icon(Icons.Outlined.Delete, contentDescription = "删除", tint = MidnightMuted, modifier = Modifier.size(18.dp))
        }
    }
}

@Composable
private fun Bubble(text: String, user: Boolean) {
    Box(Modifier.fillMaxWidth(), contentAlignment = if (user) Alignment.CenterEnd else Alignment.CenterStart) {
        Text(
            text,
            color = MidnightText,
            fontSize = 13.sp,
            modifier = Modifier
                .fillMaxWidth(0.92f)
                .background(
                    if (user) MidnightPrimary.copy(alpha = 0.16f) else MidnightSurface,
                    RoundedCornerShape(12.dp),
                )
                .padding(horizontal = 10.dp, vertical = 8.dp),
        )
    }
}

@Composable
private fun ToolCard(item: ChatItem.Tool) {
    Column(
        Modifier
            .fillMaxWidth()
            .border(1.dp, MidnightBorder, RoundedCornerShape(10.dp))
            .background(MidnightSurfaceHigh, RoundedCornerShape(10.dp))
            .padding(8.dp),
    ) {
        Text(
            item.name,
            color = if (item.ok) MidnightPrimary else MidnightDanger,
            fontWeight = FontWeight.SemiBold,
            fontSize = 11.sp,
        )
        Text(
            item.detail,
            color = MidnightMuted,
            fontFamily = FontFamily.Monospace,
            fontSize = 11.sp,
            maxLines = 8,
            overflow = TextOverflow.Ellipsis,
            modifier = Modifier.padding(top = 4.dp),
        )
    }
}
