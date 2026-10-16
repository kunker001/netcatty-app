package app.netcatty.ui.sftp

import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.font.FontStyle
import androidx.compose.ui.text.font.FontWeight
import app.netcatty.ui.theme.MidnightMuted
import app.netcatty.ui.theme.MidnightText

enum class EditorLanguage(val label: String) {
    YAML("YAML"),
    JSON("JSON"),
    XML("XML"),
    CONF("CONF"),
    SHELL("Shell"),
    MARKDOWN("Markdown"),
    GENERIC("Text"),
}

fun languageFor(fileName: String): EditorLanguage {
    val file = fileName.substringAfterLast('/').lowercase()
    val ext = file.substringAfterLast('.', missingDelimiterValue = "")
    return when {
        ext in setOf("yml", "yaml") -> EditorLanguage.YAML
        ext in setOf("json", "jsonc") -> EditorLanguage.JSON
        ext in setOf("xml", "html", "htm", "svg") -> EditorLanguage.XML
        ext in setOf("conf", "cfg", "cnf", "ini", "properties", "env", "toml", "service") -> EditorLanguage.CONF
        ext in setOf("sh", "bash", "zsh", "fish", "bashrc", "zshrc", "ksh") -> EditorLanguage.SHELL
        ext in setOf("md", "markdown") -> EditorLanguage.MARKDOWN
        else -> EditorLanguage.GENERIC
    }
}

fun highlightSource(text: String, language: EditorLanguage): AnnotatedString {
    if (text.isEmpty()) return AnnotatedString("")
    if (text.length > 400_000) return AnnotatedString(text)
    return when (language) {
        EditorLanguage.YAML -> highlightYaml(text)
        EditorLanguage.JSON -> highlightJson(text)
        EditorLanguage.XML -> highlightXml(text)
        EditorLanguage.CONF -> highlightConf(text)
        EditorLanguage.SHELL -> highlightShell(text)
        EditorLanguage.MARKDOWN -> highlightMarkdown(text)
        EditorLanguage.GENERIC -> highlightGeneric(text)
    }
}

private object Syn {
    val text = SpanStyle(color = MidnightText)
    val comment = SpanStyle(color = MidnightMuted, fontStyle = FontStyle.Italic)
    val key = SpanStyle(color = Color(0xFF7C3AED), fontWeight = FontWeight.Medium)
    val keyword = SpanStyle(color = Color(0xFF0369A1), fontWeight = FontWeight.SemiBold)
    val string = SpanStyle(color = Color(0xFF15803D))
    val number = SpanStyle(color = Color(0xFFC2410C))
    val bool = SpanStyle(color = Color(0xFFBE185D))
    val punct = SpanStyle(color = Color(0xFF64748B))
    val section = SpanStyle(color = Color(0xFF0F766E), fontWeight = FontWeight.SemiBold)
    val tag = SpanStyle(color = Color(0xFF1D4ED8), fontWeight = FontWeight.Medium)
    val attr = SpanStyle(color = Color(0xFF7C3AED))
}

private class Highlighter(private val text: String) {
    private val styles = ArrayList<Triple<Int, Int, SpanStyle>>(64)

    fun add(start: Int, end: Int, style: SpanStyle) {
        if (start < end && start >= 0 && end <= text.length) styles += Triple(start, end, style)
    }

    fun toAnnotated(): AnnotatedString {
        val builder = AnnotatedString.Builder(text)
        for ((start, end, style) in styles) builder.addStyle(style, start, end)
        return builder.toAnnotatedString()
    }
}

private fun highlightYaml(text: String): AnnotatedString {
    val h = Highlighter(text)
    forEachLine(text) { start, end -> highlightYamlLine(h, text, start, end) }
    return h.toAnnotated()
}

