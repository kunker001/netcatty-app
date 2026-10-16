package app.netcatty.ui.settings

import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.ExposedDropdownMenuBox
import androidx.compose.material3.ExposedDropdownMenuDefaults
import androidx.compose.material3.MenuAnchorType
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Switch
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import app.netcatty.ai.WEB_SEARCH_PRESETS
import app.netcatty.ai.WebSearchConfig
import app.netcatty.ui.theme.FieldRadius
import app.netcatty.ui.theme.MidnightMuted
import app.netcatty.ui.theme.MidnightText
import app.netcatty.ui.theme.appFieldColors

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun WebSearchSettings(
    config: WebSearchConfig,
    onChange: (WebSearchConfig) -> Unit,
) {
    val colors = appFieldColors()
    val preset = config.preset
    var providerOpen by remember { mutableStateOf(false) }

    Text("网络搜索", color = MidnightText, fontSize = 14.sp, modifier = Modifier.padding(top = 16.dp, bottom = 4.dp))
    Text(
        "允许 Catty 搜索互联网获取最新信息。",
        color = MidnightMuted,
        fontSize = 12.sp,
        modifier = Modifier.padding(bottom = 8.dp),
    )
    Row(
        Modifier.fillMaxWidth(),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Text("启用网络搜索", color = MidnightText, fontSize = 14.sp, modifier = Modifier.weight(1f))
        Switch(
            checked = config.enabled,
            onCheckedChange = { onChange(config.copy(enabled = it)) },
        )
    }
    Spacer(Modifier.height(8.dp))
    ExposedDropdownMenuBox(expanded = providerOpen, onExpandedChange = { providerOpen = it }) {
        OutlinedTextField(
            value = preset.name,
            onValueChange = {},
            readOnly = true,
            label = { Text("搜索供应商") },
            trailingIcon = { ExposedDropdownMenuDefaults.TrailingIcon(expanded = providerOpen) },
            modifier = Modifier
                .menuAnchor(MenuAnchorType.PrimaryNotEditable)
                .fillMaxWidth(),
            textStyle = TextStyle(fontSize = 14.sp, color = MidnightText),
            colors = colors,
            shape = FieldRadius,
        )
        ExposedDropdownMenu(expanded = providerOpen, onDismissRequest = { providerOpen = false }) {
            WEB_SEARCH_PRESETS.forEach { item ->
                DropdownMenuItem(
                    text = { Text(item.name) },
                    onClick = {
                        onChange(
                            config.copy(
                                providerId = item.id,
                                apiKey = "",
                                apiHost = item.defaultApiHost,
                            ),
                        )
                        providerOpen = false
                    },
                )
            }
        }
    }
    if (preset.requiresApiKey) {
        Spacer(Modifier.height(8.dp))
        OutlinedTextField(
            value = config.apiKey,
            onValueChange = { onChange(config.copy(apiKey = it)) },
            modifier = Modifier.fillMaxWidth(),
            label = { Text("搜索 API 密钥") },
            visualTransformation = PasswordVisualTransformation(),
            singleLine = true,
            textStyle = TextStyle(fontSize = 14.sp, color = MidnightText),
            shape = FieldRadius,
            colors = colors,
        )
    }
    Spacer(Modifier.height(8.dp))
    OutlinedTextField(
        value = config.apiHost.ifBlank { preset.defaultApiHost },
        onValueChange = { onChange(config.copy(apiHost = it)) },
        modifier = Modifier.fillMaxWidth(),
        label = { Text("API 地址") },
        supportingText = {
            Text(
                if (config.providerId == "searxng") "SearXNG 实例的 URL（必填）。"
                else "自定义端点。除非使用代理，否则保持默认。",
            )
        },
        singleLine = true,
        textStyle = TextStyle(fontSize = 14.sp, color = MidnightText),
        shape = FieldRadius,
        colors = colors,
    )
    Spacer(Modifier.height(8.dp))
    OutlinedTextField(
        value = config.maxResults.toString(),
        onValueChange = { raw ->
            val value = raw.filter(Char::isDigit).take(2).toIntOrNull() ?: 0
            if (value in 1..20) onChange(config.copy(maxResults = value))
            if (raw.isEmpty()) onChange(config.copy(maxResults = 5))
        },
        modifier = Modifier.fillMaxWidth(),
        label = { Text("最大结果数") },
        supportingText = { Text("搜索返回的最大结果数（1-20）。") },
        keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Number),
        singleLine = true,
        textStyle = TextStyle(fontSize = 14.sp, color = MidnightText),
        shape = FieldRadius,
        colors = colors,
    )
}
