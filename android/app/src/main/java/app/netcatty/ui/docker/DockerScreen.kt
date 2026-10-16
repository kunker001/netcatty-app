package app.netcatty.ui.docker

import android.widget.Toast
import androidx.activity.compose.BackHandler
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.outlined.ArrowBack
import androidx.compose.material.icons.automirrored.outlined.Subject
import androidx.compose.material.icons.outlined.Pause
import androidx.compose.material.icons.outlined.PlayArrow
import androidx.compose.material.icons.outlined.Refresh
import androidx.compose.material.icons.outlined.RestartAlt
import androidx.compose.material.icons.outlined.Stop
import androidx.compose.material.icons.outlined.Terminal
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
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
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import app.netcatty.docker.ComposeProject
import app.netcatty.docker.DockerAction
import app.netcatty.docker.DockerContainer
import app.netcatty.docker.composeExecCommand
import app.netcatty.docker.composeFollowLogsCommand
import app.netcatty.docker.containerStateLabel
import app.netcatty.docker.listComposeContainers
import app.netcatty.docker.readComposeLogs
import app.netcatty.docker.runComposeAction
import app.netcatty.ssh.SshSession
import app.netcatty.ui.theme.CardRadius
import app.netcatty.ui.theme.CompactBarTitle
import app.netcatty.ui.theme.MidnightBackground
import app.netcatty.ui.theme.MidnightBorder
import app.netcatty.ui.theme.MidnightDanger
import app.netcatty.ui.theme.MidnightMuted
import app.netcatty.ui.theme.MidnightPrimary
import app.netcatty.ui.theme.MidnightSurface
import app.netcatty.ui.theme.MidnightText
import app.netcatty.ui.theme.StatusGreen
import app.netcatty.ui.theme.StatusOrange
import app.netcatty.ui.theme.StatusRed
import app.netcatty.ui.theme.appTopBarColors
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun DockerScreen(
    session: SshSession,
    project: ComposeProject,
    onBack: () -> Unit,
    onRunInTerminal: (String) -> Unit,
) {
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    var containers by remember { mutableStateOf<List<DockerContainer>>(emptyList()) }
    var loading by remember { mutableStateOf(true) }
    var error by remember { mutableStateOf<String?>(null) }
    var busy by remember { mutableStateOf<String?>(null) }
    var logsFor by remember { mutableStateOf<DockerContainer?>(null) }

    fun reload() {
        loading = true
        error = null
        scope.launch {
            val result = withContext(Dispatchers.IO) {
                runCatching { listComposeContainers(session, project) }
            }
            result.onSuccess {
                containers = it
                error = null
            }.onFailure {
                error = it.message ?: "无法读取容器"
            }
            loading = false
        }
    }

    fun runAction(container: DockerContainer, action: DockerAction, label: String) {
        if (busy != null) return
        busy = label
        scope.launch {
            val result = withContext(Dispatchers.IO) {
                runCatching { runComposeAction(session, project, container, action) }
            }
            result.onSuccess {
                Toast.makeText(context, label, Toast.LENGTH_SHORT).show()
                reload()
            }.onFailure {
                Toast.makeText(context, it.message ?: "操作失败", Toast.LENGTH_LONG).show()
            }
            busy = null
        }
    }

    LaunchedEffect(project.dir, project.file) { reload() }

    val logsTarget = logsFor
    if (logsTarget != null) {
        DockerLogsScreen(
            session = session,
            project = project,
            container = logsTarget,
            onBack = { logsFor = null },
            onFollowInTerminal = {
                onRunInTerminal(composeFollowLogsCommand(project, logsTarget))
            },
        )
        return
    }

    BackHandler(onBack = onBack)

    Scaffold(
        modifier = Modifier.fillMaxSize(),
        containerColor = MidnightBackground,
        topBar = {
            TopAppBar(
                title = { CompactBarTitle("Docker", "${project.file} · ${project.dir}") },
                navigationIcon = {
                    IconButton(onClick = onBack) {
                        Icon(Icons.AutoMirrored.Outlined.ArrowBack, contentDescription = "返回")
                    }
                },
                actions = {
                    IconButton(onClick = { reload() }, enabled = !loading && busy == null) {
                        Icon(Icons.Outlined.Refresh, contentDescription = "刷新")
                    }
                },
                colors = appTopBarColors(),
            )
        },
    ) { padding ->
        Box(
            Modifier
                .fillMaxSize()
                .padding(padding),
        ) {
            when {
                loading && containers.isEmpty() -> {
                    CircularProgressIndicator(
                        modifier = Modifier.align(Alignment.Center),
                        color = MidnightPrimary,
                    )
                }
                error != null && containers.isEmpty() -> {
                    Text(
                        error ?: "",
                        color = MidnightDanger,
                        fontSize = 13.sp,
                        modifier = Modifier
                            .align(Alignment.Center)
                            .padding(24.dp),
                    )
                }
                containers.isEmpty() -> {
                    Text(
                        "这个编排里还没有容器",
                        color = MidnightMuted,
                        modifier = Modifier.align(Alignment.Center),
                    )
                }
                else -> {
                    LazyColumn(
                        contentPadding = PaddingValues(horizontal = 12.dp, vertical = 8.dp),
                        verticalArrangement = Arrangement.spacedBy(8.dp),
                    ) {
                        if (error != null) {
                            item {
                                Text(error ?: "", color = MidnightDanger, fontSize = 12.sp)
                            }
                        }
                        if (busy != null) {
                            item {
                                Text(busy ?: "", color = MidnightPrimary, fontSize = 12.sp)
                            }
                        }
                        items(containers, key = { it.id.ifBlank { it.name } }) { item ->
                            ContainerCard(
                                container = item,
                                enabled = busy == null,
                                onStart = { runAction(item, DockerAction.START, "正在启动 ${item.service}") },
                                onStop = { runAction(item, DockerAction.STOP, "正在停止 ${item.service}") },
                                onRestart = { runAction(item, DockerAction.RESTART, "正在重启 ${item.service}") },
                                onPause = { runAction(item, DockerAction.PAUSE, "正在暂停 ${item.service}") },
                                onUnpause = { runAction(item, DockerAction.UNPAUSE, "正在恢复 ${item.service}") },
                                onLogs = { logsFor = item },
                                onTerminal = { onRunInTerminal(composeExecCommand(project, item)) },
                            )
                        }
                    }
                }
            }
        }
    }
}

