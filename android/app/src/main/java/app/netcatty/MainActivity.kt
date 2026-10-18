package app.netcatty

import android.Manifest
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.SystemBarStyle
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import android.graphics.Color as AndroidColor
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableFloatStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.navigation.NavType
import androidx.navigation.compose.NavHost
import androidx.navigation.compose.composable
import androidx.navigation.compose.rememberNavController
import androidx.navigation.navArgument
import app.netcatty.data.SshConnection
import app.netcatty.ssh.SessionKeepAliveService
import app.netcatty.ssh.shSingleQuote
import app.netcatty.ui.connection.ConnectionEditorScreen
import app.netcatty.ui.home.ConnectionListScreen
import app.netcatty.ui.host.HostEditorScreen
import app.netcatty.ui.host.HostListScreen
import app.netcatty.ui.host.HostNotesScreen
import app.netcatty.ui.host.HostPickerScreen
import app.netcatty.ui.ops.OpsChatScreen
import app.netcatty.ui.settings.SettingsScreen
import app.netcatty.ui.sftp.SftpScreen
import app.netcatty.ui.terminal.SessionHolder
import app.netcatty.ui.terminal.TerminalScreen
import app.netcatty.ui.theme.NetcattyTheme
import app.netcatty.ui.tunnel.TunnelEditorScreen
import app.netcatty.ui.tunnel.TunnelListScreen
import app.netcatty.ui.update.UpdateDialog
import app.netcatty.update.AppRelease
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.launch

