package app.netcatty.ui.sftp

import androidx.activity.compose.BackHandler
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.outlined.ArrowBack
import androidx.compose.material.icons.outlined.AutoFixHigh
import androidx.compose.material.icons.outlined.Save
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TopAppBar
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.input.KeyboardCapitalization
import androidx.compose.ui.text.input.TextFieldValue
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import app.netcatty.ui.theme.CompactBarTitle
import app.netcatty.ui.theme.MidnightBackground
import app.netcatty.ui.theme.MidnightPrimary
import app.netcatty.ui.theme.MidnightText
import app.netcatty.ui.theme.appTopBarColors

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun RemoteEditorScreen(
    name: String,
    remotePath: String,
    initial: String,
    saving: Boolean,
    onSave: (String) -> Unit,
    onClose: () -> Unit,
) {
    val language = remember(name) { languageFor(name) }
    var field by remember(remotePath, initial) {
        mutableStateOf(TextFieldValue(highlightSource(initial, language)))
    }
    var confirm by remember { mutableStateOf(false) }
    var formatError by remember { mutableStateOf<String?>(null) }
    val dirty = field.text != initial

    fun requestClose() {
        if (dirty && !saving) confirm = true else onClose()
    }

    fun format() {
        formatSource(name, field.text).fold(
            onSuccess = { formatted ->
                if (formatted != field.text) {
                    field = TextFieldValue(highlightSource(formatted, language))
                }
            },
            onFailure = { formatError = it.message ?: "格式化失败" },
        )
    }

    BackHandler { requestClose() }

    Scaffold(
        modifier = Modifier.fillMaxSize(),
        containerColor = MidnightBackground,
        topBar = {
            TopAppBar(
                title = {
                    CompactBarTitle(
                        name,
                        buildString {
                            append(language.label)
                            if (dirty) append(" · 未保存")
                            append(" · ")
                            append(remotePath)
                        },
                    )
                },
                navigationIcon = {
                    IconButton(onClick = { requestClose() }) {
                        Icon(Icons.AutoMirrored.Outlined.ArrowBack, contentDescription = "返回")
                    }
                },
                actions = {
                    IconButton(onClick = { format() }, enabled = !saving) {
                        Icon(Icons.Outlined.AutoFixHigh, contentDescription = "格式化")
                    }
                    IconButton(onClick = { onSave(field.text) }, enabled = dirty && !saving) {
                        Icon(Icons.Outlined.Save, contentDescription = "保存")
                    }
                },
                colors = appTopBarColors(),
            )
        },
    ) { padding ->
        BasicTextField(
            value = field,
            onValueChange = { next ->
                field = TextFieldValue(
                    annotatedString = highlightSource(next.text, language),
                    selection = next.selection,
                    composition = next.composition,
                )
            },
            modifier = Modifier
                .fillMaxSize()
                .padding(padding)
                .imePadding()
                .padding(horizontal = 12.dp, vertical = 8.dp),
            textStyle = TextStyle(
                color = MidnightText,
                fontSize = 13.sp,
                fontFamily = FontFamily.Monospace,
                lineHeight = 18.sp,
            ),
            cursorBrush = SolidColor(MidnightPrimary),
            enabled = !saving,
            keyboardOptions = KeyboardOptions(
                capitalization = KeyboardCapitalization.None,
                autoCorrectEnabled = false,
            ),
        )
    }

    if (confirm) {
        AlertDialog(
            onDismissRequest = { confirm = false },
            title = { Text("放弃修改？") },
            text = { Text("未保存的内容会丢失。") },
            confirmButton = {
                TextButton(onClick = {
                    confirm = false
                    onClose()
                }) { Text("放弃") }
            },
            dismissButton = {
                TextButton(onClick = { confirm = false }) { Text("继续编辑") }
            },
        )
    }

    formatError?.let { message ->
        AlertDialog(
            onDismissRequest = { formatError = null },
            title = { Text("无法格式化") },
            text = { Text(message) },
            confirmButton = {
                TextButton(onClick = { formatError = null }) { Text("好") }
            },
        )
    }
}
