package com.zentarnetwork.bridge;

import com.google.gson.JsonArray;
import com.google.gson.JsonObject;
import org.bukkit.Bukkit;
import org.bukkit.ChatColor;
import org.bukkit.OfflinePlayer;
import org.bukkit.Statistic;
import org.bukkit.command.Command;
import org.bukkit.command.CommandSender;
import org.bukkit.entity.Player;
import org.bukkit.event.EventHandler;
import org.bukkit.event.EventPriority;
import org.bukkit.event.Listener;
import org.bukkit.event.entity.PlayerDeathEvent;
import org.bukkit.event.player.AsyncPlayerChatEvent;
import org.bukkit.event.player.PlayerJoinEvent;
import org.bukkit.event.player.PlayerLoginEvent;
import org.bukkit.event.player.PlayerQuitEvent;
import org.bukkit.plugin.java.JavaPlugin;

import java.lang.reflect.Method;
import java.util.ArrayList;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;
import java.util.regex.Pattern;

public final class ZentarBridgePlugin extends JavaPlugin implements Listener {
    private static final Pattern CODE = Pattern.compile("^[A-Za-z0-9]{8}$");
    private static final Pattern CONTROL = Pattern.compile("[\\p{Cntrl}\\u200b-\\u200f\\u202a-\\u202e\\u2066-\\u2069]");

    private BridgeClient client;
    private volatile boolean maintenance;
    private int uniquePlayers;
    private long lastUniqueAt;
    private final Map<UUID, Long> verifyCooldown = new ConcurrentHashMap<>();

    @Override
    public void onEnable() {
        saveDefaultConfig();
        Bukkit.getPluginManager().registerEvents(this, this);
        startBridge();
        long period = Math.max(5, getConfig().getInt("bridge.status-interval-seconds", 10)) * 20L;
        Bukkit.getScheduler().runTaskTimer(this, this::sendStatus, 40L, period);
    }

    @Override
    public void onDisable() {
        if (client != null) client.stop();
    }

    private void startBridge() {
        if (client != null) client.stop();
        String secret = System.getenv("ZENTAR_BRIDGE_SECRET");
        if (secret == null || secret.isBlank()) secret = getConfig().getString("bridge.secret", "");
        if (secret == null || secret.length() < 32 || secret.startsWith("BURAYA_")) {
            getLogger().severe("bridge.secret ayarlanmamış veya 32 karakterden kısa; köprü BAŞLATILMADI.");
            client = null;
            return;
        }
        client = new BridgeClient(getLogger(), getConfig().getString("bridge.url", "ws://127.0.0.1:8765"), secret,
                getConfig().getString("bridge.server-name", "GenPvP"), getDescription().getVersion(),
                Bukkit.getVersion(), this::onBotMessage);
        client.start();
    }

    // ---------- Bot -> Plugin ----------

    private void onBotMessage(Protocol.Message msg, BridgeClient c) {
        switch (msg.type) {
            case "hello_ack":
                Bukkit.getScheduler().runTask(this, this::sendStatus);
                break;
            case "ping":
                c.send("pong", msg.data, msg.id);
                break;
            case "discord_chat":
                broadcast(format("chat.discord-format", "user", clean(str(msg.data, "user"), 32), "message", clean(str(msg.data, "message"), 256)));
                break;
            case "announce":
            case "staff_message": {
                String key = msg.type.equals("announce") ? "chat.announce-format" : "chat.staff-format";
                String text = format(key, "from", clean(str(msg.data, "from"), 32), "message", clean(str(msg.data, "message"), 256));
                Bukkit.getScheduler().runTask(this, () -> {
                    int n = Bukkit.getOnlinePlayers().size();
                    Bukkit.broadcastMessage(text);
                    JsonObject res = new JsonObject();
                    res.addProperty("ok", true);
                    res.addProperty("recipients", n);
                    c.send(msg.type + "_result", res, msg.id);
                });
                break;
            }
            case "maintenance": {
                boolean enabled = msg.data.has("enabled") && msg.data.get("enabled").getAsBoolean();
                Bukkit.getScheduler().runTask(this, () -> {
                    setMaintenance(enabled);
                    JsonObject res = new JsonObject();
                    res.addProperty("ok", true);
                    c.send("maintenance_result", res, msg.id);
                });
                break;
            }
            case "player_info":
                Bukkit.getScheduler().runTask(this, () -> c.send("player_info_result", playerInfo(str(msg.data, "name")), msg.id));
                break;
            case "verify_result": {
                String uuid = str(msg.data, "uuid");
                String message = clean(str(msg.data, "message"), 200);
                boolean ok = msg.data.has("ok") && msg.data.get("ok").getAsBoolean();
                Bukkit.getScheduler().runTask(this, () -> {
                    try {
                        Player p = Bukkit.getPlayer(UUID.fromString(uuid));
                        if (p != null) p.sendMessage((ok ? ChatColor.GREEN : ChatColor.RED) + message);
                    } catch (IllegalArgumentException ignored) {
                        // geçersiz UUID: yok say
                    }
                });
                break;
            }
            default:
                break;
        }
    }

