import { Controller, Get, Req } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import type { Request } from 'express';
import { MoreThanOrEqual, Not, Repository } from 'typeorm';
import { AuthService } from '../auth/auth.service';
import { Company } from '../database/entities/company.entity';
import { Conversation } from '../database/entities/conversation.entity';
import { Message } from '../database/entities/message.entity';
import { User } from '../database/entities/user.entity';

@Controller('dashboard')
export class DashboardController {
  constructor(
    private readonly auth: AuthService,
    @InjectRepository(Company)
    private readonly companies: Repository<Company>,
    @InjectRepository(User)
    private readonly users: Repository<User>,
    @InjectRepository(Conversation)
    private readonly conversations: Repository<Conversation>,
    @InjectRepository(Message)
    private readonly messages: Repository<Message>,
  ) {}

  @Get('stats')
  async stats(@Req() req: Request) {
    const user = await this.auth.requireAccess(req);
    const companyId = user.role === 'super_admin' ? null : user.companyId;

    if (user.role !== 'super_admin' && !companyId) {
      return { error: 'No company' };
    }

    const conversationWhere = companyId ? { companyId } : {};
    const messageWhere = companyId ? { conversation: { companyId } } : {};

    const [totalCompanies, totalAgents, totalConversations, totalMessages] = await Promise.all([
      user.role === 'super_admin' ? this.companies.count() : Promise.resolve(undefined),
      this.users.count({
        where: companyId
          ? { companyId, role: Not('super_admin') }
          : { role: Not('super_admin') },
      }),
      this.conversations.count({ where: conversationWhere }),
      this.messages.count({ where: messageWhere }),
    ]);

    const [conversationsByStatus, conversationsByChannel, recentConversations, messagesPerDay] =
      await Promise.all([
        this.groupConversations('status', companyId),
        this.groupConversations('channel', companyId),
        this.recentConversations(companyId),
        this.messagesPerDay(companyId),
      ]);

    return {
      ...(totalCompanies !== undefined ? { totalCompanies } : {}),
      totalAgents,
      totalConversations,
      totalMessages,
      conversationsByStatus,
      conversationsByChannel,
      recentConversations,
      messagesPerDay,
    };
  }

  private async groupConversations(field: 'status' | 'channel', companyId: string | null) {
    const qb = this.conversations
      .createQueryBuilder('conversation')
      .select(`conversation.${field}`, field)
      .addSelect('COUNT(*)', 'count')
      .groupBy(`conversation.${field}`);

    if (companyId) {
      qb.where('conversation.companyId = :companyId', { companyId });
    }

    const rows = await qb.getRawMany<Record<string, string>>();
    return Object.fromEntries(rows.map((row) => [row[field], Number(row.count)]));
  }

  private async recentConversations(companyId: string | null) {
    const conversations = await this.conversations.find({
      where: companyId ? { companyId } : {},
      order: { updatedAt: 'DESC' },
      take: 10,
      relations: { agent: true, company: true },
    });

    return Promise.all(
      conversations.map(async (conversation) => {
        const lastMessage = await this.messages.findOne({
          where: { conversationId: conversation.id },
          order: { createdAt: 'DESC' },
        });

        return {
          id: conversation.id,
          customerName: conversation.customerName,
          channel: conversation.channel,
          status: conversation.status,
          updatedAt: conversation.updatedAt,
          agent: conversation.agent ? { name: conversation.agent.name } : null,
          company: conversation.company ? { name: conversation.company.name } : null,
          messages: lastMessage
            ? [{ content: lastMessage.content, createdAt: lastMessage.createdAt }]
            : [],
        };
      }),
    );
  }

  private async messagesPerDay(companyId: string | null) {
    const sevenDaysAgo = new Date(Date.now() - 7 * 86400000);
    const recentMessages = await this.messages.find({
      where: companyId
        ? { conversation: { companyId }, createdAt: MoreThanOrEqual(sevenDaysAgo) }
        : { createdAt: MoreThanOrEqual(sevenDaysAgo) },
      relations: companyId ? { conversation: true } : {},
      select: { id: true, createdAt: true },
    });

    const days = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sab'];
    return Array.from({ length: 7 }, (_, i) => {
      const d = new Date(Date.now() - (6 - i) * 86400000);
      const count = recentMessages.filter((message) => message.createdAt.toDateString() === d.toDateString()).length;
      return { day: days[d.getDay()], count };
    });
  }
}
