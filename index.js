require('dotenv').config();

const {
  Client,
  GatewayIntentBits,
  REST,
  Routes,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  MessageFlags
} = require('discord.js');

const sqlite3 = require('sqlite3').verbose();

// ===================== СОЗДАНИЕ БАЗЫ ДАННЫХ =====================
const db = new sqlite3.Database('./database.sqlite');

db.run(`
CREATE TABLE IF NOT EXISTS users (
  userId TEXT PRIMARY KEY,
  balance INTEGER DEFAULT 0
)
`, (err) => {
  if (err) {
    console.error("❌ Ошибка создания таблицы:", err.message);
  } else {
    console.log("✅ Таблица users готова");
  }
});

// ===================== CONFIG from .env =====================
const TOKEN = process.env.TOKEN;
const CLIENT_ID = process.env.CLIENT_ID;
const GUILD_ID = process.env.GUILD_ID;

const LOG_CHANNEL_ID = process.env.LOG_CHANNEL_ID || "1504248461636141186";
const LEADER_ROLE_ID = process.env.LEADER_ROLE_ID;
const SHOP_LOG_CHANNEL_ID = process.env.SHOP_LOG_CHANNEL_ID;
const NOTIFY_ROLE_ID = process.env.NOTIFY_ROLE_ID;

if (!LEADER_ROLE_ID) console.warn("⚠️ LEADER_ROLE_ID не указан в .env");
if (!SHOP_LOG_CHANNEL_ID) console.warn("⚠️ SHOP_LOG_CHANNEL_ID не указан в .env");

// ===================== НАСТРОЙКИ ВОЙСА =====================
const VOICE_REWARD = 4000;        // 4000$ за 10 минут
const VOICE_INTERVAL = 600000;    // 10 минут (600000 мс)

// ===================== BOT =====================
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildVoiceStates
  ]
});

// ===================== COMMANDS =====================
const commands = [
  { name: 'баланс', description: 'Показать баланс' },
  {
    name: 'перевод',
    description: 'Перевести деньги другому игроку',
    options: [
      { name: 'игрок', type: 6, required: true, description: 'Кому перевести' },
      { name: 'сумма', type: 4, required: true, description: 'Сумма' }
    ]
  },
  { name: 'магазин', description: 'Магазин' },
  { name: 'топ', description: 'Топ 10 богачей' },
  {
    name: 'забрать',
    description: '[ЛИДЕР] Забрать деньги у игрока',
    options: [
      { name: 'игрок', type: 6, required: true, description: 'У кого забрать' },
      { name: 'сумма', type: 4, required: true, description: 'Сумма' }
    ]
  },
  { name: 'проверитьбд', description: 'Проверить данные в БД' }
];

// ===================== REGISTER =====================
const rest = new REST({ version: '10' }).setToken(TOKEN);

async function register() {
  await rest.put(
    Routes.applicationGuildCommands(CLIENT_ID, GUILD_ID),
    { body: commands }
  );
  console.log("✅ команды загружены");
}

// ===================== READY =====================
client.once('ready', async () => {
  console.log(`✅ Онлайн: ${client.user.tag}`);
  await register();
  console.log(`🎧 Войс-награда: ${VOICE_REWARD}$ каждые ${VOICE_INTERVAL / 60000} минут`);
  console.log(`👥 Для награды нужно минимум 2 человека в голосовом канале`);
});

// ===================== USER =====================
function addUser(id) {
  db.run(`INSERT OR IGNORE INTO users (userId, balance) VALUES (?, 0)`, [id], (err) => {
    if (err) console.error(`❌ Ошибка addUser:`, err.message);
  });
}

// ===================== VOICE SYSTEM (С ПОЛНОЙ ЗАЩИТОЙ + 2+ ЧЕЛОВЕК) =====================
const voiceState = new Map();