private fun highlightYamlLine(h: Highlighter, text: String, start: Int, end: Int) {
    var i = skipWs(text, start, end)
    if (i >= end) return
    if (text[i] == '#') {
        h.add(i, end, Syn.comment)
        return
    }
    if (matchAt(text, i, end, "---") || matchAt(text, i, end, "...")) {
        h.add(i, i + 3, Syn.keyword)
        return
    }
    if (text[i] == '-' && i + 1 < end && text[i + 1].isWhitespace()) {
        h.add(i, i + 1, Syn.keyword)
        i = skipWs(text, i + 1, end)
    }
    if (i >= end) return
    if (text[i] == '#') {
        h.add(i, end, Syn.comment)
        return
    }
    val colon = yamlKeyColon(text, i, end)
    if (colon != null) {
        h.add(i, colon, Syn.key)
        h.add(colon, colon + 1, Syn.punct)
        highlightScalar(h, text, colon + 1, end, hashComment = true)
    } else {
        highlightScalar(h, text, i, end, hashComment = true)
    }
}

private fun yamlKeyColon(text: String, start: Int, end: Int): Int? {
    var i = start
    if (i >= end) return null
    if (text[i] == '"' || text[i] == '\'') {
        i = skipQuoted(text, i, end)
        i = skipWs(text, i, end)
        return if (i < end && text[i] == ':') i else null
    }
    while (i < end) {
        when (val c = text[i]) {
            '#' -> return null
            '"' , '\'' -> return null
            ':' -> {
                val next = if (i + 1 < end) text[i + 1] else ' '
                if (next == ' ' || next == '\t' || next == '#' || i + 1 == end) return i
            }
        }
        i++
    }
    return null
}

private fun highlightJson(text: String): AnnotatedString {
    val h = Highlighter(text)
    val inObject = ArrayDeque<Boolean>()
    var expectKey = false
    var i = 0
    while (i < text.length) {
        val c = text[i]
        when {
            c.isWhitespace() -> i++
            c == '/' && i + 1 < text.length && text[i + 1] == '/' -> {
                val nl = text.indexOf('\n', i).let { if (it < 0) text.length else it }
                h.add(i, nl, Syn.comment)
                i = nl
            }
            c == '/' && i + 1 < text.length && text[i + 1] == '*' -> {
                val close = text.indexOf("*/", i + 2).let { if (it < 0) text.length else it + 2 }
                h.add(i, close, Syn.comment)
                i = close
            }
            c == '{' -> {
                h.add(i, i + 1, Syn.punct)
                inObject.addLast(true)
                expectKey = true
                i++
            }
            c == '}' -> {
                h.add(i, i + 1, Syn.punct)
                if (inObject.isNotEmpty()) inObject.removeLast()
                expectKey = false
                i++
            }
            c == '[' -> {
                h.add(i, i + 1, Syn.punct)
                inObject.addLast(false)
                expectKey = false
                i++
            }
            c == ']' -> {
                h.add(i, i + 1, Syn.punct)
                if (inObject.isNotEmpty()) inObject.removeLast()
                expectKey = false
                i++
            }
            c == ',' -> {
                h.add(i, i + 1, Syn.punct)
                expectKey = inObject.lastOrNull() == true
                i++
            }
            c == ':' -> {
                h.add(i, i + 1, Syn.punct)
                expectKey = false
                i++
            }
            c == '"' -> {
                val end = skipQuoted(text, i, text.length)
                h.add(i, end, if (expectKey) Syn.key else Syn.string)
                i = end
            }
            c == '-' || c.isDigit() -> {
                val start = i
                i++
                while (i < text.length && text[i] in "+-.eE0123456789") i++
                h.add(start, i, Syn.number)
            }
            text.startsWith("true", i) && wordEnd(text, i + 4) -> {
                h.add(i, i + 4, Syn.bool)
                i += 4
            }
            text.startsWith("false", i) && wordEnd(text, i + 5) -> {
                h.add(i, i + 5, Syn.bool)
                i += 5
            }
            text.startsWith("null", i) && wordEnd(text, i + 4) -> {
                h.add(i, i + 4, Syn.bool)
                i += 4
            }
            else -> i++
        }
    }
    return h.toAnnotated()
}

