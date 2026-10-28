import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey, X-Notify-Secret",
};

const supabase = createClient(
  Deno.env.get("SUPABASE_URL") ?? "",
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""
);

const TELEGRAM_API_BASE = "https://api.telegram.org/bot";

async function sendMessage(chatId: string, text: string): Promise<void> {
  const token = Deno.env.get("TELEGRAM_BOT_TOKEN");
  if (!token) throw new Error("TELEGRAM_BOT_TOKEN not configured");
  const res = await fetch(`${TELEGRAM_API_BASE}/${token}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: chatId, text, parse_mode: "HTML" }),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Telegram API error: ${res.status} ${body}`);
  }
}

export default async (req: Request): Promise<Response> => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  try {
    const url = new URL(req.url);
    if (url.pathname.endsWith("/webhook") && req.method === "POST") {
      const update = await req.json();
      const msg = update.message;
      if (!msg || !msg.text) {
        return new Response(JSON.stringify({ ok: true }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }
      const chatId = String(msg.chat.id);
      const text = msg.text.trim();

      if (text === "/start") {
        await sendMessage(chatId, "Привет! Это бот «Бюджет для двоих». Отправьте код семьи для привязки.");
      } else if (text.startsWith("/link ")) {
        const inviteCode = text.slice(6).trim();
        const { data: family, error: famErr } = await supabase.from("families").select("id, name").eq("invite_code", inviteCode).maybeSingle();
        if (famErr || !family) {
          await sendMessage(chatId, "Семья с таким кодом не найдена. Проверьте код и попробуйте снова.");
        } else {
          await supabase.from("telegram_links").upsert({ family_id: family.id, chat_id: chatId, username: msg.from?.username ?? null }, { onConflict: "chat_id" });
          await sendMessage(chatId, `Семья «${family.name}» привязана. Вы будете получать уведомления о бюджете и целях.`);
        }
      } else if (text === "/help") {
        await sendMessage(chatId, "Команды:\n/start — начать\n/link <код> — привязать семью\n/help — помощь");
      }
      return new Response(JSON.stringify({ ok: true }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    if (url.pathname.endsWith("/notify") && req.method === "POST") {
      const expectedSecret = Deno.env.get("TELEGRAM_NOTIFY_SECRET");
      const suppliedSecret = req.headers.get("X-Notify-Secret");
      if (!expectedSecret || !suppliedSecret || suppliedSecret !== expectedSecret) {
        return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }
      const body = await req.json();
      const { family_id, title, body: msgBody } = body as { family_id?: string; title?: string; body?: string };
      if (!family_id || !title) {
        return new Response(JSON.stringify({ error: "family_id and title required" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }
      const { data: links, error: linkErr } = await supabase.from("telegram_links").select("chat_id").eq("family_id", family_id);
      if (linkErr) throw linkErr;
      if (!links || links.length === 0) {
        return new Response(JSON.stringify({ sent: 0 }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }
      let sent = 0;
      for (const link of links) {
        try { await sendMessage(String(link.chat_id), `<b>${title}</b>${msgBody ? "\n" + msgBody : ""}`); sent++; } catch { /* skip */ }
      }
      return new Response(JSON.stringify({ sent }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    return new Response(JSON.stringify({ error: "Not found" }), { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Internal error";
    return new Response(JSON.stringify({ error: message }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
};
