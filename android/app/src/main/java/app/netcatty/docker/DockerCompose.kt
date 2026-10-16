package app.netcatty.docker

import app.netcatty.ssh.SshSession
import app.netcatty.ssh.shSingleQuote
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json

enum class ComposeTool(val cli: String) {
    V2("docker compose"),
    V1("docker-compose"),
}

data class ComposeProject(
    val dir: String,
    val file: String,
    val tool: ComposeTool,
)

data class DockerContainer(
    val id: String,
    val name: String,
    val service: String,
    val state: String,
    val status: String,
    val image: String,
) {
    val running: Boolean get() = state.equals("running", true)
    val paused: Boolean get() = state.equals("paused", true) || status.contains("Paused", true)
    val canExec: Boolean get() = running && !paused
}

private val json = Json {
    ignoreUnknownKeys = true
    isLenient = true
}

@Serializable
private data class ComposePsRow(
    val ID: String? = null,
    val Id: String? = null,
    val Name: String? = null,
    val Names: String? = null,
    val Service: String? = null,
    val State: String? = null,
    val Status: String? = null,
    val Image: String? = null,
    val Health: String? = null,
    val Project: String? = null,
)

suspend fun detectComposeProject(session: SshSession): ComposeProject? {
    val pid = session.shellPid ?: return null
    val result = session.execLogin(
        """
        cwd=`cd /proc/$pid/cwd 2>/dev/null && pwd -P` || exit 1
        echo "CWD=${'$'}cwd"
        d="${'$'}cwd"
        n=0
        found=
        while [ -n "${'$'}d" ] && [ "${'$'}d" != / ] && [ ${'$'}n -lt 12 ] && [ -z "${'$'}found" ]; do
          for f in docker-compose.yml docker-compose.yaml compose.yml compose.yaml; do
            if [ -f "${'$'}d/${'$'}f" ]; then
              echo "DIR=${'$'}d"
              echo "FILE=${'$'}f"
              found=1
              break
            fi
          done
          if [ -n "${'$'}found" ]; then break; fi
          d=`dirname "${'$'}d"`
          n=`expr ${'$'}n + 1`
        done
        if docker compose version >/dev/null 2>&1; then echo TOOL=v2
        elif docker-compose version >/dev/null 2>&1; then echo TOOL=v1
        else echo TOOL=none
        fi
        """.trimIndent(),
        timeoutSeconds = 12,
    )
    val text = result.stdout
    val dir = valueOf(text, "DIR") ?: return null
    val file = valueOf(text, "FILE") ?: return null
    val tool = when (valueOf(text, "TOOL")) {
        "v2" -> ComposeTool.V2
        "v1" -> ComposeTool.V1
        else -> return null
    }
    return ComposeProject(dir = dir, file = file, tool = tool)
}

suspend fun listComposeContainers(session: SshSession, project: ComposeProject): List<DockerContainer> {
    val cmd = "${project.tool.cli} ps -a --format json"
    val result = session.execLogin(
        "cd ${shSingleQuote(project.dir)} && $cmd",
        timeoutSeconds = 20,
    )
    val parsed = parseComposePs(result.stdout)
    if (parsed.isNotEmpty()) return parsed
    if (result.exitCode != 0) {
        error(result.stderr.ifBlank { result.stdout }.ifBlank { "无法列出容器" }.trim().take(400))
    }
    return parsed
}

suspend fun runComposeAction(
    session: SshSession,
    project: ComposeProject,
    container: DockerContainer,
    action: DockerAction,
): String {
    val service = container.service.ifBlank { container.name }
    val quoted = shSingleQuote(service)
    val command = when (action) {
        DockerAction.START -> "${project.tool.cli} start $quoted || ${project.tool.cli} up -d $quoted"
        DockerAction.STOP -> "${project.tool.cli} stop $quoted"
        DockerAction.RESTART -> "${project.tool.cli} restart $quoted"
        DockerAction.PAUSE -> "${project.tool.cli} pause $quoted"
        DockerAction.UNPAUSE -> "${project.tool.cli} unpause $quoted"
    }
    val result = session.execLogin(
        "cd ${shSingleQuote(project.dir)} && $command",
        timeoutSeconds = 45,
    )
    if (result.exitCode != 0 && result.exitCode != null) {
        error(result.stderr.ifBlank { result.stdout }.ifBlank { "操作失败" }.trim().take(400))
    }
    return result.stdout.trim()
}

suspend fun readComposeLogs(
    session: SshSession,
    project: ComposeProject,
    container: DockerContainer,
    tail: Int = 200,
): String {
    val service = container.service.ifBlank { container.name }
    val result = session.execLogin(
        "cd ${shSingleQuote(project.dir)} && ${project.tool.cli} logs --no-color --tail=$tail ${shSingleQuote(service)}",
        timeoutSeconds = 30,
    )
    val text = (result.stdout + result.stderr).trim()
    return text.ifBlank { "（没有日志）" }
}

fun composeExecCommand(project: ComposeProject, container: DockerContainer): String {
    val service = shSingleQuote(container.service.ifBlank { container.name })
    return "cd ${shSingleQuote(project.dir)} && (${project.tool.cli} exec -it $service bash || ${project.tool.cli} exec -it $service sh)\n"
}

fun composeFollowLogsCommand(project: ComposeProject, container: DockerContainer): String {
    val service = shSingleQuote(container.service.ifBlank { container.name })
    return "cd ${shSingleQuote(project.dir)} && ${project.tool.cli} logs -f --tail=100 $service\n"
}

enum class DockerAction {
    START, STOP, RESTART, PAUSE, UNPAUSE,
}

fun containerStateLabel(state: String): String = when (state.lowercase()) {
    "running" -> "运行中"
    "paused" -> "已暂停"
    "exited" -> "已停止"
    "created" -> "已创建"
    "restarting" -> "重启中"
    "dead" -> "已销毁"
    "removing" -> "删除中"
    else -> state.ifBlank { "未知" }
}

private fun parseComposePs(stdout: String): List<DockerContainer> {
    val text = stdout.trim()
    if (text.isEmpty()) return emptyList()
    val rows = buildList {
        if (text.startsWith("[")) {
            runCatching { addAll(json.decodeFromString<List<ComposePsRow>>(text)) }
        } else {
            text.lineSequence()
                .map { it.trim() }
                .filter { it.startsWith("{") }
                .forEach { line ->
                    runCatching { add(json.decodeFromString<ComposePsRow>(line)) }
                }
        }
    }
    return rows.map { row ->
        val state = row.State.orEmpty()
        val health = row.Health.orEmpty()
        val status = buildString {
            append(row.Status ?: containerStateLabel(state))
            if (health.isNotBlank() && !health.equals("none", true)) append(" · $health")
        }
        DockerContainer(
            id = (row.ID ?: row.Id).orEmpty(),
            name = (row.Name ?: row.Names).orEmpty(),
            service = row.Service.orEmpty(),
            state = state.ifBlank { row.Status.orEmpty() },
            status = status,
            image = row.Image.orEmpty(),
        )
    }
}

private fun valueOf(text: String, key: String): String? =
    Regex("""^$key=(.*)$""", RegexOption.MULTILINE).find(text)?.groupValues?.get(1)?.trim()?.takeIf { it.isNotEmpty() }
