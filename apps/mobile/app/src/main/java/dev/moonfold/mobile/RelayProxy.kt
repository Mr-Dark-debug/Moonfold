package dev.moonfold.mobile

import java.io.IOException
import java.net.InetAddress
import java.net.ServerSocket
import java.net.Socket
import java.util.Collections
import java.util.concurrent.TimeUnit
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.Response
import okhttp3.WebSocket
import okhttp3.WebSocketListener
import okio.ByteString
import okio.ByteString.Companion.toByteString

/** Bytes one stream may queue towards the relay before reading from the web view pauses. */
private const val HIGH_WATER_BYTES = 4L * 1024 * 1024

/**
 * Reach from anywhere (D-69): a listener on this phone's loopback at the computer's own port.
 * Each connection becomes one relay stream to the computer, so `https://127.0.0.1:<port>` is just
 * another address of the paired computer: the same pinned certificate, the same session cookie.
 * The relay only ever sees the TLS bytes the web view sends.
 */
class RelayProxy(private val relay: Relay, private val port: Int) {
    private val client = OkHttpClient.Builder()
        .connectTimeout(10, TimeUnit.SECONDS)
        .readTimeout(0, TimeUnit.MILLISECONDS)
        .pingInterval(20, TimeUnit.SECONDS)
        .build()
    private val open = Collections.synchronizedSet(mutableSetOf<Socket>())
    @Volatile private var server: ServerSocket? = null

    val running: Boolean get() = server?.isClosed == false

    fun matches(other: Relay, otherPort: Int) = relay == other && port == otherPort

    /** False when the port is taken on this phone; the relay path is then unavailable. */
    fun start(): Boolean {
        if (running) return true
        val listening = try {
            ServerSocket(port, 16, InetAddress.getByName("127.0.0.1"))
        } catch (_: IOException) {
            return false
        }
        server = listening
        Thread({
            while (!listening.isClosed) {
                val socket = try {
                    listening.accept()
                } catch (_: IOException) {
                    break
                }
                open.add(socket)
                connect(socket)
            }
        }, "moonfold-relay-accept").apply { isDaemon = true }.start()
        return true
    }

    fun stop() {
        server?.close()
        server = null
        synchronized(open) {
            open.forEach { runCatching { it.close() } }
            open.clear()
        }
    }

    private fun connect(socket: Socket) {
        val request = Request.Builder().url("${relay.url}/v1/connect/${relay.room}").build()
        val output = socket.getOutputStream()
        val closeSocket: () -> Unit = {
            runCatching { socket.close() }
            open.remove(socket)
        }
        client.newWebSocket(request, object : WebSocketListener() {
            override fun onOpen(webSocket: WebSocket, response: Response) {
                Thread({ pump(socket, webSocket) }, "moonfold-relay-stream").apply {
                    isDaemon = true
                }.start()
            }

            override fun onMessage(webSocket: WebSocket, bytes: ByteString) {
                try {
                    synchronized(output) {
                        output.write(bytes.toByteArray())
                        output.flush()
                    }
                } catch (_: IOException) {
                    webSocket.cancel()
                    closeSocket()
                }
            }

            override fun onClosing(webSocket: WebSocket, code: Int, reason: String) {
                webSocket.close(1000, null)
                closeSocket()
            }

            override fun onClosed(webSocket: WebSocket, code: Int, reason: String) {
                closeSocket()
            }

            override fun onFailure(webSocket: WebSocket, t: Throwable, response: Response?) {
                closeSocket()
            }
        })
    }

    /** Web view to relay. Reads wait while the relay is behind, instead of queueing without end. */
    private fun pump(socket: Socket, webSocket: WebSocket) {
        val buffer = ByteArray(32 * 1024)
        try {
            val input = socket.getInputStream()
            while (true) {
                val read = input.read(buffer)
                if (read < 0) break
                while (webSocket.queueSize() > HIGH_WATER_BYTES) Thread.sleep(10)
                if (!webSocket.send(buffer.toByteString(0, read))) break
            }
        } catch (_: IOException) {
        } catch (_: InterruptedException) {
        }
        webSocket.close(1000, null)
        runCatching { socket.close() }
        open.remove(socket)
    }
}
