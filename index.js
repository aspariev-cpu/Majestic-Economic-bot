require('dotenv').config();

const {
  Client,
  GatewayIntentBits,
  REST,
  Routes,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  MessageFlags,
  EmbedBuilder,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle
} = require('discord.js');

const sqlite3 = require('sqlite3').verbose();

// ===================== БАЗА ДАННЫХ =====================
const db = new sqlite3.Database('./database.sqlite');

db.run(`
CREATE TABLE IF NOT EXISTS users (
  userId TEXT PRIMARY KEY,
  balance INTEGER DEFAULT 0,
  playerTag TEXT
)`, (err) => {
  if (err) console.error("❌ Ошибка users:", err.message);
  else console.log("✅ Таблица users готова");
});

db.run(`
CREATE TABLE IF NOT EXISTS server_bank (
  id INTEGER PRIMARY KEY,
  balance INTEGER DEFAULT 100000
)`, (err) => {
  if (err) console.error("❌ Ошибка server_bank:", err.message);
  else console.log("✅ Таблица server_bank готова");
});

db.run(`INSERT OR IGNORE INTO server_bank (id, balance) VALUES (1, 100000)`);

// ===================== CONFIG =====================
const TOKEN = process.env.TOKEN;
const CLIENT_ID = process.env.CLIENT_ID;
const GUILD_ID = process.env.GUILD_ID;
const LOG_CHANNEL_ID = process.env.LOG_CHANNEL_ID || "1504248461636141186";
const LEADER_ROLE_ID = process.env.LEADER_ROLE_ID;
const SHOP_LOG_CHANNEL_ID = process.env.SHOP_LOG_CHANNEL_ID;
const NOTIFY_ROLE_ID = process.env.NOTIFY_ROLE_ID;
const TICKET_CATEGORY_ID = process.env.TICKET_CATEGORY_ID;
const TICKET_MODERATION_CHANNEL_ID = process.env.TICKET_MODERATION_CHANNEL_ID;

if (!LEADER_ROLE_ID) console.warn("⚠️ LEADER_ROLE_ID не указан");
if (!SHOP_LOG_CHANNEL_ID) console.warn("⚠️ SHOP_LOG_CHANNEL_ID не указан");
if (!TICKET_CATEGORY_ID) console.warn("⚠️ TICKET_CATEGORY_ID не указан");
if (!TICKET_MODERATION_CHANNEL_ID) console.warn("⚠️ TICKET_MODERATION_CHANNEL_ID не указан");

// ===================== НАСТРОЙКИ ВОЙСА =====================
const VOICE_REWARD = 100;
const VOICE_INTERVAL = 60000;

// ===================== BOT =====================
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildVoiceStates,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.DirectMessages
  ]
});

// ===================== КОМАНДЫ =====================
const commands = [
  { name: 'баланс', description: 'Показать баланс' },
  {
    name: 'перевод',
    description: 'Перевести деньги другому игроку',
    options: [
      { name: 'игрок', type: 6, required: true, description: 'Кому перевести' },
      { name: 'сумма', type: 4, required: true, description: 'Сумма перевода' }
    ]
  },
  { name: 'магазин', description: 'Открыть магазин' },
  { name: 'топ', description: 'Топ 10 богачей' },
  {
    name: 'забрать',
    description: '[ЛИДЕР] Забрать деньги у игрока',
    options: [
      { name: 'игрок', type: 6, required: true, description: 'У кого забрать' },
      { name: 'сумма', type: 4, required: true, description: 'Сумма' }
    ]
  },
  { name: 'банк', description: '💰 Баланс банка сервера' },
  {
    name: 'добавитьвбанк',
    description: '💰 [АДМИН] Пополнить банк сервера',
    options: [
      { name: 'сумма', type: 4, required: true, description: 'Сумма пополнения' }
    ]
  },
  {
    name: 'сеттег',
    description: 'Установить свой игровой тег',
    options: [
      { name: 'тег', type: 3, required: true, description: 'Ваш игровой тег (например: Pehota_Leo | 45618)' }
    ]
  }
];

const rest = new REST({ version: '10' }).setToken(TOKEN);

async function register() {
  try {
    await rest.put(Routes.applicationGuildCommands(CLIENT_ID, GUILD_ID), { body: commands });
    console.log("✅ Команды загружены");
  } catch (error) {
    console.error("❌ Ошибка регистрации команд:", error);
  }
}

