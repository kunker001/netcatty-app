package app.netcatty.ui.sftp

import java.io.StringReader
import java.io.StringWriter
import javax.xml.parsers.DocumentBuilderFactory
import javax.xml.transform.OutputKeys
import javax.xml.transform.TransformerFactory
import javax.xml.transform.dom.DOMSource
import javax.xml.transform.stream.StreamResult
import kotlinx.serialization.ExperimentalSerializationApi
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonElement
import org.xml.sax.InputSource

@OptIn(ExperimentalSerializationApi::class)
private val prettyJson = Json {
    prettyPrint = true
    prettyPrintIndent = "  "
}

fun formatSource(fileName: String, text: String): Result<String> = runCatching {
    val normalized = text.replace("\r\n", "\n").replace('\r', '\n')
    when (languageFor(fileName)) {
        EditorLanguage.JSON -> formatJson(normalized)
        EditorLanguage.XML -> formatXml(normalized)
        EditorLanguage.YAML -> formatYaml(normalized)
        EditorLanguage.CONF -> formatConf(normalized)
        else -> formatPlain(normalized)
    }
}

private fun formatJson(text: String): String {
    val element = prettyJson.parseToJsonElement(text.trim().ifBlank { error("空文件") })
    return prettyJson.encodeToString(JsonElement.serializer(), element).trimEnd() + "\n"
}

private fun formatXml(text: String): String {
    val factory = DocumentBuilderFactory.newInstance().apply {
        isExpandEntityReferences = false
        runCatching { setFeature("http://xml.org/sax/features/external-general-entities", false) }
        runCatching { setFeature("http://xml.org/sax/features/external-parameter-entities", false) }
        runCatching { setFeature("http://apache.org/xml/features/nonvalidating/load-external-dtd", false) }
    }
    val document = factory.newDocumentBuilder().parse(InputSource(StringReader(text)))
    document.xmlStandalone = true
    val transformer = TransformerFactory.newInstance().newTransformer().apply {
        setOutputProperty(OutputKeys.INDENT, "yes")
        setOutputProperty(OutputKeys.OMIT_XML_DECLARATION, "no")
        setOutputProperty("{http://xml.apache.org/xslt}indent-amount", "2")
    }
    val out = StringWriter()
    transformer.transform(DOMSource(document), StreamResult(out))
    return out.toString().trimEnd() + "\n"
}

private fun formatYaml(text: String): String {
    val lines = text.split('\n').map { raw ->
        val noTrail = raw.trimEnd()
        val indent = noTrail.takeWhile { it == ' ' || it == '\t' }.replace("\t", "  ")
        var rest = noTrail.dropWhile { it == ' ' || it == '\t' }
        if (rest.startsWith("#") || rest.isEmpty()) return@map indent + rest
        if (rest.startsWith("-") && rest.length > 1 && rest[1] != ' ' && rest[1] != '-') {
            rest = "- " + rest.substring(1)
        }
        rest = rest.replace(Regex("""^([A-Za-z0-9_./-]+):\s+"""), "$1: ")
        indent + rest
    }
    return trimExtraBlank(lines) + "\n"
}

private fun formatConf(text: String): String {
    val braces = text.count { it == '{' }
    val semis = text.count { it == ';' }
    val sections = Regex("""^\s*\[""", RegexOption.MULTILINE).findAll(text).count()
    return if (braces >= 1 && semis >= 2 && braces + semis > sections * 2) {
        formatBraces(text, 4)
    } else {
        formatIni(text)
    }
}

private fun formatIni(text: String): String {
    val out = StringBuilder()
    var pendingBlank = false
    for (raw in text.split('\n')) {
        val trimmed = raw.trimEnd().trimStart()
        when {
            trimmed.isEmpty() -> pendingBlank = true
            trimmed.startsWith("#") || trimmed.startsWith(";") -> {
                flushBlank(out, pendingBlank)
                pendingBlank = false
                out.append(trimmed).append('\n')
            }
            trimmed.startsWith("[") && trimmed.endsWith("]") -> {
                if (out.isNotEmpty()) out.append('\n')
                pendingBlank = false
                out.append(trimmed).append('\n')
            }
            else -> {
                flushBlank(out, pendingBlank)
                pendingBlank = false
                val eq = trimmed.indexOf('=')
                if (eq > 0) {
                    val key = trimmed.substring(0, eq).trim()
                    val value = trimmed.substring(eq + 1).trim()
                    out.append(key).append(" = ").append(value).append('\n')
                } else {
                    out.append(trimmed).append('\n')
                }
            }
        }
    }
    return out.toString().trimEnd() + "\n"
}

private fun formatBraces(text: String, indentSize: Int): String {
    val out = StringBuilder()
    var indent = 0
    for (raw in text.split('\n')) {
        var line = raw.trimEnd().trimStart()
        if (line.isEmpty()) {
            out.append('\n')
            continue
        }
        val comment = line.startsWith("#") || line.startsWith(";")
        if (!comment) {
            var closes = 0
            var opens = 0
            var i = 0
            while (i < line.length && (line[i] == '}' || line[i].isWhitespace())) {
                if (line[i] == '}') closes++
                i++
            }
            indent = (indent - closes).coerceAtLeast(0)
            if (line.endsWith("{")) opens = 1
            out.append(" ".repeat(indent * indentSize)).append(line).append('\n')
            indent += opens
        } else {
            out.append(" ".repeat(indent * indentSize)).append(line).append('\n')
        }
    }
    return out.toString().trimEnd() + "\n"
}

private fun formatPlain(text: String): String {
    val lines = text.split('\n').map { it.replace("\t", "  ").trimEnd() }
    return trimExtraBlank(lines) + "\n"
}

private fun trimExtraBlank(lines: List<String>): String {
    val out = ArrayList<String>(lines.size)
    var blank = 0
    for (line in lines) {
        if (line.isEmpty()) {
            blank++
            if (blank <= 1 && out.isNotEmpty()) out += ""
        } else {
            blank = 0
            out += line
        }
    }
    return out.joinToString("\n").trimEnd()
}

private fun flushBlank(out: StringBuilder, pending: Boolean) {
    if (pending && out.isNotEmpty() && !out.endsWith("\n\n")) out.append('\n')
}
