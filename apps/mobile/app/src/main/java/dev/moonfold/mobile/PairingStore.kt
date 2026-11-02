package dev.moonfold.mobile

import android.content.Context
import androidx.core.content.edit

/** The paired computer. Holds no secret: the session lives in the web view's cookie store. */
class PairingStore(context: Context) {
    private val prefs = context.getSharedPreferences("pairing", Context.MODE_PRIVATE)

    var host: PairedHost?
        get() {
            val addresses = prefs.getString(ADDRESSES, null)?.split(',') ?: return null
            val sha256 = prefs.getString(SHA256, null) ?: return null
            return PairedHost(addresses, prefs.getInt(PORT, 0), sha256, prefs.getString(NAME, "").orEmpty())
        }
        set(value) = prefs.edit {
            if (value == null) {
                clear()
            } else {
                putString(ADDRESSES, value.addresses.joinToString(","))
                putInt(PORT, value.port)
                putString(SHA256, value.sha256)
                putString(NAME, value.name)
            }
        }

    /** The address that answered last, tried first next time. */
    var lastAddress: String?
        get() = prefs.getString(LAST_ADDRESS, null)
        set(value) = prefs.edit { putString(LAST_ADDRESS, value) }

    private companion object {
        const val ADDRESSES = "addresses"
        const val PORT = "port"
        const val SHA256 = "sha256"
        const val NAME = "name"
        const val LAST_ADDRESS = "lastAddress"
    }
}