client.once('ready', async () => {
  console.log(`✅ Онлайн: ${client.user.tag}`);
  await register();
  console.log(`🎧 Войс-награда: ${VOICE_REWARD}$ каждую минуту (нужно 2+ человека)`);
});

function addUser(id) {
  db.run(`INSERT OR IGNORE INTO users (userId, balance) VALUES (?, 0)`, [id]);
}

// Функция получения игрового тега
function getDisplayName(userId, userTag, callback) {
  db.get(`SELECT playerTag FROM users WHERE userId = ?`, [userId], (err, row) => {
    if (row && row.playerTag) {
      callback(row.playerTag);
    } else {
      callback(userTag);
    }
  });
}

// ===================== ВОЙС-СИСТЕМА =====================
const voiceState = new Map();

setInterval(async () => {
  const now = Date.now();
  for (const guild of client.guilds.cache.values()) {
    for (const channel of guild.channels.cache.values()) {
      if (!channel.isVoiceBased()) continue;
      
      const activeMembers = channel.members.filter(m => 
        !m.user.bot && 
        !m.voice.selfMute && 
        !m.voice.selfDeaf && 
        !m.voice.serverMute && 
        !m.voice.serverDeaf
      );
      
      if (activeMembers.size < 2) continue;
      
      for (const member of activeMembers.values()) {
        let state = voiceState.get(member.id);
        if (!state) {
          state = { lastReward: now, lastActive: now };
          voiceState.set(member.id, state);
          continue;
        }
        
        if (now - state.lastActive > 120000) {
          state.lastReward = now;
          state.lastActive = now;
          voiceState.set(member.id, state);
          continue;
        }
        
        state.lastActive = now;
        
        if (now - state.lastReward >= VOICE_INTERVAL) {
          addUser(member.id);
          db.run(`UPDATE users SET balance = balance + ? WHERE userId = ?`, [VOICE_REWARD, member.id]);
          state.lastReward = now;
          voiceState.set(member.id, state);
          console.log(`✅ ${member.user.tag} +${VOICE_REWARD}$`);
        }
      }
    }
  }
}, 30000);

client.on('voiceStateUpdate', (oldState, newState) => {
  const member = newState.member || oldState.member;
  if (member.user.bot) return;
  const now = Date.now();
  if (!oldState.channelId && newState.channelId) {
    voiceState.set(member.id, { lastReward: now, lastActive: now });
  }
  if (oldState.channelId && !newState.channelId) {
    voiceState.delete(member.id);
  }
});

// ===================== КОМАНДА !СКРИН =====================
client.on('messageCreate', async (message) => {
  if (message.author.bot) return;
  if (message.content === '!скрин') {
    const embed = new EmbedBuilder()
      .setColor(0x5865F2)
      .setTitle('📸 Создать заявку на вывод')
      .setDescription('Нажми на кнопку ниже, чтобы создать тикет и получить **10,000$**')
      .addFields(
        { name: '📌 Инструкция', value: '1. Нажми кнопку "Создать тикет"\n2. Отправь скриншот (Ctrl+V)\n3. Дождись ответа модератора', inline: false },
        { name: '💰 Сумма', value: '**10,000$**', inline: true },
        { name: '⏱️ Время ответа', value: 'Обычно в течение 24 часов', inline: true }
      )
      .setFooter({ text: 'GTA Family System', iconURL: client.user.displayAvatarURL() })
      .setTimestamp();

    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId('create_ticket')
        .setLabel('📸 Создать тикет')
        .setStyle(ButtonStyle.Success)
        .setEmoji('🎫')
    );

    await message.channel.send({ embeds: [embed], components: [row] });
  }
});

// ===================== ТИКЕТ-СИСТЕМА =====================
const tickets = new Map();

