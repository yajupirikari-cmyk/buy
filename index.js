require('dotenv').config();
const { Client, GatewayIntentBits, EmbedBuilder, ActionRowBuilder, StringSelectMenuBuilder, ButtonBuilder, ButtonStyle, PermissionsBitField } = require('discord.js');
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

// ダミーの商品設定。実際には適宜変更してください。
const SHOP_ITEMS = [
    {
        label: 'VIPロール',
        description: 'VIPロールを購入します（価格: 500マネー）',
        value: 'role_123456789012345678', // valueは role_ロールID の形式にします
        price: 500,
        roleId: '123456789012345678'
    },
    {
        label: 'カスタムカラーロール',
        description: '色付きのロールを購入します（価格: 300マネー）',
        value: 'role_234567890123456789',
        price: 300,
        roleId: '234567890123456789'
    }
];

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

    // 権限チェック関数（管理者権限 または 指定ロール）
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

        const embed = new EmbedBuilder()
            .setTitle('🛒 アイテムショップ')
            .setDescription('購入したいアイテムを下のメニューから選んでください。\n申請が管理者に送られ、承認されるとマネーが引かれて付与されます。')
            .setColor(0x00FF00);

        const selectMenu = new StringSelectMenuBuilder()
            .setCustomId('shop_select')
            .setPlaceholder('アイテムを選択してください')
            .addOptions(SHOP_ITEMS.map(item => ({
                label: item.label,
                description: item.description,
                value: item.value
            })));

        const row = new ActionRowBuilder().addComponents(selectMenu);

        await message.channel.send({ embeds: [embed], components: [row] });
        return message.reply('ショップパネルを設置しました。').then(m => setTimeout(() => m.delete().catch(()=>{}), 3000));
    }
});

client.on('interactionCreate', async interaction => {
    if (interaction.isStringSelectMenu() && interaction.customId === 'shop_select') {
        const selectedValue = interaction.values[0];
        const item = SHOP_ITEMS.find(i => i.value === selectedValue);

        if (!item) return interaction.reply({ content: 'エラー: アイテムが見つかりません。', ephemeral: true });

        // 承認チャンネルへ通知
        const approvalChannel = client.channels.cache.get(APPROVAL_CHANNEL_ID);
        if (!approvalChannel) {
            return interaction.reply({ content: 'エラー: 承認チャンネルが見つかりません。', ephemeral: true });
        }

        const embed = new EmbedBuilder()
            .setTitle('🔔 購入申請')
            .addFields(
                { name: '申請者', value: `${interaction.user.tag} (${interaction.user.id})` },
                { name: '購入希望アイテム', value: `${item.label}` },
                { name: '価格', value: `${item.price} マネー` }
            )
            .setColor(0xFFA500)
            .setTimestamp();

        const approveBtn = new ButtonBuilder()
            .setCustomId(`approve_${interaction.user.id}_${item.roleId}_${item.price}`)
            .setLabel('承認する')
            .setStyle(ButtonStyle.Success);
        
        const rejectBtn = new ButtonBuilder()
            .setCustomId(`reject_${interaction.user.id}_${item.roleId}`)
            .setLabel('拒否する')
            .setStyle(ButtonStyle.Danger);

        const row = new ActionRowBuilder().addComponents(approveBtn, rejectBtn);

        await approvalChannel.send({ content: `<@&${ADMIN_ROLE_ID}>`, embeds: [embed], components: [row] });

        await interaction.reply({ content: `✅ **${item.label}** の購入申請を送信しました。管理者の承認をお待ちください。`, ephemeral: true });
    }

    if (interaction.isButton()) {
        const [action, targetUserId, roleId, priceStr] = interaction.customId.split('_');

        if (action !== 'approve' && action !== 'reject') return;

        // 権限チェック
        const hasAdminPermission = interaction.member.permissions.has(PermissionsBitField.Flags.Administrator) ||
                                   interaction.member.roles.cache.has(ADMIN_ROLE_ID);
        
        if (!hasAdminPermission) {
            return interaction.reply({ content: 'この操作を行う権限がありません。', ephemeral: true });
        }

        const targetMember = await interaction.guild.members.fetch(targetUserId).catch(() => null);
        const originalEmbed = interaction.message.embeds[0];

        if (action === 'approve') {
            const price = parseInt(priceStr);

            // マネーチェックと減算
            let userRecord = await User.findOne({ userId: targetUserId });
            if (!userRecord || userRecord.money < price) {
                const errorEmbed = EmbedBuilder.from(originalEmbed)
                    .setColor(0xFF0000)
                    .setTitle('❌ 承認失敗 (残高不足)')
                    .addFields({ name: 'ステータス', value: `残高が不足しています。申請はキャンセルされました。\n承認者: ${interaction.user.username} (${interaction.user.id})` });
                
                await interaction.update({ embeds: [errorEmbed], components: [] });
                if (targetMember) targetMember.send(`❌ あなたの購入申請は残高不足のためキャンセルされました。`).catch(()=>{});
                return;
            }

            userRecord.money -= price;
            await userRecord.save();

            // ロール付与
            if (targetMember) {
                const role = interaction.guild.roles.cache.get(roleId);
                if (role) {
                    await targetMember.roles.add(role).catch(err => console.error('Role add error:', err));
                    targetMember.send(`✅ 購入申請が承認され、**${role.name}** が付与されました！\n残高: ${userRecord.money}`).catch(()=>{});
                }
            }

            const successEmbed = EmbedBuilder.from(originalEmbed)
                .setColor(0x00FF00)
                .setTitle('✅ 承認済み')
                .addFields({ name: 'ステータス', value: `承認済み: ${interaction.user.username} (${interaction.user.id})` });
            
            await interaction.update({ embeds: [successEmbed], components: [] });

        } else if (action === 'reject') {
            const rejectEmbed = EmbedBuilder.from(originalEmbed)
                .setColor(0xFF0000)
                .setTitle('❌ 拒否済み')
                .addFields({ name: 'ステータス', value: `拒否済み: ${interaction.user.username} (${interaction.user.id})` });
            
            await interaction.update({ embeds: [rejectEmbed], components: [] });
            if (targetMember) targetMember.send(`❌ あなたの購入申請は管理者によって拒否されました。`).catch(()=>{});
        }
    }
});

client.login(process.env.DISCORD_TOKEN);

// --- Renderデプロイ用のダミーサーバー ---
// RenderのWeb Service(無料枠)はWebサーバーとしてポートを開かないとエラーで停止するため、簡易サーバーを立てます。
const http = require('http');
const server = http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end('Discord Bot is running!\n');
});
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Dummy web server listening on port ${PORT}`);
});
