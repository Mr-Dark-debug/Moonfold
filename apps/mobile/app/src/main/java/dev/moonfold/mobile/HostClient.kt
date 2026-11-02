package dev.moonfold.mobile

import java.io.IOException
import java.net.HttpURLConnection
import java.net.URL
import java.security.MessageDigest
import java.security.SecureRandom
import java.security.cert.CertificateException
import java.security.cert.X509Certificate
import javax.net.ssl.HttpsURLConnection
import javax.net.ssl.SSLContext
import javax.net.ssl.SSLSocketFactory
import javax.net.ssl.X509TrustManager
import org.json.JSONObject

private const val CONNECT_TIMEOUT_MS = 2_500
private const val READ_TIMEOUT_MS = 5_000

/** Lowercase hex SHA-256, the form the QR code carries. */
fun certificateSha256(der: ByteArray): String =
    MessageDigest.getInstance("SHA-256").digest(der).joinToString("") { "%02x".format(it) }

/** Trusts one certificate and nothing else, whoever signed it. */
class PinnedTrustManager(private val sha256: String) : X509TrustManager {
    override fun checkServerTrusted(chain: Array<out X509Certificate>?, authType: String?) {
        val leaf = chain?.firstOrNull() ?: throw CertificateException("No certificate")
        if (certificateSha256(leaf.encoded) != sha256) {
            throw CertificateException("Not the paired computer")
        }
    }

    override fun checkClientTrusted(chain: Array<out X509Certificate>?, authType: String?) {
        throw CertificateException("Client certificates are not used")
    }

    override fun getAcceptedIssuers(): Array<X509Certificate> = emptyArray()
}

sealed interface HostState {
    data class Signed(val origin: String) : HostState
    data object Revoked : HostState
    data object Unreachable : HostState
}

sealed interface Exchange {
    data class Session(val origin: String, val cookie: SessionCookie) : Exchange
    data object CodeRejected : Exchange
    data object Unreachable : Exchange
}

data class SessionCookie(val name: String, val value: String, val maxAgeSeconds: Long)

/** Talks to the paired computer directly, over a connection pinned to its certificate. */
class HostClient(private val host: PairedHost) {
    private val sockets: SSLSocketFactory = SSLContext.getInstance("TLS").run {
        init(null, arrayOf(PinnedTrustManager(host.sha256)), SecureRandom())
        socketFactory
    }

    /** Whether the host answers on any address, and whether it still accepts this phone. */
    fun check(addresses: List<String>, cookieFor: (String) -> String?): HostState {
        for (address in addresses) {
            val origin = host.origin(address)
            val authenticated = runCatching {
                val connection = open("$origin/api/auth/session")
                cookieFor(origin)?.let { connection.setRequestProperty("Cookie", it) }
                try {
                    if (connection.responseCode != HttpURLConnection.HTTP_OK) return@runCatching null
                    JSONObject(connection.inputStream.bufferedReader().readText())
                        .optBoolean("authenticated", false)
                } finally {
                    connection.disconnect()
                }
            }.getOrNull() ?: continue
            return if (authenticated) HostState.Signed(origin) else HostState.Revoked
        }
        return HostState.Unreachable
    }

    /**
     * Spends the one-time token and returns the session the host issues for it. Sending the old
     * session along makes the host replace it, so scanning again leaves one entry in Connections.
     */
    fun exchange(token: String, cookieFor: (String) -> String?): Exchange {
        for (address in host.addresses) {
            val origin = host.origin(address)
            val connection = try {
                open("$origin/api/auth/browser-session").apply {
                    requestMethod = "POST"
                    doOutput = true
                    setRequestProperty("Content-Type", "application/json")
                    cookieFor(origin)?.let { setRequestProperty("Cookie", it) }
                    outputStream.use {
                        it.write(JSONObject().put("credential", token).toString().toByteArray())
                    }
                }
            } catch (_: IOException) {
                continue
            }
            try {
                val status = connection.responseCode
                if (status != HttpURLConnection.HTTP_OK) return Exchange.CodeRejected
                val cookie = connection.headerFields.entries
                    .filter { it.key.equals("Set-Cookie", ignoreCase = true) }
                    .flatMap { it.value }
                    .firstNotNullOfOrNull(::parseSessionCookie)
                return if (cookie == null) Exchange.CodeRejected else Exchange.Session(origin, cookie)
            } catch (_: IOException) {
                continue
            } finally {
                connection.disconnect()
            }
        }
        return Exchange.Unreachable
    }

    private fun open(url: String): HttpsURLConnection =
        (URL(url).openConnection() as HttpsURLConnection).apply {
            sslSocketFactory = sockets
            // The pin identifies the host, and a machine's address changes between networks.
            setHostnameVerifier { _, _ -> true }
            connectTimeout = CONNECT_TIMEOUT_MS
            readTimeout = READ_TIMEOUT_MS
            instanceFollowRedirects = false
            useCaches = false
            // The host's Connections list shows this as a phone.
            setRequestProperty("User-Agent", "MoonfoldMobile/${BuildConfig.VERSION_NAME} (Android; Mobile)")
        }
}

/** Reads a session Set-Cookie; a cleared cookie (empty or already expired) is not a session. */
fun parseSessionCookie(header: String, nowMillis: Long = System.currentTimeMillis()): SessionCookie? {
    val parts = header.split(';').map(String::trim)
    val pair = parts.first()
    val separator = pair.indexOf('=')
    if (separator <= 0 || separator == pair.lastIndex) return null
    val attribute = { name: String ->
        parts.drop(1).firstOrNull { it.startsWith("$name=", ignoreCase = true) }?.substringAfter('=')
    }
    val expires = attribute("Expires")?.let {
        runCatching { java.time.ZonedDateTime.parse(it, java.time.format.DateTimeFormatter.RFC_1123_DATE_TIME) }
            .getOrNull()
    }
    val maxAge = attribute("Max-Age")?.toLongOrNull()
        ?: expires?.let { (it.toInstant().toEpochMilli() - nowMillis) / 1000 }
        ?: return null
    if (maxAge <= 0) return null
    return SessionCookie(pair.substring(0, separator), pair.substring(separator + 1), maxAge)
}
