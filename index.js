require('dotenv').config();
const { Client, GatewayIntentBits, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, PermissionsBitField, ModalBuilder, TextInputBuilder, TextInputStyle } = require('discord.js');
const mongoose = require('mongoose');
const User = require('./models/User');

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.GuildMembers
    ]
});

const ADMIN_ROLE_ID = '1515576671875371048';
const APPROVAL_CHANNEL_ID = '1515576976864182403';
const SHOP_CHANNEL_ID = '1515566449106616460';

// ユーザーをIDまたはメンションから取得するヘルパー
async function resolveUser(guild, mentionOrId) {
    if (!mentionOrId) return null;
    const id = mentionOrId.replace(/[<@!>]/g, '');
    try {
        return await client.users.fetch(id);
    } catch {
        return null;
    }
}

// メンバーをIDから取得するヘルパー
async function resolveMember(guild, id) {
    try {
        return await guild.members.fetch(id);
    } catch {
        return null;
    }
}

client.once('clientReady', async () => {
    console.log(`Logged in as ${client.user.tag}!`);
    try {
        await mongoose.connect(process.env.MONGODB_URI);
        console.log('Connected to MongoDB');
    } catch (error) {
        console.error('MongoDB connection error:', error);
    }

    // 毎分ごとのショップパネル確認処理
    setInterval(async () => {
        const shopChannel = client.channels.cache.get(SHOP_CHANNEL_ID);
        if (!shopChannel) return;

        try {
            const messages = await shopChannel.messages.fetch({ limit: 10 });
            const hasPanel = messages.some(m =>
                m.author.id === client.user.id &&
                m.embeds.length > 0 &&
                m.embeds[0].title === 'アイテムショップ'
            );

            if (!hasPanel) {
                const embed = new EmbedBuilder()
                    .setTitle('アイテムショップ')
                    .setDescription('購入したいアイテムがある場合は、下の「購入」ボタンを押してほしいものを入力してください。\n申請が管理者に送られ、承認されるとマネーが引かれます。')
                    .setColor(0x00FF00);

                const buyBtn = new ButtonBuilder()
                    .setCustomId('buy_request_btn')
                    .setLabel('購入')
                    .setStyle(ButtonStyle.Primary);

                const row = new ActionRowBuilder().addComponents(buyBtn);
                await shopChannel.send({ embeds: [embed], components: [row] });
            }
        } catch (err) {
            console.error('ショップパネルの自動確認中にエラーが発生しました:', err);
        }
    }, 60 * 1000);
});

const hasAdminPermission = (member) => {
    return member.permissions.has(PermissionsBitField.Flags.Administrator) ||
           member.roles.cache.has(ADMIN_ROLE_ID);
};