@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun ContainerCard(
    container: DockerContainer,
    enabled: Boolean,
    onStart: () -> Unit,
    onStop: () -> Unit,
    onRestart: () -> Unit,
    onPause: () -> Unit,
    onUnpause: () -> Unit,
    onLogs: () -> Unit,
    onTerminal: () -> Unit,
) {
    val color = when {
        container.paused -> StatusOrange
        container.running -> StatusGreen
        container.state.equals("restarting", true) -> MidnightPrimary
        container.state.equals("exited", true) -> StatusRed
        else -> MidnightMuted
    }
    val title = container.service.ifBlank { container.name }
    Column(
        Modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(CardRadius))
            .background(MidnightSurface)
            .border(1.dp, MidnightBorder, RoundedCornerShape(CardRadius))
            .padding(12.dp),
    ) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Box(
                Modifier
                    .size(10.dp)
                    .clip(CircleShape)
                    .background(color),
            )
            Column(Modifier.padding(start = 10.dp).weight(1f)) {
                Text(
                    title,
                    color = MidnightText,
                    fontWeight = FontWeight.SemiBold,
                    fontSize = 14.sp,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                )
                Text(
                    buildString {
                        append(containerStateLabel(container.state))
                        if (container.status.isNotBlank()) append(" · ${container.status}")
                    },
                    color = color,
                    fontSize = 11.sp,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                )
                if (container.image.isNotBlank() || container.name.isNotBlank()) {
                    Text(
                        container.image.ifBlank { container.name },
                        color = MidnightMuted,
                        fontSize = 11.sp,
                        maxLines = 1,
                        overflow = TextOverflow.Ellipsis,
                    )
                }
            }
        }
        FlowRow(
            modifier = Modifier.padding(top = 8.dp),
            horizontalArrangement = Arrangement.spacedBy(4.dp),
        ) {
            if (container.paused) {
                ActionChip("恢复", Icons.Outlined.PlayArrow, enabled, onUnpause)
            } else if (container.running) {
                ActionChip("停止", Icons.Outlined.Stop, enabled, onStop)
                ActionChip("重启", Icons.Outlined.RestartAlt, enabled, onRestart)
                ActionChip("暂停", Icons.Outlined.Pause, enabled, onPause)
            } else {
                ActionChip("启动", Icons.Outlined.PlayArrow, enabled, onStart)
                ActionChip("重启", Icons.Outlined.RestartAlt, enabled, onRestart)
            }
            ActionChip("日志", Icons.AutoMirrored.Outlined.Subject, enabled, onLogs)
            ActionChip("终端", Icons.Outlined.Terminal, enabled && container.canExec, onTerminal)
        }
    }
}

@Composable
private fun ActionChip(
    label: String,
    icon: ImageVector,
    enabled: Boolean,
    onClick: () -> Unit,
) {
    TextButton(onClick = onClick, enabled = enabled) {
        Icon(icon, contentDescription = null, modifier = Modifier.size(16.dp).padding(end = 4.dp))
        Text(label, fontSize = 12.sp)
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun DockerLogsScreen(
    session: SshSession,
    project: ComposeProject,
    container: DockerContainer,
    onBack: () -> Unit,
    onFollowInTerminal: () -> Unit,
) {
    var text by remember { mutableStateOf("正在读取日志…") }
    val title = container.service.ifBlank { container.name }

    LaunchedEffect(container.id, container.service) {
        text = withContext(Dispatchers.IO) {
            runCatching { readComposeLogs(session, project, container) }
                .getOrElse { it.message ?: "读取日志失败" }
        }
    }

    BackHandler(onBack = onBack)

    Scaffold(
        modifier = Modifier.fillMaxSize(),
        containerColor = MidnightBackground,
        topBar = {
            TopAppBar(
                title = { CompactBarTitle("日志", title) },
                navigationIcon = {
                    IconButton(onClick = onBack) {
                        Icon(Icons.AutoMirrored.Outlined.ArrowBack, contentDescription = "返回")
                    }
                },
                actions = {
                    TextButton(onClick = onFollowInTerminal) {
                        Text("终端跟踪")
                    }
                },
                colors = appTopBarColors(),
            )
        },
    ) { padding ->
        Text(
            text,
            modifier = Modifier
                .fillMaxSize()
                .padding(padding)
                .verticalScroll(rememberScrollState())
                .padding(12.dp),
            color = MidnightText,
            fontSize = 12.sp,
            fontFamily = FontFamily.Monospace,
            lineHeight = 16.sp,
        )
    }
}