private fun highlightXml(text: String): AnnotatedString {
    val h = Highlighter(text)
    var i = 0
    while (i < text.length) {
        if (text.startsWith("<!--", i)) {
            val close = text.indexOf("-->", i + 4).let { if (it < 0) text.length else it + 3 }
            h.add(i, close, Syn.comment)
            i = close
            continue
        }
        if (text.startsWith("<?", i) || text.startsWith("<!", i)) {
            val close = text.indexOf('>', i + 2).let { if (it < 0) text.length else it + 1 }
            h.add(i, close, Syn.keyword)
            i = close
            continue
        }
        if (text[i] == '<') {
            val tagStart = i
            i++
            if (i < text.length && text[i] == '/') {
                h.add(tagStart, i + 1, Syn.punct)
                i++
            } else {
                h.add(tagStart, tagStart + 1, Syn.punct)
            }
            val nameStart = i
            while (i < text.length && (text[i].isLetterOrDigit() || text[i] in "_:-")) i++
            h.add(nameStart, i, Syn.tag)
            while (i < text.length && text[i] != '>') {
                if (text.startsWith("/>", i)) {
                    h.add(i, i + 2, Syn.punct)
                    i += 2
                    break
                }
                if (text[i].isWhitespace()) {
                    i++
                    continue
                }
                if (text[i] == '"' || text[i] == '\'') {
                    val end = skipQuoted(text, i, text.length)
                    h.add(i, end, Syn.string)
                    i = end
                    continue
                }
                if (text[i] == '=') {
                    h.add(i, i + 1, Syn.punct)
                    i++
                    continue
                }
                val attrStart = i
                while (i < text.length && (text[i].isLetterOrDigit() || text[i] in "_:-")) i++
                if (i > attrStart) h.add(attrStart, i, Syn.attr) else i++
            }
            if (i < text.length && text[i] == '>') {
                h.add(i, i + 1, Syn.punct)
                i++
            }
            continue
        }
        i++
    }
    return h.toAnnotated()
}

private fun highlightConf(text: String): AnnotatedString {
    val h = Highlighter(text)
    forEachLine(text) { start, end ->
        var i = skipWs(text, start, end)
        if (i >= end) return@forEachLine
        if (text[i] == '#' || text[i] == ';') {
            h.add(i, end, Syn.comment)
            return@forEachLine
        }
        if (text[i] == '[') {
            val close = text.indexOf(']', i + 1).let { if (it < 0 || it > end) end else it + 1 }
            h.add(i, close, Syn.section)
            if (close < end) highlightScalar(h, text, close, end, hashComment = true, semiComment = true)
            return@forEachLine
        }
        val eq = indexOfUnquoted(text, '=', i, end)
        if (eq != null) {
            h.add(i, eq, Syn.key)
            h.add(eq, eq + 1, Syn.punct)
            highlightScalar(h, text, eq + 1, end, hashComment = true, semiComment = true)
            return@forEachLine
        }
        val wordEnd = scanWord(text, i, end)
        if (wordEnd > i) {
            val word = text.substring(i, wordEnd)
            h.add(i, wordEnd, if (word in CONF_KEYWORDS) Syn.keyword else Syn.key)
            highlightScalar(h, text, wordEnd, end, hashComment = true, semiComment = true)
        }
    }
    return h.toAnnotated()
}

