package dev.moonfold.mobile

import android.app.PendingIntent
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.pm.PackageInfo
import android.content.pm.PackageInstaller
import android.content.pm.PackageManager
import android.os.Build
import android.widget.Toast
import androidx.core.content.edit
import java.io.File
import java.io.IOException
import java.security.MessageDigest
import java.util.concurrent.TimeUnit
import okhttp3.OkHttpClient
import okhttp3.Request
import org.json.JSONArray

/** The only place this app updates from (D-73): the project's own GitHub releases. */
private const val RELEASES_URL =
    "https://api.github.com/repos/Mr-Dark-debug/Moonfold/releases?per_page=20"
private val APK_NAME = Regex("""^Moonfold-Android-(\d+\.\d+\.\d+(?:-[0-9A-Za-z.]+)?)\.apk$""")
private val SHA256_DIGEST = Regex("""^sha256:([0-9a-f]{64})$""")
private const val CHECK_EVERY_MS = 20L * 60 * 60 * 1000

data class ReleaseAsset(val name: String, val url: String, val digest: String?, val size: Long)

data class ReleaseInfo(val draft: Boolean, val assets: List<ReleaseAsset>)

data class AvailableUpdate(val version: String, val url: String, val sha256: String, val size: Long)

/**
 * The newest Android build across the listed releases, if it is newer than [current]. An APK
 * without a SHA-256 digest from GitHub is ignored, since the download could not be checked.
 */
fun pickUpdate(releases: List<ReleaseInfo>, current: String): AvailableUpdate? =
    releases.asSequence()
        .filterNot { it.draft }
        .flatMap { it.assets.asSequence() }
        .mapNotNull { asset ->
            val version = APK_NAME.matchEntire(asset.name)?.groupValues?.get(1)
            val sha256 = asset.digest?.let { SHA256_DIGEST.matchEntire(it)?.groupValues?.get(1) }
            if (version == null || sha256 == null) null
            else AvailableUpdate(version, asset.url, sha256, asset.size)
        }
        .maxWithOrNull { a, b -> compareVersions(a.version, b.version) }
        ?.takeIf { compareVersions(it.version, current) > 0 }

/** Semantic-version precedence: `0.2.0-beta.1` < `0.2.0-beta.2` < `0.2.0` < `0.3.0-beta.1`. */
fun compareVersions(a: String, b: String): Int {
    val (coreA, preA) = splitVersion(a)
    val (coreB, preB) = splitVersion(b)
    for (i in 0 until maxOf(coreA.size, coreB.size)) {
        val diff = (coreA.getOrElse(i) { 0 }).compareTo(coreB.getOrElse(i) { 0 })
        if (diff != 0) return diff
    }
    if (preA.isEmpty() || preB.isEmpty()) return preB.size.compareTo(preA.size).coerceIn(-1, 1)
    for (i in 0 until minOf(preA.size, preB.size)) {
        val x = preA[i]
        val y = preB[i]
        val nx = x.toLongOrNull()
        val ny = y.toLongOrNull()
        val diff = when {
            nx != null && ny != null -> nx.compareTo(ny)
            nx != null -> -1
            ny != null -> 1
            else -> x.compareTo(y)
        }
        if (diff != 0) return diff
    }
    return preA.size.compareTo(preB.size)
}

private fun splitVersion(version: String): Pair<List<Int>, List<String>> {
    val core = version.substringBefore('-').substringBefore('+')
    val pre = if ('-' in version) version.substringAfter('-').substringBefore('+') else ""
    return core.split('.').map { it.toIntOrNull() ?: 0 } to
        (if (pre.isEmpty()) emptyList() else pre.split('.'))
}

sealed interface UpdateFailure {
    data object Network : UpdateFailure
    data object Corrupt : UpdateFailure
    data object WrongSigner : UpdateFailure
}

class UpdateException(val failure: UpdateFailure) : Exception()

/** Checks, downloads and hands an update to the system installer, which asks the owner first. */
class Updater(private val context: Context) {
    private val prefs = context.getSharedPreferences("updates", Context.MODE_PRIVATE)
    private val client = OkHttpClient.Builder()
        .connectTimeout(15, TimeUnit.SECONDS)
        .readTimeout(30, TimeUnit.SECONDS)
        .build()

    /** Automatic daily checks; the launcher shortcut checks and turns them back on. */
    var automatic: Boolean
        get() = prefs.getBoolean(AUTOMATIC, true)
        set(value) = prefs.edit { putBoolean(AUTOMATIC, value) }

    fun due(now: Long): Boolean = automatic && now - prefs.getLong(LAST_CHECK, 0) >= CHECK_EVERY_MS

    /** Blocking. Null means this is the newest build. */
    fun check(now: Long): AvailableUpdate? {
        val request = Request.Builder()
            .url(RELEASES_URL)
            .header("Accept", "application/vnd.github+json")
            .header("User-Agent", "MoonfoldMobile/${BuildConfig.VERSION_NAME}")
            .build()
        val body = try {
            client.newCall(request).execute().use { response ->
                if (!response.isSuccessful) throw UpdateException(UpdateFailure.Network)
                response.body?.string() ?: throw UpdateException(UpdateFailure.Network)
            }
        } catch (_: IOException) {
            throw UpdateException(UpdateFailure.Network)
        }
        val releases = runCatching { parseReleases(body) }
            .getOrElse { throw UpdateException(UpdateFailure.Network) }
        prefs.edit { putLong(LAST_CHECK, now) }
        return pickUpdate(releases, BuildConfig.VERSION_NAME)
    }