client.on('interactionCreate', async (interaction) => {
  if (!interaction.isButton()) return;
  if (interaction.customId !== 'create_ticket') return;

  if (!TICKET_CATEGORY_ID) {
    return interaction.reply({ content: '❌ Система тикетов не настроена (нет категории)', ephemeral: true });
  }

  const existing = interaction.guild.channels.cache.find(ch => ch.name === `ticket-${interaction.user.id}`);
  if (existing) {
    return interaction.reply({ content: `❌ У вас уже есть открытый тикет: ${existing}`, ephemeral: true });
  }

  await interaction.reply({ content: '🔄 Создаю тикет...', ephemeral: true });

  const channel = await interaction.guild.channels.create({
    name: `ticket-${interaction.user.id}`,
    type: 0,
    parent: TICKET_CATEGORY_ID,
    permissionOverwrites: [
      { id: interaction.guild.id, deny: ['ViewChannel'] },
      { id: interaction.user.id, allow: ['ViewChannel', 'SendMessages', 'AttachFiles', 'ReadMessageHistory'] },
      { id: LEADER_ROLE_ID, allow: ['ViewChannel', 'SendMessages', 'ReadMessageHistory'] }
    ]
  });

  tickets.set(channel.id, { userId: interaction.user.id, status: 'waiting', username: interaction.user.tag });

  const embed = new EmbedBuilder()
    .setColor(0x2b2d31)
    .setTitle('📸 Заявка на вывод 10,000$')
    .setDescription(`👤 **Игрок:** ${interaction.user.tag}\n📌 **Инструкция:** Отправьте ОДИН скриншот (Ctrl+V) для получения 10,000$\n💰 **Сумма:** 10,000$`)
    .setFooter({ text: 'Ожидание скриншота...' })
    .setTimestamp();

  await channel.send({ content: `<@${interaction.user.id}>`, embeds: [embed] });
  await interaction.editReply({ content: `✅ Тикет создан: ${channel}`, ephemeral: true });
});

// ===================== ОБРАБОТКА СКРИНШОТА =====================
client.on('messageCreate', async (message) => {
  if (message.author.bot) return;
  
  const ticket = tickets.get(message.channel.id);
  if (!ticket || ticket.status !== 'waiting') return;

  const attachment = message.attachments.first();
  if (!attachment || !attachment.contentType?.startsWith('image/')) return;

  ticket.screenshot = attachment.url;
  ticket.status = 'ready';
  tickets.set(message.channel.id, ticket);

  const imageResponse = await fetch(attachment.url);
  const imageBuffer = Buffer.from(await imageResponse.arrayBuffer());
  
  await message.delete();

  const modChannel = client.channels.cache.get(TICKET_MODERATION_CHANNEL_ID);
  
  if (!modChannel) {
    console.error("❌ Канал модерации не найден!");
    return;
  }
  
  const embed = new EmbedBuilder()
    .setColor(0xffa500)
    .setTitle('📸 НОВАЯ ЗАЯВКА НА ВЫДАЧУ')
    .setDescription(`👤 **Игрок:** ${ticket.username} (<@${ticket.userId}>)\n💰 **Сумма:** 10,000$\n📌 **Тикет:** ${message.channel.name}`)
    .setImage('attachment://screenshot.png')
    .setTimestamp()
    .setFooter({ text: 'Нажми на кнопку, чтобы обработать заявку' });

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`approve_${message.channel.id}`)
      .setLabel('✅ Выдать 10,000$')
      .setStyle(ButtonStyle.Success),
    new ButtonBuilder()
      .setCustomId(`deny_${message.channel.id}`)
      .setLabel('❌ Отказать')
      .setStyle(ButtonStyle.Danger)
  );

  if (NOTIFY_ROLE_ID) {
    await modChannel.send({ 
      content: `<@&${NOTIFY_ROLE_ID}>, 📸 **Новая заявка на выдачу!**`,
      embeds: [embed], 
      components: [row],
      files: [{ attachment: imageBuffer, name: 'screenshot.png' }]
    });
  } else {
    await modChannel.send({ 
      embeds: [embed], 
      components: [row],
      files: [{ attachment: imageBuffer, name: 'screenshot.png' }]
    });
  }

  const waitingEmbed = new EmbedBuilder()
    .setColor(0x2b2d31)
    .setTitle('⏳ Заявка отправлена')
    .setDescription('Ваш скриншот отправлен на рассмотрение модераторам. Ожидайте ответа.')
    .setTimestamp();

  await message.channel.send({ embeds: [waitingEmbed] });
});