private fun highlightShell(text: String): AnnotatedString {
    val h = Highlighter(text)
    forEachLine(text) { start, end ->
        var i = skipWs(text, start, end)
        if (i >= end) return@forEachLine
        if (text[i] == '#') {
            h.add(i, end, Syn.comment)
            return@forEachLine
        }
        while (i < end) {
            when (val c = text[i]) {
                ' ', '\t' -> i++
                '#' -> {
                    h.add(i, end, Syn.comment)
                    return@forEachLine
                }
                '"', '\'', '`' -> {
                    val qEnd = skipQuoted(text, i, end)
                    h.add(i, qEnd, Syn.string)
                    i = qEnd
                }
                '$' -> {
                    val varStart = i
                    i++
                    if (i < end && text[i] == '{') {
                        val close = text.indexOf('}', i + 1).let { if (it < 0 || it > end) end else it + 1 }
                        h.add(varStart, close, Syn.keyword)
                        i = close
                    } else {
                        while (i < end && (text[i].isLetterOrDigit() || text[i] == '_')) i++
                        h.add(varStart, i, Syn.keyword)
                    }
                }
                in '0'..'9' -> {
                    val nStart = i
                    while (i < end && text[i].isDigit()) i++
                    h.add(nStart, i, Syn.number)
                }
                else -> {
                    if (c.isLetter() || c == '_') {
                        val wStart = i
                        while (i < end && (text[i].isLetterOrDigit() || text[i] == '_' || text[i] == '-')) i++
                        val word = text.substring(wStart, i)
                        if (word in SHELL_KEYWORDS) h.add(wStart, i, Syn.keyword)
                    } else {
                        if (c in "{}[]()|&;<>") h.add(i, i + 1, Syn.punct)
                        i++
                    }
                }
            }
        }
    }
    return h.toAnnotated()
}

private fun highlightMarkdown(text: String): AnnotatedString {
    val h = Highlighter(text)
    var inFence = false
    forEachLine(text) { start, end ->
        val i = skipWs(text, start, end)
        if (i < end && text.startsWith("```", i)) {
            h.add(i, end, Syn.keyword)
            inFence = !inFence
            return@forEachLine
        }
        if (inFence) {
            h.add(start, end, Syn.string)
            return@forEachLine
        }
        if (i < end && text[i] == '#') {
            h.add(i, end, Syn.key)
            return@forEachLine
        }
        var p = start
        while (p < end) {
            if (text[p] == '`') {
                val close = text.indexOf('`', p + 1).let { if (it < 0 || it > end) end else it + 1 }
                h.add(p, close, Syn.string)
                p = close
            } else {
                p++
            }
        }
    }
    return h.toAnnotated()
}

private fun highlightGeneric(text: String): AnnotatedString {
    val h = Highlighter(text)
    var i = 0
    while (i < text.length) {
        when {
            text.startsWith("//", i) -> {
                val nl = text.indexOf('\n', i).let { if (it < 0) text.length else it }
                h.add(i, nl, Syn.comment)
                i = nl
            }
            text.startsWith("/*", i) -> {
                val close = text.indexOf("*/", i + 2).let { if (it < 0) text.length else it + 2 }
                h.add(i, close, Syn.comment)
                i = close
            }
            text[i] == '#' && (i == 0 || text[i - 1] == '\n' || text[i - 1].isWhitespace()) -> {
                val nl = text.indexOf('\n', i).let { if (it < 0) text.length else it }
                h.add(i, nl, Syn.comment)
                i = nl
            }
            text[i] == '"' || text[i] == '\'' -> {
                val end = skipQuoted(text, i, text.length)
                h.add(i, end, Syn.string)
                i = end
            }
            text[i].isDigit() -> {
                val start = i
                while (i < text.length && (text[i].isDigit() || text[i] in ".xXaAbBcCdDeEfF")) i++
                h.add(start, i, Syn.number)
            }
            else -> i++
        }
    }
    return h.toAnnotated()
}

