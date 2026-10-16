package app.netcatty.ui.theme

import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.OutlinedTextFieldDefaults
import androidx.compose.material3.TextFieldColors
import androidx.compose.material3.TopAppBarColors
import androidx.compose.material3.TopAppBarDefaults
import androidx.compose.material3.Typography
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp

val MidnightBackground = Color(0xFFFFFFFF)
val MidnightSurface = Color(0xFFF5F7FA)
val MidnightSurfaceHigh = Color(0xFFEEF2F6)
val MidnightBorder = Color(0xFFE3E8EE)
val MidnightPrimary = Color(0xFF0EA5E9)
val MidnightOnPrimary = Color(0xFFFFFFFF)
val MidnightText = Color(0xFF1B2430)
val MidnightMuted = Color(0xFF667085)
val MidnightDanger = Color(0xFFDC2626)
val StatusGreen = Color(0xFF16A34A)
val StatusOrange = Color(0xFFEA580C)
val StatusRed = Color(0xFFDC2626)
val StatusGray = Color(0xFF98A2B3)

val ScreenPad = 12.dp
val CardRadius = 12.dp
val FieldRadius = RoundedCornerShape(12.dp)

private val scheme = lightColorScheme(
    primary = MidnightPrimary,
    onPrimary = MidnightOnPrimary,
    background = MidnightBackground,
    onBackground = MidnightText,
    surface = MidnightSurface,
    onSurface = MidnightText,
    surfaceVariant = MidnightSurfaceHigh,
    onSurfaceVariant = MidnightMuted,
    outline = MidnightBorder,
    error = MidnightDanger,
    onError = Color.White,
    primaryContainer = Color(0xFFE0F4FC),
    onPrimaryContainer = Color(0xFF0C4A6E),
    secondary = MidnightSurfaceHigh,
    onSecondary = MidnightText,
)

private val type = Typography(
    titleLarge = TextStyle(
        color = MidnightText,
        fontSize = 20.sp,
        fontWeight = FontWeight.SemiBold,
        lineHeight = 24.sp,
    ),
    titleMedium = TextStyle(
        color = MidnightText,
        fontSize = 16.sp,
        fontWeight = FontWeight.SemiBold,
        lineHeight = 20.sp,
    ),
    bodyLarge = TextStyle(
        color = MidnightText,
        fontSize = 14.sp,
        lineHeight = 20.sp,
    ),
    bodyMedium = TextStyle(
        color = MidnightMuted,
        fontSize = 12.sp,
        lineHeight = 16.sp,
    ),
    labelLarge = TextStyle(
        color = MidnightText,
        fontSize = 13.sp,
        fontWeight = FontWeight.Medium,
    ),
)

@Composable
fun NetcattyTheme(content: @Composable () -> Unit) {
    MaterialTheme(
        colorScheme = scheme,
        typography = type,
        content = content,
    )
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun appTopBarColors(): TopAppBarColors = TopAppBarDefaults.topAppBarColors(
    containerColor = MidnightBackground,
    titleContentColor = MidnightText,
    navigationIconContentColor = MidnightText,
    actionIconContentColor = MidnightPrimary,
)

@Composable
fun CompactBarTitle(title: String, subtitle: String? = null) {
    Column {
        Text(
            title,
            color = MidnightText,
            fontSize = 16.sp,
            fontWeight = FontWeight.SemiBold,
            maxLines = 1,
            overflow = TextOverflow.Ellipsis,
        )
        if (!subtitle.isNullOrBlank()) {
            Text(
                subtitle,
                color = MidnightMuted,
                fontSize = 11.sp,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
            )
        }
    }
}

@Composable
fun appFieldColors(): TextFieldColors = OutlinedTextFieldDefaults.colors(
    focusedBorderColor = MidnightPrimary,
    unfocusedBorderColor = MidnightBorder,
    focusedContainerColor = MidnightSurface,
    unfocusedContainerColor = MidnightSurface,
    disabledContainerColor = MidnightSurface,
    focusedTextColor = MidnightText,
    unfocusedTextColor = MidnightText,
    cursorColor = MidnightPrimary,
    focusedLabelColor = MidnightMuted,
    unfocusedLabelColor = MidnightMuted,
    focusedPlaceholderColor = MidnightMuted,
    unfocusedPlaceholderColor = MidnightMuted,
)
