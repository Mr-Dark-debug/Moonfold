package dev.moonfold.mobile

import java.net.URLDecoder

/** A relay that carries this phone's connection when it shares no network with the computer. */
data class Relay(val url: String, val room: String)

/** The computer this phone is paired with: where to find it and the only certificate to trust. */
data class PairedHost(
    val addresses: List<String>,
    val port: Int,
    val sha256: String,
    val name: String,
    val relay: Relay? = null,
) {
    fun origin(address: String) = "https://$address:$port"

    /** Its network addresses, then this phone's loopback, where [RelayProxy] listens. */
    val reachableAddresses: List<String>
        get() = if (relay == null) addresses else addresses + LOOPBACK
}

const val LOOPBACK = "127.0.0.1"

/** What a QR code says: the host, and a token that works once and for a few minutes. */
data class PairingCode(val host: PairedHost, val token: String)

private const val PREFIX = "moonfold://mobile-pair?"
private const val MAX_NAME_LENGTH = 60
private val ADDRESS = Regex("[A-Za-z0-9.-]{1,253}")
private val SHA256 = Regex("[0-9a-f]{64}")
private val ROOM = Regex("[A-Za-z0-9_-]{43}")
private val RELAY_URL = Regex("wss?://[^\\s?#@]{1,500}", RegexOption.IGNORE_CASE)

/** Null unless `raw` is a complete Moonfold pairing code. */
fun parsePairingCode(raw: String): PairingCode? {
    if (!raw.startsWith(PREFIX)) return null
    val query = raw.removePrefix(PREFIX)
        .split('&')
        .mapNotNull { part ->
            val separator = part.indexOf('=')
            if (separator <= 0) return@mapNotNull null
            val value = runCatching {
                URLDecoder.decode(part.substring(separator + 1), Charsets.UTF_8.name())
            }.getOrNull() ?: return@mapNotNull null
            part.substring(0, separator) to value
        }
        .toMap()

    if (query["v"] != "1") return null
    val addresses = query["hosts"].orEmpty().split(',').filter(ADDRESS::matches)
    val port = query["port"]?.toIntOrNull()?.takeIf { it in 1..65535 }
    val sha256 = query["sha256"]?.takeIf(SHA256::matches)
    val token = query["token"]?.takeIf(String::isNotBlank)
    val relay = query["relay"]?.trimEnd('/')?.takeIf(RELAY_URL::matches)?.let { url ->
        query["room"]?.takeIf(ROOM::matches)?.let { Relay(url, it) }
    }
    if ((addresses.isEmpty() && relay == null) || port == null || sha256 == null || token == null) {
        return null
    }

    val name = query["name"].orEmpty().trim().take(MAX_NAME_LENGTH).ifEmpty { "your computer" }
    return PairingCode(PairedHost(addresses, port, sha256, name, relay), token)
}