private fun highlightScalar(
    h: Highlighter,
    text: String,
    start: Int,
    end: Int,
    hashComment: Boolean,
    semiComment: Boolean = false,
) {
    var i = skipWs(text, start, end)
    while (i < end) {
        when (val c = text[i]) {
            ' ', '\t' -> i++
            '#' -> if (hashComment) {
                h.add(i, end, Syn.comment)
                return
            } else i++
            ';' -> if (semiComment) {
                if (i + 1 == end || text[i + 1].isWhitespace() || text[i + 1] == '#' || text[i + 1] == ';') {
                    h.add(i, i + 1, Syn.punct)
                    i++
                } else {
                    h.add(i, end, Syn.comment)
                    return
                }
            } else {
                h.add(i, i + 1, Syn.punct)
                i++
            }
            '"', '\'' -> {
                val qEnd = skipQuoted(text, i, end)
                h.add(i, qEnd, Syn.string)
                i = qEnd
            }
            '{', '}', '[', ']', ',', ':' -> {
                h.add(i, i + 1, Syn.punct)
                i++
            }
            else -> {
                if ((c == '-' && i + 1 < end && text[i + 1].isDigit()) || c.isDigit()) {
                    val nStart = i
                    if (c == '-') i++
                    while (i < end && (text[i].isDigit() || text[i] in ".eE+-")) i++
                    h.add(nStart, i, Syn.number)
                } else if (c.isLetter()) {
                    val wStart = i
                    while (i < end && (text[i].isLetterOrDigit() || text[i] == '_' || text[i] == '-' || text[i] == '.')) i++
                    val word = text.substring(wStart, i)
                    when {
                        word.equals("true", true) || word.equals("false", true) ||
                            word.equals("null", true) || word.equals("yes", true) ||
                            word.equals("no", true) || word.equals("on", true) ||
                            word.equals("off", true) -> h.add(wStart, i, Syn.bool)
                        word in CONF_KEYWORDS -> h.add(wStart, i, Syn.keyword)
                    }
                } else {
                    i++
                }
            }
        }
    }
}

private inline fun forEachLine(text: String, block: (start: Int, end: Int) -> Unit) {
    var start = 0
    while (start <= text.length) {
        var nl = text.indexOf('\n', start)
        if (nl < 0) nl = text.length
        var end = nl
        if (end > start && text[end - 1] == '\r') end--
        block(start, end)
        if (nl == text.length) break
        start = nl + 1
    }
}

private fun skipWs(text: String, start: Int, end: Int): Int {
    var i = start
    while (i < end && (text[i] == ' ' || text[i] == '\t')) i++
    return i
}

private fun skipQuoted(text: String, start: Int, end: Int): Int {
    if (start >= end) return end
    val quote = text[start]
    var i = start + 1
    while (i < end) {
        val c = text[i]
        when {
            quote == '\'' && c == '\'' && i + 1 < end && text[i + 1] == '\'' -> i += 2
            c == '\\' && quote != '\'' -> i += 2
            c == quote -> return i + 1
            else -> i++
        }
    }
    return end
}

private fun indexOfUnquoted(text: String, target: Char, start: Int, end: Int): Int? {
    var i = start
    while (i < end) {
        when (val c = text[i]) {
            '"', '\'' -> i = skipQuoted(text, i, end)
            target -> return i
            else -> i++
        }
    }
    return null
}

private fun scanWord(text: String, start: Int, end: Int): Int {
    var i = start
    while (i < end && (text[i].isLetterOrDigit() || text[i] in "_-.")) i++
    return i
}

private fun matchAt(text: String, start: Int, end: Int, token: String): Boolean {
    if (start + token.length > end) return false
    if (!text.startsWith(token, start)) return false
    val after = start + token.length
    return after == end || text[after].isWhitespace()
}

private fun wordEnd(text: String, index: Int): Boolean =
    index >= text.length || !(text[index].isLetterOrDigit() || text[index] == '_')

private val CONF_KEYWORDS = setOf(
    "server", "location", "http", "events", "upstream", "listen", "server_name", "root",
    "index", "proxy_pass", "proxy_set_header", "ssl_certificate", "ssl_certificate_key",
    "include", "worker_processes", "pid", "error_log", "access_log", "try_files", "rewrite",
    "return", "deny", "allow", "gzip", "client_max_body_size", "fastcgi_pass", "alias",
    "Port", "PermitRootLogin", "PasswordAuthentication", "ListenAddress", "HostName",
    "User", "IdentityFile", "StrictHostKeyChecking",
)

private val SHELL_KEYWORDS = setOf(
    "if", "then", "else", "elif", "fi", "for", "while", "until", "do", "done", "case", "esac",
    "function", "return", "exit", "export", "local", "source", "alias", "unset", "shift",
    "echo", "printf", "read", "cd", "set", "trap", "wait", "in",
)
