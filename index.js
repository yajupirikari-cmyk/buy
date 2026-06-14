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

client.once('ready', async () => {
    console.log(`Logged in as ${client.user.tag}!`);
    try {
        await mongoose.connect(process.env.MONGODB_URI);
        console.log('Connected to MongoDB');
    } catch (error) {
        console.error('MongoDB connection error:', error);
    }
});

client.on('messageCreate', async message => {
    if (message.author.bot) return;

    const args = message.content.split(' ');
    const command = args[0];

    const hasAdminPermission = (member) => {
        return member.permissions.has(PermissionsBitField.Flags.Administrator) ||
               member.roles.cache.has(ADMIN_ROLE_ID);
    };

    if (command === '!money') {
        if (message.channel.id !== APPROVAL_CHANNEL_ID) {
            return message.reply('エラー: このコマンドは承認チャンネルでのみ使用できます。');
        }

        if (!hasAdminPermission(message.member)) {
            return message.reply('このコマンドを実行する権限がありません。');
        }

        const targetUser = message.mentions.users.first() || client.users.cache.get(args[1]);
        const amount = parseInt(args[2]);

        if (!targetUser || isNaN(amount)) {
            return message.reply('使用方法: `!money @ユーザー <金額>`');
        }

        let userRecord = await User.findOne({ userId: targetUser.id });
        if (!userRecord) {
            userRecord = new User({ userId: targetUser.id, money: 0 });
        }
        userRecord.money += amount;
        await userRecord.save();

        return message.reply(`${targetUser.tag} に ${amount} マネーを付与しました。（現在: ${userRecord.money}）`);
    }

    if (command === '?money') {
        const targetUser = message.mentions.users.first() || client.users.cache.get(args[1]) || message.author;
        
        let userRecord = await User.findOne({ userId: targetUser.id });
        const money = userRecord ? userRecord.money : 0;

        return message.reply(`${targetUser.tag} の所持マネーは ${money} です。`);
    }

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
        return message.reply('ショップパネルを設置しました。').then(m => setTimeout(() => m.delete().catch(()=>{}), 3000));
    }
});

client.on('interactionCreate', async interaction => {
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

        const row = new ActionRowBuilder().addComponents(inputField);
        modal.addComponents(row);

        await interaction.showModal(modal);
        return;
    }

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

        await interaction.reply({ content: `購入申請を送信しました。管理者の承認をお待ちください。`, ephemeral: true });
        return;
    }

    if (interaction.isButton()) {
        const parts = interaction.customId.split('|');
        const action = parts[0];
        const targetUserId = parts[1];

        if (action !== 'approve' && action !== 'reject') return;

        const hasAdminPermission = interaction.member.permissions.has(PermissionsBitField.Flags.Administrator) ||
                                   interaction.member.roles.cache.has(ADMIN_ROLE_ID);
        
        if (!hasAdminPermission) {
            return interaction.reply({ content: 'この操作を行う権限がありません。', ephemeral: true });
        }

        const originalEmbed = interaction.message.embeds[0];
        const targetMember = await interaction.guild.members.fetch(targetUserId).catch(() => null);

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
                .setLabel('付与するロールID (付与しない場合は空欄)')
                .setPlaceholder('例: 123456789012345678')
                .setStyle(TextInputStyle.Short)
                .setRequired(false);

            modal.addComponents(
                new ActionRowBuilder().addComponents(priceInput),
                new ActionRowBuilder().addComponents(roleInput)
            );

            await interaction.showModal(modal);
            return;
        } else if (action === 'reject') {
            const rejectEmbed = EmbedBuilder.from(originalEmbed)
                .setColor(0xFF0000)
                .setTitle('拒否済み')
                .addFields({ name: 'ステータス', value: `拒否済み: ${interaction.user.username} (${interaction.user.id})` });
            
            await interaction.update({ embeds: [rejectEmbed], components: [] });
            if (targetMember) targetMember.send(`あなたの購入申請は管理者によって拒否されました。`).catch(()=>{});
        }
    }

    if (interaction.isModalSubmit()) {
        const parts = interaction.customId.split('|');
        if (parts[0] !== 'modal_admin_approve') return;

        const targetUserId = parts[1];
        const messageId = parts[2];
        const priceStr = interaction.fields.getTextInputValue('price_input');
        const roleIdStr = interaction.fields.getTextInputValue('role_input');

        const price = parseInt(priceStr);
        if (isNaN(price)) {
            return interaction.reply({ content: 'エラー: マネーの額は数字で入力してください。', ephemeral: true });
        }

        const targetMember = await interaction.guild.members.fetch(targetUserId).catch(() => null);
        
        let originalMessage;
        try {
            originalMessage = await interaction.channel.messages.fetch(messageId);
        } catch (error) {
            return interaction.reply({ content: 'エラー: 元の申請メッセージが見つかりません。', ephemeral: true });
        }
        const originalEmbed = originalMessage.embeds[0];

        let role = null;
        if (roleIdStr && roleIdStr.trim() !== '') {
            role = interaction.guild.roles.cache.get(roleIdStr.trim());
            if (!role) {
                return interaction.reply({ content: `エラー: サーバー内にID \`${roleIdStr}\` のロールが見つかりません。`, ephemeral: true });
            }
        }

        let userRecord = await User.findOne({ userId: targetUserId });
        if (!userRecord || userRecord.money < price) {
            const errorEmbed = EmbedBuilder.from(originalEmbed)
                .setColor(0xFF0000)
                .setTitle('承認失敗 (残高不足)')
                .addFields({ name: 'ステータス', value: `残高が不足しています。申請はキャンセルされました。\n承認者: ${interaction.user.username} (${interaction.user.id})` });
            
            await originalMessage.edit({ embeds: [errorEmbed], components: [] });
            await interaction.reply({ content: 'ユーザーの残高が不足していたため、キャンセルしました。', ephemeral: true });
            if (targetMember) targetMember.send(`あなたの購入申請は残高不足のためキャンセルされました。`).catch(()=>{});
            return;
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
            targetMember.send(dmMessage).catch(()=>{});
        }

        const successEmbed = EmbedBuilder.from(originalEmbed)
            .setColor(0x00FF00)
            .setTitle('承認済み')
            .addFields({ name: 'ステータス', value: statusText });
        
        await originalMessage.edit({ embeds: [successEmbed], components: [] });
        await interaction.reply({ content: `承認処理を完了し、${price} マネーを引き落としました。`, ephemeral: true });
    }
});

client.login(process.env.DISCORD_TOKEN);

// --- Renderデプロイ用のダミーサーバー ---
const http = require('http');
const server = http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end('Discord Bot is running!\n');
});
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Dummy web server listening on port ${PORT}`);
});
