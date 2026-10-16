package app.netcatty.ui.sftp

import android.content.Intent
import android.widget.Toast
import androidx.activity.compose.BackHandler
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.outlined.ArrowBack
import androidx.compose.material.icons.outlined.Description
import androidx.compose.material.icons.outlined.Edit
import androidx.compose.material.icons.outlined.Folder
import androidx.compose.material.icons.outlined.Home
import androidx.compose.material.icons.outlined.Terminal
import androidx.compose.material.icons.outlined.Upload
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.ListItem
import androidx.compose.material3.ListItemDefaults
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
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.core.content.FileProvider
import app.netcatty.ui.terminal.SessionHolder
import app.netcatty.ui.theme.CompactBarTitle
import app.netcatty.ui.theme.MidnightBackground
import app.netcatty.ui.theme.MidnightMuted
import app.netcatty.ui.theme.MidnightPrimary
import app.netcatty.ui.theme.MidnightSurface
import app.netcatty.ui.theme.MidnightText
import app.netcatty.ui.theme.appTopBarColors
import java.io.File
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import net.schmizz.sshj.sftp.RemoteResourceInfo

private data class EditorDraft(
    val remotePath: String,
    val name: String,
    val content: String,
)

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun SftpScreen(
    sessionHolder: SessionHolder,
    onBack: () -> Unit,
    onOpenInShell: (String) -> Unit,
) {
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    var path by remember { mutableStateOf(".") }
    var home by remember { mutableStateOf<String?>(null) }
    var entries by remember { mutableStateOf<List<RemoteResourceInfo>>(emptyList()) }
    var status by remember { mutableStateOf("正在打开 SFTP…") }
    var editor by remember { mutableStateOf<EditorDraft?>(null) }
    var saving by remember { mutableStateOf(false) }
    var menuFor by remember { mutableStateOf<RemoteResourceInfo?>(null) }

    fun reload(next: String) {
        val session = sessionHolder.session
        if (session == null || !session.connected) {
            status = "SSH 尚未连接"
            return
        }
        scope.launch {
            runCatching {
                withContext(Dispatchers.IO) {
                    session.openSftp().use { sftp ->
                        val resolved = sftp.canonicalize(if (next.isBlank()) "/" else next)
                        val list = sftp.ls(resolved).sortedWith(
                            compareBy<RemoteResourceInfo> { !it.isDirectory }.thenBy { it.name.lowercase() },
                        )
                        resolved to list
                    }
                }
            }.onSuccess { (resolved, list) ->
                path = resolved
                if (home == null && next == ".") home = resolved
                entries = list.filter { it.name != "." && it.name != ".." }
                status = resolved
            }.onFailure {
                status = it.message ?: "SFTP 失败"
            }
        }
    }

    LaunchedEffect(Unit) { reload(".") }

    val upload = rememberLauncherForActivityResult(ActivityResultContracts.OpenDocument()) { uri ->
        if (uri == null) return@rememberLauncherForActivityResult
        val session = sessionHolder.session ?: return@rememberLauncherForActivityResult
        scope.launch {
            runCatching {
                withContext(Dispatchers.IO) {
                    val name = uri.lastPathSegment?.substringAfterLast('/') ?: "upload.bin"
                    val tmp = File(context.cacheDir, name)
                    context.contentResolver.openInputStream(uri)?.use { input ->
                        tmp.outputStream().use { input.copyTo(it) }
                    } ?: error("无法读取文件")
                    session.upload(tmp, joinPath(path, name))
                    tmp.delete()
                }
            }.onSuccess {
                Toast.makeText(context, "已上传", Toast.LENGTH_SHORT).show()
                reload(path)
            }.onFailure {
                Toast.makeText(context, it.message ?: "上传失败", Toast.LENGTH_LONG).show()
            }
        }
    }

    fun downloadTo(entry: RemoteResourceInfo, then: (File) -> Unit) {
        val session = sessionHolder.session ?: return
        scope.launch {
            runCatching {
                withContext(Dispatchers.IO) {
                    val dir = File(context.getExternalFilesDir(null), "Download").apply { mkdirs() }
                    val dest = File(dir, entry.name)
                    session.download(entry.path, dest)
                    dest
                }
            }.onSuccess(then).onFailure {
                Toast.makeText(context, it.message ?: "下载失败", Toast.LENGTH_LONG).show()
            }
        }
    }

    fun openExternal(file: File) {
        val uri = FileProvider.getUriForFile(context, "${context.packageName}.files", file)
        val intent = Intent(Intent.ACTION_VIEW).apply {
            setDataAndType(uri, context.contentResolver.getType(uri) ?: "*/*")
            addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
        }
        context.startActivity(Intent.createChooser(intent, "打开 ${file.name}"))
    }

    fun openEditor(entry: RemoteResourceInfo) {
        val session = sessionHolder.session ?: return
        if (entry.attributes.size > MAX_EDIT_BYTES) {
            Toast.makeText(context, "文件超过 ${MAX_EDIT_BYTES / 1024} KB，请下载后用外部应用打开", Toast.LENGTH_LONG).show()
            return
        }
        scope.launch {
            runCatching {
                withContext(Dispatchers.IO) {
                    val tmp = File(context.cacheDir, "edit-${entry.name}")
                    session.download(entry.path, tmp)
                    val bytes = tmp.readBytes()
                    tmp.delete()
                    if (bytes.any { it == 0.toByte() }) error("这是二进制文件，无法在内置编辑器打开")
                    bytes.toString(Charsets.UTF_8)
                }
            }.onSuccess { text ->
                editor = EditorDraft(entry.path, entry.name, text)
            }.onFailure {
                Toast.makeText(context, it.message ?: "打开失败", Toast.LENGTH_LONG).show()
            }
        }
    }

    fun saveEditor(draft: EditorDraft, text: String) {
        val session = sessionHolder.session ?: return
        saving = true
        scope.launch {
            runCatching {
                withContext(Dispatchers.IO) {
                    val tmp = File(context.cacheDir, "save-${draft.name}")
                    tmp.writeText(text, Charsets.UTF_8)
                    session.upload(tmp, draft.remotePath)
                    tmp.delete()
                }
            }.onSuccess {
                Toast.makeText(context, "已保存", Toast.LENGTH_SHORT).show()
                editor = draft.copy(content = text)
            }.onFailure {
                Toast.makeText(context, it.message ?: "保存失败", Toast.LENGTH_LONG).show()
            }
            saving = false
        }
    }

    val currentEditor = editor
    if (currentEditor != null) {
        RemoteEditorScreen(
            name = currentEditor.name,
            remotePath = currentEditor.remotePath,
            initial = currentEditor.content,
            saving = saving,
            onSave = { saveEditor(currentEditor, it) },
            onClose = { editor = null },
        )
        return
    }

    BackHandler(onBack = onBack)

    Scaffold(
        containerColor = MidnightBackground,
        topBar = {
            TopAppBar(
                title = { CompactBarTitle("SFTP", status) },
                navigationIcon = {
                    IconButton(onClick = onBack) {
                        Icon(Icons.AutoMirrored.Outlined.ArrowBack, contentDescription = "返回")
                    }
                },
                actions = {
                    IconButton(onClick = { reload("/") }) {
                        Icon(Icons.Outlined.Folder, contentDescription = "根目录")
                    }
                    home?.let { homePath ->
                        IconButton(onClick = { reload(homePath) }) {
                            Icon(Icons.Outlined.Home, contentDescription = "家目录")
                        }
                    }
                    IconButton(
                        onClick = { onOpenInShell(path) },
                        enabled = path.isNotBlank() && path != ".",
                    ) {
                        Icon(Icons.Outlined.Terminal, contentDescription = "定位路径到终端", tint = MidnightPrimary)
                    }
                    IconButton(onClick = { upload.launch(arrayOf("*/*")) }) {
                        Icon(Icons.Outlined.Upload, contentDescription = "上传")
                    }
                },
                colors = appTopBarColors(),
            )
        },
    ) { padding ->
        LazyColumn(
            Modifier
                .fillMaxSize()
                .padding(padding),
        ) {
            item {
                PathBar(path = path, onOpen = { reload(it) })
            }
            if (path != "/") {
                item {
                    ListItem(
                        headlineContent = { Text("..") },
                        supportingContent = { Text("上级目录") },
                        leadingContent = { Icon(Icons.Outlined.Folder, contentDescription = null) },
                        modifier = Modifier
                            .fillMaxWidth()
                            .clickable { reload(parentPath(path)) },
                        colors = ListItemDefaults.colors(containerColor = MidnightSurface),
                    )
                }
            }
            items(entries, key = { it.path }) { entry ->
                ListItem(
                    headlineContent = {
                        Text(entry.name, maxLines = 1, overflow = TextOverflow.Ellipsis, fontSize = 14.sp)
                    },
                    supportingContent = {
                        Text(if (entry.isDirectory) "文件夹" else "${entry.attributes.size} 字节")
                    },
                    leadingContent = {
                        Icon(
                            if (entry.isDirectory) Icons.Outlined.Folder else Icons.Outlined.Description,
                            contentDescription = null,
                        )
                    },
                    trailingContent = {
                        Row {
                            if (entry.isDirectory) {
                                IconButton(onClick = { onOpenInShell(entry.path) }) {
                                    Icon(Icons.Outlined.Terminal, contentDescription = "定位路径到终端", tint = MidnightPrimary)
                                }
                            }
                            if (!entry.isDirectory && isEditable(entry)) {
                                IconButton(onClick = { openEditor(entry) }) {
                                    Icon(Icons.Outlined.Edit, contentDescription = "编辑", tint = MidnightPrimary)
                                }
                            }
                        }
                    },
                    modifier = Modifier
                        .fillMaxWidth()
                        .clickable {
                            if (entry.isDirectory) {
                                reload(entry.path)
                            } else {
                                menuFor = entry
                            }
                        },
                    colors = ListItemDefaults.colors(containerColor = MidnightBackground),
                )
            }
        }
    }

    menuFor?.let { entry ->
        AlertDialog(
            onDismissRequest = { menuFor = null },
            title = { Text(entry.name) },
            text = { Text(entry.path) },
            confirmButton = {
                if (isEditable(entry)) {
                    TextButton(onClick = {
                        menuFor = null
                        openEditor(entry)
                    }) { Text("编辑") }
                }
                TextButton(onClick = {
                    menuFor = null
                    downloadTo(entry, ::openExternal)
                }) { Text("下载打开") }
            },
            dismissButton = {
                TextButton(onClick = { menuFor = null }) { Text("取消") }
            },
        )
    }
}

