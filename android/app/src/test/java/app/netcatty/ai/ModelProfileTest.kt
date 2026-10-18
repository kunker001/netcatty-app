package app.netcatty.ai

import org.junit.Assert.assertEquals
import org.junit.Test

class ModelProfileTest {
    @Test
    fun legacyKeyBecomesTheFirstProfile() {
        val settings = AiSettings(
            providerId = "deepseek",
            baseUrl = "https://api.deepseek.com/v1",
            model = "deepseek-chat",
            apiKey = "sk-legacy",
        ).ensureProfiles()
        assertEquals("default", settings.activeProfileId)
        assertEquals("deepseek-chat", settings.model)
        assertEquals("sk-legacy", settings.profiles.single().apiKey)
        assertEquals("DeepSeek · deepseek-chat", settings.profiles.single().title())
    }

    @Test
    fun switchingProfileUpdatesTheActiveModel() {
        val first = ModelProfile(id = "a", providerId = "openai", baseUrl = "https://api.openai.com/v1", model = "gpt-4o-mini", apiKey = "sk-a")
        val second = ModelProfile(id = "b", providerId = "ollama", baseUrl = "http://127.0.0.1:11434/v1", model = "llama3.1", apiKey = "")
        val settings = AiSettings(profiles = listOf(first, second), activeProfileId = "a").ensureProfiles()
        val switched = settings.selectProfile("b")
        assertEquals("b", switched.activeProfileId)
        assertEquals("llama3.1", switched.model)
        assertEquals("ollama", switched.providerId)
        assertEquals("", switched.apiKey)
        assertEquals("sk-a", switched.profiles.first { it.id == "a" }.apiKey)
    }

    @Test
    fun removingTheActiveProfileSelectsAnother() {
        val settings = AiSettings(
            profiles = listOf(
                ModelProfile(id = "a", model = "one", apiKey = "k1"),
                ModelProfile(id = "b", model = "two", apiKey = "k2"),
            ),
            activeProfileId = "a",
        ).removeProfile("a")
        assertEquals("b", settings.activeProfileId)
        assertEquals("two", settings.model)
        assertEquals("k2", settings.apiKey)
    }

    @Test
    fun removingTheLastProfileClearsTheActiveModel() {
        val settings = AiSettings(
            profiles = listOf(ModelProfile(id = "a", model = "one", apiKey = "k1")),
            activeProfileId = "a",
        ).removeProfile("a")
        assertEquals(emptyList<ModelProfile>(), settings.profiles)
        assertEquals("", settings.model)
        assertEquals("", settings.apiKey)
    }
}
