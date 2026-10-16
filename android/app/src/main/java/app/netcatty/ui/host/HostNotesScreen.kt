package app.netcatty.ui.host

import androidx.activity.compose.BackHandler
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.outlined.ArrowBack
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.OutlinedTextField
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
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.input.KeyboardCapitalization
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import app.netcatty.ui.theme.CompactBarTitle
import app.netcatty.ui.theme.FieldRadius
import app.netcatty.ui.theme.MidnightBackground
import app.netcatty.ui.theme.MidnightMuted
import app.netcatty.ui.theme.MidnightText
import app.netcatty.ui.theme.ScreenPad
import app.netcatty.ui.theme.appFieldColors
import app.netcatty.ui.theme.appTopBarColors

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun HostNotesScreen(
    hostTitle: String,
    hostname: String,
    initial: String,
    onBack: () -> Unit,
    onSave: (String) -> Unit,
) {
    var text by remember(initial) { mutableStateOf(initial) }
    val colors = appFieldColors()

    fun commit() {
        val next = text.trimEnd()
        if (next != initial) onSave(next)
        onBack()
    }

    BackHandler { commit() }

    Scaffold(
        containerColor = MidnightBackground,
        topBar = {
            TopAppBar(
                title = { CompactBarTitle("笔记", hostTitle.ifBlank { hostname }) },
                navigationIcon = {
                    IconButton(onClick = { commit() }) {
                        Icon(Icons.AutoMirrored.Outlined.ArrowBack, contentDescription = "返回")
                    }
                },
                actions = {
                    TextButton(onClick = { commit() }) { Text("保存") }
                },
                colors = appTopBarColors(),
            )
        },
    ) { padding ->
        OutlinedTextField(
            value = text,
            onValueChange = { text = it },
            modifier = Modifier
                .fillMaxSize()
                .padding(padding)
                .navigationBarsPadding()
                .imePadding()
                .padding(horizontal = ScreenPad, vertical = 8.dp),
            placeholder = {
                Text(
                    "端口、用途、登录提示、排障记录…",
                    color = MidnightMuted,
                    fontSize = 14.sp,
                )
            },
            textStyle = TextStyle(fontSize = 15.sp, color = MidnightText, lineHeight = 22.sp),
            colors = colors,
            shape = FieldRadius,
            keyboardOptions = KeyboardOptions(capitalization = KeyboardCapitalization.Sentences),
        )
    }
}
