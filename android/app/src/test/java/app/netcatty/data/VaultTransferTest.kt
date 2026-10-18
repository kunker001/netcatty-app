package app.netcatty.data

import app.netcatty.ai.AiSettings
import app.netcatty.ai.PermissionMode
import app.netcatty.ai.WebSearchConfig
import app.netcatty.data.AuthMethod
import app.netcatty.data.TunnelKind
import java.io.ByteArrayInputStream
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertThrows
import org.junit.Assert.assertTrue
import org.junit.Test

class VaultTransferTest {
    @Test
    fun roundTripKeepsHostsConnectionsAndTunnels() {
        val payload = samplePayload()
        val encrypted = VaultTransfer.encrypt(payload, "secret-pass")
        val opened = VaultTransfer.decrypt(encrypted, "secret-pass")
        assertEquals(payload.hosts, opened.hosts)
        assertEquals(payload.connections, opened.connections)
        assertEquals(payload.tunnels, opened.tunnels)
        assertEquals(null, opened.agent)
        assertTrue(encrypted.toString(Charsets.UTF_8).contains("\"app\":\"netcatty\""))
        assertTrue(!encrypted.toString(Charsets.UTF_8).contains("root-secret"))
        assertTrue(!encrypted.toString(Charsets.UTF_8).contains("10.0.0.8"))
    }

    @Test
    fun agentConfigRoundTripsAndStaysOutOfTheEnvelope() {
        val agent = AiSettings(
            providerId = "deepseek",
            baseUrl = " https://api.deepseek.com/v1 ",
            model = " deepseek-chat ",
            apiKey = "sk-test-secret",
            permissionMode = PermissionMode.AUTO,
            timeoutSeconds = 0,
            responseIdleTimeoutSeconds = 90_000,
            maxIterations = 500,
            commandBlocklist = listOf(" rm -rf ", "", "rm -rf"),
            webSearch = WebSearchConfig(enabled = true, providerId = "exa", apiKey = " search-secret ", maxResults = 99),
        )
        val opened = VaultTransfer.decrypt(VaultTransfer.encrypt(VaultPayload(agent = agent), "secret-pass"), "secret-pass")
        val saved = opened.agent ?: error("missing agent")
        assertEquals("deepseek", saved.providerId)
        assertEquals("https://api.deepseek.com/v1", saved.baseUrl)
        assertEquals("deepseek-chat", saved.model)
        assertEquals("sk-test-secret", saved.apiKey)
        assertEquals("sk-test-secret", saved.profiles.single().apiKey)
        assertEquals(saved.profiles.single().id, saved.activeProfileId)
        assertEquals(PermissionMode.AUTO, saved.permissionMode)
        assertEquals(1, saved.timeoutSeconds)
        assertEquals(86_400, saved.responseIdleTimeoutSeconds)
        assertEquals(100, saved.maxIterations)
        assertEquals(listOf("rm -rf"), saved.commandBlocklist)
        assertEquals(true, saved.webSearch.enabled)
        assertEquals("search-secret", saved.webSearch.apiKey)
        assertEquals(20, saved.webSearch.maxResults)
        val envelope = VaultTransfer.encrypt(VaultPayload(agent = agent), "secret-pass").toString(Charsets.UTF_8)
        assertTrue(!envelope.contains("sk-test-secret"))
        assertTrue(!envelope.contains("search-secret"))
    }

    @Test
    fun wrongPasswordAndTamperFailClosed() {
        val encrypted = VaultTransfer.encrypt(samplePayload(), "secret-pass")
        assertThrows(VaultTransferException::class.java) {
            VaultTransfer.decrypt(encrypted, "other-pass")
        }
        val tampered = encrypted.copyOf()
        tampered[tampered.lastIndex] = (tampered[tampered.lastIndex] + 1).toByte()
        assertThrows(VaultTransferException::class.java) {
            VaultTransfer.decrypt(tampered, "secret-pass")
        }
    }

