package app.netcatty

import android.app.Application
import app.netcatty.ai.AiSettingsStore
import app.netcatty.ai.CommandSafety
import app.netcatty.ai.OpsChatStore
import app.netcatty.data.HostRepository
import app.netcatty.session.LiveSessionStore
import app.netcatty.ssh.HostPingMonitor
import app.netcatty.ssh.HostStatsMonitor
import app.netcatty.ssh.SshCrypto
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob

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

    override fun onCreate() {
        super.onCreate()
        SshCrypto.install()
        hosts = HostRepository(this)
        ai = AiSettingsStore(this)
        commandSafety = CommandSafety(this)
        opsChats = OpsChatStore(this, appScope)
        liveSessions = LiveSessionStore(appScope, onRemoved = { id -> opsChats.pause(id) })
        pings = HostPingMonitor()
        hostStats = HostStatsMonitor()
    }
}