// ===================== ВЫДАТЬ / ОТКАЗАТЬ =====================
client.on('interactionCreate', async (interaction) => {
  if (!interaction.isButton()) return;
  if (!interaction.customId.startsWith('approve_') && !interaction.customId.startsWith('deny_')) return;

  if (!interaction.guild) {
    return interaction.reply({ content: '❌ Эта команда доступна только на сервере!', ephemeral: true });
  }

  const member = interaction.guild.members.cache.get(interaction.user.id);
  if (!member || !member.roles.cache.has(LEADER_ROLE_ID)) {
    return interaction.reply({ content: '❌ У вас нет прав для этого!', ephemeral: true });
  }

  const channelId = interaction.customId.split('_')[1];
  const ticket = tickets.get(channelId);
  if (!ticket) {
    return interaction.reply({ content: '❌ Тикет не найден', ephemeral: true });
  }

  const user = await client.users.fetch(ticket.userId).catch(() => null);

  if (interaction.customId.startsWith('approve_')) {
    db.get(`SELECT balance FROM server_bank WHERE id = 1`, async (err, row) => {
      if (err || !row || row.balance < 10000) {
        return interaction.reply({ 
          content: `❌ В банке сервера недостаточно средств! Доступно: ${row?.balance || 0}$`, 
          ephemeral: true 
        });
      }

      db.run(`UPDATE server_bank SET balance = balance - 10000 WHERE id = 1`);
      addUser(ticket.userId);
      db.run(`UPDATE users SET balance = balance + 10000 WHERE userId = ?`, [ticket.userId]);

      if (user) {
        const successEmbed = new EmbedBuilder()
          .setColor(0x00ff00)
          .setTitle('✅ Заявка одобрена!')
          .setDescription(`💰 Вам начислено **10,000$**\n📌 Средства уже на вашем балансе.`)
          .setTimestamp();
        await user.send({ embeds: [successEmbed] });
      }

      const embed = EmbedBuilder.from(interaction.message.embeds[0])
        .setColor(0x00ff00)
        .addFields(
          { name: '✅ Статус', value: 'ОДОБРЕНО', inline: true },
          { name: '👨‍⚖️ Выдал', value: interaction.user.tag, inline: true }
        );

      await interaction.update({ embeds: [embed], components: [] });
      await interaction.followUp({ content: '✅ Выдача выполнена! Тикет будет закрыт через 5 секунд.' });
    });
  } else {
    if (user) {
      const denyEmbed = new EmbedBuilder()
        .setColor(0xff0000)
        .setTitle('❌ Заявка отклонена')
        .setDescription('📌 Причина: Не соблюдены условия выдачи.\n\nЕсли у вас есть вопросы, обратитесь к администрации.')
        .setTimestamp();
      await user.send({ embeds: [denyEmbed] });
    }

    const embed = EmbedBuilder.from(interaction.message.embeds[0])
      .setColor(0xff0000)
      .addFields(
        { name: '❌ Статус', value: 'ОТКАЗАНО', inline: true },
        { name: '👨‍⚖️ Отказал', value: interaction.user.tag, inline: true }
      );

    await interaction.update({ embeds: [embed], components: [] });
    await interaction.followUp({ content: '❌ Отказано. Тикет будет закрыт через 5 секунд.' });
  }

  setTimeout(async () => {
    const channel = await client.channels.fetch(channelId).catch(() => null);
    if (channel) await channel.delete();
    tickets.delete(channelId);
  }, 5000);
});

// ===================== ОБРАБОТКА КНОПКИ "СВОЯ СУММА" =====================
client.on('interactionCreate', async (interaction) => {
  if (!interaction.isButton()) return;
  if (interaction.customId !== 'custom_amount') return;

  const modal = new ModalBuilder()
    .setCustomId('custom_amount_modal')
    .setTitle('💸 Введите сумму');

  const amountInput = new TextInputBuilder()
    .setCustomId('amount')
    .setLabel('Сумма для покупки')
    .setStyle(TextInputStyle.Short)
    .setPlaceholder('Например: 5000')
    .setRequired(true);

  const row = new ActionRowBuilder().addComponents(amountInput);
  modal.addComponents(row);

  await interaction.showModal(modal);
});