@Composable
private fun PathBar(path: String, onOpen: (String) -> Unit) {
    val crumbs = pathCrumbs(path)
    Row(
        Modifier
            .fillMaxWidth()
            .horizontalScroll(rememberScrollState())
            .padding(horizontal = 8.dp, vertical = 4.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        crumbs.forEachIndexed { index, crumb ->
            TextButton(onClick = { onOpen(crumb.path) }) {
                Text(
                    crumb.label,
                    color = if (index == crumbs.lastIndex) MidnightText else MidnightPrimary,
                    fontSize = 13.sp,
                    maxLines = 1,
                )
            }
            if (index != crumbs.lastIndex) {
                Text("/", color = MidnightMuted, fontSize = 13.sp)
            }
        }
    }
}

private data class PathCrumb(val label: String, val path: String)

private fun pathCrumbs(path: String): List<PathCrumb> {
    val parts = path.trim('/').split('/').filter { it.isNotEmpty() }
    val crumbs = mutableListOf(PathCrumb("根目录", "/"))
    var acc = ""
    parts.forEach { part ->
        acc += "/$part"
        crumbs += PathCrumb(part, acc)
    }
    return crumbs
}

private fun parentPath(path: String): String {
    val trimmed = path.trimEnd('/')
    if (trimmed.isEmpty() || trimmed == "/") return "/"
    val idx = trimmed.lastIndexOf('/')
    return if (idx <= 0) "/" else trimmed.substring(0, idx)
}

private fun joinPath(dir: String, name: String): String =
    if (dir.endsWith("/")) dir + name else "$dir/$name"

private fun isEditable(entry: RemoteResourceInfo): Boolean {
    if (entry.isDirectory) return false
    if (entry.attributes.size > MAX_EDIT_BYTES) return false
    val ext = entry.name.substringAfterLast('.', "").lowercase()
    return ext.isEmpty() || ext in TEXT_EXTS
}

private const val MAX_EDIT_BYTES = 512 * 1024

private val TEXT_EXTS = setOf(
    "txt", "md", "markdown", "log", "json", "jsonc", "yml", "yaml", "xml", "toml", "ini", "cfg", "conf", "cnf",
    "env", "properties", "sh", "bash", "zsh", "fish", "ps1", "bat", "cmd",
    "py", "rb", "pl", "php", "js", "ts", "jsx", "tsx", "vue", "css", "scss", "html", "htm", "svg",
    "c", "h", "cc", "cpp", "hpp", "java", "kt", "kts", "go", "rs", "swift", "m", "mm",
    "sql", "csv", "tsv", "gradle", "dockerfile", "gitignore", "editorconfig",
)