setInterval(async () => {
  const now = Date.now();
  
  for (const guild of client.guilds.cache.values()) {
    for (const channel of guild.channels.cache.values()) {
      if (!channel.isVoiceBased()) continue;

      // ========= ПРОВЕРКА: В КАНАЛЕ МИНИМУМ 2 ЧЕЛОВЕКА (НЕ БОТОВ) =========
      const humanCount = channel.members.filter(m => !m.user.bot).size;
      if (humanCount < 2) continue;

      for (const member of channel.members.values()) {
        if (member.user.bot) continue;

        // ========= ЗАЩИТА ОТ МУТА И АФК =========
        if (
          member.voice.selfMute ||
          member.voice.selfDeaf ||
          member.voice.serverMute ||
          member.voice.serverDeaf
        ) {
          // Если заглушен - пропускаем
          continue;
        }

        let state = voiceState.get(member.id);
        
        // Если нет состояния - создаём
        if (!state) {
          state = {
            lastReward: now,
            lastActive: now
          };
          voiceState.set(member.id, state);
          continue;
        }

        // Проверка активности (если прошло больше 2 минут без активности - сброс)
        if (now - state.lastActive > 120000) {
          state.lastReward = now;
          state.lastActive = now;
          voiceState.set(member.id, state);
          continue;
        }

        // Обновляем последнюю активность
        state.lastActive = now;
        voiceState.set(member.id, state);

        // Проверяем, прошло ли 10 минут с последней награды
        if (now - state.lastReward >= VOICE_INTERVAL) {
          // Начисляем награду
          addUser(member.id);
          
          db.run(
            `UPDATE users SET balance = balance + ? WHERE userId = ?`,
            [VOICE_REWARD, member.id],
            function(err) {
              if (err) {
                console.error(`❌ Ошибка начисления ${member.user.tag}:`, err.message);
              } else {
                console.log(`✅ ${member.user.tag} +${VOICE_REWARD}$ (в канале ${humanCount} чел)`);
              }
            }
          );
          
          state.lastReward = now;
          voiceState.set(member.id, state);
        }
      }
    }
  }
}, 30000); // Проверяем каждые 30 секунд

// ===================== ОТСЛЕЖИВАНИЕ ВХОДА/ВЫХОДА =====================
client.on('voiceStateUpdate', (oldState, newState) => {
  const member = newState.member || oldState.member;
  if (member.user.bot) return;

  const now = Date.now();
  
  // Зашёл в голосовой канал
  if (!oldState.channelId && newState.channelId) {
    voiceState.set(member.id, {
      lastReward: now,
      lastActive: now
    });
    console.log(`🔊 ${member.user.tag} зашёл в войс-канал`);
  }
  
  // Вышел из голосового канала
  if (oldState.channelId && !newState.channelId) {
    voiceState.delete(member.id);
    console.log(`🔇 ${member.user.tag} вышел из войс-канала`);
  }
});

