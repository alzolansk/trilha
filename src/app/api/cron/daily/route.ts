import { NextResponse, type NextRequest } from 'next/server';
import webpush from 'web-push';
import { supabaseAdmin } from '@/lib/supabase/server';
import { daysBetween, todayIn } from '@/lib/time';

// Rotina diária (Vercel Cron, 1x/dia no plano Hobby): lembretes por push conforme preferências.
// Usa a secret key do Supabase SOMENTE aqui, no servidor, para ler assinaturas de todos.
export const maxDuration = 60;

interface Sub { id: string; user_id: string; endpoint: string; p256dh: string; auth: string }

export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret || req.headers.get('authorization') !== `Bearer ${secret}`) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const admin = supabaseAdmin();
  const pub = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
  const priv = process.env.VAPID_PRIVATE_KEY;
  if (!admin || !pub || !priv) return NextResponse.json({ skipped: 'Supabase secret key ou VAPID não configurados.' });
  webpush.setVapidDetails(process.env.VAPID_SUBJECT || 'mailto:admin@example.com', pub, priv);

  const { data: prefs } = await admin.from('notification_prefs').select('*').eq('push_enabled', true);
  if (!prefs?.length) return NextResponse.json({ sent: 0 });
  const userIds = prefs.map((p) => p.user_id);
  const [{ data: subs }, { data: members }] = await Promise.all([
    admin.from('push_subscriptions').select('id,user_id,endpoint,p256dh,auth').in('user_id', userIds),
    admin.from('trip_members').select('user_id, trip_id, trips(id,title,start_date,end_date,departure_tz)').in('user_id', userIds),
  ]);
  const tripIds = Array.from(new Set((members ?? []).map((m) => m.trip_id)));
  const [{ data: tasks }, { data: stops }] = await Promise.all([
    admin.from('tasks').select('trip_id,title,assignee_id,due_date,status,dismissed').in('trip_id', tripIds).neq('status', 'done'),
    admin.from('stops').select('trip_id,name,arrival_date,lat,lng').in('trip_id', tripIds),
  ]);

  const weatherCache = new Map<string, string | null>();
  async function weather(lat: number, lng: number, date: string) {
    const k = `${lat},${lng},${date}`;
    if (weatherCache.has(k)) return weatherCache.get(k)!;
    try {
      const r = await fetch(`https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lng}&daily=temperature_2m_max,temperature_2m_min,precipitation_probability_max&timezone=auto&start_date=${date}&end_date=${date}`);
      const j = await r.json();
      const txt = j?.daily ? `${Math.round(j.daily.temperature_2m_min[0])}°–${Math.round(j.daily.temperature_2m_max[0])}°, chuva ${j.daily.precipitation_probability_max?.[0] ?? '?'}% (Open-Meteo)` : null;
      weatherCache.set(k, txt);
      return txt;
    } catch {
      return null;
    }
  }

  let sent = 0;
  let removed = 0;
  for (const p of prefs) {
    const msgs: { title: string; body: string; url: string; tag: string }[] = [];
    for (const m of (members ?? []).filter((x) => x.user_id === p.user_id)) {
      const t = m.trips as unknown as { id: string; title: string; start_date: string; end_date: string; departure_tz: string } | null;
      if (!t) continue;
      const today = todayIn(t.departure_tz || 'America/Sao_Paulo');
      const d = daysBetween(today, t.start_date);
      if (p.departure_reminders && [30, 7, 1, 0].includes(d)) {
        msgs.push({ title: t.title, body: d === 0 ? 'É hoje. Boa viagem!' : `Faltam ${d} ${d === 1 ? 'dia' : 'dias'}.`, url: `/t/${t.id}`, tag: `dep-${t.id}` });
      }
      if (p.task_reminders) {
        const due = (tasks ?? []).filter((x) => x.trip_id === t.id && !x.dismissed && x.due_date && (x.assignee_id === p.user_id || !x.assignee_id) && daysBetween(today, x.due_date) >= 0 && daysBetween(today, x.due_date) <= 1);
        if (due.length) msgs.push({ title: `${t.title}: pendências`, body: due.map((x) => x.title).slice(0, 3).join(' · '), url: `/t/${t.id}/mala`, tag: `tasks-${t.id}` });
      }
      if (p.weather) {
        for (const s of (stops ?? []).filter((x) => x.trip_id === t.id && x.lat != null && daysBetween(today, x.arrival_date) === 3)) {
          const w = await weather(s.lat, s.lng, s.arrival_date);
          if (w) msgs.push({ title: `${s.name} em 3 dias`, body: `Previsão para a chegada: ${w}`, url: `/t/${t.id}/roteiro`, tag: `wx-${t.id}-${s.name}` });
        }
      }
    }
    for (const sub of ((subs ?? []) as Sub[]).filter((x) => x.user_id === p.user_id)) {
      for (const msg of msgs.slice(0, 4)) {
        try {
          await webpush.sendNotification({ endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } }, JSON.stringify(msg), { TTL: 60 * 60 * 12 });
          sent++;
        } catch (e) {
          const code = (e as { statusCode?: number }).statusCode;
          if (code === 404 || code === 410) {
            await admin.from('push_subscriptions').delete().eq('id', sub.id);
            removed++;
            break;
          }
        }
      }
    }
  }
  return NextResponse.json({ sent, removed });
}
