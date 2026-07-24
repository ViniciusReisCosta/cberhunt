import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AgentsController } from './agents/agents.controller';
import { AppController } from './app.controller';
import { AuthController } from './auth/auth.controller';
import { AuthService } from './auth/auth.service';
import { ChannelsController } from './channels/channels.controller';
import { ChatbotController } from './chatbot/chatbot.controller';
import { CompaniesController } from './companies/companies.controller';
import { ConversationsController } from './conversations/conversations.controller';
import { entities } from './database/entities';
import { shouldUseDatabaseSsl } from './database/ssl';
import { DashboardController } from './dashboard/dashboard.controller';
import { PaymentsController } from './payments/payments.controller';
import { PlansController } from './plans/plans.controller';
import { PublicController } from './public/public.controller';
import { ApiKeysController } from './settings/api-keys.controller';
import { InvoicesController } from './settings/invoices.controller';
import { NotificationPreferencesController } from './settings/notification-preferences.controller';
import { QuickRepliesController } from './settings/quick-replies.controller';
import { WhatsAppController } from './whatsapp/whatsapp.controller';
import { WhatsAppService } from './whatsapp/whatsapp.service';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    TypeOrmModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        type: 'postgres',
        url: config.get<string>('DATABASE_URL'),
        entities,
        synchronize: config.get<string>('TYPEORM_SYNC') === 'true',
        logging: config.get<string>('TYPEORM_LOGGING') === 'true',
        ssl: shouldUseDatabaseSsl() ? { rejectUnauthorized: false } : false,
      }),
    }),
    TypeOrmModule.forFeature(entities),
  ],
  controllers: [
    AppController,
    AuthController,
    PlansController,
    DashboardController,
    AgentsController,
    ChannelsController,
    CompaniesController,
    ConversationsController,
    ChatbotController,
    QuickRepliesController,
    NotificationPreferencesController,
    ApiKeysController,
    InvoicesController,
    PaymentsController,
    PublicController,
    WhatsAppController,
  ],
  providers: [AuthService, WhatsAppService],
})
export class AppModule {}
