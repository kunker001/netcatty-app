package app.netcatty.ui.terminal

import android.annotation.SuppressLint
import android.content.ClipData
import android.content.ClipboardManager
import android.content.Context
import android.os.Handler
import android.os.Looper
import android.view.MotionEvent
import android.view.ViewGroup
import android.view.inputmethod.InputMethodManager
import android.webkit.JavascriptInterface
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.Toast
import androidx.activity.compose.BackHandler
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.outlined.ArrowBack
import androidx.compose.material.icons.automirrored.outlined.StickyNote2
import androidx.compose.material.icons.outlined.AutoAwesome
import androidx.compose.material.icons.outlined.Folder
import androidx.compose.material.icons.outlined.LinkOff
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TopAppBar
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.focus.focusProperties
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.viewinterop.AndroidView
import app.netcatty.R
import app.netcatty.docker.ComposeProject
import app.netcatty.docker.detectComposeProject
import app.netcatty.ai.AiSettings
import app.netcatty.ai.CommandSafety
import app.netcatty.ai.OpsChatBucket
import app.netcatty.ai.OpsChatStore
import app.netcatty.ai.PermissionMode
import app.netcatty.data.ConnectSpec
import app.netcatty.session.LiveSession
import app.netcatty.session.LiveStatus
import app.netcatty.ssh.SshSession
import app.netcatty.ssh.escapeJsString
import app.netcatty.ui.docker.DockerScreen
import app.netcatty.ui.ops.OpsChatScreen
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.delay
import kotlinx.coroutines.isActive
import kotlinx.coroutines.suspendCancellableCoroutine
import kotlinx.coroutines.withContext
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.jsonPrimitive
import kotlin.coroutines.resume
import app.netcatty.ui.theme.CompactBarTitle
import app.netcatty.ui.theme.MidnightBackground
import app.netcatty.ui.theme.MidnightMuted
import app.netcatty.ui.theme.MidnightPrimary
import app.netcatty.ui.theme.MidnightSurface
import app.netcatty.ui.theme.MidnightSurfaceHigh
import app.netcatty.ui.theme.MidnightText
import app.netcatty.ui.theme.appTopBarColors
import kotlinx.coroutines.CoroutineScope

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun TerminalScreen(
    live: LiveSession,
    sessionHolder: SessionHolder,
    aiSettings: AiSettings,
    safety: CommandSafety,
    opsBucket: OpsChatBucket,
    opsStore: OpsChatStore,
    appScope: CoroutineScope,
    onBack: () -> Unit,
    onDisconnect: () -> Unit,
    onOpenSftp: () -> Unit,
    onOpenSettings: () -> Unit,
    onOpenNotes: () -> Unit,
    onPermissionChange: (PermissionMode) -> Unit,
) {
    val target = live.spec
    var status by remember { mutableStateOf(statusLabel(live)) }
    var confirmExit by remember { mutableStateOf(false) }
    var showOps by remember { mutableStateOf(false) }
    var showDocker by remember { mutableStateOf(false) }
    var composeProject by remember { mutableStateOf<ComposeProject?>(null) }
    var dockerProject by remember { mutableStateOf<ComposeProject?>(null) }
    var ctrlOn by remember { mutableStateOf(false) }
    var webView by remember { mutableStateOf<WebView?>(null) }

    LaunchedEffect(live.status, live.error) {
        status = statusLabel(live)
    }

    LaunchedEffect(live.id, live.status) {
        if (live.status != LiveStatus.CONNECTED) {
            composeProject = null
            return@LaunchedEffect
        }
        val session = live.session
        delay(600)
        for (i in 1..3) {
            if (session.shellPid != null) break
            withContext(Dispatchers.IO) { session.captureShellPid() }
            if (session.shellPid == null) delay(800)
        }
        while (isActive && session.connected) {
            composeProject = withContext(Dispatchers.IO) {
                runCatching { detectComposeProject(session) }.getOrNull()
            }
            delay(5_000)
        }
    }

    DisposableEffect(live.id) {
        sessionHolder.session = live.session
        sessionHolder.target = target
        onDispose {
            live.session.detachOutput()
            if (sessionHolder.webView === webView) {
                sessionHolder.webView = null
            }
        }
    }

    fun send(raw: String) {
        val payload = if (ctrlOn && raw.length == 1) {
            ctrlOn = false
            val code = raw.lowercase()[0].code and 31
            code.toChar().toString()
        } else {
            raw
        }
        sessionHolder.session?.write(payload)
        webView?.focusTerminal()
    }

    LaunchedEffect(showOps, showDocker) {
        if (!showOps && !showDocker) {
            delay(120)
            webView?.focusTerminal()
        }
    }

    BackHandler {
        when {
            showDocker -> showDocker = false
            showOps -> showOps = false
            else -> onBack()
        }
    }

    Box(Modifier.fillMaxSize()) {
    Column(
        Modifier
            .fillMaxSize()
            .imePadding()
            .background(MidnightBackground),
    ) {
        TopAppBar(
            title = { CompactBarTitle(target.title, status) },
            navigationIcon = {
                IconButton(onClick = onBack) {
                    Icon(Icons.AutoMirrored.Outlined.ArrowBack, contentDescription = "返回列表")
                }
            },
            actions = {
                IconButton(onClick = { showOps = true }) {
                    Icon(Icons.Outlined.AutoAwesome, contentDescription = "Catty 运维", tint = MidnightPrimary)
                }
                IconButton(onClick = onOpenNotes) {
                    Icon(
                        Icons.AutoMirrored.Outlined.StickyNote2,
                        contentDescription = if (target.notes.isBlank()) "添加笔记" else "主机笔记",
                        tint = MidnightPrimary,
                    )
                }
                if (composeProject != null) {
                    IconButton(onClick = {
                        dockerProject = composeProject
                        showDocker = true
                    }) {
                        Icon(
                            painter = painterResource(R.drawable.ic_docker),
                            contentDescription = "Docker",
                            tint = MidnightPrimary,
                        )
                    }
                }
                IconButton(onClick = onOpenSftp) {
                    Icon(Icons.Outlined.Folder, contentDescription = "SFTP", tint = MidnightPrimary)
                }
                IconButton(onClick = { confirmExit = true }) {
                    Icon(Icons.Outlined.LinkOff, contentDescription = "断开连接", tint = MidnightPrimary)
                }
            },
            colors = appTopBarColors(),
        )
        AndroidView(
            modifier = Modifier
                .weight(1f)
                .fillMaxWidth(),
            factory = { context ->
                WebView(context).apply {
                    layoutParams = ViewGroup.LayoutParams(
                        ViewGroup.LayoutParams.MATCH_PARENT,
                        ViewGroup.LayoutParams.MATCH_PARENT,
                    )
                    @SuppressLint("SetJavaScriptEnabled", "ClickableViewAccessibility")
                    settings.javaScriptEnabled = true
                    settings.domStorageEnabled = true
                    settings.setSupportZoom(false)
                    settings.builtInZoomControls = false
                    settings.displayZoomControls = false
                    isFocusable = true
                    isFocusableInTouchMode = true
                    importantForAutofill = android.view.View.IMPORTANT_FOR_AUTOFILL_NO
                    setBackgroundColor(0xFFFFFFFF.toInt())
                    setOnTouchListener { view, event ->
                        if (event.action == MotionEvent.ACTION_DOWN) {
                            view.requestFocus()
                            (view as WebView).evaluateJavascript(
                                "window.netcattyFocus && window.netcattyFocus()",
                                null,
                            )
                        }
                        false
                    }
                    addJavascriptInterface(
                        TerminalJsBridge(
                            sessionHolder = sessionHolder,
                            target = target,
                            context = context.applicationContext,
                            webView = { this },
                            onStatus = { post { status = it } },
                            onOutput = { chunk ->
                                post {
                                    evaluateJavascript(
                                        "window.netcattyWrite('${escapeJsString(chunk)}')",
                                        null,
                                    )
                                }
                            },
                        ),
                        "Netcatty",
                    )
                    webViewClient = object : WebViewClient() {
                        override fun onPageFinished(view: WebView?, url: String?) {
                            view?.postDelayed({ view.focusTerminal() }, 160)
                        }
                    }
                    loadUrl("file:///android_asset/terminal/index.html")
                    focusTerminal()
                    webView = this
                    sessionHolder.webView = this
                }
            },
            update = {
                webView = it
                sessionHolder.webView = it
            },
        )
        Row(
            Modifier
                .fillMaxWidth()
                .background(MidnightSurface)
                .navigationBarsPadding()
                .horizontalScroll(rememberScrollState())
                .padding(horizontal = 6.dp, vertical = 4.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            ExtraKey("Esc") { send("\u001b") }
            ExtraKey("Tab") { send("\t") }
            ExtraKey("Ctrl", selected = ctrlOn) {
                ctrlOn = !ctrlOn
                webView?.focusTerminal()
            }
            ExtraKey("↑") { send("\u001b[A") }
            ExtraKey("↓") { send("\u001b[B") }
            ExtraKey("←") { send("\u001b[D") }
            ExtraKey("→") { send("\u001b[C") }
            ExtraKey("Home") { send("\u001b[H") }
            ExtraKey("End") { send("\u001b[F") }
            ExtraKey("~") { send("~") }
            ExtraKey("-") { send("-") }
            ExtraKey("/") { send("/") }
            ExtraKey("复制") {
                webView?.evaluateJavascript("window.netcattyCopy && window.netcattyCopy()", null)
            }
        }
    }
        if (showDocker) {
            val project = dockerProject ?: composeProject
            if (project != null) {
                DockerScreen(
                    session = live.session,
                    project = project,
                    onBack = { showDocker = false },
                    onRunInTerminal = { command ->
                        showDocker = false
                        live.session.write(command)
                    },
                )
            }
        }
        if (showOps) {
            OpsChatScreen(
                title = target.title,
                subtitle = target.hostname,
                target = target,
                settings = aiSettings,
                safety = safety,
                sessionHolder = sessionHolder,
                bucket = opsBucket,
                store = opsStore,
                appScope = appScope,
                onBack = { showOps = false },
                onOpenSettings = onOpenSettings,
                onPermissionChange = onPermissionChange,
            )
        }
    }

    if (confirmExit) {
        AlertDialog(
            onDismissRequest = { confirmExit = false },
            title = { Text("断开连接？") },
            text = { Text("断开后会话会从首页移除。返回列表不会断开。") },
            confirmButton = {
                TextButton(onClick = {
                    confirmExit = false
                    sessionHolder.session = null
                    sessionHolder.target = null
                    sessionHolder.webView = null
                    onDisconnect()
                }) { Text("断开") }
            },
            dismissButton = {
                TextButton(onClick = { confirmExit = false }) { Text("留下") }
            },
        )
    }
}

@Composable
private fun ExtraKey(label: String, selected: Boolean = false, onClick: () -> Unit) {
    Box(
        modifier = Modifier
            .padding(end = 4.dp)
            .height(32.dp)
            .widthIn(min = 40.dp)
            .focusProperties { canFocus = false }
            .clip(RoundedCornerShape(8.dp))
            .background(if (selected) MidnightPrimary.copy(alpha = 0.16f) else MidnightSurfaceHigh)
            .clickable(onClick = onClick)
            .padding(horizontal = 10.dp),
        contentAlignment = Alignment.Center,
    ) {
        Text(
            label,
            color = if (selected) MidnightPrimary else MidnightText,
            fontSize = 12.sp,
            maxLines = 1,
            overflow = TextOverflow.Clip,
        )
    }
}

private fun WebView.focusTerminal() {
    isFocusable = true
    isFocusableInTouchMode = true
    requestFocus()
    evaluateJavascript("window.netcattyFocus && window.netcattyFocus()", null)
    post {
        val imm = context.getSystemService(Context.INPUT_METHOD_SERVICE) as? InputMethodManager
        imm?.showSoftInput(this, InputMethodManager.SHOW_IMPLICIT)
    }
}

class SessionHolder {
    var session: SshSession? = null
    var target: ConnectSpec? = null
    var webView: WebView? = null

    suspend fun readTerminalContext(maxLines: Int = 80): String {
        val view = webView ?: return ""
        return suspendCancellableCoroutine { cont ->
            view.post {
                view.evaluateJavascript("window.netcattyReadContext($maxLines)") { json ->
                    val text = runCatching {
                        json?.takeIf { it != "null" }?.let {
                            Json.parseToJsonElement(it).jsonPrimitive.content
                        }
                    }.getOrNull().orEmpty()
                    if (cont.isActive) cont.resume(text)
                }
            }
        }
    }
}

private fun statusLabel(live: LiveSession): String = when (live.status) {
    LiveStatus.CONNECTING -> "正在连接…"
    LiveStatus.CONNECTED -> live.spec.connectionLine
    LiveStatus.FAILED -> live.error?.let { "连接失败：$it" } ?: "连接失败"
}

class TerminalJsBridge(
    private val sessionHolder: SessionHolder,
    private val target: ConnectSpec,
    private val context: Context,
    private val webView: () -> WebView?,
    private val onStatus: (String) -> Unit,
    private val onOutput: (String) -> Unit,
) {
    private val main = Handler(Looper.getMainLooper())

    @JavascriptInterface
    fun onReady(cols: Int, rows: Int) {
        sessionHolder.session?.resize(cols, rows)
        sessionHolder.session?.attachOutput(onOutput)
        onStatus(
            if (sessionHolder.session?.connected == true) target.connectionLine else "正在连接…",
        )
    }

    @JavascriptInterface
    fun onData(data: String) {
        sessionHolder.session?.write(data)
    }

    @JavascriptInterface
    fun onResize(cols: Int, rows: Int) {
        sessionHolder.session?.resize(cols, rows)
    }

    @JavascriptInterface
    fun copyText(text: String) {
        main.post {
            if (text.isBlank()) {
                Toast.makeText(context, "请先长按选择文字", Toast.LENGTH_SHORT).show()
                return@post
            }
            val clipboard = context.getSystemService(Context.CLIPBOARD_SERVICE) as ClipboardManager
            clipboard.setPrimaryClip(ClipData.newPlainText("terminal", text))
            Toast.makeText(context, "已复制", Toast.LENGTH_SHORT).show()
        }
    }

    @JavascriptInterface
    fun setSelecting(active: Boolean) {
        if (!active) return
        main.post {
            val view = webView() ?: return@post
            val imm = view.context.getSystemService(Context.INPUT_METHOD_SERVICE) as? InputMethodManager
            imm?.hideSoftInputFromWindow(view.windowToken, 0)
        }
    }
}