client.on('messageCreate', async message => {
    if (message.author.bot) return;

    const content = message.content.trim();
    const args = content.split(/\s+/);
    const command = args[0].toLowerCase();

    // !money @ユーザー <金額>
    if (command === '!money') {
        if (message.channel.id !== APPROVAL_CHANNEL_ID) {
            return message.reply('エラー: このコマンドは承認チャンネルでのみ使用できます。');
        }
        if (!hasAdminPermission(message.member)) {
            return message.reply('このコマンドを実行する権限がありません。');
        }

        const targetUser = message.mentions.users.first() || await resolveUser(message.guild, args[1]);
        const amount = parseInt(args[2] || args[1]);

        if (!targetUser || isNaN(amount) || amount <= 0) {
            return message.reply('使用方法: `!money @ユーザー <金額>` または `!money ユーザーID <金額>`');
        }

        let userRecord = await User.findOne({ userId: targetUser.id });
        if (!userRecord) {
            userRecord = new User({ userId: targetUser.id, money: 0 });
        }
        userRecord.money += amount;
        await userRecord.save();

        return message.reply(`${targetUser.tag} に ${amount} マネーを付与しました。（現在: ${userRecord.money}）`);
    }

    // -money @ユーザー <金額>
    if (command === '-money') {
        if (message.channel.id !== APPROVAL_CHANNEL_ID) {
            return message.reply('エラー: このコマンドは承認チャンネルでのみ使用できます。');
        }
        if (!hasAdminPermission(message.member)) {
            return message.reply('このコマンドを実行する権限がありません。');
        }

        const targetUser = message.mentions.users.first() || await resolveUser(message.guild, args[1]);
        const amount = parseInt(args[2] || args[1]);

        if (!targetUser || isNaN(amount) || amount <= 0) {
            return message.reply('使用方法: `-money @ユーザー <金額>` または `-money ユーザーID <金額>`');
        }

        let userRecord = await User.findOne({ userId: targetUser.id });
        if (!userRecord) {
            return message.reply(`${targetUser.tag} のデータが存在しません。`);
        }
        if (userRecord.money < amount) {
            return message.reply(`エラー: ${targetUser.tag} の残高 (${userRecord.money}) が不足しています。`);
        }

        userRecord.money -= amount;
        await userRecord.save();

        return message.reply(`${targetUser.tag} から ${amount} マネーを減額しました。（現在: ${userRecord.money}）`);
    }

    // !resetmoney @ユーザー
    if (command === '!resetmoney') {
        if (message.channel.id !== APPROVAL_CHANNEL_ID) {
            return message.reply('エラー: このコマンドは承認チャンネルでのみ使用できます。');
        }
        if (!hasAdminPermission(message.member)) {
            return message.reply('このコマンドを実行する権限がありません。');
        }

        const targetUser = message.mentions.users.first() || await resolveUser(message.guild, args[1]);
        if (!targetUser) {
            return message.reply('使用方法: `!resetmoney @ユーザー` または `!resetmoney ユーザーID`');
        }

        let userRecord = await User.findOne({ userId: targetUser.id });
        if (!userRecord) {
            return message.reply(`${targetUser.tag} のデータが存在しません。`);
        }

        const oldMoney = userRecord.money;
        userRecord.money = 0;
        await userRecord.save();

        return message.reply(`${targetUser.tag} のマネーを ${oldMoney} から 0 にリセットしました。`);
    }

    // ?money [@ユーザー]
    if (command === '?money') {
        const targetUser = message.mentions.users.first() || await resolveUser(message.guild, args[1]) || message.author;

        let userRecord = await User.findOne({ userId: targetUser.id });
        const money = userRecord ? userRecord.money : 0;

        return message.reply(`${targetUser.tag} の所持マネーは ${money} です。`);
    }

    // ?!rank
    if (command === '?!rank') {
        try {
            // サーバーの全メンバーをAPIから取得（キャッシュなしでも確実に取れる）
            const members = await message.guild.members.fetch();
            const nonBotMembers = members.filter(m => !m.user.bot);

            // 全メンバーのマネー情報を一括取得（DBにない人は0）
            const allRecords = await User.find({});
            const recordMap = {};
            for (const r of allRecords) {
                recordMap[r.userId] = r.money;
            }

            const memberList = [];
            for (const [id, member] of nonBotMembers) {
                memberList.push({
                    tag: member.user.tag,
                    money: recordMap[id] || 0
                });
            }

            // マネー降順でソート（同額はランダム）
            memberList.sort((a, b) => {
                if (b.money !== a.money) return b.money - a.money;
                return Math.random() - 0.5;
            });

            const top20 = memberList.slice(0, 20);

            let rankText = '';
            for (let i = 0; i < top20.length; i++) {
                rankText += `**${i + 1}位** - ${top20[i].tag}: ${top20[i].money} マネー\n`;
            }

            const embed = new EmbedBuilder()
                .setTitle('マネーランキング TOP20')
                .setDescription(rankText || 'メンバーが見つかりませんでした。')
                .setColor(0x00FF00);

            return message.reply({ embeds: [embed] });
        } catch (err) {
            console.error('ランキング取得エラー:', err);
            return message.reply('エラー: ランキングの取得に失敗しました。');
        }
    }

    // ?!help
    if (command === '?!help') {
        const embed = new EmbedBuilder()
            .setTitle('コマンド一覧')
            .addFields(
                { name: '!money @ユーザー <金額>', value: 'マネーを付与する（管理者/承認チャンネル限定）' },
                { name: '-money @ユーザー <金額>', value: 'マネーを減額する（管理者/承認チャンネル限定）' },
                { name: '!resetmoney @ユーザー', value: 'マネーを0にリセットする（管理者/承認チャンネル限定）' },
                { name: '?money [@ユーザー]', value: '所持マネーを確認する（どこでも使用可能）' },
                { name: '?!rank', value: 'マネーランキングTOP20を表示（どこでも使用可能）' },
                { name: '!setup_shop', value: 'ショップパネルを設置する（管理者/ショップチャンネル限定）' },
                { name: '?!help', value: 'このコマンド一覧を表示する' }
            )
            .setColor(0x00FF00);

        return message.reply({ embeds: [embed] });
    }

    // !setup_shop
    if (command === '!setup_shop') {
        if (!hasAdminPermission(message.member)) return;
        if (message.channel.id !== SHOP_CHANNEL_ID) {
            return message.reply('エラー: このコマンドは指定のショップチャンネルでのみ実行可能です。');
        }

        const embed = new EmbedBuilder()
            .setTitle('アイテムショップ')
            .setDescription('購入したいアイテムがある場合は、下の「購入」ボタンを押してほしいものを入力してください。\n申請が管理者に送られ、承認されるとマネーが引かれます。')
            .setColor(0x00FF00);

        const buyBtn = new ButtonBuilder()
            .setCustomId('buy_request_btn')
            .setLabel('購入')
            .setStyle(ButtonStyle.Primary);

        const row = new ActionRowBuilder().addComponents(buyBtn);
        await message.channel.send({ embeds: [embed], components: [row] });
        return message.reply('ショップパネルを設置しました。').then(m => setTimeout(() => m.delete().catch(() => {}), 3000));
    }
});