    /** Discord kaynaklı metin yalnızca sohbet olarak yayınlanır; asla komut olarak çalıştırılmaz. */
    private void broadcast(String text) {
        Bukkit.getScheduler().runTask(this, () -> Bukkit.broadcastMessage(text));
    }

    private String format(String key, String... kv) {
        String f = getConfig().getString(key, "{message}");
        for (int i = 0; i + 1 < kv.length; i += 2) f = f.replace("{" + kv[i] + "}", kv[i + 1]);
        return ChatColor.translateAlternateColorCodes('&', f);
    }

    private static String str(JsonObject o, String k) {
        return o.has(k) && !o.get(k).isJsonNull() ? o.get(k).getAsString() : "";
    }

    /** Renk/biçim kodlarını ve kontrol karakterlerini temizler, uzunluğu sınırlar. */
    private static String clean(String s, int max) {
        String out = CONTROL.matcher(s == null ? "" : s).replaceAll(" ").replace('§', ' ').replace('&', '＆').trim();
        return out.length() > max ? out.substring(0, max) : out;
    }

    // ---------- Bakım ----------

    private void setMaintenance(boolean enabled) {
        this.maintenance = enabled;
        if (!enabled) return;
        String kick = ChatColor.translateAlternateColorCodes('&', getConfig().getString("maintenance.kick-message", "Bakımdayız."));
        for (Player p : new ArrayList<>(Bukkit.getOnlinePlayers())) {
            if (!canBypassMaintenance(p)) p.kickPlayer(kick);
        }
    }

    private boolean canBypassMaintenance(Player p) {
        return p.isOp() || p.hasPermission("zentarbridge.maintenance.bypass");
    }

    @EventHandler
    public void onLogin(PlayerLoginEvent e) {
        if (maintenance && !canBypassMaintenance(e.getPlayer())) {
            e.disallow(PlayerLoginEvent.Result.KICK_OTHER,
                    ChatColor.translateAlternateColorCodes('&', getConfig().getString("maintenance.kick-message", "Bakımdayız.")));
        }
    }

    // ---------- Plugin -> Bot ----------

    private String rankOf(Player p) {
        String placeholder = getConfig().getString("chat.rank-placeholder", "");
        if (placeholder == null || placeholder.isEmpty() || Bukkit.getPluginManager().getPlugin("PlaceholderAPI") == null) return "";
        try {
            Class<?> api = Class.forName("me.clip.placeholderapi.PlaceholderAPI");
            Method m = api.getMethod("setPlaceholders", OfflinePlayer.class, String.class);
            String r = (String) m.invoke(null, p, placeholder);
            if (r == null || r.equals(placeholder)) return "";
            return ChatColor.stripColor(ChatColor.translateAlternateColorCodes('&', r)).trim();
        } catch (Exception ex) {
            return "";
        }
    }

    private JsonObject playerEvent(Player p) {
        JsonObject d = new JsonObject();
        d.addProperty("player", p.getName());
        d.addProperty("uuid", p.getUniqueId().toString());
        return d;
    }

    @EventHandler(priority = EventPriority.MONITOR, ignoreCancelled = true)
    public void onChat(AsyncPlayerChatEvent e) {
        if (client == null) return;
        JsonObject d = playerEvent(e.getPlayer());
        d.addProperty("rank", rankOf(e.getPlayer()));
        d.addProperty("message", e.getMessage());
        client.send("chat", d, null);
    }

    @EventHandler(priority = EventPriority.MONITOR)
    public void onJoin(PlayerJoinEvent e) {
        if (client != null) client.send("join", playerEvent(e.getPlayer()), null);
    }

    @EventHandler(priority = EventPriority.MONITOR)
    public void onQuit(PlayerQuitEvent e) {
        if (client != null) client.send("quit", playerEvent(e.getPlayer()), null);
    }

    @EventHandler(priority = EventPriority.MONITOR)
    @SuppressWarnings("deprecation")
    public void onDeath(PlayerDeathEvent e) {
        if (client == null) return;
        JsonObject d = playerEvent(e.getEntity());
        String msg = e.getDeathMessage();
        d.addProperty("message", msg == null ? e.getEntity().getName() + " öldü." : ChatColor.stripColor(msg));
        client.send("death", d, null);
    }

