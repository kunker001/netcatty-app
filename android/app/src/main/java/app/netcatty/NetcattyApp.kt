package app.netcatty

import android.app.Application
import app.netcatty.ai.AiSettingsStore
import app.netcatty.ai.CommandSafety
import app.netcatty.ai.OpsChatStore
import app.netcatty.ai.OpsExecution
import app.netcatty.data.Host
import app.netcatty.data.HostRepository
import app.netcatty.data.TunnelRepository
import app.netcatty.data.TunnelRule
import app.netcatty.session.LiveSession
import app.netcatty.session.LiveSessionStore
import app.netcatty.session.LiveStatus
import app.netcatty.session.TunnelPhase
import app.netcatty.session.TunnelStatus
import app.netcatty.session.TunnelStore
import app.netcatty.ssh.HostPingMonitor
import app.netcatty.ssh.HostStatsMonitor
import app.netcatty.ssh.SessionKeepAliveService
import app.netcatty.ssh.SshCrypto
import app.netcatty.update.AppUpdater
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.distinctUntilChanged
import kotlinx.coroutines.launch

class NetcattyApp : Application() {
    val appScope = CoroutineScope(SupervisorJob() + Dispatchers.Default)

    lateinit var hosts: HostRepository
        private set
    lateinit var ai: AiSettingsStore
        private set
    lateinit var commandSafety: CommandSafety
        private set
    lateinit var liveSessions: LiveSessionStore
        private set
    lateinit var pings: HostPingMonitor
        private set
    lateinit var hostStats: HostStatsMonitor
        private set
    lateinit var opsChats: OpsChatStore
        private set
    lateinit var tunnels: TunnelStore
        private set
    lateinit var updates: AppUpdater
        private set

    override fun onCreate() {
        super.onCreate()
        SshCrypto.install()
        hosts = HostRepository(this)
        ai = AiSettingsStore(this)
        commandSafety = CommandSafety(this)
        opsChats = OpsChatStore(this, appScope)
        liveSessions = LiveSessionStore(appScope, onRemoved = { id -> opsChats.pause(id) })
        tunnels = TunnelStore(TunnelRepository(this), appScope) { id -> hosts.spec(id) }
        updates = AppUpdater(this)
        pings = HostPingMonitor()
        hostStats = HostStatsMonitor()
        appScope.launch {
            combine(
                liveSessions.sessions,
                opsChats.executions,
                hosts.hosts,
                tunnels.rules,
                tunnels.status,
            ) { sessions, execs, hostList, rules, tunnelStatus ->
                KeepAliveSnapshot(sessions, execs, hostList, rules, tunnelStatus)
            }.distinctUntilChanged().collect { snap ->
                val sessions = snap.sessions
                val execs = snap.executions
                val hostList = snap.hosts
                val tunnelCount = snap.rules.count { rule ->
                    val phase = snap.tunnelStatus[rule.id]?.phase
                    phase == TunnelPhase.ACTIVE || phase == TunnelPhase.STARTING
                }
                val active = sessions.any { it.status == LiveStatus.CONNECTING || it.session.connected }
                if (!active && tunnelCount == 0) {
                    SessionKeepAliveService.stop(this@NetcattyApp)
                    return@collect
                }
                if (!active) {
                    val only = snap.rules.firstOrNull { rule ->
                        val phase = snap.tunnelStatus[rule.id]?.phase
                        phase == TunnelPhase.ACTIVE || phase == TunnelPhase.STARTING
                    }
                    val text = if (tunnelCount == 1 && only != null) {
                        val hostId = hosts.connection(only.connectionId)?.hostId
                        val hostTitle = hostList.firstOrNull { it.id == hostId }?.title
                        listOfNotNull(only.endpointLine(), hostTitle).joinToString(" · ")
                    } else {
                        "$tunnelCount 条隧道正在转发"
                    }
                    SessionKeepAliveService.start(
                        context = this@NetcattyApp,
                        title = "隧道转发中",
                        text = text,
                        progress = false,
                        dest = SessionKeepAliveService.OPEN_TUNNELS,
                        hostId = null,
                        sessionId = null,
                    )
                    return@collect
                }
                val exec = execs.firstOrNull()
                val hostTitle = exec?.hostId?.let { id -> hostList.firstOrNull { it.id == id }?.title }
                    ?: sessions.firstOrNull()?.spec?.title
                val sessionId = exec?.hostId?.let { id -> sessions.firstOrNull { it.spec.hostId == id }?.id }
                    ?: sessions.firstOrNull()?.id
                if (exec != null) {
                    SessionKeepAliveService.start(
                        context = this@NetcattyApp,
                        title = if (exec.awaitingConfirm) "Catty 等待确认" else "Catty 执行中",
                        text = listOfNotNull(hostTitle, exec.step.ifBlank { exec.title }).joinToString(" · "),
                        progress = !exec.awaitingConfirm,
                        dest = SessionKeepAliveService.OPEN_CATTY,
                        hostId = exec.hostId,
                        sessionId = sessionId,
                    )
                } else {
                    val text = when (sessions.size) {
                        1 -> sessions.first().spec.connectionLine
                        else -> "${sessions.size} 个会话正在保持连接"
                    }
                    SessionKeepAliveService.start(
                        context = this@NetcattyApp,
                        title = "Netcatty 正在保持连接",
                        text = text,
                        progress = false,
                        dest = SessionKeepAliveService.OPEN_SESSION,
                        hostId = sessions.first().spec.hostId,
                        sessionId = sessionId,
                    )
                }
            }
        }
    }
}

private data class KeepAliveSnapshot(
    val sessions: List<LiveSession>,
    val executions: List<OpsExecution>,
    val hosts: List<Host>,
    val rules: List<TunnelRule>,
    val tunnelStatus: Map<String, TunnelStatus>,
)
