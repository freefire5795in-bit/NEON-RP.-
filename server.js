require('dotenv').config();
const express = require('express');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const { Client, GatewayIntentBits, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, Events } = require('discord.js');
const crypto = require('crypto');

const required = ['DISCORD_BOT_TOKEN','DISCORD_APPLICATION_CHANNEL_ID','ALLOWED_ORIGIN','APPLICATION_SHARED_SECRET','STAFF_ROLE_ID'];
const missing = required.filter(k => !process.env[k] || process.env[k].startsWith('PUT_') || process.env[k].startsWith('REPLACE_') || process.env[k].includes('YOUR-WEBSITE'));
if (missing.length) { console.error('Missing configuration:', missing.join(', ')); process.exit(1); }
if (process.env.APPLICATION_SHARED_SECRET.length < 32) { console.error('APPLICATION_SHARED_SECRET must be at least 32 characters.'); process.exit(1); }
const app = express();
app.disable('x-powered-by');
app.use(helmet({ crossOriginResourcePolicy: { policy: 'cross-origin' } }));
app.use(express.json({ limit: '40kb', strict: true }));
const limiter = rateLimit({ windowMs: 10 * 60 * 1000, limit: 5, standardHeaders: 'draft-7', legacyHeaders: false, message: { error: 'محاولات كثيرة. حاول بعد قليل.' } });
app.use('/api/applications', limiter);
app.use((req,res,next)=>{
  const origin = req.get('origin');
  if (origin && origin !== process.env.ALLOWED_ORIGIN) return res.status(403).json({error:'Origin not allowed'});
  if (req.method === 'OPTIONS') {
    if (origin === process.env.ALLOWED_ORIGIN) { res.set('Access-Control-Allow-Origin', origin); res.set('Vary','Origin'); res.set('Access-Control-Allow-Methods','POST, OPTIONS'); res.set('Access-Control-Allow-Headers','Content-Type'); }
    return res.sendStatus(origin && origin !== process.env.ALLOWED_ORIGIN ? 403 : 204);
  }
  if (origin === process.env.ALLOWED_ORIGIN) { res.set('Access-Control-Allow-Origin', origin); res.set('Vary','Origin'); }
  next();
});
const client = new Client({ intents: [GatewayIntentBits.Guilds] });
client.once(Events.ClientReady, c => console.log(`Discord bot ready as ${c.user.tag}`));
client.login(process.env.DISCORD_BOT_TOKEN);
function clean(s, max=1000) { return String(s ?? '').replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g,'').slice(0,max).trim(); }
function safeEqual(a,b) { const aa=Buffer.from(a); const bb=Buffer.from(b); return aa.length===bb.length && crypto.timingSafeEqual(aa,bb); }
app.get('/health', (req,res)=>res.json({ok:true,discordReady:client.isReady()}));
app.post('/api/applications', async (req,res)=>{
  try {
    const auth = req.get('x-application-secret') || '';
    // Optional machine-to-machine shared secret. Browser clients cannot safely hold a secret;
    // therefore this header should be added only by a trusted server-side proxy, not public HTML.
    if (process.env.REQUIRE_SHARED_SECRET === 'true' && !safeEqual(auth, process.env.APPLICATION_SHARED_SECRET)) return res.status(401).json({error:'Unauthorized'});
    const b=req.body || {};
    const playerName=clean(b.playerName,8), discordUsername=clean(b.discordUsername,15), discordId=clean(b.discordId,20), extra=clean(b.extra,500);
    const applicationType = b.applicationType === 'police' ? 'police' : 'general';
    const applicationTitle = applicationType === 'police' ? '👮 تقديم شرطة جديد — NEON RP' : '📝 تقديم جديد — NEON RP';
    const age = b.age === null || b.age === '' || typeof b.age === 'undefined' ? null : Number(b.age);
    if (playerName.length < 2 || playerName.length > 8 || discordUsername.length < 2 || discordUsername.length > 15 || (discordId && !/^\d{17,20}$/.test(discordId))) return res.status(400).json({error:'تحقق من اسم اللاعب واسم مستخدم ديسكورد.'});
    if (age !== null && (!Number.isInteger(age) || age < 13 || age > 99)) return res.status(400).json({error:'العمر غير صالح.'});
    if (!Array.isArray(b.answers) || b.answers.length < 1 || b.answers.length > 30) return res.status(400).json({error:'عدد الإجابات غير صالح.'});
    const answers=b.answers.map((a,i)=>({question:clean(a?.question,300)||`السؤال ${i+1}`,answer:clean(a?.answer,1200)||'لم تتم الإجابة',timedOut:!!a?.timedOut,correct:!!a?.correct}));
    const applicationId=crypto.randomUUID();
    const score=Number.isFinite(Number(b.score)) ? Math.max(0,Math.min(30,Math.trunc(Number(b.score)))) : 0;
    const total=answers.length;
    const channel=await client.channels.fetch(process.env.DISCORD_APPLICATION_CHANNEL_ID);
    if (!channel || !channel.isTextBased() || !channel.send) return res.status(500).json({error:'قناة استقبال الطلبات غير متاحة. تواصل مع الإدارة.'});
    const embed=new EmbedBuilder().setColor(0xff2947).setTitle(applicationTitle).setDescription(applicationType === 'police' ? 'طلب تقديم للشرطة من موقع NEON RP.' : 'طلب تقديم جديد من موقع NEON RP.').addFields(
      {name:'نوع التقديم',value:applicationType === 'police' ? 'الشرطة' : 'عام',inline:true},
      {name:'اسم اللاعب',value:playerName.slice(0,1024),inline:true},
      {name:'اسم مستخدم ديسكورد',value:discordId ? `<@${discordId}>\n\`${discordId}\`\n@${discordUsername}` : `@${discordUsername}\nلم يُضف المعرّف الرقمي؛ لا يمكن عمل منشن مباشر.`,inline:true},
      {name:'العمر',value:age===null?'لم يُذكر':String(age),inline:true},
      {name:'نتيجة الاختيار من متعدد',value:`${score} / ${total}`,inline:true},
      {name:'المدة',value:`${Math.max(0,Math.min(7200,Number(b.elapsedSeconds)||0))} ثانية`,inline:true},
      {name:'معلومات إضافية',value:extra || 'لا توجد',inline:false}
    ).setFooter({text:`NEON RP • Application ID: ${applicationId}`}).setTimestamp(new Date());
    const chunks=[];
    for (let i=0;i<answers.length;i++) {
      const a=answers[i];
      chunks.push(`**${i+1}. ${a.question}**\n${a.answer}\n${a.timedOut?'⏱️ انتهى الوقت':''}`.trim());
    }
    let description=''; const pages=[];
    for (const chunk of chunks) { if ((description+'\n\n'+chunk).length>3900) { pages.push(description); description=''; } description += (description?'\n\n':'')+chunk; }
    if (description) pages.push(description);
    const embeds=[embed,...pages.slice(0,9).map((page,i)=>new EmbedBuilder().setColor(0x211014).setTitle(`إجابات التقديم • ${i+1}/${Math.min(pages.length,9)}`).setDescription(page))];
    const row=new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(`neon_app_approve:${applicationId}`).setLabel('قبول').setStyle(ButtonStyle.Success),
      new ButtonBuilder().setCustomId(`neon_app_reject:${applicationId}`).setLabel('رفض').setStyle(ButtonStyle.Danger)
    );
    await channel.send({embeds,components:[row],allowedMentions:{parse:[]}});
    return res.status(201).json({ok:true,applicationId});
  } catch (err) { console.error('Application submit failed:',err.message); return res.status(500).json({error:'تعذر إرسال الطلب إلى ديسكورد. حاول لاحقًا.'}); }
});
client.on(Events.InteractionCreate, async interaction=>{
  if (!interaction.isButton() || !interaction.customId.startsWith('neon_app_')) return;
  const member = interaction.member;
  const roles = member && member.roles && member.roles.cache;
  if (!interaction.inGuild() || !roles || !roles.has(process.env.STAFF_ROLE_ID)) {
    await interaction.reply({content:'هذا الإجراء مخصص للإدارة فقط.',ephemeral:true}).catch(()=>{});
    return;
  }
  const approved = interaction.customId.startsWith('neon_app_approve:');
  const oldEmbeds = interaction.message.embeds;
  const embeds = oldEmbeds.map((old, i) => {
    const next = EmbedBuilder.from(old);
    if (i === 0) next.setTitle(`${approved ? '✅ تم قبول' : '❌ تم رفض'} التقديم — NEON RP`).addFields({name:'قرار الإدارة',value:`${approved ? 'مقبول' : 'مرفوض'} بواسطة ${interaction.user.tag}`,inline:false});
    return next;
  });
  await interaction.update({embeds,components:[]}).catch(async()=>{ await interaction.reply({content:'تعذر تحديث حالة الطلب.',ephemeral:true}).catch(()=>{}); });
});
const port=Number(process.env.PORT)||3000;
app.listen(port,()=>console.log(`NEON RP application API listening on port ${port}`));
