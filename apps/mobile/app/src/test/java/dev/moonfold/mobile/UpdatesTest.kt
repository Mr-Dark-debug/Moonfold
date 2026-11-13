package dev.moonfold.mobile

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class UpdatesTest {
    private val digest = "sha256:" + "a".repeat(64)

    private fun apk(version: String, digest: String? = this.digest) =
        ReleaseAsset("Moonfold-Android-$version.apk", "https://example.test/$version.apk", digest, 10)

    @Test
    fun versionsFollowSemverPrecedence() {
        val ordered = listOf("0.1.0", "0.2.0-beta.1", "0.2.0-beta.2", "0.2.0-beta.10", "0.2.0", "0.10.0")
        ordered.zipWithNext().forEach { (lower, higher) ->
            assertTrue("$lower < $higher", compareVersions(lower, higher) < 0)
            assertTrue("$higher > $lower", compareVersions(higher, lower) > 0)
        }
        assertEquals(0, compareVersions("0.2.0-beta.1", "0.2.0-beta.1"))
    }

    @Test
    fun picksTheNewestBuildAcrossReleases() {
        val releases = listOf(
            ReleaseInfo(false, listOf(ReleaseAsset("Moonfold-1.0.0-x64.exe", "x", digest, 1))),
            ReleaseInfo(false, listOf(apk("0.3.0-beta.1"))),
            ReleaseInfo(false, listOf(apk("0.2.0-beta.1"))),
        )
        assertEquals("0.3.0-beta.1", pickUpdate(releases, "0.2.0-beta.1")?.version)
        assertEquals("a".repeat(64), pickUpdate(releases, "0.2.0-beta.1")?.sha256)
        assertNull(pickUpdate(releases, "0.3.0-beta.1"))
    }

    @Test
    fun skipsDraftsAndBuildsWithoutADigest() {
        val releases = listOf(
            ReleaseInfo(true, listOf(apk("0.4.0"))),
            ReleaseInfo(false, listOf(apk("0.3.0", digest = null))),
            ReleaseInfo(false, listOf(apk("0.3.0", digest = "md5:abc"))),
        )
        assertNull(pickUpdate(releases, "0.2.0-beta.1"))
    }
}