    @Test
    fun sanitizeDropsOrphansAndBlankHosts() {
        val clean = VaultTransfer.sanitize(
            VaultPayload(
                hosts = listOf(
                    Host(id = "h1", label = " web ", hostname = " 10.0.0.1 ", group = " prod "),
                    Host(id = "", label = "skip", hostname = "10.0.0.2"),
                    Host(id = "h1", label = "web2", hostname = "10.0.0.3", group = "prod"),
                ),
                connections = listOf(
                    SshConnection(id = "c1", hostId = "missing", username = "root", password = "x"),
                    SshConnection(id = "c2", hostId = "h1", username = " root ", port = 0, password = "pw"),
                ),
                tunnels = listOf(
                    TunnelRule(id = "t1", connectionId = "c2", listenPort = 8080, targetPort = 80),
                    TunnelRule(id = "t2", connectionId = "c1", listenPort = 1, targetPort = 1),
                ),
            ),
        )
        assertEquals(listOf("h1"), clean.hosts.map { it.id })
        assertEquals("web2", clean.hosts.single().label)
        assertEquals("10.0.0.3", clean.hosts.single().hostname)
        assertEquals("prod", clean.hosts.single().group)
        assertEquals(listOf("c2"), clean.connections.map { it.id })
        assertEquals(22, clean.connections.single().port)
        assertEquals("root", clean.connections.single().username)
        assertEquals(listOf("t1"), clean.tunnels.map { it.id })
    }

    @Test
    fun mergeUpdatesSameIdAndKeepsLocalOnlyEntries() {
        val localHost = Host(id = "local", label = "local", hostname = "10.0.0.2", group = "lab")
        val shared = Host(id = "shared", label = "old", hostname = "10.0.0.1")
        val incoming = VaultTransfer.sanitize(
            VaultPayload(
                hosts = listOf(Host(id = "shared", label = "new", hostname = "10.0.0.9", group = "prod")),
                connections = listOf(
                    SshConnection(id = "c-new", hostId = "shared", username = "ubuntu", password = "pw"),
                ),
            ),
        )
        val (hosts, connections) = VaultTransfer.merge(
            hosts = listOf(localHost, shared),
            connections = listOf(SshConnection(id = "c-local", hostId = "local", username = "root")),
            incoming = incoming,
        )
        assertEquals(setOf("local", "shared"), hosts.map { it.id }.toSet())
        assertEquals("new", hosts.first { it.id == "shared" }.label)
        assertEquals(setOf("c-local", "c-new"), connections.map { it.id }.toSet())
    }

    @Test
    fun sectionsPutNamedGroupsFirstAndLeaveUngroupedFlat() {
        val hosts = listOf(
            Host(id = "1", label = "b", hostname = "b.example", group = "zeta"),
            Host(id = "2", label = "a", hostname = "a.example", group = "  "),
            Host(id = "3", label = "c", hostname = "c.example", group = "Alpha"),
            Host(id = "4", label = "d", hostname = "d.example", group = "alpha"),
        )
        val sections = hostSections(hosts)
        assertEquals("", sections.last().key)
        assertEquals("未分组", sections.last().title)
        assertEquals(setOf("Alpha", "alpha", "zeta", ""), sections.map { it.key }.toSet())
        val named = sections.dropLast(1).map { it.key }
        for (index in 0 until named.lastIndex) {
            assertTrue(String.CASE_INSENSITIVE_ORDER.compare(named[index], named[index + 1]) <= 0)
        }
        assertEquals(listOf("3"), sections.first { it.key == "Alpha" }.hosts.map { it.id })
        assertEquals(listOf("4"), sections.first { it.key == "alpha" }.hosts.map { it.id })
        assertEquals(listOf("2"), sections.last().hosts.map { it.id })
        assertTrue(hostSectionsNeedHeaders(sections))
        val flat = hostSections(listOf(Host(id = "2", label = "a", hostname = "a.example")))
        assertEquals(false, hostSectionsNeedHeaders(flat))
    }

    @Test
    fun oversizedReadFails() {
        val input = ByteArrayInputStream(ByteArray(32))
        assertThrows(VaultTransferException::class.java) {
            readBackupBytes(input, max = 8)
        }
    }

    @Test
    fun ciphertextChangesBetweenExports() {
        val payload = samplePayload()
        val first = VaultTransfer.encrypt(payload, "secret-pass")
        val second = VaultTransfer.encrypt(payload, "secret-pass")
        assertNotEquals(first.toList(), second.toList())
    }

    private fun samplePayload(): VaultPayload = VaultPayload(
        hosts = listOf(
            Host(id = "h1", label = "web", hostname = "10.0.0.8", group = "prod", notes = "edge"),
        ),
        connections = listOf(
            SshConnection(
                id = "c1",
                hostId = "h1",
                username = "root",
                authMethod = AuthMethod.PASSWORD,
                password = "root-secret",
                port = 22,
            ),
        ),
        tunnels = listOf(
            TunnelRule(
                id = "t1",
                connectionId = "c1",
                kind = TunnelKind.LOCAL,
                listenPort = 8080,
                targetHost = "127.0.0.1",
                targetPort = 80,
            ),
        ),
    )
}