// ===================== ОБРАБОТКА МОДАЛЬНОГО ОКНА =====================
client.on('interactionCreate', async (interaction) => {
  if (!interaction.isModalSubmit()) return;
  if (interaction.customId !== 'custom_amount_modal') return;

  const amount = parseInt(interaction.fields.getTextInputValue('amount'));
  
  if (isNaN(amount) || amount <= 0) {
    return interaction.reply({ content: '❌ Введите корректную сумму!', ephemeral: true });
  }

  addUser(interaction.user.id);
  
  db.get(`SELECT balance FROM users WHERE userId = ?`, [interaction.user.id], async (err, row) => {
    if (err || !row || row.balance < amount) {
      return interaction.reply({ 
        content: `❌ Недостаточно денег! Ваш баланс: ${row?.balance || 0}$`, 
        ephemeral: true 
      });
    }

    db.run(`UPDATE users SET balance = balance - ? WHERE userId = ?`, [amount, interaction.user.id]);

    getDisplayName(interaction.user.id, interaction.user.tag, async (displayName) => {
      const shopLogChannel = client.channels.cache.get(SHOP_LOG_CHANNEL_ID);
      
      if (shopLogChannel) {
        try {
          await shopLogChannel.send({
            content: `🛒 **${displayName}** (<@${interaction.user.id}>) купил товар: \`Кастомная сумма (${amount}$)\` за **${amount}$**\n💰 Деньги списаны.`,
            allowedMentions: { users: [interaction.user.id] }
          });
        } catch (err) {
          console.error("❌ Ошибка отправки уведомления:", err);
        }
      }
    });

    interaction.reply({ 
      content: `✅ Вы успешно купили кастомную сумму за **${amount}$**!`, 
      ephemeral: true 
    });
  });
});

