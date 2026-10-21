package com.zentarnetwork.bridge;

import com.google.gson.JsonObject;

import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.WebSocket;
import java.time.Duration;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.CompletionStage;
import java.util.concurrent.Executors;
import java.util.concurrent.ScheduledExecutorService;
import java.util.concurrent.TimeUnit;
import java.util.function.BiConsumer;
import java.util.logging.Logger;

/** Discord botuna giden imzalı WebSocket istemcisi; kopmada üstel gecikmeyle yeniden bağlanır. */
public final class BridgeClient {
    private final Logger log;
    private final String url;
    private final String secret;
    private final String serverName;
    private final String pluginVersion;
    private final String serverVersion;
    private final BiConsumer<Protocol.Message, BridgeClient> handler;

    private final Protocol.ReplayCache replay = new Protocol.ReplayCache();
    private final ScheduledExecutorService scheduler = Executors.newSingleThreadScheduledExecutor(r -> {
        Thread t = new Thread(r, "ZentarBridge-WS");
        t.setDaemon(true);
        return t;
    });

    private volatile WebSocket socket;
    private volatile boolean authed;
    private volatile boolean stopped;
    private volatile String helloId;
    private long backoffSeconds = 1;
    private CompletableFuture<?> sendChain = CompletableFuture.completedFuture(null);

    public BridgeClient(Logger log, String url, String secret, String serverName, String pluginVersion,
                        String serverVersion, BiConsumer<Protocol.Message, BridgeClient> handler) {
        this.log = log;
        this.url = url;
        this.secret = secret;
        this.serverName = serverName;
        this.pluginVersion = pluginVersion;
        this.serverVersion = serverVersion;
        this.handler = handler;
    }

    public boolean isReady() {
        return authed && socket != null && !socket.isOutputClosed();
    }

    public void start() {
        stopped = false;
        connect();
    }

    public void stop() {
        stopped = true;
        authed = false;
        WebSocket ws = socket;
        if (ws != null) ws.sendClose(WebSocket.NORMAL_CLOSURE, "plugin-disabled");
        scheduler.shutdownNow();
    }

    private void connect() {
        if (stopped) return;
        try {
            HttpClient.newHttpClient().newWebSocketBuilder()
                    .connectTimeout(Duration.ofSeconds(10))
                    .buildAsync(URI.create(url), new Listener())
                    .whenComplete((ws, err) -> {
                        if (err != null) {
                            log.warning("Bota bağlanılamadı (" + url + "): " + err.getClass().getSimpleName());
                            scheduleReconnect();
                        } else {
                            socket = ws;
                            sendHello();
                        }
                    });
        } catch (Exception e) {
            log.warning("Bağlantı başlatılamadı: " + e.getMessage());
            scheduleReconnect();
        }
    }

    private void scheduleReconnect() {
        if (stopped) return;
        authed = false;
        long wait = backoffSeconds;
        backoffSeconds = Math.min(30, backoffSeconds * 2);
        scheduler.schedule(this::connect, wait, TimeUnit.SECONDS);
    }

    private void sendHello() {
        JsonObject d = new JsonObject();
        d.addProperty("serverName", serverName);
        d.addProperty("pluginVersion", pluginVersion);
        d.addProperty("serverVersion", serverVersion);
        helloId = sendRaw("hello", d, null);
    }

    /** Doğrulanmış bağlantı varsa gönderir. */
    public void send(String type, JsonObject data, String re) {
        if (!isReady()) return;
        sendRaw(type, data, re);
    }

    private synchronized String sendRaw(String type, JsonObject data, String re) {
        WebSocket ws = socket;
        if (ws == null) return null;
        Protocol.Encoded enc = Protocol.encode(secret, type, data, re);
        // WebSocket.sendText eşzamanlı çağrılamaz; gönderimleri sıraya diz.
        sendChain = sendChain.handle((v, e) -> null).thenCompose(v -> ws.sendText(enc.text, true));
        return enc.id;
    }

    private final class Listener implements WebSocket.Listener {
        private final StringBuilder buffer = new StringBuilder();

        @Override
        public void onOpen(WebSocket ws) {
            ws.request(1);
        }

        @Override
        public CompletionStage<?> onText(WebSocket ws, CharSequence data, boolean last) {
            buffer.append(data);
            if (buffer.length() > 64 * 1024) {
                buffer.setLength(0);
                ws.sendClose(1009, "too-big");
                return null;
            }
            if (last) {
                String raw = buffer.toString();
                buffer.setLength(0);
                Protocol.Message msg = Protocol.decode(secret, raw, replay);
                if (msg == null) {
                    log.warning("Geçersiz/imzasız mesaj reddedildi.");
                } else if (!authed) {
                    if ("hello_ack".equals(msg.type) && msg.re != null && msg.re.equals(helloId)) {
                        authed = true;
                        backoffSeconds = 1;
                        log.info("Discord botuna bağlandı ve kimlik doğrulandı.");
                        handler.accept(msg, BridgeClient.this);
                    }
                } else {
                    try {
                        handler.accept(msg, BridgeClient.this);
                    } catch (Exception e) {
                        log.warning("Mesaj işlenemedi (" + msg.type + "): " + e.getMessage());
                    }
                }
            }
            ws.request(1);
            return null;
        }

        @Override
        public CompletionStage<?> onClose(WebSocket ws, int statusCode, String reason) {
            log.warning("Bot bağlantısı kapandı (" + statusCode + " " + reason + ").");
            socket = null;
            scheduleReconnect();
            return null;
        }

        @Override
        public void onError(WebSocket ws, Throwable error) {
            log.warning("WebSocket hatası: " + error.getClass().getSimpleName());
            socket = null;
            scheduleReconnect();
        }
    }
}