// ===================== INTERACTIONS =====================
client.on('interactionCreate', async (i) => {
  try {
    if (i.isChatInputCommand()) {
      addUser(i.user.id);

      if (i.commandName === 'баланс') {
        db.get(`SELECT balance FROM users WHERE userId = ?`, [i.user.id], (e, r) => {
          i.reply({ content: `💰 Баланс: ${r?.balance || 0}$`, flags: MessageFlags.Ephemeral });
        });
      }

      if (i.commandName === 'проверитьбд') {
        db.get(`SELECT * FROM users WHERE userId = ?`, [i.user.id], (e, r) => {
          i.reply({ 
            content: r ? `📊 Данные в БД: баланс = ${r.balance}$` : `❌ Пользователь не найден в БД`,
            flags: MessageFlags.Ephemeral 
          });
        });
      }

      if (i.commandName === 'перевод') {
        const user = i.options.getUser('игрок');
        const amount = i.options.getInteger('сумма');

        if (amount <= 0) return i.reply({ content: "❌ Сумма должна быть больше 0", flags: MessageFlags.Ephemeral });

        db.get(`SELECT balance FROM users WHERE userId = ?`, [i.user.id], (e, r) => {
          if ((r?.balance || 0) < amount) {
            return i.reply({ content: "❌ Недостаточно денег", flags: MessageFlags.Ephemeral });
          }

          addUser(user.id);

          db.run(`UPDATE users SET balance = balance - ? WHERE userId = ?`, [amount, i.user.id]);
          db.run(`UPDATE users SET balance = balance + ? WHERE userId = ?`, [amount, user.id]);

          i.reply({ content: `💸 Переведено ${amount}$ пользователю ${user.username}`, flags: MessageFlags.Ephemeral });
        });
      }

      if (i.commandName === 'забрать') {
        if (!LEADER_ROLE_ID) {
          return i.reply({ content: "❌ Система лидеров не настроена", flags: MessageFlags.Ephemeral });
        }

        const member = i.member;
        if (!member.roles.cache.has(LEADER_ROLE_ID)) {
          return i.reply({ content: "❌ У вас нет роли лидера для этой команды.", flags: MessageFlags.Ephemeral });
        }

        const targetUser = i.options.getUser('игрок');
        const amount = i.options.getInteger('сумма');

        if (amount <= 0) return i.reply({ content: "❌ Сумма должна быть больше 0", flags: MessageFlags.Ephemeral });

        addUser(targetUser.id);

        db.get(`SELECT balance FROM users WHERE userId = ?`, [targetUser.id], (e, r) => {
          const currentBalance = r?.balance || 0;
          if (currentBalance < amount) {
            return i.reply({ content: `❌ У игрока ${targetUser.username} только ${currentBalance}$`, flags: MessageFlags.Ephemeral });
          }

          db.run(`UPDATE users SET balance = balance - ? WHERE userId = ?`, [amount, targetUser.id]);

          const logChannel = client.channels.cache.get(LOG_CHANNEL_ID);
          if (logChannel) {
            logChannel.send(`🔻 **Лидер ${i.user.username} забрал ${amount}$ у ${targetUser.username}**`);
          }

          i.reply({ content: `✅ Вы забрали ${amount}$ у ${targetUser.username}. Новый баланс: ${currentBalance - amount}$`, flags: MessageFlags.Ephemeral });
        });
      }

      if (i.commandName === 'магазин') {
        const row1 = new ActionRowBuilder().addComponents(
          new ButtonBuilder().setCustomId('buy_10000').setLabel('💲10000$').setStyle(ButtonStyle.Primary),
          new ButtonBuilder().setCustomId('buy_20000').setLabel('💲20000$').setStyle(ButtonStyle.Primary),
          new ButtonBuilder().setCustomId('buy_30000').setLabel('💲30000$').setStyle(ButtonStyle.Success),
          new ButtonBuilder().setCustomId('buy_40000').setLabel('💲40000$').setStyle(ButtonStyle.Primary),
          new ButtonBuilder().setCustomId('buy_50000').setLabel('💲50000$').setStyle(ButtonStyle.Success)
        );

        const row2 = new ActionRowBuilder().addComponents(
          new ButtonBuilder().setCustomId('buy_car').setLabel('🚗1000$').setStyle(ButtonStyle.Secondary),
          new ButtonBuilder().setCustomId('buy_house').setLabel('🏠5000$').setStyle(ButtonStyle.Secondary),
          new ButtonBuilder().setCustomId('buy_dragon').setLabel('🐉10000$').setStyle(ButtonStyle.Danger),
          new ButtonBuilder().setCustomId('buy_crown').setLabel('👑2000$').setStyle(ButtonStyle.Success)
        );

        return i.reply({
          content: "🛒 МАГАЗИН",
          components: [row1, row2],
          flags: MessageFlags.Ephemeral
        });
      }

      if (i.commandName === 'топ') {
        db.all(
          `SELECT userId, balance FROM users ORDER BY balance DESC LIMIT 10`,
          [],
          (e, rows) => {
            if (!rows?.length) return i.reply({ content: "❌ Нет данных", flags: MessageFlags.Ephemeral });
            let text = "🏆 ТОП 10 по деньгам:\n\n";
            rows.forEach((u, index) => {
              text += `#${index + 1} <@${u.userId}> — ${u.balance}$\n`;
            });
            i.reply({ content: text, flags: MessageFlags.Ephemeral });
          }
        );
      }
    }

    // ================= BUTTONS (МАГАЗИН) =================
    if (i.isButton()) {
      const shop = {
        buy_10000: 10000,
        buy_20000: 20000,
        buy_30000: 30000,
        buy_40000: 40000,
        buy_50000: 50000,
        buy_car: 1000,
        buy_house: 5000,
        buy_dragon: 10000,
        buy_crown: 2000
      };

      const price = shop[i.customId];
      if (!price) return;

      addUser(i.user.id);
      await i.deferReply({ flags: MessageFlags.Ephemeral });

      db.get(`SELECT balance FROM users WHERE userId = ?`, [i.user.id], async (e, r) => {
        if ((r?.balance || 0) < price) {
          return i.editReply({ content: "❌ Недостаточно денег", flags: MessageFlags.Ephemeral });
        }

        db.run(`UPDATE users SET balance = balance - ? WHERE userId = ?`, [price, i.user.id]);

        const shopLogChannel = client.channels.cache.get(SHOP_LOG_CHANNEL_ID);
        const highRoleId = NOTIFY_ROLE_ID;
        
        if (shopLogChannel && highRoleId) {
          try {
            await shopLogChannel.send({
              content: `<@&${highRoleId}>, 🛒 **<@${i.user.id}>** купил товар: \`${i.customId}\` за **${price}$**\n💰 Деньги списаны. Требуется выдача награды.`,
              allowedMentions: { roles: [highRoleId], users: [i.user.id] }
            });
          } catch (err) {
            console.error("❌ Ошибка отправки уведомления:", err);
          }
        }

        i.editReply({ content: `✅ Вы купили предмет за ${price}$. Уведомление отправлено хайрангам.`, flags: MessageFlags.Ephemeral });
      });
    }

  } catch (err) {
    console.log("ERROR:", err);
  }
});

client.login(TOKEN);