    private void sendStatus() {
        if (client == null || !client.isReady()) return;
        JsonObject d = new JsonObject();
        JsonArray players = new JsonArray();
        for (Player p : Bukkit.getOnlinePlayers()) {
            JsonObject o = new JsonObject();
            o.addProperty("name", p.getName());
            o.addProperty("uuid", p.getUniqueId().toString());
            players.add(o);
        }
        d.add("players", players);
        d.addProperty("max", Bukkit.getMaxPlayers());
        d.addProperty("version", Bukkit.getBukkitVersion().split("-")[0]);
        d.addProperty("maintenance", maintenance);
        long nowMs = System.currentTimeMillis();
        if (nowMs - lastUniqueAt > 300_000L) { // dizin taraması pahalı: 5 dakikada bir
            uniquePlayers = Bukkit.getOfflinePlayers().length;
            lastUniqueAt = nowMs;
        }
        d.addProperty("uniquePlayers", uniquePlayers);
        try {
            double[] tps = (double[]) Bukkit.class.getMethod("getTPS").invoke(null);
            d.addProperty("tps", Math.round(Math.min(20.0, tps[0]) * 100.0) / 100.0);
        } catch (Exception ignored) {
            // Spigot: TPS bilgisi yok, alan gönderilmez
        }
        client.send("status", d, null);
    }

    @SuppressWarnings("deprecation")
    private JsonObject playerInfo(String name) {
        JsonObject d = new JsonObject();
        OfflinePlayer target = null;
        Player online = Bukkit.getPlayerExact(name);
        if (online != null) {
            target = online;
        } else {
            // Ağ araması yapılmaz; yalnızca sunucuya daha önce girmiş oyuncular
            for (OfflinePlayer op : Bukkit.getOfflinePlayers()) {
                if (op.getName() != null && op.getName().equalsIgnoreCase(name)) {
                    target = op;
                    break;
                }
            }
        }
        if (target == null || (!target.hasPlayedBefore() && !target.isOnline())) {
            d.addProperty("found", false);
            return d;
        }
        d.addProperty("found", true);
        d.addProperty("name", target.getName());
        d.addProperty("uuid", target.getUniqueId().toString());
        d.addProperty("online", target.isOnline());
        d.addProperty("firstPlayed", target.getFirstPlayed());
        d.addProperty("lastPlayed", target.getLastPlayed());
        Long play = stat(target, "PLAY_ONE_MINUTE", "PLAY_TIME");
        if (play != null) d.addProperty("playtimeMs", play * 50L); // tick -> ms
        Long kills = stat(target, "PLAYER_KILLS");
        if (kills != null) d.addProperty("kills", kills);
        Long deaths = stat(target, "DEATHS");
        if (deaths != null) d.addProperty("deaths", deaths);
        return d;
    }

    private Long stat(OfflinePlayer p, String... names) {
        for (String n : names) {
            try {
                return (long) p.getStatistic(Statistic.valueOf(n));
            } catch (Exception ignored) {
                // bu sürümde yok; sıradakini dene
            }
        }
        return null;
    }

    // ---------- Komutlar ----------

    @Override
    public boolean onCommand(CommandSender sender, Command cmd, String label, String[] args) {
        if (cmd.getName().equalsIgnoreCase("dogrula")) return handleVerify(sender, args);
        if (cmd.getName().equalsIgnoreCase("zentarbridge")) {
            if (args.length > 0 && args[0].equalsIgnoreCase("reload")) {
                reloadConfig();
                startBridge();
                sender.sendMessage(ChatColor.GREEN + "Yapılandırma yenilendi, köprü yeniden başlatıldı.");
            } else {
                sender.sendMessage(ChatColor.LIGHT_PURPLE + "Köprü: " + (client != null && client.isReady() ? ChatColor.GREEN + "bağlı" : ChatColor.RED + "bağlı değil")
                        + ChatColor.GRAY + " | Bakım: " + (maintenance ? "açık" : "kapalı"));
            }
            return true;
        }
        return false;
    }

    private boolean handleVerify(CommandSender sender, String[] args) {
        if (!(sender instanceof Player)) {
            sender.sendMessage("Bu komut yalnızca oyuncular içindir.");
            return true;
        }
        Player p = (Player) sender;
        if (args.length != 1 || !CODE.matcher(args[0]).matches()) {
            p.sendMessage(ChatColor.RED + "Kullanım: /dogrula <kod>  (kodu Discord'da /doğrula ile al)");
            return true;
        }
        long now = System.currentTimeMillis();
        long cd = getConfig().getLong("verify.cooldown-seconds", 3) * 1000L;
        Long last = verifyCooldown.get(p.getUniqueId());
        if (last != null && now - last < cd) {
            p.sendMessage(ChatColor.RED + "Lütfen birkaç saniye bekle.");
            return true;
        }
        verifyCooldown.put(p.getUniqueId(), now);
        if (client == null || !client.isReady()) {
            p.sendMessage(ChatColor.RED + "Doğrulama sistemi şu anda kullanılamıyor, daha sonra tekrar dene.");
            return true;
        }
        JsonObject d = new JsonObject();
        d.addProperty("code", args[0]);
        d.addProperty("uuid", p.getUniqueId().toString());
        d.addProperty("name", p.getName());
        client.send("verify", d, null);
        p.sendMessage(ChatColor.GRAY + "Doğrulanıyor…");
        return true;
    }
}
