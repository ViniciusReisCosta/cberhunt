import {
  BadRequestException,
  Body,
  Controller,
  Get,
  NotFoundException,
  Param,
  Post,
  Put,
  Query,
  Req,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import type { Request } from 'express';
import { ILike, In, Repository } from 'typeorm';
import { AuthService } from '../auth/auth.service';
import { Channel } from '../database/entities/channel.entity';
import { ChatbotRule } from '../database/entities/chatbot-rule.entity';
import { Company } from '../database/entities/company.entity';
import { Conversation } from '../database/entities/conversation.entity';
import { ConversationTag } from '../database/entities/conversation-tag.entity';
import { Message } from '../database/entities/message.entity';
import { User } from '../database/entities/user.entity';

@Controller('conversations')
export class ConversationsController {
  constructor(
    private readonly auth: AuthService,
    @InjectRepository(Conversation)
    private readonly conversations: Repository<Conversation>,
    @InjectRepository(Message)
    private readonly messages: Repository<Message>,
    @InjectRepository(User)
    private readonly users: Repository<User>,
    @InjectRepository(Channel)
    private readonly channels: Repository<Channel>,
    @InjectRepository(Company)
    private readonly companies: Repository<Company>,
    @InjectRepository(ChatbotRule)
    private readonly chatbotRules: Repository<ChatbotRule>,
    @InjectRepository(ConversationTag)
    private readonly tags: Repository<ConversationTag>,
  ) {}

  @Get()
  async findAll(
    @Req() req: Request,
    @Query('status') status?: string,
    @Query('channel') channel?: string,
    @Query('search') search?: string,
  ) {
    const user = await this.auth.requireAccess(req);
    const where: Record<string, unknown> = {};

    if (user.role !== 'super_admin' && user.companyId) where.companyId = user.companyId;
    if (status) where.status = status;
    if (channel) where.channel = channel;
    if (search) where.customerName = ILike(`%${search}%`);

    const conversations = await this.conversations.find({
      where,
      relations: { agent: true },
      order: { updatedAt: 'DESC' },
    });

    return Promise.all(conversations.map((conversation) => this.serializeConversation(conversation, 'list')));
  }

  @Post()
  async create(
    @Req() req: Request,
    @Body()
    body: {
      customerName?: string;
      channel?: string;
      channelId?: string;
      customerPhone?: string;
      customerEmail?: string;
    },
  ) {
    const user = await this.auth.requireAccess(req);
    const companyId = user.companyId;
    if (!companyId) throw new BadRequestException('No company available');

    const customerName = body.customerName?.trim();
    if (!customerName) throw new BadRequestException('customerName and channel are required');

    const channel = await this.resolveChannel(companyId, body.channelId, body.channel);
    if (!channel?.type) throw new BadRequestException('customerName and channel are required');

    const agentId = await this.assignConversation(companyId);

    const conversation = await this.conversations.save(
      this.conversations.create({
        customerName,
        channel: channel.type,
        channelId: channel.id,
        customerPhone: body.customerPhone?.trim() || null,
        customerEmail: body.customerEmail?.trim() || null,
        companyId,
        agentId,
      }),
    );

    await this.messages.save(
      this.messages.create({
        content: `Conversa iniciada via ${channel.type.charAt(0).toUpperCase() + channel.type.slice(1)}`,
        senderType: 'system',
        conversationId: conversation.id,
      }),
    );

    const created = await this.conversations.findOneOrFail({
      where: { id: conversation.id },
      relations: { agent: true },
    });
    return this.serializeConversation(created, 'detail');
  }

  @Get(':id')
  async findOne(@Req() req: Request, @Param('id') id: string) {
    const user = await this.auth.requireAccess(req);
    const conversation = await this.conversations.findOne({
      where: { id },
      relations: { agent: true },
    });

    if (!conversation) throw new NotFoundException('Not found');
    this.auth.ensureCompanyAccess(user, conversation.companyId);

    return this.serializeConversation(conversation, 'detail');
  }

  @Put(':id')
  async update(@Req() req: Request, @Param('id') id: string, @Body() body: Record<string, unknown>) {
    const user = await this.auth.requireAccess(req);
    const existing = await this.conversations.findOne({ where: { id } });
    if (!existing) throw new NotFoundException('Not found');
    this.auth.ensureCompanyAccess(user, existing.companyId);

    const updateData: Partial<Conversation> = {};
    if (typeof body.status === 'string') updateData.status = body.status;

    if (body.agentId !== undefined) {
      if (body.agentId === null || body.agentId === '') {
        updateData.agentId = null;
      } else if (typeof body.agentId === 'string') {
        const targetAgent = await this.users.findOne({ where: { id: body.agentId } });
        if (!targetAgent || targetAgent.companyId !== existing.companyId) {
          throw new BadRequestException('Invalid agent');
        }
        updateData.agentId = body.agentId;
      }
    }

    await this.conversations.update({ id }, updateData);
    const updated = await this.conversations.findOneOrFail({
      where: { id },
      relations: { agent: true },
    });

    return this.serializeConversation(updated, 'detail');
  }

  @Post(':id/messages')
  async createMessage(
    @Req() req: Request,
    @Param('id') id: string,
    @Body() body: { content?: string; senderType?: string },
  ) {
    const content = body.content?.trim();
    const senderType = body.senderType?.trim();
    if (!content || !senderType) {
      throw new BadRequestException('content and senderType are required');
    }

    const authenticatedUser =
      senderType !== 'customer' && senderType !== 'bot'
        ? await this.auth.requireAccess(req)
        : null;

    const conversation = await this.conversations.findOne({ where: { id } });
    if (!conversation) throw new NotFoundException('Conversation not found');

    if (authenticatedUser) {
      this.auth.ensureCompanyAccess(authenticatedUser, conversation.companyId);
    }

    const message = await this.messages.save(
      this.messages.create({
        content,
        senderType,
        conversationId: id,
        senderId: senderType === 'agent' ? authenticatedUser?.id || null : null,
      }),
    );

    await this.conversations.update(
      { id },
      {
        updatedAt: new Date(),
        ...(senderType === 'customer' ? { unreadCount: conversation.unreadCount + 1 } : {}),
      },
    );

    if (senderType === 'customer') {
      const botReply = await this.getChatbotReply(conversation.companyId, content);
      if (botReply) {
        await this.messages.save(
          this.messages.create({
            content: botReply,
            senderType: 'bot',
            conversationId: id,
          }),
        );
      }
    }

    const created = await this.messages.findOneOrFail({
      where: { id: message.id },
      relations: { sender: true },
    });
    return this.serializeMessage(created);
  }

  private async resolveChannel(
    companyId: string,
    channelId?: string,
    channelType?: string,
  ): Promise<{ id: string | null; type: string } | null> {
    if (channelId) {
      const channel = await this.channels.findOne({ where: { id: channelId } });
      if (!channel || channel.companyId !== companyId) return null;
      return channel;
    }

    const type = channelType?.trim();
    if (!type) return null;

    const configured = await this.channels.findOne({
      where: { companyId, type, connected: true },
      order: { createdAt: 'ASC' },
    });

    return configured ? { id: configured.id, type: configured.type } : { id: null, type };
  }

  private async assignConversation(companyId: string) {
    const agents = await this.users.find({
      where: {
        companyId,
        role: In(['agent', 'company_admin']),
        online: true,
      },
      order: { createdAt: 'ASC' },
    });

    if (agents.length === 0) {
      const anyAgent = await this.users.findOne({
        where: { companyId, role: In(['agent', 'company_admin']) },
      });
      return anyAgent?.id || null;
    }

    const withCounts = await Promise.all(
      agents.map(async (agent) => ({
        id: agent.id,
        count: await this.conversations.count({
          where: { agentId: agent.id, status: In(['open', 'pending']) },
        }),
      })),
    );

    withCounts.sort((a, b) => a.count - b.count);
    return withCounts[0]?.id || null;
  }

  private async getChatbotReply(companyId: string, message: string) {
    const company = await this.companies.findOne({ where: { id: companyId } });
    if (!company) return null;

    const now = new Date();
    const currentTime = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
    if (currentTime < company.businessHoursStart || currentTime > company.businessHoursEnd) {
      return `Nosso horario de atendimento e das ${company.businessHoursStart} as ${company.businessHoursEnd}. Retornaremos em breve!`;
    }

    const rules = await this.chatbotRules.find({
      where: { companyId, active: true },
    });
    const lowerMsg = message.toLowerCase();

    for (const rule of rules) {
      const keywords = rule.keyword.toLowerCase().split(',').map((keyword) => keyword.trim());
      if (keywords.some((keyword) => keyword && lowerMsg.includes(keyword))) {
        return rule.response;
      }
    }

    return null;
  }

  private async serializeConversation(conversation: Conversation, mode: 'list' | 'detail') {
    const [messages, tags] = await Promise.all([
      this.messages.find({
        where: { conversationId: conversation.id },
        order: { createdAt: mode === 'detail' ? 'ASC' : 'DESC' },
        take: mode === 'detail' ? undefined : 1,
        relations: { sender: true },
      }),
      this.tags.find({ where: { conversationId: conversation.id }, order: { createdAt: 'ASC' } }),
    ]);

    return {
      id: conversation.id,
      customerName: conversation.customerName,
      customerEmail: conversation.customerEmail,
      customerPhone: conversation.customerPhone,
      customerAvatar: conversation.customerAvatar,
      channel: conversation.channel,
      status: conversation.status,
      unreadCount: conversation.unreadCount,
      companyId: conversation.companyId,
      channelId: conversation.channelId,
      agentId: conversation.agentId,
      agent: conversation.agent
        ? { id: conversation.agent.id, name: conversation.agent.name, role: conversation.agent.role }
        : null,
      createdAt: conversation.createdAt,
      updatedAt: conversation.updatedAt,
      tags: tags.map((tag) => ({ id: tag.id, label: tag.label, color: tag.color })),
      messages: messages.map((message) => this.serializeMessage(message)),
    };
  }

  private serializeMessage(message: Message) {
    return {
      id: message.id,
      content: message.content,
      senderType: message.senderType,
      senderId: message.senderId,
      sender: message.sender
        ? {
            id: message.sender.id,
            name: message.sender.name,
            role: message.sender.role,
          }
        : null,
      read: message.read,
      createdAt: message.createdAt,
    };
  }
}
