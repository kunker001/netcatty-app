package app.netcatty.ui.host

import androidx.compose.ui.graphics.Color
import app.netcatty.ssh.NetQuality
import app.netcatty.ui.theme.StatusGray
import app.netcatty.ui.theme.StatusGreen
import app.netcatty.ui.theme.StatusOrange
import app.netcatty.ui.theme.StatusRed

fun NetQuality.tint(): Color = when (this) {
    NetQuality.GOOD -> StatusGreen
    NetQuality.FAIR -> StatusOrange
    NetQuality.POOR -> StatusRed
    NetQuality.UNKNOWN -> StatusGray
}
