package dev.moonfold.mobile

import com.google.zxing.BarcodeFormat
import com.google.zxing.BinaryBitmap
import com.google.zxing.EncodeHintType
import com.google.zxing.RGBLuminanceSource
import com.google.zxing.common.HybridBinarizer
import com.google.zxing.qrcode.QRCodeReader
import com.google.zxing.qrcode.QRCodeWriter
import com.google.zxing.qrcode.decoder.ErrorCorrectionLevel
import java.security.cert.CertificateException
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Test

class PairingTest {
    private val sha256 = "ab".repeat(32)
    private val code =
        "moonfold://mobile-pair?v=1&hosts=192.168.1.5%2C100.64.0.2&port=13774&sha256=$sha256" +
            "&token=one-time&name=Pat%27s+laptop"

    @Test
    fun `reads what the desktop settings page writes`() {
        val parsed = parsePairingCode(code)
        assertNotNull(parsed)
        assertEquals(listOf("192.168.1.5", "100.64.0.2"), parsed!!.host.addresses)
        assertEquals(13774, parsed.host.port)
        assertEquals(sha256, parsed.host.sha256)
        assertEquals("one-time", parsed.token)
        assertEquals("Pat's laptop", parsed.host.name)
    }

    @Test
    fun `a full pairing code survives the QR symbol the desktop draws`() {
        val longest = code.replace("one-time", "t".repeat(64)).replace("192.168.1.5", "192.168.100.200")
        val matrix = QRCodeWriter().encode(
            longest,
            BarcodeFormat.QR_CODE,
            440,
            440,
            mapOf(EncodeHintType.ERROR_CORRECTION to ErrorCorrectionLevel.M, EncodeHintType.MARGIN to 2),
        )
        val pixels = IntArray(matrix.width * matrix.height) { index ->
            if (matrix.get(index % matrix.width, index / matrix.width)) 0xFF000000.toInt() else -1
        }
        val source = RGBLuminanceSource(matrix.width, matrix.height, pixels)
        val text = QRCodeReader().decode(BinaryBitmap(HybridBinarizer(source))).text
        assertEquals(longest, text)
        assertNotNull(parsePairingCode(text))
    }

    @Test
    fun `refuses anything incomplete or from another version`() {
        assertNull(parsePairingCode("https://example.com/?v=1"))
        assertNull(parsePairingCode(code.replace("v=1", "v=2")))
        assertNull(parsePairingCode(code.replace("sha256=$sha256", "sha256=abc")))
        assertNull(parsePairingCode(code.replace("port=13774", "port=99999")))
        assertNull(parsePairingCode(code.replace("&token=one-time", "")))
    }

    @Test
    fun `an address cannot smuggle in a path or a user`() {
        assertNull(parsePairingCode(code.replace("192.168.1.5%2C100.64.0.2", "evil.test%2Fx%40y")))
    }

    @Test
    fun `a session cookie comes with its lifetime`() {
        val cookie = parseSessionCookie(
            "moonfold_session=abc.def; Expires=Thu, 02 Nov 2028 00:00:00 GMT; Path=/; HttpOnly; Secure",
            nowMillis = 1_793_836_800_000,
        )
        assertEquals("moonfold_session", cookie?.name)
        assertEquals("abc.def", cookie?.value)
        assertEquals(true, (cookie?.maxAgeSeconds ?: 0) > 0)
    }

    @Test
    fun `a cleared cookie is not a session`() {
        assertNull(parseSessionCookie("moonfold_session=; Max-Age=0; Path=/"))
        assertNull(parseSessionCookie("moonfold_session=x; Max-Age=0; Path=/"))
        assertNull(parseSessionCookie("moonfold_session=x; Path=/"))
    }

    @Test(expected = CertificateException::class)
    fun `an empty chain is refused`() {
        PinnedTrustManager(sha256).checkServerTrusted(emptyArray(), "ECDHE_ECDSA")
    }

    @Test
    fun `fingerprints match the form the host publishes`() {
        assertEquals(
            "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
            certificateSha256("abc".toByteArray()),
        )
    }
    @Test
    fun `reads a relay and room, and adds this phone's loopback as an address`() {
        val room = "R".repeat(43)
        val parsed = parsePairingCode(
            "moonfold://mobile-pair?v=1&hosts=&port=13774&sha256=$sha256&token=t" +
                "&relay=wss%3A%2F%2Frelay.example.dev%2F&room=$room",
        )
        assertNotNull(parsed)
        assertEquals(Relay("wss://relay.example.dev", room), parsed!!.host.relay)
        assertEquals(emptyList<String>(), parsed.host.addresses)
        assertEquals(listOf(LOOPBACK), parsed.host.reachableAddresses)
        assertEquals("https://127.0.0.1:13774", parsed.host.origin(LOOPBACK))
    }

    @Test
    fun `ignores a relay it cannot use, and needs an address without one`() {
        val base = "moonfold://mobile-pair?v=1&port=13774&sha256=$sha256&token=t"
        val room = "R".repeat(43)
        // An http relay, a short room or credentials in the address are not a relay.
        assertNull(parsePairingCode("$base&hosts=&relay=https%3A%2F%2Fx.dev&room=$room"))
        assertNull(parsePairingCode("$base&hosts=&relay=wss%3A%2F%2Fx.dev&room=short"))
        assertNull(parsePairingCode("$base&hosts=&relay=wss%3A%2F%2Fu%40x.dev&room=$room"))
        // A local address still pairs, without the relay.
        val local = parsePairingCode("$base&hosts=10.0.0.2&relay=https%3A%2F%2Fx.dev&room=$room")
        assertNull(local!!.host.relay)
        assertEquals(listOf("10.0.0.2"), local.host.reachableAddresses)
    }
}
