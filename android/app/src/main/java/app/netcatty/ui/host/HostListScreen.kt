package app.netcatty.ui.host

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.outlined.ArrowBack
import androidx.compose.material.icons.outlined.Add
import androidx.compose.material.icons.outlined.Dns
import androidx.compose.material.icons.outlined.MoreVert
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.Scaffold
import androidx.compose.material3.SmallFloatingActionButton
import androidx.compose.material3.Text
import androidx.compose.material3.TopAppBar
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateMapOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import app.netcatty.data.Host
import app.netcatty.data.SshConnection
import app.netcatty.data.hostSections
import app.netcatty.data.hostSectionsNeedHeaders
import app.netcatty.ui.theme.CardRadius
import app.netcatty.ui.theme.CompactBarTitle
import app.netcatty.ui.theme.MidnightBackground
import app.netcatty.ui.theme.MidnightBorder
import app.netcatty.ui.theme.MidnightMuted
import app.netcatty.ui.theme.MidnightOnPrimary
import app.netcatty.ui.theme.MidnightPrimary
import app.netcatty.ui.theme.MidnightSurface
import app.netcatty.ui.theme.MidnightText
import app.netcatty.ui.theme.ScreenPad
import app.netcatty.ui.theme.appTopBarColors

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun HostListScreen(
    hosts: List<Host>,
    connections: List<SshConnection>,
    onBack: () -> Unit,
    onAdd: () -> Unit,
    onOpen: (Host) -> Unit,
    onOpenCatty: (Host) -> Unit,
    onOpenNotes: (Host) -> Unit,
    onDelete: (Host) -> Unit,
) {
    val counts = remember(connections) { connections.groupingBy { it.hostId }.eachCount() }
    val sections = remember(hosts) { hostSections(hosts) }
    val showGroups = hostSectionsNeedHeaders(sections)
    val expanded = remember { mutableStateMapOf<String, Boolean>() }
    Scaffold(
        containerColor = MidnightBackground,
        topBar = {
            TopAppBar(
                title = {
                    CompactBarTitle(
                        "主机",
                        if (showGroups) "${sections.size} 个分组 · ${hosts.size} 台主机" else "一台主机可对应多条连接",
                    )
                },
                navigationIcon = {
                    IconButton(onClick = onBack) {
                        Icon(Icons.AutoMirrored.Outlined.ArrowBack, contentDescription = "返回")
                    }
                },
                colors = appTopBarColors(),
            )
        },
        floatingActionButton = {
            SmallFloatingActionButton(
                onClick = onAdd,
                containerColor = MidnightPrimary,
                contentColor = MidnightOnPrimary,
                modifier = Modifier.navigationBarsPadding(),
            ) {
                Icon(Icons.Outlined.Add, contentDescription = "添加主机")
            }
        },
    ) { padding ->
        if (hosts.isEmpty()) {
            Box(
                Modifier
                    .fillMaxSize()
                    .padding(padding),
                contentAlignment = Alignment.Center,
            ) {
                Column(horizontalAlignment = Alignment.CenterHorizontally) {
                    Text("还没有主机", color = MidnightText, fontWeight = FontWeight.SemiBold)
                    Text("先添加主机，再为它创建连接。", color = MidnightMuted, fontSize = 12.sp, modifier = Modifier.padding(top = 4.dp))
                }
            }
        } else {
            LazyColumn(
                modifier = Modifier
                    .fillMaxSize()
                    .padding(padding)
                    .padding(horizontal = ScreenPad),
                contentPadding = PaddingValues(bottom = 72.dp, top = 8.dp),
                verticalArrangement = Arrangement.spacedBy(8.dp),
            ) {
                sections.forEach { section ->
                    val open = !showGroups || expanded[section.key] != false
                    if (showGroups) {
                        item(key = "group:${section.key}") {
                            HostGroupHeader(
                                title = section.title,
                                count = section.hosts.size,
                                expanded = open,
                                onToggle = { expanded[section.key] = !open },
                            )
                        }
                    }
                    if (open) {
                        items(section.hosts, key = { it.id }) { host ->
                            Box(Modifier.padding(start = if (showGroups) 8.dp else 0.dp)) {
                                HostRow(
                                    host = host,
                                    connectionCount = counts[host.id] ?: 0,
                                    onOpen = { onOpen(host) },
                                    onOpenCatty = { onOpenCatty(host) },
                                    onOpenNotes = { onOpenNotes(host) },
                                    onDelete = { onDelete(host) },
                                )
                            }
                        }
                    }
                }
            }
        }
    }
}

@Composable
private fun HostRow(
    host: Host,
    connectionCount: Int,
    onOpen: () -> Unit,
    onOpenCatty: () -> Unit,
    onOpenNotes: () -> Unit,
    onDelete: () -> Unit,
) {
    var menu by remember { mutableStateOf(false) }
    Row(
        Modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(CardRadius))
            .background(MidnightSurface)
            .border(1.dp, MidnightBorder, RoundedCornerShape(CardRadius))
            .clickable(onClick = onOpen)
            .padding(start = 10.dp, end = 2.dp, top = 8.dp, bottom = 8.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Box(
            Modifier
                .size(34.dp)
                .clip(CircleShape)
                .background(MidnightPrimary.copy(alpha = 0.16f)),
            contentAlignment = Alignment.Center,
        ) {
            Icon(Icons.Outlined.Dns, contentDescription = null, tint = MidnightPrimary, modifier = Modifier.size(18.dp))
        }
        Column(
            Modifier
                .weight(1f)
                .padding(horizontal = 10.dp),
        ) {
            Text(host.title, color = MidnightText, fontWeight = FontWeight.SemiBold, fontSize = 14.sp, maxLines = 1, overflow = TextOverflow.Ellipsis)
            Text(host.hostname, color = MidnightMuted, fontSize = 12.sp, maxLines = 1, overflow = TextOverflow.Ellipsis)
            Text(
                "$connectionCount 条连接",
                color = MidnightMuted,
                fontSize = 11.sp,
            )
            host.notePreview()?.let { preview ->
                Text(
                    preview,
                    color = MidnightMuted,
                    fontSize = 11.sp,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                    modifier = Modifier.padding(top = 2.dp),
                )
            }
        }
        Box {
            IconButton(onClick = { menu = true }, modifier = Modifier.size(36.dp)) {
                Icon(Icons.Outlined.MoreVert, contentDescription = "更多", tint = MidnightMuted, modifier = Modifier.size(18.dp))
            }
            DropdownMenu(expanded = menu, onDismissRequest = { menu = false }) {
                DropdownMenuItem(text = { Text("编辑") }, onClick = { menu = false; onOpen() })
                DropdownMenuItem(
                    text = { Text(if (host.notes.isBlank()) "添加笔记" else "编辑笔记") },
                    onClick = { menu = false; onOpenNotes() },
                )
                DropdownMenuItem(text = { Text("Catty 会话") }, onClick = { menu = false; onOpenCatty() })
                DropdownMenuItem(text = { Text("删除") }, onClick = { menu = false; onDelete() })
            }
        }
    }
}