// ===================== ОБРАБОТКА СЛЭШ-КОМАНД =====================
client.on('interactionCreate', async (i) => {
  if (!i.isChatInputCommand()) return;
  addUser(i.user.id);

  try {
    switch (i.commandName) {
      case 'баланс':
        db.get(`SELECT balance FROM users WHERE userId = ?`, [i.user.id], (e, r) => {
          i.reply({ content: `💰 Баланс: ${r?.balance || 0}$`, flags: MessageFlags.Ephemeral });
        });
        break;

      case 'сеттег':
        const playerTag = i.options.getString('тег');
        db.run(`UPDATE users SET playerTag = ? WHERE userId = ?`, [playerTag, i.user.id]);
        i.reply({ content: `✅ Ваш игровой тег установлен: **${playerTag}**`, flags: MessageFlags.Ephemeral });
        break;

      case 'банк':
        db.get(`SELECT balance FROM server_bank WHERE id = 1`, (e, r) => {
          i.reply({ content: `🏦 **Банк сервера:** ${r?.balance || 0}$`, flags: MessageFlags.Ephemeral });
        });
        break;

      case 'добавитьвбанк':
        if (!i.member.roles.cache.has(LEADER_ROLE_ID)) {
          return i.reply({ content: "❌ У вас нет прав для этой команды.", flags: MessageFlags.Ephemeral });
        }
        const addAmount = i.options.getInteger('сумма');
        if (addAmount <= 0) {
          return i.reply({ content: "❌ Сумма должна быть больше 0", flags: MessageFlags.Ephemeral });
        }
        db.run(`UPDATE server_bank SET balance = balance + ? WHERE id = 1`, [addAmount]);
        db.get(`SELECT balance FROM server_bank WHERE id = 1`, (e, r) => {
          i.reply({ content: `✅ Добавлено ${addAmount}$. Новый баланс банка: ${r.balance}$`, flags: MessageFlags.Ephemeral });
        });
        break;

      case 'перевод':
        const user = i.options.getUser('игрок');
        const amount = i.options.getInteger('сумма');
        if (amount <= 0) {
          return i.reply({ content: "❌ Сумма должна быть больше 0", flags: MessageFlags.Ephemeral });
        }
        db.get(`SELECT balance FROM users WHERE userId = ?`, [i.user.id], (e, r) => {
          if ((r?.balance || 0) < amount) {
            return i.reply({ content: "❌ Недостаточно денег", flags: MessageFlags.Ephemeral });
          }
          addUser(user.id);
          db.run(`UPDATE users SET balance = balance - ? WHERE userId = ?`, [amount, i.user.id]);
          db.run(`UPDATE users SET balance = balance + ? WHERE userId = ?`, [amount, user.id]);
          i.reply({ content: `💸 Переведено ${amount}$ пользователю ${user.username}`, flags: MessageFlags.Ephemeral });
        });
        break;

      case 'забрать':
        if (!i.member.roles.cache.has(LEADER_ROLE_ID)) {
          return i.reply({ content: "❌ У вас нет прав для этой команды.", flags: MessageFlags.Ephemeral });
        }
        const target = i.options.getUser('игрок');
        const val = i.options.getInteger('сумма');
        if (val <= 0) {
          return i.reply({ content: "❌ Сумма должна быть больше 0", flags: MessageFlags.Ephemeral });
        }
        addUser(target.id);
        db.get(`SELECT balance FROM users WHERE userId = ?`, [target.id], (e, r) => {
          const curr = r?.balance || 0;
          if (curr < val) {
            return i.reply({ content: `❌ У игрока ${target.username} только ${curr}$`, flags: MessageFlags.Ephemeral });
          }
          db.run(`UPDATE users SET balance = balance - ? WHERE userId = ?`, [val, target.id]);
          const logCh = client.channels.cache.get(LOG_CHANNEL_ID);
          if (logCh) {
            logCh.send(`🔻 **Лидер ${i.user.username} забрал ${val}$ у ${target.username}**`);
          }
          i.reply({ content: `✅ Вы забрали ${val}$ у ${target.username}. Новый баланс: ${curr - val}$`, flags: MessageFlags.Ephemeral });
        });
        break;

      case 'магазин':
        const row1 = new ActionRowBuilder().addComponents(
          new ButtonBuilder().setCustomId('buy_5000').setLabel('💲5000$').setStyle(ButtonStyle.Primary),
          new ButtonBuilder().setCustomId('buy_10000').setLabel('💲10000$').setStyle(ButtonStyle.Primary),
          new ButtonBuilder().setCustomId('buy_15000').setLabel('💲15000$').setStyle(ButtonStyle.Success),
          new ButtonBuilder().setCustomId('buy_20000').setLabel('💲20000$').setStyle(ButtonStyle.Primary),
          new ButtonBuilder().setCustomId('buy_25000').setLabel('💲25000$').setStyle(ButtonStyle.Success)
        );
        const row2 = new ActionRowBuilder().addComponents(
          new ButtonBuilder().setCustomId('buy_Пулемет').setLabel('🔫 Пулемет 20000$').setStyle(ButtonStyle.Secondary),
          new ButtonBuilder().setCustomId('buy_Граната').setLabel('💣 Граната 50000$').setStyle(ButtonStyle.Secondary),
          new ButtonBuilder().setCustomId('buy_Дефик').setLabel('🛡️ Дефик 150000$').setStyle(ButtonStyle.Danger),
          new ButtonBuilder().setCustomId('buy_Мушкет').setLabel('🔫 Мушкет 180000$').setStyle(ButtonStyle.Success)
        );
        const row3 = new ActionRowBuilder().addComponents(
          new ButtonBuilder()
            .setCustomId('custom_amount')
            .setLabel('💸 Ввести свою сумму')
            .setStyle(ButtonStyle.Secondary)
        );
        i.reply({ content: "🛒 МАГАЗИН", components: [row1, row2, row3], flags: MessageFlags.Ephemeral });
        break;

      case 'топ':
        db.all(`SELECT userId, balance FROM users ORDER BY balance DESC LIMIT 10`, [], (e, rows) => {
          if (!rows?.length) return i.reply({ content: "❌ Нет данных", flags: MessageFlags.Ephemeral });
          let text = "🏆 ТОП 10 по деньгам:\n\n";
          rows.forEach((u, idx) => {
            text += `#${idx + 1} <@${u.userId}> — ${u.balance}$\n`;
          });
          i.reply({ content: text, flags: MessageFlags.Ephemeral });
        });
        break;
    }
  } catch (err) {
    console.error("ERROR в команде:", err);
  }
});

// ===================== КНОПКИ МАГАЗИНА (ОСТАЛЬНЫЕ) =====================
client.on('interactionCreate', async (i) => {
  if (!i.isButton()) return;
  
  const shop = {
    buy_5000: 5000, buy_10000: 10000, buy_15000: 15000, buy_20000: 20000, buy_25000: 25000,
    buy_Пулемет: 20000, buy_Граната: 50000, buy_Дефик: 150000, buy_Мушкет: 180000
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

    getDisplayName(i.user.id, i.user.tag, async (displayName) => {
      const shopLogChannel = client.channels.cache.get(SHOP_LOG_CHANNEL_ID);
      
      if (shopLogChannel) {
        try {
          await shopLogChannel.send({
            content: `🛒 **${displayName}** (<@${i.user.id}>) купил товар: \`${i.customId}\` за **${price}$**\n💰 Деньги списаны.`,
            allowedMentions: { users: [i.user.id] }
          });
        } catch (err) {
          console.error("❌ Ошибка отправки уведомления:", err);
        }
      }
    });

    i.editReply({ content: `✅ Вы купили предмет за ${price}$.`, flags: MessageFlags.Ephemeral });
  });
});

client.login(TOKEN);
