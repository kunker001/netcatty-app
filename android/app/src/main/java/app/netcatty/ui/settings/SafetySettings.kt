package app.netcatty.ui.settings

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.Add
import androidx.compose.material.icons.outlined.Close
import androidx.compose.material3.FilterChip
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import app.netcatty.ai.PermissionMode
import app.netcatty.ai.labelZh
import app.netcatty.ui.theme.FieldRadius
import app.netcatty.ui.theme.MidnightDanger
import app.netcatty.ui.theme.MidnightMuted
import app.netcatty.ui.theme.MidnightText
import app.netcatty.ui.theme.appFieldColors

@OptIn(ExperimentalLayoutApi::class)
@Composable
fun SafetySettings(
    mode: PermissionMode,
    onMode: (PermissionMode) -> Unit,
    timeout: String,
    onTimeout: (String) -> Unit,
    idleTimeout: String,
    onIdleTimeout: (String) -> Unit,
    maxIterations: String,
    onMaxIterations: (String) -> Unit,
    blocklist: List<String>,
    onBlocklist: (List<String>) -> Unit,
    defaultBlocklist: List<String>,
) {
    val colors = appFieldColors()
    var regexErrors by remember { mutableStateOf<Map<Int, String>>(emptyMap()) }

    fun validate(pattern: String, idx: Int) {
        if (pattern.isBlank()) {
            regexErrors = regexErrors - idx
            return
        }
        regexErrors = try {
            Regex(pattern)
            regexErrors - idx
        } catch (error: Exception) {
            regexErrors + (idx to (error.message ?: "无效正则"))
        }
    }

    Text("安全", color = MidnightText, fontSize = 14.sp, modifier = Modifier.padding(top = 16.dp, bottom = 4.dp))
    Text(
        "控制 Catty 通过 Netcatty 访问终端的方式。观察模式只读；确认模式会先询问；自动模式可直接执行，但仍受黑名单约束。",
        color = MidnightMuted,
        fontSize = 12.sp,
        modifier = Modifier.padding(bottom = 8.dp),
    )
    Text("权限模式", color = MidnightMuted, fontSize = 12.sp)
    FlowRow(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
        PermissionMode.entries.forEach { item ->
            FilterChip(
                selected = mode == item,
                onClick = { onMode(item) },
                label = { Text(item.labelZh(), fontSize = 12.sp) },
            )
        }
    }
    Spacer(Modifier.height(8.dp))
    OutlinedTextField(
        value = idleTimeout,
        onValueChange = { onIdleTimeout(it.filter(Char::isDigit).take(5)) },
        modifier = Modifier.fillMaxWidth(),
        label = { Text("响应等待时间（秒）") },
        supportingText = { Text("连续这么多秒没有收到新响应时取消请求。") },
        keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Number),
        singleLine = true,
        textStyle = TextStyle(fontSize = 14.sp, color = MidnightText),
        shape = FieldRadius,
        colors = colors,
    )
    Spacer(Modifier.height(8.dp))
    OutlinedTextField(
        value = timeout,
        onValueChange = { onTimeout(it.filter(Char::isDigit).take(5)) },
        modifier = Modifier.fillMaxWidth(),
        label = { Text("命令超时（秒）") },
        supportingText = { Text("通过终端执行命令时允许运行的最长时间。") },
        keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Number),
        singleLine = true,
        textStyle = TextStyle(fontSize = 14.sp, color = MidnightText),
        shape = FieldRadius,
        colors = colors,
    )
    Spacer(Modifier.height(8.dp))
    OutlinedTextField(
        value = maxIterations,
        onValueChange = { onMaxIterations(it.filter(Char::isDigit).take(3)) },
        modifier = Modifier.fillMaxWidth(),
        label = { Text("最大迭代次数") },
        supportingText = { Text("防止 AI 失控循环调用工具的上限。") },
        keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Number),
        singleLine = true,
        textStyle = TextStyle(fontSize = 14.sp, color = MidnightText),
        shape = FieldRadius,
        colors = colors,
    )
    Spacer(Modifier.height(10.dp))
    Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
        Column(Modifier.weight(1f)) {
            Text("命令黑名单", color = MidnightText, fontSize = 14.sp)
            Text("拦截危险命令的正则表达式。", color = MidnightMuted, fontSize = 12.sp)
        }
        TextButton(onClick = {
            onBlocklist(defaultBlocklist)
            regexErrors = emptyMap()
        }) { Text("恢复默认") }
    }
    Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
        blocklist.forEachIndexed { idx, pattern ->
            Column {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    OutlinedTextField(
                        value = pattern,
                        onValueChange = { value ->
                            validate(value, idx)
                            onBlocklist(blocklist.toMutableList().also { it[idx] = value })
                        },
                        modifier = Modifier.weight(1f),
                        placeholder = { Text("正则表达式…") },
                        singleLine = true,
                        textStyle = TextStyle(fontSize = 12.sp, fontFamily = FontFamily.Monospace, color = MidnightText),
                        isError = regexErrors.containsKey(idx),
                        shape = FieldRadius,
                        colors = colors,
                    )
                    IconButton(
                        onClick = {
                            onBlocklist(blocklist.filterIndexed { i, _ -> i != idx })
                            regexErrors = regexErrors
                                .filterKeys { it != idx }
                                .mapKeys { (key, _) -> if (key > idx) key - 1 else key }
                        },
                    ) {
                        Icon(Icons.Outlined.Close, contentDescription = "删除规则", tint = MidnightMuted)
                    }
                }
                regexErrors[idx]?.let { message ->
                    Text(message, color = MidnightDanger, fontSize = 11.sp, modifier = Modifier.padding(start = 4.dp))
                }
            }
        }
    }
    TextButton(onClick = { onBlocklist(blocklist + "") }) {
        Icon(Icons.Outlined.Add, contentDescription = null, modifier = Modifier.padding(end = 4.dp))
        Text("添加规则")
    }
    Text(
        "这些安全设置会约束经由 Netcatty 执行的操作。",
        color = MidnightMuted,
        fontSize = 12.sp,
        modifier = Modifier.padding(top = 4.dp),
    )
}