class MainActivity : ComponentActivity() {
    private val pendingOpen = MutableStateFlow<OpenTarget?>(null)

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        setIntent(intent)
        pendingOpen.value = OpenTarget.from(intent)
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        pendingOpen.value = OpenTarget.from(intent)
        if (Build.VERSION.SDK_INT >= 33 &&
            checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED
        ) {
            requestPermissions(arrayOf(Manifest.permission.POST_NOTIFICATIONS), 10)
        }
        enableEdgeToEdge(
            statusBarStyle = SystemBarStyle.light(AndroidColor.TRANSPARENT, AndroidColor.TRANSPARENT),
            navigationBarStyle = SystemBarStyle.light(AndroidColor.TRANSPARENT, AndroidColor.TRANSPARENT),
        )
        val app = application as NetcattyApp
        setContent {
            NetcattyTheme {
                val nav = rememberNavController()
                val scope = rememberCoroutineScope()
                val hosts by app.hosts.hosts.collectAsStateWithLifecycle()
                val connections by app.hosts.connections.collectAsStateWithLifecycle()
                val aiSettings by app.ai.settings.collectAsStateWithLifecycle()
                val liveSessions by app.liveSessions.sessions.collectAsStateWithLifecycle()
                val pings by app.pings.pings.collectAsStateWithLifecycle()
                val hostStats by app.hostStats.stats.collectAsStateWithLifecycle()
                val opsExecutions by app.opsChats.executions.collectAsStateWithLifecycle()
                val tunnelRules by app.tunnels.rules.collectAsStateWithLifecycle()
                val tunnelStatus by app.tunnels.status.collectAsStateWithLifecycle()
                val sessionHolder = remember { SessionHolder() }
                val openTarget by pendingOpen.collectAsStateWithLifecycle()
                var pendingUpdate by remember { mutableStateOf<AppRelease?>(null) }
                var updateDownloading by remember { mutableStateOf(false) }
                var updateProgress by remember { mutableFloatStateOf(0f) }
                var updateError by remember { mutableStateOf<String?>(null) }

                fun startUpdate(release: AppRelease) {
                    if (updateDownloading) return
                    if (app.updates.needsInstallPermission()) {
                        app.updates.openInstallPermissionSettings()
                        updateError = "请允许安装未知应用后，再点下载更新"
                        return
                    }
                    updateDownloading = true
                    updateProgress = 0f
                    updateError = null
                    scope.launch {
                        runCatching {
                            val file = app.updates.download(release) { updateProgress = it }
                            app.updates.install(file)
                        }.onFailure { error ->
                            updateError = error.message ?: "更新失败"
                        }
                        updateDownloading = false
                    }
                }

                fun openConnection(conn: SshConnection) {
                    val spec = app.hosts.spec(conn.id) ?: return
                    val live = app.liveSessions.start(spec)
                    scope.launch { app.hosts.markConnected(conn.id) }
                    nav.navigate("session/${live.id}") {
                        popUpTo("home")
                        launchSingleTop = true
                    }
                }

                LaunchedEffect(Unit) {
                    app.hosts.load()
                    app.tunnels.load()
                    app.tunnels.autostart()
                    app.ai.load()
                    app.commandSafety.apply(app.ai.settings.value.commandBlocklist)
                    if (app.updates.selfUpdateEnabled() && app.updates.shouldAutoCheck()) {
                        val latest = runCatching { app.updates.newerRelease() }.getOrNull()
                        app.updates.markChecked()
                        if (latest != null && latest.version != app.updates.skippedVersion()) {
                            pendingUpdate = latest
                        }
                    }
                }

                pendingUpdate?.let { release ->
                    UpdateDialog(
                        release = release,
                        currentVersion = app.updates.currentVersion(),
                        downloading = updateDownloading,
                        progress = updateProgress,
                        error = updateError,
                        onLater = {
                            pendingUpdate = null
                            updateError = null
                        },
                        onDownload = { startUpdate(release) },
                    )
                }

                LaunchedEffect(openTarget, hosts, liveSessions) {
                    val target = openTarget ?: return@LaunchedEffect
                    val handled = when (target.dest) {
                        SessionKeepAliveService.OPEN_CATTY -> {
                            val hostId = target.hostId
                            if (hostId.isNullOrBlank()) return@LaunchedEffect
                            if (hosts.none { it.id == hostId }) {
                                if (hosts.isNotEmpty()) pendingOpen.value = null
                                return@LaunchedEffect
                            }
                            nav.navigate("catty/$hostId") { launchSingleTop = true }
                            true
                        }
                        SessionKeepAliveService.OPEN_SESSION -> {
                            val session = liveSessions.firstOrNull { it.id == target.sessionId }
                                ?: liveSessions.firstOrNull { target.hostId == null || it.spec.hostId == target.hostId }
                            if (session == null) {
                                pendingOpen.value = null
                                return@LaunchedEffect
                            }
                            nav.navigate("session/${session.id}") {
                                popUpTo("home")
                                launchSingleTop = true
                            }
                            true
                        }
                        SessionKeepAliveService.OPEN_TUNNELS -> {
                            nav.navigate("tunnels") { launchSingleTop = true }
                            true
                        }
                        else -> true
                    }
                    if (handled) pendingOpen.value = null
                }

                NavHost(navController = nav, startDestination = "home") {
                    composable("home") {
                        ConnectionListScreen(
                            sessions = liveSessions,
                            pings = pings,
                            pingMonitor = app.pings,
                            stats = hostStats,
                            statsMonitor = app.hostStats,
                            aiByHost = opsExecutions.associateBy { it.hostId },
                            onPickHost = { nav.navigate("pick-host") },
                            onOpen = { live -> nav.navigate("session/${live.id}") },
                            onDisconnect = { live -> app.liveSessions.close(live.id) },
                            onRetry = { live ->
                                app.liveSessions.start(live.spec)
                                nav.navigate("session/${live.id}")
                            },
                            onHosts = { nav.navigate("hosts") },
                            onTunnels = { nav.navigate("tunnels") },
                            onSettings = { nav.navigate("settings") },
                            updateHint = pendingUpdate?.version,
                        )
                    }
                    composable("pick-host") {
                        HostPickerScreen(
                            hosts = hosts,
                            connections = connections,
                            onBack = { nav.popBackStack() },
                            onAddHost = { nav.navigate("host/new") },
                            onNeedConnection = { host -> nav.navigate("conn/new?hostId=${host.id}") },
                            onConnect = { conn ->
                                openConnection(conn)
                            },
                        )
                    }
                    composable("hosts") {
                        HostListScreen(
                            hosts = hosts,
                            connections = connections,
                            onBack = { nav.popBackStack() },
                            onAdd = { nav.navigate("host/new") },
                            onOpen = { nav.navigate("host/${it.id}") },
                            onOpenCatty = { nav.navigate("catty/${it.id}") },
                            onOpenNotes = { nav.navigate("host/${it.id}/notes") },
                            onDelete = { host ->
                                val connectionIds = app.hosts.connectionsFor(host.id).map { it.id }.toSet()
                                scope.launch {
                                    app.tunnels.removeConnections(connectionIds)
                                    app.hosts.deleteHost(host.id)
                                }
                                app.opsChats.deleteHost(host.id)
                            },
                        )
                    }
                    composable(
                        "host/{id}/notes",
                        arguments = listOf(navArgument("id") { type = NavType.StringType }),
                    ) { entry ->
                        val id = entry.arguments?.getString("id")
                        val host = id?.let(app.hosts::host)
                        if (host == null) {
                            LaunchedEffect(id) { nav.popBackStack() }
                        } else {
                            HostNotesScreen(
                                hostTitle = host.title,
                                hostname = host.hostname,
                                initial = host.notes,
                                onBack = { nav.popBackStack() },
                                onSave = { notes ->
                                    scope.launch {
                                        val current = app.hosts.host(host.id) ?: return@launch
                                        app.hosts.upsertHost(current.copy(notes = notes))
                                        app.liveSessions.updateHostNotes(host.id, notes)
                                    }
                                },
                            )
                        }
                    }
                    composable(
                        "host/{id}",
                        arguments = listOf(navArgument("id") { type = NavType.StringType }),
                    ) { entry ->
                        val id = entry.arguments?.getString("id")
                        val initial = if (id == null || id == "new") null else app.hosts.host(id)
                        HostEditorScreen(
                            initial = initial,
                            connections = initial?.id?.let(app.hosts::connectionsFor).orEmpty(),
                            onBack = { nav.popBackStack() },
                            onSave = { host ->
                                scope.launch {
                                    val saved = app.hosts.upsertHost(host)
                                    if (initial == null) {
                                        nav.navigate("conn/new?hostId=${saved.id}") {
                                            popUpTo("hosts")
                                        }
                                    } else {
                                        nav.popBackStack()
                                    }
                                }
                            },
                            onAddConnection = { host ->
                                scope.launch {
                                    val saved = app.hosts.upsertHost(host)
                                    nav.navigate("conn/new?hostId=${saved.id}")
                                }
                            },
                            onEditConnection = { nav.navigate("conn/${it.id}") },
                            onOpenCatty = { nav.navigate("catty/${it.id}") },
                        )
                    }
                    composable(
                        "conn/{id}?hostId={hostId}",
                        arguments = listOf(
                            navArgument("id") { type = NavType.StringType },
                            navArgument("hostId") {
                                type = NavType.StringType
                                defaultValue = ""
                            },
                        ),
                    ) { entry ->
                        val id = entry.arguments?.getString("id")
                        val hostId = entry.arguments?.getString("hostId").orEmpty()
                        val initial = if (id == null || id == "new") null else app.hosts.connection(id)
                        ConnectionEditorScreen(
                            hosts = hosts,
                            initial = initial,
                            presetHostId = hostId.ifBlank { initial?.hostId },
                            onBack = { nav.popBackStack() },
                            onCreateHost = { nav.navigate("host/new") },
                            onSave = { conn ->
                                scope.launch {
                                    app.hosts.upsertConnection(conn)
                                    nav.popBackStack()
                                }
                            },
                            onSaveAndConnect = { conn ->
                                scope.launch {
                                    val saved = app.hosts.upsertConnection(conn)
                                    val spec = app.hosts.spec(saved.id) ?: return@launch
                                    app.liveSessions.start(spec)
                                    app.hosts.markConnected(saved.id)
                                    nav.navigate("session/${saved.id}") {
                                        popUpTo("home")
                                    }
                                }
                            },
                        )
                    }
                    composable(
                        "session/{id}",
                        arguments = listOf(navArgument("id") { type = NavType.StringType }),
                    ) { entry ->
                        val id = entry.arguments?.getString("id")
                        val live = liveSessions.firstOrNull { it.id == id }
                        if (live == null) {
                            LaunchedEffect(id) { nav.popBackStack() }
                        } else {
                            TerminalScreen(
                                live = live,
                                sessionHolder = sessionHolder,
                                aiSettings = aiSettings,
                                safety = app.commandSafety,
                                opsBucket = app.opsChats.bucket(
                                    live.spec.hostId,
                                    aiSettings.permissionMode,
                                    app.hosts.connectionsFor(live.spec.hostId).map { it.id },
                                ),
                                opsStore = app.opsChats,
                                appScope = app.appScope,
                                onBack = { nav.popBackStack() },
                                onDisconnect = { app.liveSessions.close(live.id) },
                                onOpenSftp = { nav.navigate("sftp") },
                                onOpenTunnels = {
                                    nav.navigate("tunnels?connectionId=${live.spec.connectionId}")
                                },
                                onOpenSettings = { nav.navigate("settings") },
                                onOpenNotes = { nav.navigate("host/${live.spec.hostId}/notes") },
                                onPermissionChange = { mode ->
                                    val current = app.opsChats.bucket(live.spec.hostId, mode).current()
                                    current.permissionMode = mode
                                    current.agent?.setPermissionMode(mode)
                                    app.opsChats.persist(live.spec.hostId)
                                    scope.launch {
                                        app.ai.save(aiSettings.copy(permissionMode = mode))
                                    }
                                },
                            )
                        }
                    }
                    composable(
                        "catty/{hostId}",
                        arguments = listOf(navArgument("hostId") { type = NavType.StringType }),
                    ) { entry ->
                        val hostId = entry.arguments?.getString("hostId")
                        val host = hostId?.let(app.hosts::host)
                        if (host == null) {
                            LaunchedEffect(hostId) { nav.popBackStack() }
                        } else {
                            val live = liveSessions.firstOrNull { it.spec.hostId == host.id }
                            LaunchedEffect(live?.id) {
                                if (live != null) {
                                    sessionHolder.session = live.session
                                    sessionHolder.target = live.spec
                                }
                            }
                            OpsChatScreen(
                                title = host.title,
                                subtitle = host.hostname,
                                target = live?.spec,
                                settings = aiSettings,
                                safety = app.commandSafety,
                                sessionHolder = live?.let { sessionHolder },
                                bucket = app.opsChats.bucket(
                                    host.id,
                                    aiSettings.permissionMode,
                                    app.hosts.connectionsFor(host.id).map { it.id },
                                ),
                                store = app.opsChats,
                                appScope = app.appScope,
                                startInHistory = opsExecutions.none { it.hostId == host.id },
                                onBack = { nav.popBackStack() },
                                onOpenSettings = { nav.navigate("settings") },
                                onPermissionChange = { mode ->
                                    val current = app.opsChats.bucket(host.id, mode).current()
                                    current.permissionMode = mode
                                    current.agent?.setPermissionMode(mode)
                                    app.opsChats.persist(host.id)
                                    scope.launch {
                                        app.ai.save(aiSettings.copy(permissionMode = mode))
                                    }
                                },
                            )
                        }
                    }
                    composable("sftp") {
                        SftpScreen(
                            sessionHolder = sessionHolder,
                            onBack = { nav.popBackStack() },
                            onOpenInShell = { dir ->
                                sessionHolder.session?.write("cd ${shSingleQuote(dir)}\n")
                                nav.popBackStack()
                            },
                        )
                    }
                    composable(
                        "tunnels?connectionId={connectionId}",
                        arguments = listOf(
                            navArgument("connectionId") {
                                type = NavType.StringType
                                defaultValue = ""
                            },
                        ),
                    ) { entry ->
                        val preset = entry.arguments?.getString("connectionId").orEmpty()
                        TunnelListScreen(
                            rules = tunnelRules,
                            status = tunnelStatus,
                            hosts = hosts,
                            connections = connections,
                            onBack = { nav.popBackStack() },
                            onAdd = {
                                val query = if (preset.isBlank()) "" else "?connectionId=$preset"
                                nav.navigate("tunnel/new$query")
                            },
                            onOpen = { rule -> nav.navigate("tunnel/${rule.id}") },
                            onStart = { app.tunnels.start(it) },
                            onStop = { app.tunnels.stop(it.id) },
                            onDelete = { rule -> scope.launch { app.tunnels.delete(rule.id) } },
                        )
                    }
                    composable(
                        "tunnel/{id}?connectionId={connectionId}",
                        arguments = listOf(
                            navArgument("id") { type = NavType.StringType },
                            navArgument("connectionId") {
                                type = NavType.StringType
                                defaultValue = ""
                            },
                        ),
                    ) { entry ->
                        val id = entry.arguments?.getString("id")
                        val preset = entry.arguments?.getString("connectionId").orEmpty()
                        val initial = if (id == null || id == "new") null else tunnelRules.firstOrNull { it.id == id }
                        if (id != null && id != "new" && initial == null && tunnelRules.isNotEmpty()) {
                            LaunchedEffect(id) { nav.popBackStack() }
                        } else {
                            TunnelEditorScreen(
                                hosts = hosts,
                                connections = connections,
                                initial = initial,
                                presetConnectionId = preset.ifBlank { null },
                                onBack = { nav.popBackStack() },
                                onCreateConnection = { nav.navigate("hosts") },
                                onSave = { rule, startNow ->
                                    scope.launch {
                                        app.tunnels.save(rule)
                                        if (startNow) app.tunnels.start(rule)
                                        nav.popBackStack()
                                    }
                                },
                            )
                        }
                    }
                    composable("settings") {
                        SettingsScreen(
                            store = app.ai,
                            initial = aiSettings,
                            defaultBlocklist = app.commandSafety.defaultPatterns,
                            updater = app.updates,
                            onSaved = { app.commandSafety.apply(it.commandBlocklist) },
                            onExport = app.backup::exportEncrypted,
                            onOpenImport = app.backup::openEncrypted,
                            onCommitImport = app.backup::commitImport,
                            onBack = { nav.popBackStack() },
                        )
                    }
                }
            }
        }
    }
}

private data class OpenTarget(
    val dest: String,
    val hostId: String?,
    val sessionId: String?,
) {
    companion object {
        fun from(intent: Intent?): OpenTarget? {
            val dest = intent?.getStringExtra(SessionKeepAliveService.EXTRA_OPEN_DEST) ?: return null
            return OpenTarget(
                dest = dest,
                hostId = intent.getStringExtra(SessionKeepAliveService.EXTRA_HOST_ID),
                sessionId = intent.getStringExtra(SessionKeepAliveService.EXTRA_SESSION_ID),
            )
        }
    }
}