    /** Blocking. Returns an APK whose hash matches GitHub's digest and whose signer is ours. */
    fun download(update: AvailableUpdate, progress: (Long, Long) -> Unit): File {
        val dir = File(context.cacheDir, "updates").apply { deleteRecursively(); mkdirs() }
        val file = File(dir, "Moonfold-Android-${update.version}.apk")
        val digest = MessageDigest.getInstance("SHA-256")
        try {
            client.newCall(Request.Builder().url(update.url).build()).execute().use { response ->
                val body = response.body
                if (!response.isSuccessful || body == null) throw UpdateException(UpdateFailure.Network)
                val total = body.contentLength().takeIf { it > 0 } ?: update.size
                body.byteStream().use { input ->
                    file.outputStream().use { output ->
                        val buffer = ByteArray(64 * 1024)
                        var done = 0L
                        while (true) {
                            val read = input.read(buffer)
                            if (read < 0) break
                            output.write(buffer, 0, read)
                            digest.update(buffer, 0, read)
                            done += read
                            progress(done, total)
                        }
                    }
                }
            }
        } catch (_: IOException) {
            throw UpdateException(UpdateFailure.Network)
        }
        val hex = digest.digest().joinToString("") { "%02x".format(it) }
        if (hex != update.sha256) throw UpdateException(UpdateFailure.Corrupt)
        if (!signedLikeThisApp(file)) throw UpdateException(UpdateFailure.WrongSigner)
        return file
    }

    /** Opens a system install session; the system asks the owner before replacing the app. */
    fun install(apk: File) {
        val installer = context.packageManager.packageInstaller
        val params = PackageInstaller.SessionParams(PackageInstaller.SessionParams.MODE_FULL_INSTALL)
        params.setAppPackageName(context.packageName)
        val id = installer.createSession(params)
        installer.openSession(id).use { session ->
            apk.inputStream().use { input ->
                session.openWrite("base.apk", 0, apk.length()).use { output ->
                    input.copyTo(output)
                    session.fsync(output)
                }
            }
            val status = Intent(context, UpdateStatusReceiver::class.java)
            val flags = PendingIntent.FLAG_UPDATE_CURRENT or
                (if (Build.VERSION.SDK_INT >= 31) PendingIntent.FLAG_MUTABLE else 0)
            session.commit(PendingIntent.getBroadcast(context, id, status, flags).intentSender)
        }
    }

    private fun signedLikeThisApp(apk: File): Boolean {
        val pm = context.packageManager
        val ours = signers(pm.getPackageInfo(context.packageName, signingFlag()))
        val theirs = pm.getPackageArchiveInfo(apk.path, signingFlag())?.let(::signers).orEmpty()
        return ours.isNotEmpty() && ours == theirs
    }

    private fun signingFlag(): Int =
        if (Build.VERSION.SDK_INT >= 28) PackageManager.GET_SIGNING_CERTIFICATES
        else @Suppress("DEPRECATION") PackageManager.GET_SIGNATURES

    private fun signers(info: PackageInfo): Set<String> {
        val certificates = if (Build.VERSION.SDK_INT >= 28) {
            info.signingInfo?.apkContentsSigners
        } else {
            @Suppress("DEPRECATION") info.signatures
        }
        val sha = MessageDigest.getInstance("SHA-256")
        return certificates.orEmpty().map { cert ->
            sha.digest(cert.toByteArray()).joinToString("") { "%02x".format(it) }
        }.toSet()
    }

    private fun parseReleases(body: String): List<ReleaseInfo> {
        val array = JSONArray(body)
        return (0 until array.length()).map { i ->
            val release = array.getJSONObject(i)
            val assets = release.optJSONArray("assets") ?: JSONArray()
            ReleaseInfo(
                draft = release.optBoolean("draft", false),
                assets = (0 until assets.length()).map { j ->
                    val asset = assets.getJSONObject(j)
                    ReleaseAsset(
                        name = asset.optString("name"),
                        url = asset.optString("browser_download_url"),
                        digest = asset.optString("digest").takeIf { it.isNotEmpty() && it != "null" },
                        size = asset.optLong("size"),
                    )
                },
            )
        }
    }

    private companion object {
        const val AUTOMATIC = "automatic"
        const val LAST_CHECK = "lastCheck"
    }
}

/** Receives the install session's result; the system confirmation screen opens from here. */
class UpdateStatusReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        when (intent.getIntExtra(PackageInstaller.EXTRA_STATUS, PackageInstaller.STATUS_FAILURE)) {
            PackageInstaller.STATUS_PENDING_USER_ACTION -> {
                val confirm = if (Build.VERSION.SDK_INT >= 33) {
                    intent.getParcelableExtra(Intent.EXTRA_INTENT, Intent::class.java)
                } else {
                    @Suppress("DEPRECATION") intent.getParcelableExtra(Intent.EXTRA_INTENT)
                }
                confirm?.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)?.let(context::startActivity)
            }
            PackageInstaller.STATUS_SUCCESS -> Unit
            PackageInstaller.STATUS_FAILURE_ABORTED -> Unit
            else -> Toast.makeText(context, R.string.update_install_failed, Toast.LENGTH_LONG).show()
        }
    }
}
