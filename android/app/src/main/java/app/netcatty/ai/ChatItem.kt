package app.netcatty.ai

import kotlinx.serialization.Serializable

@Serializable
sealed class ChatItem {
    @Serializable
    data class User(val text: String) : ChatItem()

    @Serializable
    data class Assistant(val text: String) : ChatItem()

    @Serializable
    data class Tool(val name: String, val detail: String, val ok: Boolean, val running: Boolean = false) : ChatItem()

    @Serializable
    data class Error(val text: String) : ChatItem()
}
