package com.zentarnetwork.bridge;

import com.google.gson.JsonObject;
import com.google.gson.JsonParser;

import javax.crypto.Mac;
import javax.crypto.spec.SecretKeySpec;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.Iterator;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;

/**
 * Bot ile aynı protokol: { "p": "<JSON metni>", "s": "<hex HMAC-SHA256>" }.
 * İmza, ayrıştırmadan önce "p" metni üzerinde doğrulanır.
 */
public final class Protocol {
    public static final long MAX_SKEW_MS = 60_000;

    private Protocol() {}

    public static final class Message {
        public final String id;
        public final String type;
        public final String re;
        public final JsonObject data;

        Message(String id, String type, String re, JsonObject data) {
            this.id = id;
            this.type = type;
            this.re = re;
            this.data = data;
        }
    }

    public static final class Encoded {
        public final String id;
        public final String text;

        Encoded(String id, String text) {
            this.id = id;
            this.text = text;
        }
    }

    /** Görülmüş mesaj kimlikleri (tekrar saldırısı koruması). */
    public static final class ReplayCache {
        private final Map<String, Long> seen = new ConcurrentHashMap<>();

        /** Daha önce görüldüyse true. */
        public boolean check(String id, long now) {
            if (seen.size() > 2000) {
                for (Iterator<Map.Entry<String, Long>> it = seen.entrySet().iterator(); it.hasNext(); ) {
                    if (it.next().getValue() <= now) it.remove();
                }
            }
            return seen.putIfAbsent(id, now + MAX_SKEW_MS * 2) != null;
        }
    }

    static String sign(String secret, String text) {
        try {
            Mac mac = Mac.getInstance("HmacSHA256");
            mac.init(new SecretKeySpec(secret.getBytes(StandardCharsets.UTF_8), "HmacSHA256"));
            byte[] raw = mac.doFinal(text.getBytes(StandardCharsets.UTF_8));
            StringBuilder sb = new StringBuilder(raw.length * 2);
            for (byte b : raw) sb.append(String.format("%02x", b));
            return sb.toString();
        } catch (Exception e) {
            throw new IllegalStateException("HMAC hesaplanamadı", e);
        }
    }

    public static Encoded encode(String secret, String type, JsonObject data, String re) {
        String id = UUID.randomUUID().toString();
        JsonObject payload = new JsonObject();
        payload.addProperty("id", id);
        payload.addProperty("ts", System.currentTimeMillis());
        payload.addProperty("from", "plugin");
        payload.addProperty("type", type);
        if (re != null) payload.addProperty("re", re);
        payload.add("data", data == null ? new JsonObject() : data);
        String p = payload.toString();
        JsonObject env = new JsonObject();
        env.addProperty("p", p);
        env.addProperty("s", sign(secret, p));
        return new Encoded(id, env.toString());
    }

    /** Geçerliyse mesajı, değilse null döner (sebep çağırana log için verilmez; sessizce reddedilir). */
    public static Message decode(String secret, String raw, ReplayCache replay) {
        try {
            JsonObject env = JsonParser.parseString(raw).getAsJsonObject();
            String p = env.get("p").getAsString();
            String given = env.get("s").getAsString();
            byte[] expected = sign(secret, p).getBytes(StandardCharsets.UTF_8);
            if (!MessageDigest.isEqual(expected, given.toLowerCase().getBytes(StandardCharsets.UTF_8))) return null;

            JsonObject msg = JsonParser.parseString(p).getAsJsonObject();
            if (!"bot".equals(msg.get("from").getAsString())) return null; // yön bağlama
            long now = System.currentTimeMillis();
            if (Math.abs(now - msg.get("ts").getAsLong()) > MAX_SKEW_MS) return null;
            String id = msg.get("id").getAsString();
            if (replay.check(id, now)) return null;
            JsonObject data = msg.has("data") && msg.get("data").isJsonObject() ? msg.getAsJsonObject("data") : new JsonObject();
            String re = msg.has("re") ? msg.get("re").getAsString() : null;
            return new Message(id, msg.get("type").getAsString(), re, data);
        } catch (Exception e) {
            return null;
        }
    }
}
