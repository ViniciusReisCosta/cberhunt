import { Controller, Get } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Channel } from '../database/entities/channel.entity';
import { Company, PaymentStatus } from '../database/entities/company.entity';
import { Conversation } from '../database/entities/conversation.entity';
import { Message } from '../database/entities/message.entity';

@Controller('public')
export class PublicController {
  constructor(
    @InjectRepository(Company)
    private readonly companies: Repository<Company>,
    @InjectRepository(Message)
    private readonly messages: Repository<Message>,
    @InjectRepository(Channel)
    private readonly channels: Repository<Channel>,
    @InjectRepository(Conversation)
    private readonly conversations: Repository<Conversation>,
  ) {}

  @Get('metrics')
  async metrics() {
    const [companies, activeCompanies, messages, connectedChannels, conversations] = await Promise.all([
      this.companies.count(),
      this.companies.count({ where: { active: true, paymentStatus: PaymentStatus.Paid } }),
      this.messages.count(),
      this.channels.count({ where: { connected: true } }),
      this.conversations.count(),
    ]);

    return {
      companies,
      activeCompanies,
      messages,
      connectedChannels,
      conversations,
    };
  }
}

