import bcrypt from 'bcryptjs';
import AppDataSource from './data-source';
import { ChannelType } from './entities/channel-type.entity';
import { Plan } from './entities/plan.entity';
import { User } from './entities/user.entity';

async function main() {
  await AppDataSource.initialize();

  const plans = AppDataSource.getRepository(Plan);
  const channelTypes = AppDataSource.getRepository(ChannelType);
  const users = AppDataSource.getRepository(User);

  await plans.upsert(
    [
      {
        id: 'plan_starter',
        name: 'Starter',
        slug: 'starter',
        price: Number(process.env.PLAN_STARTER_PRICE || 149),
        maxAgents: 3,
        maxChannels: 2,
        maxMessages: 1000,
        features: JSON.stringify(['Unified Inbox', '2 Channels', 'Basic Chatbot', 'Email Support']),
        stripePriceId: process.env.STRIPE_PRICE_STARTER || null,
      },
      {
        id: 'plan_professional',
        name: 'Professional',
        slug: 'professional',
        price: Number(process.env.PLAN_PROFESSIONAL_PRICE || 399),
        maxAgents: 10,
        maxChannels: 5,
        maxMessages: 10000,
        features: JSON.stringify([
          'Unified Inbox',
          'All Channels',
          'Advanced Chatbot',
          'Auto Assignment',
          'Analytics',
          'Priority Support',
        ]),
        stripePriceId: process.env.STRIPE_PRICE_PROFESSIONAL || null,
      },
      {
        id: 'plan_enterprise',
        name: 'Enterprise',
        slug: 'enterprise',
        price: Number(process.env.PLAN_ENTERPRISE_PRICE || 999),
        maxAgents: 999,
        maxChannels: 10,
        maxMessages: 999999,
        features: JSON.stringify([
          'Unlimited Agents',
          'All Channels',
          'AI Chatbot',
          'Custom Integrations',
          'Dedicated Support',
          'SLA Guarantee',
        ]),
        stripePriceId: process.env.STRIPE_PRICE_ENTERPRISE || null,
      },
    ],
    ['slug'],
  );

  await channelTypes.upsert(
    [
      {
        type: 'whatsapp',
        label: 'WhatsApp Business',
        icon: 'fab fa-whatsapp',
        color: '#25D366',
        active: true,
        sortOrder: 10,
      },
      {
        type: 'instagram',
        label: 'Instagram DM',
        icon: 'fab fa-instagram',
        color: '#E4405F',
        active: true,
        sortOrder: 20,
      },
      {
        type: 'facebook',
        label: 'Facebook Messenger',
        icon: 'fab fa-facebook-messenger',
        color: '#1877F2',
        active: true,
        sortOrder: 30,
      },
      {
        type: 'telegram',
        label: 'Telegram',
        icon: 'fab fa-telegram',
        color: '#0088cc',
        active: true,
        sortOrder: 40,
      },
      {
        type: 'email',
        label: 'Email',
        icon: 'fas fa-envelope',
        color: '#6366f1',
        active: true,
        sortOrder: 50,
      },
      {
        type: 'sms',
        label: 'SMS',
        icon: 'fas fa-sms',
        color: '#f59e0b',
        active: true,
        sortOrder: 60,
      },
    ],
    ['type'],
  );

  const adminEmail = (process.env.SUPER_ADMIN_EMAIL || 'admin@cberhunt.com').trim().toLowerCase();
  const adminPassword = process.env.SUPER_ADMIN_PASSWORD || 'admin123';
  const existingAdmin = await users.findOne({ where: { email: adminEmail } });

  if (!existingAdmin) {
    await users.save(
      users.create({
        name: 'Super Admin',
        email: adminEmail,
        password: bcrypt.hashSync(adminPassword, 12),
        role: 'super_admin',
        online: false,
      }),
    );
  }

  await AppDataSource.destroy();
  console.log('Seed completed');
}

main().catch(async (error) => {
  console.error(error);
  if (AppDataSource.isInitialized) await AppDataSource.destroy();
  process.exit(1);
});
