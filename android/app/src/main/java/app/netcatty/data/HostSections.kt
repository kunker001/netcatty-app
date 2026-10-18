package app.netcatty.data

data class HostSection(
    val key: String,
    val title: String,
    val hosts: List<Host>,
)

fun hostSections(hosts: List<Host>): List<HostSection> {
    val buckets = LinkedHashMap<String, MutableList<Host>>()
    hosts.forEach { host ->
        val key = host.group.trim()
        buckets.getOrPut(key) { mutableListOf() }.add(host)
    }
    val named = buckets.keys.filter { it.isNotEmpty() }.sortedWith(String.CASE_INSENSITIVE_ORDER)
    return buildList {
        named.forEach { key ->
            add(HostSection(key, key, buckets.getValue(key).sortedByTitle()))
        }
        val ungrouped = buckets[""]
        if (!ungrouped.isNullOrEmpty()) {
            add(HostSection("", "未分组", ungrouped.sortedByTitle()))
        }
    }
}

/** A single empty-group bucket stays a flat list. Named groups get headers. */
fun hostSectionsNeedHeaders(sections: List<HostSection>): Boolean =
    sections.any { it.key.isNotEmpty() }

private fun List<Host>.sortedByTitle(): List<Host> =
    sortedBy { it.title.lowercase() }