client.on('interactionCreate', async interaction => {

    // 購入ボタン
    if (interaction.isButton() && interaction.customId === 'buy_request_btn') {
        const modal = new ModalBuilder()
            .setCustomId('modal_buy_request')
            .setTitle('購入申請');

        const inputField = new TextInputBuilder()
            .setCustomId('request_detail_input')
            .setLabel('欲しいものを入力してください')
            .setPlaceholder('例: クラ軍国1番隊長、BAN:123456789など')
            .setStyle(TextInputStyle.Paragraph)
            .setRequired(true);

        modal.addComponents(new ActionRowBuilder().addComponents(inputField));
        await interaction.showModal(modal);
        return;
    }

    // 承認・拒否ボタン
    if (interaction.isButton() && (interaction.customId.startsWith('approve|') || interaction.customId.startsWith('reject|'))) {
        const parts = interaction.customId.split('|');
        const action = parts[0];
        const targetUserId = parts[1];

        if (!hasAdminPermission(interaction.member)) {
            return interaction.reply({ content: 'この操作を行う権限がありません。', ephemeral: true });
        }

        const originalEmbed = interaction.message.embeds[0];
        const targetMember = await resolveMember(interaction.guild, targetUserId);

        if (action === 'approve') {
            const modal = new ModalBuilder()
                .setCustomId(`modal_admin_approve|${targetUserId}|${interaction.message.id}`)
                .setTitle('承認と金額・ロール設定');

            const priceInput = new TextInputBuilder()
                .setCustomId('price_input')
                .setLabel('引き落とすマネーの額')
                .setPlaceholder('例: 1000')
                .setStyle(TextInputStyle.Short)
                .setRequired(true);

            const roleInput = new TextInputBuilder()
                .setCustomId('role_input')
                .setLabel('付与するロールID (不要なら空欄)')
                .setPlaceholder('例: 123456789012345678')
                .setStyle(TextInputStyle.Short)
                .setRequired(false);

            modal.addComponents(
                new ActionRowBuilder().addComponents(priceInput),
                new ActionRowBuilder().addComponents(roleInput)
            );

            await interaction.showModal(modal);
            return;
        }

        if (action === 'reject') {
            const rejectEmbed = EmbedBuilder.from(originalEmbed)
                .setColor(0xFF0000)
                .setTitle('拒否済み')
                .addFields({ name: 'ステータス', value: `拒否済み: ${interaction.user.username} (${interaction.user.id})` });

            await interaction.update({ embeds: [rejectEmbed], components: [] });
            if (targetMember) targetMember.send('あなたの購入申請は管理者によって拒否されました。').catch(() => {});
        }
        return;
    }

    // 購入申請モーダル
    if (interaction.isModalSubmit() && interaction.customId === 'modal_buy_request') {
        const inputValue = interaction.fields.getTextInputValue('request_detail_input');

        const approvalChannel = client.channels.cache.get(APPROVAL_CHANNEL_ID);
        if (!approvalChannel) {
            return interaction.reply({ content: 'エラー: 承認チャンネルが見つかりません。', ephemeral: true });
        }

        const embed = new EmbedBuilder()
            .setTitle('購入申請')
            .addFields(
                { name: '申請者', value: `${interaction.user.tag} (${interaction.user.id})` },
                { name: '希望内容', value: inputValue }
            )
            .setColor(0xFFA500)
            .setTimestamp();

        const approveBtn = new ButtonBuilder()
            .setCustomId(`approve|${interaction.user.id}`)
            .setLabel('承認する')
            .setStyle(ButtonStyle.Success);

        const rejectBtn = new ButtonBuilder()
            .setCustomId(`reject|${interaction.user.id}`)
            .setLabel('拒否する')
            .setStyle(ButtonStyle.Danger);

        const row = new ActionRowBuilder().addComponents(approveBtn, rejectBtn);
        await approvalChannel.send({ content: `<@&${ADMIN_ROLE_ID}>`, embeds: [embed], components: [row] });
        await interaction.reply({ content: '購入申請を送信しました。管理者の承認をお待ちください。', ephemeral: true });
        return;
    }

    // 管理者承認モーダル
    if (interaction.isModalSubmit() && interaction.customId.startsWith('modal_admin_approve|')) {
        const parts = interaction.customId.split('|');
        const targetUserId = parts[1];
        const messageId = parts[2];
        const priceStr = interaction.fields.getTextInputValue('price_input');
        const roleIdStr = interaction.fields.getTextInputValue('role_input');

        const price = parseInt(priceStr);
        if (isNaN(price) || price <= 0) {
            return interaction.reply({ content: 'エラー: マネーの額は正の数字で入力してください。', ephemeral: true });
        }

        const targetMember = await resolveMember(interaction.guild, targetUserId);

        let originalMessage;
        try {
            originalMessage = await interaction.channel.messages.fetch(messageId);
        } catch {
            return interaction.reply({ content: 'エラー: 元の申請メッセージが見つかりません。', ephemeral: true });
        }
        const originalEmbed = originalMessage.embeds[0];

        let role = null;
        if (roleIdStr && roleIdStr.trim() !== '') {
            role = interaction.guild.roles.cache.get(roleIdStr.trim());
            if (!role) {
                return interaction.reply({ content: `エラー: ID \`${roleIdStr.trim()}\` のロールが見つかりません。`, ephemeral: true });
            }
        }

        let userRecord = await User.findOne({ userId: targetUserId });
        const currentMoney = userRecord ? userRecord.money : 0;

        if (currentMoney < price) {
            const errorEmbed = EmbedBuilder.from(originalEmbed)
                .setColor(0xFF0000)
                .setTitle('承認失敗 (残高不足)')
                .addFields({ name: 'ステータス', value: `残高が不足しています。申請はキャンセルされました。\n承認者: ${interaction.user.username} (${interaction.user.id})` });

            await originalMessage.edit({ embeds: [errorEmbed], components: [] });
            await interaction.reply({ content: 'ユーザーの残高が不足していたため、キャンセルしました。', ephemeral: true });
            if (targetMember) targetMember.send('あなたの購入申請は残高不足のためキャンセルされました。').catch(() => {});
            return;
        }

        if (!userRecord) {
            userRecord = new User({ userId: targetUserId, money: 0 });
        }
        userRecord.money -= price;
        await userRecord.save();

        let dmMessage = `申請が承認されました！\n${price} マネー引き落とされました。\n現在の残高: ${userRecord.money}`;
        let statusText = `承認済み: ${interaction.user.username} (${interaction.user.id})\n消費マネー: ${price}`;

        if (role && targetMember) {
            await targetMember.roles.add(role).catch(err => console.error('Role add error:', err));
            dmMessage += `\nロール「${role.name}」が付与されました。`;
            statusText += `\n付与ロール: ${role.name}`;
        }

        if (targetMember) {
            targetMember.send(dmMessage).catch(() => {});
        }

        const successEmbed = EmbedBuilder.from(originalEmbed)
            .setColor(0x00FF00)
            .setTitle('承認済み')
            .addFields({ name: 'ステータス', value: statusText });

        await originalMessage.edit({ embeds: [successEmbed], components: [] });
        await interaction.reply({ content: `承認処理を完了し、${price} マネーを引き落としました。`, ephemeral: true });
        return;
    }
});

client.login(process.env.DISCORD_TOKEN);

// Renderデプロイ用のダミーサーバー
const http = require('http');
const server = http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end('Discord Bot is running!\n');
});
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Dummy web server listening on port ${PORT}`);
});
